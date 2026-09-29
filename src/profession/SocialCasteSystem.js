/**
 * SocialCasteSystem.js
 * 四大社会阶级动态晋升与领袖继承无环有限状态机 (FSM) 系统
 * 
 * 核心指标 (Milestone 2 契约 2.1 ~ 2.3 节 & TC-EDGE-05):
 * 1. 驱逐声望虚空属性，纯依靠实体劳作履历 (expLabor) 与战斗履历 (expCombat) 驱动；
 * 2. 15.0s 晋升防振荡滞后冷却锁 (promotionCooldown)，杜绝高频跃迁死锁；
 * 3. 领袖唯一性硬性约束: 每个阵营同时存活领袖严格 <= 1，老领袖驾崩后在 3.0s~5.0s 内完成继承选举加冕，无并发双王，无永久无主死锁；
 * 4. 战俘奴隶熔断: 带有 IS_SLAVE 掩码单位绝对锁死在 CIVILIAN，不响应任何晋升；
 * 5. 100% 物理零 GC: 全程依托平铺连续 TypedArray 与预分配缓冲区。
 */

import {
  NULL_ENTITY,
  TOTAL_SLOTS,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y
} from '../core/ECS.js';

import {
  CASTE_STRIDE,
  CASTE_OFFSET_TYPE,
  CASTE_OFFSET_EXP_LABOR,
  CASTE_OFFSET_EXP_COMBAT,
  CASTE_OFFSET_COOLDOWN,
  CasteType,
  PROMOTION_COOLDOWN_SECONDS,
  createSocialCasteBuffer,
  resetSocialCaste
} from '../components/SocialCasteComponent.js';

import {
  IS_ALIVE,
  IS_SLAVE,
  IS_LEADER,
  hasStatus,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';

import { DomainEvents } from '../data/DomainEvents.js';
import { MAX_FACTIONS } from '../data/FactionData.js';

export const FACTION_CAPACITY = 32; // 支持 32 阵营连续索引

export const LABOR_PROMOTION_THRESHOLD = 5.0;     // 平民升工匠所需劳作次数 (人类 3.5)
export const COMBAT_PROMOTION_THRESHOLD = 50.0;   // 平民升士兵所需战斗经验 (人类 35.0)
export const ARTISAN_POP_MAX_RATIO = 0.30;        // 工匠人口上限比例 (30%)
export const SOLDIER_POP_WARTIME_RATIO = 0.40;    // 战时士兵动员比例 (40%)
export const RETIREMENT_SOLDIER_RATIO = 0.50;     // 和平退伍士兵过剩比例 (50%)
export const PEACE_RETIREMENT_SECONDS = 60.0;     // 和平退伍时间门槛 (60s)
export const DEFAULT_HEIR_INTERREGNUM = 3.0;      // 新王即位继承倒计时 (3.0s ~ 5.0s)

export class SocialCasteSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null]
   * @param {object|null} [options=null]
   */
  constructor(ecs, eventBus = null, options = null) {
    this.ecs = ecs;
    this.eventBus = eventBus;
    this.heirInterregnumSeconds = options?.heirInterregnumSeconds || DEFAULT_HEIR_INTERREGNUM;

    // 1. 阶级连续平铺内存池 (Float32Array: 4097 * 4)
    this.castes = createSocialCasteBuffer();

    // 2. 阵营人口普查统计缓冲区 (零 GC 预分配，支持 32 个阵营)
    this.factionTotalPop = new Uint16Array(FACTION_CAPACITY);
    this.factionCivilianCount = new Uint16Array(FACTION_CAPACITY);
    this.factionArtisanCount = new Uint16Array(FACTION_CAPACITY);
    this.factionSoldierCount = new Uint16Array(FACTION_CAPACITY);
    this.factionLeaderCount = new Uint16Array(FACTION_CAPACITY);
    this.factionLeaderEntityId = new Uint16Array(FACTION_CAPACITY);

    // 3. 继承人状态机管理
    this.heirTimers = new Float32Array(FACTION_CAPACITY);
    this.heirPending = new Uint8Array(FACTION_CAPACITY);
    this.heirCandidateId = new Uint16Array(FACTION_CAPACITY);
    this.heirCandidateScore = new Float32Array(FACTION_CAPACITY);

    // 4. 战争与动员状态
    this.factionInWar = new Uint8Array(FACTION_CAPACITY);
    this.factionMobilized = new Uint8Array(FACTION_CAPACITY);
    this.factionPeaceTimers = new Float32Array(FACTION_CAPACITY);

    // 5. 实体所属种族覆盖 (用于人类 30% 门槛折扣等)
    this.entityRaceCode = new Uint8Array(TOTAL_SLOTS); // 0=OTHER, 1=HUMAN
  }

  /**
   * 设置实体的种族代码 (用于人类折扣等特性)
   * @param {number} entityId 
   * @param {string} raceKey 
   */
  setEntityRace(entityId, raceKey) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return;
    this.entityRaceCode[entityId] = (raceKey === 'HUMAN') ? 1 : 0;
  }

  /**
   * 获取实体的当前阶级
   * @param {number} entityId 
   * @returns {number} CasteType 枚举
   */
  getCaste(entityId) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return CasteType.CIVILIAN;
    return (this.castes[entityId * CASTE_STRIDE + CASTE_OFFSET_TYPE] | 0);
  }

  /**
   * 记录实体的劳作产出履历 (平民农耕、建造、搬运)
   * 战俘奴隶绝嗣且熔断晋升
   * @param {number} entityId 
   * @param {number} [amount=1.0] 
   */
  recordLabor(entityId, amount = 1.0) {
    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) return;
    if (hasStatus(this.ecs.statusFlags, entityId, IS_SLAVE)) return; // 奴隶熔断

    const off = entityId * CASTE_STRIDE;
    this.castes[off + CASTE_OFFSET_EXP_LABOR] += amount;
  }

  /**
   * 记录实体的战斗履历 (承伤、击杀)
   * 战俘奴隶绝嗣且熔断晋升
   * @param {number} entityId 
   * @param {number} [damageTaken=0.0] 
   * @param {number} [kills=0] 
   */
  recordCombat(entityId, damageTaken = 0.0, kills = 0) {
    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) return;
    if (hasStatus(this.ecs.statusFlags, entityId, IS_SLAVE)) return; // 奴隶熔断

    const off = entityId * CASTE_STRIDE;
    const combatExp = damageTaken + kills * 50.0;
    this.castes[off + CASTE_OFFSET_EXP_COMBAT] += combatExp;
  }

  /**
   * 设置阵营的战争与总动员状态
   * @param {number} factionId 
   * @param {boolean} inWar 
   * @param {boolean} [mobilized=false] 
   */
  setFactionWarState(factionId, inWar, mobilized = false) {
    if (factionId < 0 || factionId >= FACTION_CAPACITY) return;
    this.factionInWar[factionId] = inWar ? 1 : 0;
    this.factionMobilized[factionId] = mobilized ? 1 : 0;
    if (inWar) {
      this.factionPeaceTimers[factionId] = 0.0;
    }
  }

  /**
   * 处决/阵亡领袖并触发权力交接
   * @param {number} factionId 
   * @param {number} [leaderId=0] 
   */
  killLeader(factionId, leaderId = 0) {
    if (factionId < 0 || factionId >= FACTION_CAPACITY) return;

    const currentLeader = leaderId > 0 ? leaderId : this.factionLeaderEntityId[factionId];
    if (currentLeader > NULL_ENTITY) {
      clearStatus(this.ecs.statusFlags, currentLeader, IS_LEADER);
      this.castes[currentLeader * CASTE_STRIDE + CASTE_OFFSET_TYPE] = CasteType.CIVILIAN;
      this.factionLeaderEntityId[factionId] = 0;
      this.factionLeaderCount[factionId] = 0;

      if (this.eventBus) {
        this.eventBus.emit(DomainEvents.EVT_RULER_DIED, currentLeader, 0, factionId, 0);
      }
    }

    // 开启继承时钟 (3.0s ~ 5.0s)
    this.heirPending[factionId] = 1;
    this.heirTimers[factionId] = this.heirInterregnumSeconds;
    this.heirCandidateId[factionId] = 0;
    this.heirCandidateScore[factionId] = -1.0;
  }

  /**
   * 注册或指定阵营领袖
   * @param {number} entityId 
   * @param {number} factionId 
   */
  registerLeader(entityId, factionId) {
    if (factionId < 0 || factionId >= FACTION_CAPACITY) return;
    this.factionLeaderCount[factionId] = 1;
    this.factionLeaderEntityId[factionId] = entityId;
  }

  /**
   * 重置指定实体的社会阶级数据
   * @param {number} entityId 
   */
  resetEntity(entityId) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return;
    resetSocialCaste(this.castes, entityId);
    this.entityRaceCode[entityId] = 0;
  }

  /**
   * 刷新全阵营人口结构普查 (零 GC 纯数组累加)
   * @private
   */
  _censusFactions() {
    this.factionTotalPop.fill(0);
    this.factionCivilianCount.fill(0);
    this.factionArtisanCount.fill(0);
    this.factionSoldierCount.fill(0);
    this.factionLeaderCount.fill(0);
    this.factionLeaderEntityId.fill(0);

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const id = dense[i];
      if (id === NULL_ENTITY) continue;

      const facId = this.ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (facId < 0 || facId >= FACTION_CAPACITY) continue;

      this.factionTotalPop[facId]++;

      const caste = (this.castes[id * CASTE_STRIDE + CASTE_OFFSET_TYPE] | 0);
      const isLeader = hasStatus(this.ecs.statusFlags, id, IS_LEADER);

      if (isLeader || caste === CasteType.LEADER) {
        this.factionLeaderCount[facId]++;
        this.factionLeaderEntityId[facId] = id;
      } else if (caste === CasteType.ARTISAN) {
        this.factionArtisanCount[facId]++;
      } else if (caste === CasteType.SOLDIER) {
        this.factionSoldierCount[facId]++;
      } else {
        this.factionCivilianCount[facId]++;
      }
    }
  }

  /**
   * 执行单个实体的阶级晋升/转换
   * @private
   * @param {number} entityId 
   * @param {number} newCaste - CasteType
   */
  _promote(entityId, newCaste) {
    const off = entityId * CASTE_STRIDE;
    this.castes[off + CASTE_OFFSET_TYPE] = newCaste;
    // 强制写入 15.0s 防振荡滞后冷却锁
    this.castes[off + CASTE_OFFSET_COOLDOWN] = PROMOTION_COOLDOWN_SECONDS;

    if (newCaste === CasteType.LEADER) {
      setStatus(this.ecs.statusFlags, entityId, IS_LEADER);
    } else {
      clearStatus(this.ecs.statusFlags, entityId, IS_LEADER);
    }

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_CASTE_PROMOTED, entityId, 0, newCaste, 0);
    }
  }

  /**
   * 系统每帧更新与 FSM 晋升推进
   * 绝对零 GC: 热路径无临时对象创建
   * @param {number} dt - 帧步长 (秒)
   */
  update(dt) {
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    // 1. 递减所有实体的防振荡滞后冷却锁
    for (let i = 0; i < total; i++) {
      const id = dense[i];
      if (id === NULL_ENTITY) continue;

      const cdOff = id * CASTE_STRIDE + CASTE_OFFSET_COOLDOWN;
      const cd = this.castes[cdOff];
      if (cd > 0.0) {
        this.castes[cdOff] = Math.max(0.0, cd - dt);
      }
    }

    // 2. 普查全阵营人口结构
    this._censusFactions();

    // 3. 推进阵营和平/继承时钟
    for (let f = 0; f < FACTION_CAPACITY; f++) {
      if (this.factionTotalPop[f] === 0) continue;

      if (this.factionInWar[f] === 0) {
        this.factionPeaceTimers[f] += dt;
      }

      // 继承仲裁 FSM: 领袖数为 0 且阵营有存活人口
      if (this.factionLeaderCount[f] === 0) {
        if (this.heirPending[f] === 0) {
          // 首次察觉无主，启动继承时钟
          this.heirPending[f] = 1;
          this.heirTimers[f] = this.heirInterregnumSeconds;
          this.heirCandidateId[f] = 0;
          this.heirCandidateScore[f] = -1.0;
        } else {
          this.heirTimers[f] -= dt;
          if (this.heirTimers[f] <= 0.0) {
            // 继承倒计时结束，执行加冕！
            this._crownHeir(f);
          }
        }
      } else {
        // 已有合法存活领袖，关闭继承时钟
        this.heirPending[f] = 0;
        this.heirTimers[f] = 0.0;
      }
    }

    // 4. 遍历实体，判定常规阶级转换 (CIVILIAN, ARTISAN, SOLDIER)
    for (let i = 0; i < total; i++) {
      const id = dense[i];
      if (id === NULL_ENTITY) continue;

      // 奴隶熔断: 带有 IS_SLAVE 掩码的单位绝对锁死在 CIVILIAN
      if (hasStatus(this.ecs.statusFlags, id, IS_SLAVE)) {
        this.castes[id * CASTE_STRIDE + CASTE_OFFSET_TYPE] = CasteType.CIVILIAN;
        clearStatus(this.ecs.statusFlags, id, IS_LEADER);
        continue;
      }

      const off = id * CASTE_STRIDE;
      const currentCaste = (this.castes[off + CASTE_OFFSET_TYPE] | 0);
      const cooldown = this.castes[off + CASTE_OFFSET_COOLDOWN];

      // 15s 冷却锁未归零，禁止跃迁
      if (cooldown > 0.0) continue;

      // 领袖不参与普通流转
      if (currentCaste === CasteType.LEADER || hasStatus(this.ecs.statusFlags, id, IS_LEADER)) continue;

      const facId = this.ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      const pop = this.factionTotalPop[facId] || 1;
      const isHuman = this.entityRaceCode[id] === 1;

      // 人类万金油适应被动: 门槛降低 30%
      const laborReq = isHuman ? LABOR_PROMOTION_THRESHOLD * 0.70 : LABOR_PROMOTION_THRESHOLD;
      const combatReq = isHuman ? COMBAT_PROMOTION_THRESHOLD * 0.70 : COMBAT_PROMOTION_THRESHOLD;

      const expLabor = this.castes[off + CASTE_OFFSET_EXP_LABOR];
      const expCombat = this.castes[off + CASTE_OFFSET_EXP_COMBAT];

      // ====== 判定 1: 平民 (CIVILIAN) 的晋升分支 ======
      if (currentCaste === CasteType.CIVILIAN) {
        // 分支 A: 平民 -> 士兵 (优先判定保命战斗)
        const inWar = this.factionInWar[facId] === 1;
        const soldierRatio = this.factionSoldierCount[facId] / pop;

        if (expCombat >= combatReq || (inWar && soldierRatio < SOLDIER_POP_WARTIME_RATIO && expCombat > 0)) {
          this._promote(id, CasteType.SOLDIER);
          this.factionCivilianCount[facId]--;
          this.factionSoldierCount[facId]++;
          continue;
        }

        // 分支 B: 平民 -> 工匠
        const artisanRatio = this.factionArtisanCount[facId] / pop;
        if (expLabor >= laborReq && (artisanRatio < ARTISAN_POP_MAX_RATIO || this.factionArtisanCount[facId] === 0)) {
          this._promote(id, CasteType.ARTISAN);
          this.factionCivilianCount[facId]--;
          this.factionArtisanCount[facId]++;
          continue;
        }
      }

      // ====== 判定 2: 工匠 (ARTISAN) 的动员晋升 ======
      else if (currentCaste === CasteType.ARTISAN) {
        if (this.factionMobilized[facId] === 1) {
          this._promote(id, CasteType.SOLDIER);
          this.factionArtisanCount[facId]--;
          this.factionSoldierCount[facId]++;
          continue;
        }
      }

      // ====== 判定 3: 士兵 (SOLDIER) 的退伍复员 ======
      else if (currentCaste === CasteType.SOLDIER) {
        const peaceTime = this.factionPeaceTimers[facId];
        const soldierRatio = this.factionSoldierCount[facId] / pop;

        if (peaceTime >= PEACE_RETIREMENT_SECONDS && soldierRatio > RETIREMENT_SOLDIER_RATIO) {
          // 退伍复员为工匠或平民
          const newCaste = (this.factionArtisanCount[facId] / pop < ARTISAN_POP_MAX_RATIO)
            ? CasteType.ARTISAN
            : CasteType.CIVILIAN;

          this._promote(id, newCaste);
          this.factionSoldierCount[facId]--;
          if (newCaste === CasteType.ARTISAN) {
            this.factionArtisanCount[facId]++;
          } else {
            this.factionCivilianCount[facId]++;
          }
          continue;
        }
      }
    }
  }

  /**
   * 阵营继承人选举与加冕
   * 确保领袖唯一性约束: 每个阵营活跃存活领袖恒严格 <= 1
   * @private
   * @param {number} factionId 
   */
  _crownHeir(factionId) {
    // 防御性校验: 确认该阵营当前确实无领袖
    if (this.factionLeaderCount[factionId] > 0) {
      this.heirPending[factionId] = 0;
      return;
    }

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    let bestCandidateId = NULL_ENTITY;
    let bestScore = -1.0;

    for (let i = 0; i < total; i++) {
      const id = dense[i];
      if (id === NULL_ENTITY) continue;

      const facId = this.ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (facId !== factionId) continue;

      // 奴隶熔断: 奴隶绝不可继承大统
      if (hasStatus(this.ecs.statusFlags, id, IS_SLAVE)) continue;

      const off = id * CASTE_STRIDE;
      const caste = (this.castes[off + CASTE_OFFSET_TYPE] | 0);
      const expLabor = this.castes[off + CASTE_OFFSET_EXP_LABOR];
      const expCombat = this.castes[off + CASTE_OFFSET_EXP_COMBAT];

      // 评估打分: 士兵权重最高 (1000)，工匠次之 (500)，平民保底 (100)，加上实打实的功勋经验
      let score = 100.0;
      if (caste === CasteType.SOLDIER) score += 1000.0;
      else if (caste === CasteType.ARTISAN) score += 500.0;

      score += expCombat * 2.0 + expLabor * 1.0;

      if (score > bestScore) {
        bestScore = score;
        bestCandidateId = id;
      }
    }

    if (bestCandidateId > NULL_ENTITY) {
      // 成功选出新王，加冕！
      this._promote(bestCandidateId, CasteType.LEADER);
      this.factionLeaderCount[factionId] = 1;
      this.factionLeaderEntityId[factionId] = bestCandidateId;
      this.heirPending[factionId] = 0;
      this.heirTimers[factionId] = 0.0;

      // 向总线广播关键事务加冕事件
      if (this.eventBus) {
        this.eventBus.emit(DomainEvents.EVT_HEIR_CROWNED, bestCandidateId, 0, factionId, 0);
      }
    }
  }
}
