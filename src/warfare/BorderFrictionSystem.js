/**
 * BorderFrictionSystem.js
 * 边境摩擦三阶梯状态机与外交宣战系统
 * 
 * 核心设计指标 (Milestone 3 契约 1.2 节):
 * 1. 阶段 0: 中立相安无事 (0)
 * 2. 阶段 1: 微观私怨与打砸抢 (1 ~ 29)
 * 3. 阶段 2: 边境哨戒与小队械斗 (30 ~ 69)
 * 4. 阶段 3: 战争长鸣与军团总攻 (>= 70)
 * 5. 摩擦增量事件源 (偷粮+10, 互殴+15, 将领被杀+45直接阶段3)
 * 6. 仇怨满 70 或图腾受袭自动宣战 (EVT_WAR_DECLARED)
 * 7. 血誓同盟连带宣战机制
 * 8. 绝对零 GC: 纯连续 TypedArray 二维矩阵维护
 */

import { DomainEvents } from '../data/DomainEvents.js';
import { MAX_FACTIONS } from '../data/FactionData.js';

export const FrictionStage = Object.freeze({
  NEUTRAL: 0,   // 阶段 0: 中立相安无事 (0)
  FRICTION: 1,  // 阶段 1: 微观私怨与打砸抢 (1 ~ 29)
  SKIRMISH: 2,  // 阶段 2: 边境哨戒与小队械斗 (30 ~ 69)
  TOTAL_WAR: 3  // 阶段 3: 战争长鸣与军团总攻 (>= 70)
});

export const FRICTION_STAGE_1_MIN = 1.0;
export const FRICTION_STAGE_2_MIN = 30.0;
export const FRICTION_STAGE_3_MIN = 70.0;

export const FRICTION_STOLEN_FOOD = 10.0;
export const FRICTION_BRAWL_INJURY = 15.0;
export const FRICTION_VIP_KILLED = 45.0;

export class BorderFrictionSystem {
  /**
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null]
   */
  constructor(eventBus = null) {
    this.eventBus = eventBus;

    // 16x16 阵营摩擦张力对称矩阵 (Float32Array: 256, 1KB)
    this.frictionMatrix = new Float32Array(MAX_FACTIONS * MAX_FACTIONS);

    // 16x16 阵营战争状态矩阵 (Uint8Array: 256, 1=战争中)
    this.warStates = new Uint8Array(MAX_FACTIONS * MAX_FACTIONS);

    // 16x16 和平保护期倒计时 (秒)
    this.peaceLocks = new Float32Array(MAX_FACTIONS * MAX_FACTIONS);

    // 各阵营血誓同盟位掩码 (Uint16Array: 16)
    this.alliances = new Uint16Array(MAX_FACTIONS);
  }

  /**
   * 计算阵营对在扁平数组中的索引
   * @private
   */
  _index(facA, facB) {
    const a = (facA - 1) & 0x0F;
    const b = (facB - 1) & 0x0F;
    return (a << 4) | b;
  }

  /**
   * 获取两阵营之间的摩擦张力
   * @param {number} facA 
   * @param {number} facB 
   * @returns {number}
   */
  getFriction(facA, facB) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return 0.0;
    return this.frictionMatrix[this._index(facA, facB)];
  }

  /**
   * 获取两阵营当前所处的摩擦阶梯
   * @param {number} facA 
   * @param {number} facB 
   * @returns {number} FrictionStage 枚举
   */
  getStage(facA, facB) {
    if (this.isAtWar(facA, facB)) return FrictionStage.TOTAL_WAR;
    const f = this.getFriction(facA, facB);
    if (f >= FRICTION_STAGE_3_MIN) return FrictionStage.TOTAL_WAR;
    if (f >= FRICTION_STAGE_2_MIN) return FrictionStage.SKIRMISH;
    if (f >= FRICTION_STAGE_1_MIN) return FrictionStage.FRICTION;
    return FrictionStage.NEUTRAL;
  }

  /**
   * 检查两阵营是否处于全面战争状态
   * @param {number} facA 
   * @param {number} facB 
   * @returns {boolean}
   */
  isAtWar(facA, facB) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return false;
    return this.warStates[this._index(facA, facB)] === 1;
  }

  /**
   * 缔结或解除血誓盟友关系
   * @param {number} facA 
   * @param {number} facB 
   * @param {boolean} [isAllied=true] 
   */
  setAlliance(facA, facB, isAllied = true) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return;
    const bitA = (1 << (facA - 1));
    const bitB = (1 << (facB - 1));

    if (isAllied) {
      this.alliances[facA - 1] |= bitB;
      this.alliances[facB - 1] |= bitA;
    } else {
      this.alliances[facA - 1] &= ~bitB;
      this.alliances[facB - 1] &= ~bitA;
    }
  }

  /**
   * 检查两阵营是否为血誓同盟
   * @param {number} facA 
   * @param {number} facB 
   * @returns {boolean}
   */
  isAllied(facA, facB) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return false;
    return (this.alliances[facA - 1] & (1 << (facB - 1))) !== 0;
  }

  /**
   * 记录摩擦张力事件增量
   * @param {number} facA 
   * @param {number} facB 
   * @param {number} amount 
   */
  recordFriction(facA, facB, amount) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return;

    const idxAB = this._index(facA, facB);
    const idxBA = this._index(facB, facA);

    // 和平锁期间免除摩擦积累
    if (this.peaceLocks[idxAB] > 0.0) return;

    const oldStage = this.getStage(facA, facB);
    const nextFriction = Math.min(100.0, this.frictionMatrix[idxAB] + amount);
    this.frictionMatrix[idxAB] = nextFriction;
    this.frictionMatrix[idxBA] = nextFriction;

    const newStage = this.getStage(facA, facB);

    // 阶梯升级事件
    if (newStage > oldStage && this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_FRICTION_ESCALATED, facA, facB, newStage, 0);
    }

    // 突破 70 触发全面宣战
    if (nextFriction >= FRICTION_STAGE_3_MIN && !this.isAtWar(facA, facB)) {
      this.declareWar(facA, facB);
    }
  }

  /**
   * 皇子或将领阵亡，瞬间注入 +45 张力并直接跃迁至阶段 3 全面宣战
   * @param {number} killerFac 
   * @param {number} victimFac 
   */
  onPrinceOrGeneralKilled(killerFac, victimFac) {
    this.recordFriction(victimFac, killerFac, FRICTION_VIP_KILLED);
    if (!this.isAtWar(victimFac, killerFac)) {
      this.declareWar(victimFac, killerFac);
    }
  }

  /**
   * 图腾遭敌军突袭，直接引爆宣战
   * @param {number} attackerFac 
   * @param {number} defenderFac 
   */
  onTotemAttacked(attackerFac, defenderFac) {
    if (!this.isAtWar(defenderFac, attackerFac)) {
      this.declareWar(defenderFac, attackerFac);
    }
  }

  /**
   * 正式对外宣战
   * @param {number} attackerFac 
   * @param {number} defenderFac 
   */
  declareWar(attackerFac, defenderFac) {
    if (attackerFac <= 0 || attackerFac > MAX_FACTIONS || defenderFac <= 0 || defenderFac > MAX_FACTIONS || attackerFac === defenderFac) return;

    const idxAB = this._index(attackerFac, defenderFac);
    const idxBA = this._index(defenderFac, attackerFac);

    if (this.peaceLocks[idxAB] > 0.0) return; // 处于和平锁
    if (this.warStates[idxAB] === 1) return;  // 已宣战

    this.warStates[idxAB] = 1;
    this.warStates[idxBA] = 1;
    this.frictionMatrix[idxAB] = Math.max(FRICTION_STAGE_3_MIN, this.frictionMatrix[idxAB]);
    this.frictionMatrix[idxBA] = Math.max(FRICTION_STAGE_3_MIN, this.frictionMatrix[idxBA]);

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_WAR_DECLARED, attackerFac, defenderFac, 0, 0);
    }

    // 外交连带宣战机制: 宣战方的盟友自动对被宣战方宣战
    const allyMask = this.alliances[attackerFac - 1];
    for (let c = 1; c <= MAX_FACTIONS; c++) {
      if (c === attackerFac || c === defenderFac) continue;
      if ((allyMask & (1 << (c - 1))) !== 0) {
        if (!this.isAtWar(c, defenderFac)) {
          this.declareWar(c, defenderFac);
        }
      }
    }
  }

  /**
   * 强制停战协议
   * @param {number} facA 
   * @param {number} facB 
   * @param {number} [peaceLockSeconds=120.0] 
   */
  enforcePeace(facA, facB, peaceLockSeconds = 120.0) {
    if (facA <= 0 || facA > MAX_FACTIONS || facB <= 0 || facB > MAX_FACTIONS || facA === facB) return;

    const idxAB = this._index(facA, facB);
    const idxBA = this._index(facB, facA);

    this.warStates[idxAB] = 0;
    this.warStates[idxBA] = 0;
    this.frictionMatrix[idxAB] = 0.0;
    this.frictionMatrix[idxBA] = 0.0;
    this.peaceLocks[idxAB] = peaceLockSeconds;
    this.peaceLocks[idxBA] = peaceLockSeconds;
  }

  /**
   * 系统每帧更新 (推进和平锁倒计时)
   * 绝对零 GC
   * @param {number} dt 
   */
  update(dt) {
    for (let i = 0; i < this.peaceLocks.length; i++) {
      if (this.peaceLocks[i] > 0.0) {
        this.peaceLocks[i] = Math.max(0.0, this.peaceLocks[i] - dt);
      }
    }
  }
}
