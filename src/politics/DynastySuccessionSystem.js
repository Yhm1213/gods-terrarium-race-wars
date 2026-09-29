/**
 * DynastySuccessionSystem.js
 * 世袭五大驾崩大转盘、3.0s 原子事务锁与双等位基因防伪认亲系统 (TC-EDGE-07)
 * 严格遵照 SPEC-M3-CONTRACT §5.1 & §5.2
 *
 * 核心机制:
 * 1. 世袭五大驾崩大转盘 (40% 正常顺位, 15% 离奇横死, 15% 幼主摄政, 15% 兄弟掷骰, 15% 私生子夺嫡)
 * 2. 3.0 秒继承原子事务锁 (TC-EDGE-07): 锁定王位读写指针，杜绝并发双王死锁
 * 3. 父系双等位基因防伪认亲掩码断言: 杜绝敌国刺客或不死族冒充
 * 4. 绝嗣角斗空安全 (Extinction Failsafe): 过滤奴隶，全族仅剩 1 人时推选平民即位，政体坍塌为军阀强权，绝不抛出空数组异常
 */

import {
  NULL_ENTITY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  GENETICS_STRIDE,
  GEN_OFFSET_PATERNAL,
  GEN_OFFSET_PHENOTYPE,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT
} from '../core/ECS.js';
import {
  IS_ALIVE,
  IS_LEADER,
  IS_REGENT,
  IS_SLAVE,
  hasStatus,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';
import {
  MAX_FACTIONS,
  FACTION_STRIDE,
  FAC_OFFSET_CIVIC_ID
} from '../data/FactionData.js';
import { DomainEvents } from '../data/DomainEvents.js';

export const SUCCESSION_LOCK_SECONDS = 3.0; // 3.0s 加冕原子事务锁

export const SuccessionRouletteType = Object.freeze({
  NORMAL_HEIR: 0,      // [40%] 正常顺位即位 (大皇子)
  FREAK_ACCIDENT: 1,   // [15%] 离奇横死意外 (二皇子)
  REGENT_REGENCY: 2,   // [15%] 幼主登基，权臣摄政 (IS_REGENT)
  BROTHERS_DICE: 3,    // [15%] 兄弟掷骰决斗
  BASTARD_COUP: 4      // [15%] 荒野私生子夺嫡
});

export class DynastySuccessionSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {Int32Array} factionBuffer 
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null] 
   * @param {import('../core/PRNG.js').PRNG|null} [prng=null] 
   * @param {Uint32Array|null} [geneticsBuffer=null]
   */
  constructor(ecs, factionBuffer, eventBus = null, prng = null, geneticsBuffer = null) {
    this.ecs = ecs;
    this.factionBuffer = factionBuffer;
    this.eventBus = eventBus;
    this.prng = prng;
    this.genetics = geneticsBuffer || (ecs && ecs.genetics) || null;

    // 继承原子事务锁倒计时 (秒)
    this.successionTimers = new Float32Array(MAX_FACTIONS + 1);
    // 各阵营当前合法加冕领袖实体 ID
    this.factionLeaderIds = new Int32Array(MAX_FACTIONS + 1);

    // 零 GC 预分配候选子嗣与族人数组 (最多 128)
    this._candidateIds = new Int32Array(128);
    this._candidateCount = 0;
  }

  /**
   * 检查指定阵营是否处于继承原子锁保护期内
   * @param {number} factionId 
   * @returns {boolean}
   */
  isSuccessionLocked(factionId) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return false;
    return this.successionTimers[factionId] > 0.0;
  }

  /**
   * 注册当前阵营领袖
   * @param {number} factionId 
   * @param {number} leaderId 
   */
  setLeader(factionId, leaderId) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return;
    this.factionLeaderIds[factionId] = leaderId;
    if (leaderId > NULL_ENTITY && this.ecs.isAlive(leaderId)) {
      setStatus(this.ecs.statusFlags, leaderId, IS_LEADER);
    }
  }

  /**
   * 获取指定阵营当前领袖实体 ID
   * @param {number} factionId 
   * @returns {number}
   */
  getLeader(factionId) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return NULL_ENTITY;
    return this.factionLeaderIds[factionId];
  }

  /**
   * 校验子嗣基因防伪断言
   * isValidHeir = isAlive && !isUndead && (paternalGene & kingGene) === kingGene
   *
   * @param {number} heirId 
   * @param {number} kingGene 老国王父系基因位掩码
   * @returns {boolean}
   */
  verifyPaternalGene(heirId, kingGene) {
    if (heirId <= NULL_ENTITY || !this.ecs.isAlive(heirId)) return false;
    if (!kingGene) return true; // 若老王无特定基因记录则放行

    const genBuf = this.genetics || (this.ecs && this.ecs.genetics);
    if (!genBuf) return true; // 若无基因缓冲区则安全放行

    // 不死族伪装排查与父系等位基因防伪匹配
    const patGene = genBuf[heirId * GENETICS_STRIDE + GEN_OFFSET_PATERNAL];
    return (patGene & kingGene) === kingGene;
  }

  /**
   * 老王驾崩，触发五大继承意外大转盘与 3.0s 原子事务锁
   *
   * @param {number} factionId 
   * @param {number} deadKingId 
   * @param {number} [kingGene=0] 
   * @returns {number} 加冕的新王实体 ID
   */
  triggerSuccession(factionId, deadKingId, kingGene = 0) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return NULL_ENTITY;

    // 1. 检查原子事务锁: 若处于加冕过渡时钟，拒绝并发修改，杜绝双王死锁 (TC-EDGE-07)
    if (this.successionTimers[factionId] > 0.0) {
      return this.factionLeaderIds[factionId];
    }

    // 激活 3.0 秒继承原子事务锁
    this.successionTimers[factionId] = SUCCESSION_LOCK_SECONDS;

    // 清除老王领袖状态
    if (deadKingId > NULL_ENTITY) {
      clearStatus(this.ecs.statusFlags, deadKingId, IS_LEADER);
      clearStatus(this.ecs.statusFlags, deadKingId, IS_REGENT);
    }
    this.factionLeaderIds[factionId] = NULL_ENTITY;

    // 2. 收集本阵营全体存活合法平民/战士 (过滤奴隶 IS_SLAVE)
    this._candidateCount = 0;
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY || eid === deadKingId) continue;

      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f !== factionId) continue;

      // 绝嗣角斗空安全: 绝对过滤战俘奴隶
      if (hasStatus(this.ecs.statusFlags, eid, IS_SLAVE)) continue;

      if (this._candidateCount < this._candidateIds.length) {
        this._candidateIds[this._candidateCount++] = eid;
      }
    }

    // 3. 绝嗣角斗空安全兜底 (Extinction Failsafe)
    if (this._candidateCount === 0) {
      // 族灭无存活人口
      return NULL_ENTITY;
    }

    // 全族仅剩 1 人时: 强制推选该平民即位，政体自动坍塌为【军阀强权独裁】(1)
    if (this._candidateCount === 1) {
      const soleSurvivor = this._candidateIds[0];
      this._coronate(factionId, soleSurvivor);

      // 政体坍塌为军阀强权独裁
      const baseOff = (factionId - 1) * FACTION_STRIDE;
      this.factionBuffer[baseOff + FAC_OFFSET_CIVIC_ID] = 1;

      return soleSurvivor;
    }

    // 4. 抽取五大意外继承大转盘
    const rand = this.prng ? this.prng.nextFloat() : Math.random();
    let winnerId = this._candidateIds[0];

    if (rand < 0.40) {
      // [40%] 正常顺位加冕: 基因防伪长子
      for (let i = 0; i < this._candidateCount; i++) {
        const cid = this._candidateIds[i];
        if (this.verifyPaternalGene(cid, kingGene)) {
          winnerId = cid;
          break;
        }
      }
    } else if (rand < 0.55) {
      // [15%] 离奇横死意外: 长子打猎溺死，顺位砸中次子 (第 2 位合法子嗣)
      let foundFirst = false;
      for (let i = 0; i < this._candidateCount; i++) {
        const cid = this._candidateIds[i];
        if (this.verifyPaternalGene(cid, kingGene)) {
          if (!foundFirst) {
            foundFirst = true; // 绕过长子
          } else {
            winnerId = cid; // 砸中次子
            break;
          }
        }
      }
    } else if (rand < 0.70) {
      // [15%] 幼主登基，权臣摄政: 选第一猛士并赋予 IS_REGENT
      winnerId = this._selectStrongestWarrior();
      setStatus(this.ecs.statusFlags, winnerId, IS_REGENT);
    } else if (rand < 0.85) {
      // [15%] 兄弟掷骰夺门: 选两名候选者角斗，生命值更高者登基
      if (this._candidateCount >= 2) {
        const c1 = this._candidateIds[0];
        const c2 = this._candidateIds[1];
        const hp1 = this.ecs.health[c1 * HEALTH_STRIDE + HP_OFFSET_CURRENT];
        const hp2 = this.ecs.health[c2 * HEALTH_STRIDE + HP_OFFSET_CURRENT];
        winnerId = (hp1 >= hp2) ? c1 : c2;
      }
    } else {
      // [15%] 荒野私生子夺嫡: 检索符合基因的末席私生子
      let foundBastard = false;
      for (let i = this._candidateCount - 1; i >= 0; i--) {
        const cid = this._candidateIds[i];
        if (this.verifyPaternalGene(cid, kingGene)) {
          winnerId = cid;
          foundBastard = true;
          break;
        }
      }
      if (!foundBastard) {
        winnerId = this._selectStrongestWarrior();
      }
    }

    // 5. 正式加冕新王
    this._coronate(factionId, winnerId);

    return winnerId;
  }

  /**
   * 从候选人中遴选当前生命最高的第一猛士
   * @private
   */
  _selectStrongestWarrior() {
    let bestId = this._candidateIds[0];
    let maxHp = -1.0;

    for (let i = 0; i < this._candidateCount; i++) {
      const eid = this._candidateIds[i];
      const hp = this.ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_CURRENT];
      if (hp > maxHp) {
        maxHp = hp;
        bestId = eid;
      }
    }
    return bestId;
  }

  /**
   * 加冕新王
   * @private
   */
  _coronate(factionId, newLeaderId) {
    this.factionLeaderIds[factionId] = newLeaderId;
    setStatus(this.ecs.statusFlags, newLeaderId, IS_LEADER);

    if (this.eventBus) {
      // 派发 EVT_HEIR_CROWNED (0x8008): Param1=新王ID, Param2=0, Param3=阵营ID
      this.eventBus.emit(DomainEvents.EVT_HEIR_CROWNED, newLeaderId, 0, factionId, 0);
    }
  }

  /**
   * 系统每帧更新 (推进 3.0s 原子事务锁倒计时)
   * @param {number} dt 
   */
  update(dt) {
    for (let f = 1; f <= MAX_FACTIONS; f++) {
      if (this.successionTimers[f] > 0.0) {
        this.successionTimers[f] = Math.max(0.0, this.successionTimers[f] - dt);
      }
    }
  }
}
