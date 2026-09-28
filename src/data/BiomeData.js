/**
 * @file BiomeData.js
 * @description 生物群系环境参数字典 (Biomes)
 * 严格遵循 TDS 2.3 节设计规范：
 * 修复养分量纲超标 100 倍问题，严格拉齐 GDD 的 [0.0, 1.0] 规范，
 * 并建立深水绝壁阻挡与浅水滩涂通行分流。
 */

/**
 * 地形危险伤害类型枚举 (HazardTypes)
 */
export const HazardTypes = Object.freeze({
  NONE: 0,    // 无危险
  FIRE: 1,    // 烈焰灼烧 (每秒真伤)
  ACID: 2,    // 腐蚀沼泽 (减速 + 每秒真伤)
  HOLY: 3     // 神圣愈合 (每秒负伤害即治疗)
});

/**
 * 生物群系环境参数全量字典
 * @type {Readonly<Record<string, Readonly<{
 *   id: number,
 *   name: string,
 *   moveCostMultiplier: number,
 *   nutrientFloor: number,
 *   hazardType: number,
 *   hazardDps: number,
 *   colorCode: string
 * }>>>}
 */
export const Biomes = Object.freeze({
  PLAINS: Object.freeze({
    id: 0,
    name: '温带平原',
    moveCostMultiplier: 1.0,
    nutrientFloor: 0.25,      // 修正量纲: 0.25 (催生长草与普通浆果)
    hazardType: HazardTypes.NONE,
    hazardDps: 0.0,
    colorCode: '#4a8505'
  }),
  MOUNTAINS: Object.freeze({
    id: 1,
    name: '高山岩矿',
    moveCostMultiplier: 1.5,
    nutrientFloor: 0.05,      // 贫瘠岩石
    hazardType: HazardTypes.NONE,
    hazardDps: 0.0,
    colorCode: '#736d71'
  }),
  SHALLOW_WATER: Object.freeze({
    id: 2,
    name: '浅水滩涂',
    moveCostMultiplier: 2.0,  // 减速通行
    nutrientFloor: 0.30,
    hazardType: HazardTypes.NONE,
    hazardDps: 0.0,
    colorCode: '#3a7b9c'
  }),
  DEEP_WATER: Object.freeze({
    id: 3,
    name: '深水绝壁',
    moveCostMultiplier: 999.0,// 绝对不可通行阻挡
    nutrientFloor: 0.10,
    hazardType: HazardTypes.NONE,
    hazardDps: 0.0,
    colorCode: '#163854'
  }),
  SWAMP: Object.freeze({
    id: 4,
    name: '腐蚀沼泽',
    moveCostMultiplier: 1.8,
    nutrientFloor: 0.40,
    hazardType: HazardTypes.ACID, // 腐蚀减速，每秒 1 点真伤
    hazardDps: 1.0,
    colorCode: '#2a4436'
  }),
  VOLCANO: Object.freeze({
    id: 5,
    name: '地热熔岩',
    moveCostMultiplier: 2.2,
    nutrientFloor: 0.0,
    hazardType: HazardTypes.FIRE, // 灼烧，每秒 2 点火焰真伤
    hazardDps: 2.0,
    colorCode: '#932200'
  }),
  HOLY_SPRING: Object.freeze({
    id: 6,
    name: '神圣泉眼',
    moveCostMultiplier: 0.9,
    nutrientFloor: 0.85,       // 超级高肥沃地脉 (催生古树)
    hazardType: HazardTypes.HOLY, // 神圣愈合 (每秒恢复 2 HP)
    hazardDps: -2.0,
    colorCode: '#ffd700'
  })
});

/**
 * 按 ID 快速索引的群系数组
 */
export const BiomeList = Object.freeze(
  Object.values(Biomes).sort((a, b) => a.id - b.id)
);

/**
 * 校验群系是否绝对不可通行
 * @param {number} biomeId - 群系 ID
 * @returns {boolean}
 */
export function isBiomeImpassable(biomeId) {
  const biome = BiomeList[biomeId];
  return biome ? biome.moveCostMultiplier >= 999.0 : false;
}
