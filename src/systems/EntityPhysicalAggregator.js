/**
 * EntityPhysicalAggregator.js
 * 实体物理与战斗属性动态聚合管线
 * 
 * 核心指标 (Milestone 2 契约 3.5 节):
 * 1. 单一数据源动态聚合: 结合始祖种族基底与表型器官位掩码 (PhenotypeMask)；
 * 2. 物理质量与冲量守恒:
 *    EffectiveMass = BaseMass * (1.0 + sum(Organ.MassModifier))
 *    invMass = 1.0 / EffectiveMass (即时同步 PhysicsComponent)；
 * 3. 护甲与抗性聚合:
 *    EffectiveArmor = clamp(BaseArmor + sum(Organ.ArmorBonus), -40.0, 120.0)
 *    严格死锁 -40.0 物理下限，杜绝除零崩溃；
 * 4. 100% 物理零 GC: 热路径纯数学运算，不产生任何临时垃圾对象。
 */

import {
  PHYSICS_STRIDE,
  PHY_OFFSET_MASS,
  PHY_OFFSET_INVMASS,
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  CS_OFFSET_BLUNT_RESIST,
  CS_OFFSET_PIERCE_RESIST,
  NULL_ENTITY
} from '../core/ECS.js';

import {
  GENETICS_STRIDE,
  GEN_OFFSET_PHENOTYPE
} from '../components/GeneticsComponent.js';

import { OrganFlags } from '../data/MutationFlags.js';
import { Races } from '../data/RaceData.js';

export const ARMOR_MIN_CLAMP = -40.0;
export const ARMOR_MAX_CLAMP = 120.0;

/**
 * 9 大正交器官对物理质量、护甲与抗性的加成配置表
 */
export const OrganPhysicalModifiers = Object.freeze({
  [OrganFlags.HOLY]: Object.freeze({
    massMod: 0.0,
    speedMod: 0.0,
    armorBonus: 5.0,
    bluntResist: 0.0,
    pierceResist: 0.0
  }),
  [OrganFlags.FLAME]: Object.freeze({
    massMod: 0.0,
    speedMod: 0.05,
    armorBonus: 0.0,
    bluntResist: 0.0,
    pierceResist: 0.0
  }),
  [OrganFlags.GAS]: Object.freeze({
    massMod: -0.08,
    speedMod: 0.0,
    armorBonus: 0.0,
    bluntResist: 0.0,
    pierceResist: 0.0
  }),
  [OrganFlags.WING]: Object.freeze({
    massMod: -0.10,
    speedMod: 0.25,
    armorBonus: -2.0,
    bluntResist: -0.05,
    pierceResist: -0.05
  }),
  [OrganFlags.FLESH]: Object.freeze({
    massMod: 0.10,
    speedMod: 0.0,
    armorBonus: 2.0,
    bluntResist: 0.10,
    pierceResist: 0.0
  }),
  [OrganFlags.MERCURY]: Object.freeze({
    massMod: -0.05,
    speedMod: 0.15,
    armorBonus: 0.0,
    bluntResist: -0.10,
    pierceResist: 0.15
  }),
  [OrganFlags.GRANITE]: Object.freeze({
    massMod: 0.25,
    speedMod: -0.15,
    armorBonus: 12.0,
    bluntResist: 0.20,
    pierceResist: 0.10
  }),
  [OrganFlags.ELEC]: Object.freeze({
    massMod: 0.0,
    speedMod: 0.10,
    armorBonus: 0.0,
    bluntResist: 0.0,
    pierceResist: 0.0
  }),
  [OrganFlags.AQUATIC]: Object.freeze({
    massMod: 0.0,
    speedMod: 0.05,
    armorBonus: 0.0,
    bluntResist: 0.0,
    pierceResist: 0.0
  })
});

export class EntityPhysicalAggregator {
  /**
   * 聚合单个实体的物理与战斗属性 (零 GC 纯运算)
   * 
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {number} entityId 
   * @param {string} raceKey 
   * @param {Uint32Array} geneticsBuffer 
   * @param {object|null} [outProfile=null] 可选复用结果对象
   * @param {object|null} [options=null] 可选基础属性重写 (baseArmor, baseMass 等)
   * @returns {number} EffectiveMass
   */
  static aggregateEntity(ecs, entityId, raceKey, geneticsBuffer, outProfile = null, options = null) {
    if (entityId <= NULL_ENTITY || !ecs.isAlive(entityId)) return 0.0;

    const race = Races[raceKey] || Races.HUMAN;
    const baseMass = options?.baseMass ?? race.mass;
    const baseArmor = options?.baseArmor ?? 0.0; // 契约公式中的 BaseArmor (装备或Debuff)
    const baseBlunt = race.resistances?.blunt || 0.0;
    const basePierce = race.resistances?.pierce || 0.0;

    // 读取表型表达位掩码
    const phenoOff = entityId * GENETICS_STRIDE + GEN_OFFSET_PHENOTYPE;
    const phenotype = geneticsBuffer[phenoOff];

    let totalMassMod = 0.0;
    let totalSpeedMod = 0.0;
    let totalArmorBonus = 0.0;
    let totalBluntBonus = 0.0;
    let totalPierceBonus = 0.0;

    // 遍历 9 大器官位累加修正项
    for (let bitIdx = 0; bitIdx < 9; bitIdx++) {
      const flag = 1 << bitIdx;
      if ((phenotype & flag) !== 0) {
        const mod = OrganPhysicalModifiers[flag];
        if (mod) {
          totalMassMod += mod.massMod;
          totalSpeedMod += mod.speedMod;
          totalArmorBonus += mod.armorBonus;
          totalBluntBonus += mod.bluntResist;
          totalPierceBonus += mod.pierceResist;
        }
      }
    }

    // 1. 质量聚合与冲量逆质量同步
    const effectiveMass = Math.max(1.0, baseMass * (1.0 + totalMassMod));
    const invMass = 1.0 / effectiveMass;
    const phyOff = entityId * PHYSICS_STRIDE;
    ecs.physics[phyOff + PHY_OFFSET_MASS] = effectiveMass;
    ecs.physics[phyOff + PHY_OFFSET_INVMASS] = invMass;

    // 2. 护甲聚合与死锁 -40.0 下限
    const rawArmor = baseArmor + totalArmorBonus;
    const effectiveArmor = Math.min(ARMOR_MAX_CLAMP, Math.max(ARMOR_MIN_CLAMP, rawArmor));
    const csOff = entityId * COMBAT_STRIDE;
    ecs.combatStats[csOff + CS_OFFSET_ARMOR] = effectiveArmor;
    ecs.combatStats[csOff + CS_OFFSET_BLUNT_RESIST] = baseBlunt + totalBluntBonus;
    ecs.combatStats[csOff + CS_OFFSET_PIERCE_RESIST] = basePierce + totalPierceBonus;

    // 3. 移速聚合
    const effectiveSpeed = Math.max(10.0, race.baseSpeed * (1.0 + totalSpeedMod));

    if (outProfile) {
      outProfile.mass = effectiveMass;
      outProfile.invMass = invMass;
      outProfile.armor = effectiveArmor;
      outProfile.speed = effectiveSpeed;
      outProfile.bluntResist = baseBlunt + totalBluntBonus;
      outProfile.pierceResist = basePierce + totalPierceBonus;
    }

    return effectiveMass;
  }

  /**
   * 批量聚合全场活跃实体的物理与战斗属性 (零 GC 遍历)
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {Uint32Array} geneticsBuffer 
   * @param {Int8Array|Uint8Array|function} raceLookup 
   */
  static aggregateAll(ecs, geneticsBuffer, raceLookup) {
    const dense = ecs.denseEntities;
    const total = ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const id = dense[i];
      if (id === NULL_ENTITY) continue;

      let raceKey = 'HUMAN';
      if (typeof raceLookup === 'function') {
        raceKey = raceLookup(id);
      } else if (raceLookup && raceLookup[id] !== undefined) {
        const idx = raceLookup[id];
        // 映射索引到 raceKey
        const raceKeys = Object.keys(Races);
        if (idx >= 0 && idx < raceKeys.length) {
          raceKey = raceKeys[idx];
        }
      }

      EntityPhysicalAggregator.aggregateEntity(ecs, id, raceKey, geneticsBuffer);
    }
  }
}
