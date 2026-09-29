/**
 * WarWatchdogSystem.js
 * 300s 战争交火超时双门限防伪看门狗系统 (TC-EDGE-04)
 * 严格遵照 SPEC-M3-CONTRACT §2.3
 *
 * 核心机制:
 * 1. 门限 1: 60 秒无有效战果战意消磨 (排除中立野怪伪保活与回血伪保活)，双方每秒扣除 5.0 点士气
 * 2. 门限 2: 300 秒战争绝对硬熔断，广播 EVT_PAX_DIVINA_FORCED，施加 120s 和平锁，清除 IN_COMBAT
 * 3. 停战离心退避 (Centrifugal Retreat): 休战瞬间推离重叠单位，杜绝抽搐死循环
 * 4. 100% 物理零 GC (平铺连续 TypedArray 维护交战状态)
 */

import {
  NULL_ENTITY,
  TOTAL_SLOTS,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL
} from '../core/ECS.js';
import {
  IN_COMBAT,
  IS_ALIVE,
  hasStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';
import { DomainEvents } from '../data/DomainEvents.js';

export const MAX_FACTIONS = 16;
export const WAR_STALEMATE_TIMEOUT = 60.0;    // 门限 1: 60s 僵局无战果时间 (秒)
export const WAR_MAX_DURATION = 300.0;         // 门限 2: 300s 战争绝对硬熔断 (秒)
export const WAR_MORALE_ATTRITION_RATE = 5.0;  // 战意消磨每秒扣减士气 (点/秒)
export const FORCED_PEACE_LOCK_SECONDS = 120.0;// 绝对和平锁持续时间 (秒)
export const CENTRIFUGAL_SEPARATION_DIST = 48.0;// 离心退避重叠排斥距离 (px)

export class WarWatchdogSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {import('../core/EventBus.js').EventBus|null} [eventBus=null] 
   * @param {import('./BorderFrictionSystem.js').BorderFrictionSystem|null} [borderFrictionSystem=null] 
   * @param {import('./MoraleSystem.js').MoraleSystem|null} [moraleSystem=null] 
   */
  constructor(ecs, eventBus = null, borderFrictionSystem = null, moraleSystem = null) {
    this.ecs = ecs;
    this.eventBus = eventBus;
    this.borderFrictionSystem = borderFrictionSystem;
    this.moraleSystem = moraleSystem;

    // 16x16 阵营对平铺数组 (256 元素)
    const pairCount = MAX_FACTIONS * MAX_FACTIONS;
    this.warActive = new Uint8Array(pairCount);            // 0=非战争, 1=战争中
    this.warDuration = new Float32Array(pairCount);        // 累计战争时长 (秒)
    this.stalemateTimer = new Float32Array(pairCount);     // 连续无有效战果时长 (秒)

    // 图腾实体与 HP 快照
    this.totemEntityIds = new Int32Array(MAX_FACTIONS + 1);
    this.totemLastHp = new Float32Array(MAX_FACTIONS + 1);

    // 监听全局宣战事件自动注册
    if (this.eventBus) {
      if (typeof this.eventBus.subscribe === 'function') {
        this.eventBus.subscribe(DomainEvents.EVT_WAR_DECLARED, (type, src, dst) => {
          this.startWar(src, dst);
        });
      } else if (typeof this.eventBus.on === 'function') {
        this.eventBus.on(DomainEvents.EVT_WAR_DECLARED, (facA, facB) => {
          this.startWar(facA, facB);
        });
      }
    }
  }

  /**
   * 计算阵营对索引
   * @private
   */
  _index(facA, facB) {
    return (facA - 1) * MAX_FACTIONS + (facB - 1);
  }

  /**
   * 注册阵营图腾实体 ID 与初始生命快照
   * @param {number} factionId 
   * @param {number} totemEntityId 
   */
  registerTotem(factionId, totemEntityId) {
    if (factionId <= 0 || factionId > MAX_FACTIONS) return;
    this.totemEntityIds[factionId] = totemEntityId;
    if (totemEntityId > NULL_ENTITY && this.ecs.isAlive(totemEntityId)) {
      const hpOff = totemEntityId * HEALTH_STRIDE;
      this.totemLastHp[factionId] = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
    }
  }

  /**
   * 启动战争监控
   * @param {number} facA 
   * @param {number} facB 
   */
  startWar(facA, facB) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return;

    const idxAB = this._index(facA, facB);
    const idxBA = this._index(facB, facA);

    this.warActive[idxAB] = 1;
    this.warActive[idxBA] = 1;
    this.warDuration[idxAB] = 0.0;
    this.warDuration[idxBA] = 0.0;
    this.stalemateTimer[idxAB] = 0.0;
    this.stalemateTimer[idxBA] = 0.0;

    // 记录双方图腾当前 HP 快照
    this._snapshotTotemHp(facA);
    this._snapshotTotemHp(facB);
  }

  /**
   * 终止战争监控
   * @param {number} facA 
   * @param {number} facB 
   */
  endWar(facA, facB) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return;

    const idxAB = this._index(facA, facB);
    const idxBA = this._index(facB, facA);

    this.warActive[idxAB] = 0;
    this.warActive[idxBA] = 0;
    this.warDuration[idxAB] = 0.0;
    this.warDuration[idxBA] = 0.0;
    this.stalemateTimer[idxAB] = 0.0;
    this.stalemateTimer[idxBA] = 0.0;
  }

  /**
   * 是否处于战争中
   * @param {number} facA 
   * @param {number} facB 
   * @returns {boolean}
   */
  isWarActive(facA, facB) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return false;
    return this.warActive[this._index(facA, facB)] === 1;
  }

  /**
   * 获取战争累计持续时长
   * @param {number} facA 
   * @param {number} facB 
   * @returns {number}
   */
  getWarDuration(facA, facB) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return 0.0;
    return this.warDuration[this._index(facA, facB)];
  }

  /**
   * 获取无有效战果僵局时长
   * @param {number} facA 
   * @param {number} facB 
   * @returns {number}
   */
  getStalemateTimer(facA, facB) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return 0.0;
    return this.stalemateTimer[this._index(facA, facB)];
  }

  /**
   * 更新图腾 HP 快照
   * @private
   */
  _snapshotTotemHp(facId) {
    const totemId = this.totemEntityIds[facId];
    if (totemId > NULL_ENTITY && this.ecs.isAlive(totemId)) {
      this.totemLastHp[facId] = this.ecs.health[totemId * HEALTH_STRIDE + HP_OFFSET_CURRENT];
    }
  }

  /**
   * 记录战果伤亡 (核心作战单位阵亡)
   * 严苛排除中立小动物/第三方的伪保活
   *
   * @param {number} victimFac 遇害者阵营
   * @param {number} killerFac 击杀者阵营
   */
  recordCasualty(victimFac, killerFac) {
    // 排除中立阵营 (0) 伪保活
    if (victimFac <= 0 || victimFac > MAX_FACTIONS || killerFac <= 0 || killerFac > MAX_FACTIONS || victimFac === killerFac) {
      return;
    }

    const idx = this._index(victimFac, killerFac);
    // 仅当双方处于交战状态时，此伤亡才被视作有效核心战果
    if (this.warActive[idx] === 1) {
      this.stalemateTimer[idx] = 0.0;
      this.stalemateTimer[this._index(killerFac, victimFac)] = 0.0;
    }
  }

  /**
   * 记录图腾实质受创
   * @param {number} facId 
   * @param {number} damageTaken 
   */
  recordTotemDamage(facId, damageTaken) {
    if (facId <= 0 || facId > MAX_FACTIONS || damageTaken < 1.0) return;

    // 重置所有与该阵营处于交战状态阵营对的僵局计时器
    for (let otherFac = 1; otherFac <= MAX_FACTIONS; otherFac++) {
      if (otherFac === facId) continue;
      const idx = this._index(facId, otherFac);
      if (this.warActive[idx] === 1) {
        this.stalemateTimer[idx] = 0.0;
        this.stalemateTimer[this._index(otherFac, facId)] = 0.0;
      }
    }
    this._snapshotTotemHp(facId);
  }

  /**
   * 门限 2: 300 秒战争绝对硬熔断，强制神圣休战 (Pax Divina)
   * @param {number} facA 
   * @param {number} facB 
   */
  forcePaxDivina(facA, facB) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return;

    // 1. 广播关键事务领域事件 EVT_PAX_DIVINA_FORCED (0x8005)
    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_PAX_DIVINA_FORCED, facA, facB, 0, 0);
    }

    // 2. 清除两阵营战争状态
    this.endWar(facA, facB);

    // 3. 施加 120s 绝对和平锁与清空摩擦
    if (this.borderFrictionSystem) {
      this.borderFrictionSystem.enforcePeace(facA, facB, FORCED_PEACE_LOCK_SECONDS);
    }

    // 4. 清除双方所有存活士兵的 IN_COMBAT 状态
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f === facA || f === facB) {
        clearStatus(this.ecs.statusFlags, eid, IN_COMBAT);
      }
    }

    // 5. 停战离心退避 (Centrifugal Retreat): 重叠单位向相反方向平移
    this._applyCentrifugalRetreat(facA, facB);
  }

  /**
   * 离心退避平移推离算法
   * @private
   */
  _applyCentrifugalRetreat(facA, facB) {
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    // 收集两阵营存活实体并执行空间分离
    for (let i = 0; i < total; i++) {
      const eidA = dense[i];
      if (eidA === NULL_ENTITY) continue;
      const fac1 = this.ecs.identities[eidA * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (fac1 !== facA) continue;

      const tfA = eidA * TRANSFORM_STRIDE;
      const ax = this.ecs.transforms[tfA + TF_OFFSET_X];
      const ay = this.ecs.transforms[tfA + TF_OFFSET_Y];

      for (let j = 0; j < total; j++) {
        const eidB = dense[j];
        if (eidB === NULL_ENTITY || eidA === eidB) continue;
        const fac2 = this.ecs.identities[eidB * IDENTITY_STRIDE + ID_OFFSET_FACTION];
        if (fac2 !== facB) continue;

        const tfB = eidB * TRANSFORM_STRIDE;
        const bx = this.ecs.transforms[tfB + TF_OFFSET_X];
        const by = this.ecs.transforms[tfB + TF_OFFSET_Y];

        const dx = bx - ax;
        const dy = by - ay;
        const dist2 = dx * dx + dy * dy;

        // 若双方距离小于分离阈值 (如 48px)，执行离心推离
        if (dist2 < CENTRIFUGAL_SEPARATION_DIST * CENTRIFUGAL_SEPARATION_DIST) {
          const dist = Math.sqrt(dist2);
          let nx = 1.0;
          let ny = 0.0;
          if (dist > 0.0001) {
            nx = dx / dist;
            ny = dy / dist;
          }

          // 向外反向平移推开
          const push = (CENTRIFUGAL_SEPARATION_DIST - dist) * 0.5 + 4.0;
          this.ecs.transforms[tfA + TF_OFFSET_X] -= nx * push;
          this.ecs.transforms[tfA + TF_OFFSET_Y] -= ny * push;
          this.ecs.transforms[tfB + TF_OFFSET_X] += nx * push;
          this.ecs.transforms[tfB + TF_OFFSET_Y] += ny * push;

          // 物理动量归零，彻底终止推搡互咬
          const phyA = eidA * PHYSICS_STRIDE;
          const phyB = eidB * PHYSICS_STRIDE;
          this.ecs.physics[phyA + PHY_OFFSET_VX] = 0.0;
          this.ecs.physics[phyA + PHY_OFFSET_VY] = 0.0;
          this.ecs.physics[phyB + PHY_OFFSET_VX] = 0.0;
          this.ecs.physics[phyB + PHY_OFFSET_VY] = 0.0;
        }
      }
    }
  }

  /**
   * 系统每帧更新
   * 绝对零 GC
   * @param {number} dt 帧间隔 (秒)
   */
  update(dt) {
    // 1. 图腾 HP 实质扣减监测 (防止回血伪保活)
    for (let f = 1; f <= MAX_FACTIONS; f++) {
      const totemId = this.totemEntityIds[f];
      if (totemId > NULL_ENTITY && this.ecs.isAlive(totemId)) {
        const hpOff = totemId * HEALTH_STRIDE;
        const curHp = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
        const lastHp = this.totemLastHp[f];

        if (curHp < lastHp - 1.0) {
          // 实质受创 >= 1.0 HP，刷新战果
          this.recordTotemDamage(f, lastHp - curHp);
        } else if (curHp > lastHp) {
          // 回血更新快照，但不重置僵局计时器
          this.totemLastHp[f] = curHp;
        }
      }
    }

    // 2. 遍历所有交战阵营对
    for (let facA = 1; facA <= MAX_FACTIONS; facA++) {
      for (let facB = facA + 1; facB <= MAX_FACTIONS; facB++) {
        const idx = this._index(facA, facB);
        if (this.warActive[idx] !== 1) continue;

        // 推进战争持续时长与僵局计时器
        this.warDuration[idx] += dt;
        this.warDuration[this._index(facB, facA)] = this.warDuration[idx];

        this.stalemateTimer[idx] += dt;
        this.stalemateTimer[this._index(facB, facA)] = this.stalemateTimer[idx];

        // 检查门限 2: 300 秒绝对硬熔断
        if (this.warDuration[idx] >= WAR_MAX_DURATION) {
          this.forcePaxDivina(facA, facB);
          continue;
        }

        // 检查门限 1: 60 秒战意消磨 (仅对超出 60s 门限的有效时长扣除士气)
        if (this.stalemateTimer[idx] > WAR_STALEMATE_TIMEOUT) {
          const overDt = Math.min(dt, this.stalemateTimer[idx] - WAR_STALEMATE_TIMEOUT);
          if (overDt > 0.0) {
            this._applyMoraleAttrition(facA, facB, overDt);
          }
        }
      }
    }
  }

  /**
   * 门限 1 战意消磨: 交战双方全体士兵士气每秒强制扣除 5.0 点
   * @private
   */
  _applyMoraleAttrition(facA, facB, dt) {
    const penalty = WAR_MORALE_ATTRITION_RATE * dt;
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f === facA || f === facB) {
        const mOff = eid * MORALE_STRIDE;
        const curMorale = this.ecs.morale[mOff + MORALE_OFFSET_VAL];
        const nextMorale = Math.max(0.0, curMorale - penalty);
        if (this.moraleSystem && typeof this.moraleSystem.setMorale === 'function') {
          this.moraleSystem.setMorale(eid, nextMorale);
        } else {
          this.ecs.morale[mOff + MORALE_OFFSET_VAL] = nextMorale;
        }
      }
    }
  }
}
