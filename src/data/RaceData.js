/**
 * @file RaceData.js
 * @description 12 基础种族物理参数字典 (Races)
 * 严格遵循 TDS 2.1 节平衡性配表规范：
 * 吸收专家审查意见，修正角魔/魔像超模属性、挽救真菌人、消除魔眼饥饿自绝，
 * 并将突变禁忌彻底解耦为正交器官掩码 (OrganFlags)。
 */

import { OrganFlags } from './MutationFlags.js';

/**
 * 生存代谢范式枚举 (02_races_and_civilization.md)
 */
export const MetabolicTypes = Object.freeze({
  AGRARIAN:  0, // 农耕开垦型 (人类、森灵、孢子人)
  HUNTER:    1, // 野性捕猎型 (兽化人、蜥蜴人、高山矮人)
  MARAUDER:  2, // 掠夺拾荒型 (地精、绿皮、角魔)
  INORGANIC: 3  // 无机死灵型 (亡灵、魔像、魔眼 - 免除有机饥饿)
});

/**
 * 12 基础种族物理与生态平衡参数全量字典
 * @type {Readonly<Record<string, Readonly<object>>>}
 */
export const Races = Object.freeze({
  ORC: Object.freeze({
    id: 'ORC',
    name: '绿皮菌兽',
    mass: 85.0,           // 物理质量 (kg)，用于冲量守恒碰撞
    baseSpeed: 52.0,      // 基础移速 (px/s)
    baseHp: 140,          // 拉齐 GDD 基准 (140)
    metabolicRate: 1.2,   // 饥饿消耗速率倍率
    metabolicType: MetabolicTypes.MARAUDER,
    tabooMask: OrganFlags.HOLY | OrganFlags.MERCURY, // 禁忌圣灵与水银器官
    resistances: Object.freeze({ blunt: 0.20, pierce: -0.10, fire: -0.20, acid: 0.10 })
  }),

  ELF: Object.freeze({
    id: 'ELF',
    name: '森灵树民',
    mass: 40.0,
    baseSpeed: 68.0,
    baseHp: 85,
    metabolicRate: 0.8,
    metabolicType: MetabolicTypes.AGRARIAN,
    tabooMask: OrganFlags.FLAME | OrganFlags.GAS, // 禁忌火焰与瓦斯器官 (自动重映射为剧毒孢子)
    resistances: Object.freeze({ blunt: -0.10, pierce: 0.10, fire: -0.40, acid: 0.30 })
  }),

  HUMAN: Object.freeze({
    id: 'HUMAN',
    name: '人类帝国',
    mass: 65.0,
    baseSpeed: 58.0,
    baseHp: 100,
    metabolicRate: 1.0,
    metabolicType: MetabolicTypes.AGRARIAN,
    tabooMask: 0,         // 全相容，无任何突变禁忌
    resistances: Object.freeze({ blunt: 0.00, pierce: 0.00, fire: 0.00, acid: 0.00 })
  }),

  DWARF: Object.freeze({
    id: 'DWARF',
    name: '高山矮人',
    mass: 90.0,
    baseSpeed: 42.0,
    baseHp: 130,          // 修复虚高，拉齐 GDD 基准 (130)
    metabolicRate: 1.1,
    metabolicType: MetabolicTypes.HUNTER,
    tabooMask: OrganFlags.WING, // 禁忌薄翼翅膀 (无法长出肉翅)
    resistances: Object.freeze({ blunt: 0.30, pierce: 0.10, fire: 0.20, acid: -0.10 })
  }),

  UNDEAD: Object.freeze({
    id: 'UNDEAD',
    name: '墓园亡灵',
    mass: 38.0,
    baseSpeed: 48.0,
    baseHp: 75,
    metabolicRate: 0.0,   // 零食物消耗
    metabolicType: MetabolicTypes.INORGANIC, // 无机死灵充能
    tabooMask: OrganFlags.HOLY | OrganFlags.FLESH, // 包含圣灵与鲜肉禁忌
    resistances: Object.freeze({ blunt: -0.30, pierce: 0.40, fire: -0.30, acid: 0.50 })
  }),

  GOBLIN: Object.freeze({
    id: 'GOBLIN',
    name: '狂躁地精',
    mass: 26.0,
    baseSpeed: 72.0,      // 微调移速，保持高速但不压倒精灵
    baseHp: 60,
    metabolicRate: 1.3,
    metabolicType: MetabolicTypes.MARAUDER,
    tabooMask: OrganFlags.HOLY,
    resistances: Object.freeze({ blunt: -0.20, pierce: -0.10, fire: 0.30, acid: 0.10 })
  }),

  DEMON: Object.freeze({
    id: 'DEMON',
    name: '深渊角魔',
    mass: 90.0,
    baseSpeed: 55.0,
    baseHp: 130,          // 彻底修复超模 (由 180 砍回 130)
    metabolicRate: 1.5,
    metabolicType: MetabolicTypes.MARAUDER,
    tabooMask: OrganFlags.HOLY | OrganFlags.AQUATIC,
    resistances: Object.freeze({ blunt: 0.15, pierce: 0.05, fire: 0.50, acid: -0.20 }) // 火抗降至合理 0.50
  }),

  LIZARD: Object.freeze({
    id: 'LIZARD',
    name: '沼泽蜥蜴人',
    mass: 65.0,
    baseSpeed: 55.0,
    baseHp: 110,
    metabolicRate: 0.9,
    metabolicType: MetabolicTypes.HUNTER,
    tabooMask: OrganFlags.FLAME,
    resistances: Object.freeze({ blunt: 0.10, pierce: 0.00, fire: -0.20, acid: 0.60 })
  }),

  BEAST: Object.freeze({
    id: 'BEAST',
    name: '荒原兽化人',
    mass: 85.0,
    baseSpeed: 64.0,
    baseHp: 135,
    metabolicRate: 1.4,
    metabolicType: MetabolicTypes.HUNTER,
    tabooMask: OrganFlags.MERCURY | OrganFlags.ELEC,
    resistances: Object.freeze({ blunt: 0.10, pierce: -0.10, fire: -0.10, acid: 0.00 })
  }),

  SPORE: Object.freeze({
    id: 'SPORE',
    name: '孢子真菌人',
    mass: 38.0,
    baseSpeed: 45.0,
    baseHp: 95,           // 挽救蒸发种族 (由 70 恢复至 95)
    metabolicRate: 0.5,
    metabolicType: MetabolicTypes.AGRARIAN,
    tabooMask: OrganFlags.FLAME | OrganFlags.GRANITE,
    resistances: Object.freeze({ blunt: 0.35, pierce: -0.20, fire: -0.35, acid: 0.40 }) // 火抗修正至 -0.35
  }),

  GOLEM: Object.freeze({
    id: 'GOLEM',
    name: '晶石魔像',
    mass: 180.0,          // 修正过大质量 (由 240kg 调至 180kg)
    baseSpeed: 32.0,
    baseHp: 180,          // 修复无解血量黑洞 (由 260 降至 180)
    metabolicRate: 0.0,
    metabolicType: MetabolicTypes.INORGANIC,
    tabooMask: OrganFlags.FLESH | OrganFlags.WING | OrganFlags.AQUATIC,
    resistances: Object.freeze({ blunt: 0.25, pierce: 0.35, fire: 0.20, acid: -0.40 }) // 强化酸液弱点
  }),

  ABERR: Object.freeze({
    id: 'ABERR',
    name: '拟态魔眼',
    mass: 25.0,
    baseSpeed: 68.0,
    baseHp: 85,           // 恢复至 85
    metabolicRate: 0.0,   // 修复饥饿自绝死锁: 修正为严格 0.0 (无机心智生物免饥饿)
    metabolicType: MetabolicTypes.INORGANIC,
    tabooMask: OrganFlags.HOLY | OrganFlags.FLESH,
    resistances: Object.freeze({ blunt: -0.30, pierce: -0.10, fire: 0.10, acid: 0.20 })
  })
});

/**
 * 12 种族顺序列表
 */
export const RaceList = Object.freeze(Object.values(Races));

/**
 * 检查某器官位掩码是否触犯某一种族的变异禁忌
 * @param {string} raceId - 种族 ID
 * @param {number} organMask - 器官掩码
 * @returns {boolean} true 表示触犯禁忌
 */
export function isOrganTaboo(raceId, organMask) {
  const race = Races[raceId];
  if (!race) return false;
  return (race.tabooMask & organMask) !== 0;
}
