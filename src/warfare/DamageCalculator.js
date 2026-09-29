/**
 * DamageCalculator.js
 * 边际递减护甲伤害计算、反伤熔断与 1.5s 内置冷却
 * 严格遵照 SPEC-M3-CONTRACT §2.1 & §2.2
 *
 * 核心特性:
 * 1. 边际递减护甲减伤公式与 -40.0 负护甲死锁阻尼
 * 2. 税后真实反伤与 callDepth >= 3 递归深度熔断 (TC-EDGE-01)
 * 3. 1.5s 全局内置反伤冷却 (ICD)
 * 4. 100% 物理零 GC (复用出参对象)
 */

import {
  NULL_ENTITY,
  TOTAL_SLOTS,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX
} from '../core/ECS.js';
import {
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  CS_OFFSET_BLUNT_RESIST,
  CS_OFFSET_PIERCE_RESIST,
  CS_OFFSET_REFLECT_RATIO
} from '../components/CombatStatsComponent.js';
import {
  IS_ALIVE,
  IS_SACRED_BODY,
  hasStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';

// 伤害类型枚举
export const DAMAGE_TYPE_PHYSICAL = 0; // 普通物理 (护甲减免)
export const DAMAGE_TYPE_BLUNT    = 1; // 钝击物理 (护甲减免 + 钝击抗性)
export const DAMAGE_TYPE_PIERCE   = 2; // 穿刺物理 (护甲减免 + 穿刺抗性)
export const DAMAGE_TYPE_TRUE     = 3; // 真实伤害 (无视护甲与抗性)

// 数值契约硬常量
export const ARMOR_MIN_CLAMP = -40.0;            // 负护甲下限死锁阻尼
export const REFLECT_MAX_CALL_DEPTH = 3;         // 反伤递归熔断深度 (TC-EDGE-01)
export const REFLECT_ICD_SECONDS = 1.5;          // 反伤内置冷却时间 (秒)
export const MIN_PIERCE_DAMAGE = 1.0;            // 保底穿透伤害

export class DamageCalculator {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {import('../core/EventBus.js').EventBus|null} [eventBus=null]
   */
  constructor(ecs, eventBus = null) {
    this.ecs = ecs;
    this.eventBus = eventBus;

    // 上次反伤触发时间戳 (Float32Array(4097)，零 GC 查表)
    this.lastReflectTimes = new Float32Array(TOTAL_SLOTS);

    // 内部零 GC 复用出参对象
    this._calcResult = {
      damageTaken: 0.0,
      actualHpLost: 0.0,
      reflectDamage: 0.0,
      isBlocked: false,
      isDead: false,
      callDepth: 0
    };
  }

  /**
   * 重置指定实体的反伤时间戳
   * @param {number} entityId 
   */
  resetEntity(entityId) {
    if (entityId >= 0 && entityId < TOTAL_SLOTS) {
      this.lastReflectTimes[entityId] = 0.0;
    }
  }

  /**
   * 计算单次交火伤害数值与反伤 (纯数值计算，不改变 ECS 状态)
   * 严格遵守边际递减护甲与负护甲死锁公式
   *
   * @param {number} attackerId 攻击者实体 ID
   * @param {number} victimId 受害者实体 ID
   * @param {number} rawDamage 免伤前原始伤害
   * @param {number} [dmgType=DAMAGE_TYPE_PHYSICAL] 伤害类型
   * @param {number} [callDepth=0] 当前调用深度 (用于反伤递归熔断)
   * @param {number} [now=0.0] 当前游戏时钟 (秒)
   * @param {object|null} [out=null] 可选复用结果对象
   * @returns {{damageTaken: number, actualHpLost: number, reflectDamage: number, isBlocked: boolean, isDead: boolean, callDepth: number}}
   */
  calculateDamage(attackerId, victimId, rawDamage, dmgType = DAMAGE_TYPE_PHYSICAL, callDepth = 0, now = 0.0, out = null) {
    const res = out || this._calcResult;
    res.damageTaken = 0.0;
    res.actualHpLost = 0.0;
    res.reflectDamage = 0.0;
    res.isBlocked = false;
    res.isDead = false;
    res.callDepth = callDepth;

    if (victimId <= NULL_ENTITY || !this.ecs.isAlive(victimId)) {
      return res;
    }

    // 1. 无敌金身霸体守门 (IS_SACRED_BODY 完全免疫伤害)
    if (hasStatus(this.ecs.statusFlags, victimId, IS_SACRED_BODY)) {
      res.isBlocked = true;
      return res;
    }

    if (rawDamage <= 0.0) {
      return res;
    }

    let effectiveDamage = rawDamage;

    // 2. 护甲与抗性边际递减计算 (仅限非真实伤害)
    if (dmgType !== DAMAGE_TYPE_TRUE) {
      const csOff = victimId * COMBAT_STRIDE;
      const rawArmor = this.ecs.combatStats[csOff + CS_OFFSET_ARMOR];

      let damageAfterArmor = rawDamage;

      if (rawArmor >= 0.0) {
        // 正护甲边际递减公式: Reduction = Armor / (Armor + 100.0)
        const damageReduction = rawArmor / (rawArmor + 100.0);
        damageAfterArmor = rawDamage * (1.0 - damageReduction);
      } else {
        // 负护甲阻尼公式: EffectiveArmor = max(-40.0, Armor), Amp = 1.0 + |EffectiveArmor| / 100.0
        const effectiveArmor = Math.max(ARMOR_MIN_CLAMP, rawArmor);
        const damageAmp = 1.0 + Math.abs(effectiveArmor) / 100.0;
        damageAfterArmor = rawDamage * damageAmp;
      }

      // 抗性修正
      let resistMod = 0.0;
      if (dmgType === DAMAGE_TYPE_BLUNT) {
        resistMod = this.ecs.combatStats[csOff + CS_OFFSET_BLUNT_RESIST];
      } else if (dmgType === DAMAGE_TYPE_PIERCE) {
        resistMod = this.ecs.combatStats[csOff + CS_OFFSET_PIERCE_RESIST];
      }

      // 抗性约束在 [-0.40, 0.60] 之间
      resistMod = Math.min(0.60, Math.max(-0.40, resistMod));
      effectiveDamage = damageAfterArmor * (1.0 - resistMod);
    }

    // 3. 保底穿透伤害为 1.0 点
    const finalDamage = Math.max(MIN_PIERCE_DAMAGE, effectiveDamage);
    res.damageTaken = finalDamage;

    // 4. 税后受创 HP 计算
    const hpOff = victimId * HEALTH_STRIDE;
    const curHp = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
    const actualHpLost = Math.min(curHp, finalDamage);
    res.actualHpLost = actualHpLost;
    res.isDead = (curHp - actualHpLost <= 0.0001);

    // 5. 税后真实反伤与递归熔断 (TC-EDGE-01)
    if (callDepth >= REFLECT_MAX_CALL_DEPTH) {
      // 达到递归深度熔断门限，强行终止反伤链路，防止调用栈溢出
      res.reflectDamage = 0.0;
    } else if (actualHpLost > 0.0 && attackerId > NULL_ENTITY && this.ecs.isAlive(attackerId)) {
      const csOff = victimId * COMBAT_STRIDE;
      const reflectRatio = this.ecs.combatStats[csOff + CS_OFFSET_REFLECT_RATIO];

      if (reflectRatio > 0.0) {
        const lastReflectTime = this.lastReflectTimes[victimId];
        // 检查 1.5s 全局内置冷却 (ICD)
        if (now === 0.0 || (now - lastReflectTime) >= REFLECT_ICD_SECONDS) {
          res.reflectDamage = actualHpLost * reflectRatio;
          if (now > 0.0) {
            this.lastReflectTimes[victimId] = now;
          }
        }
      }
    }

    return res;
  }

  /**
   * 应用伤害并结算受害者生命扣减与攻击者反伤递归
   * 包含生命扣除与死锁防范
   *
   * @param {number} attackerId 
   * @param {number} victimId 
   * @param {number} rawDamage 
   * @param {number} [dmgType=DAMAGE_TYPE_PHYSICAL] 
   * @param {number} [callDepth=0] 
   * @param {number} [now=0.0] 
   * @returns {{damageTaken: number, actualHpLost: number, reflectDamage: number, isBlocked: boolean, isDead: boolean, callDepth: number}}
   */
  applyDamage(attackerId, victimId, rawDamage, dmgType = DAMAGE_TYPE_PHYSICAL, callDepth = 0, now = 0.0) {
    const res = this.calculateDamage(attackerId, victimId, rawDamage, dmgType, callDepth, now);

    if (res.actualHpLost > 0.0) {
      const hpOff = victimId * HEALTH_STRIDE;
      const newHp = Math.max(0.0, this.ecs.health[hpOff + HP_OFFSET_CURRENT] - res.actualHpLost);
      this.ecs.health[hpOff + HP_OFFSET_CURRENT] = newHp;

      if (newHp <= 0.0) {
        clearStatus(this.ecs.statusFlags, victimId, IS_ALIVE);
        res.isDead = true;
      }
    }

    // 触发攻击者税后反伤 (以真实伤害反噬，调用深度 +1)
    if (res.reflectDamage > 0.0 && attackerId > NULL_ENTITY && this.ecs.isAlive(attackerId)) {
      this.applyDamage(victimId, attackerId, res.reflectDamage, DAMAGE_TYPE_TRUE, callDepth + 1, now);
    }

    return res;
  }
}
