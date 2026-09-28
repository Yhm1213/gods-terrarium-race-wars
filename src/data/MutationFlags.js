/**
 * @file MutationFlags.js
 * @description 正交变异器官 9 大属性位掩码库 (OrganFlags)
 * 严格遵循 TDS 2.2 节设计规范，解耦种族禁忌与器官类型。
 */

/**
 * 9 大正交解剖变异器官位掩码
 * @type {Readonly<{
 *   HOLY: number,
 *   FLAME: number,
 *   GAS: number,
 *   WING: number,
 *   FLESH: number,
 *   MERCURY: number,
 *   GRANITE: number,
 *   ELEC: number,
 *   AQUATIC: number
 * }>}
 */
export const OrganFlags = Object.freeze({
  HOLY:      1 << 0,  // 0x0001: 圣灵系光环/圣血
  FLAME:     1 << 1,  // 0x0002: 烈焰焦黑腺体
  GAS:       1 << 2,  // 0x0004: 易燃瓦斯囊袋
  WING:      1 << 3,  // 0x0008: 昆虫薄翼/羽翼
  FLESH:     1 << 4,  // 0x0010: 鲜肉/血肉器官
  MERCURY:   1 << 5,  // 0x0020: 水银液态流道
  GRANITE:   1 << 6,  // 0x0040: 花岗岩重甲角质
  ELEC:      1 << 7,  // 0x0080: 导电金属神经
  AQUATIC:   1 << 8   // 0x0100: 水栖腮与呼吸管
});

/**
 * 器官名称映射表
 */
export const OrganFlagNames = Object.freeze({
  [OrganFlags.HOLY]:    '圣灵',
  [OrganFlags.FLAME]:   '烈焰',
  [OrganFlags.GAS]:     '瓦斯',
  [OrganFlags.WING]:    '薄翼',
  [OrganFlags.FLESH]:   '血肉',
  [OrganFlags.MERCURY]: '水银',
  [OrganFlags.GRANITE]: '花岗岩',
  [OrganFlags.ELEC]:    '雷电',
  [OrganFlags.AQUATIC]: '水栖'
});

/**
 * 全量掩码或集合 (所有器官标志位的并集)
 */
export const ALL_ORGAN_FLAGS_MASK = (
  OrganFlags.HOLY |
  OrganFlags.FLAME |
  OrganFlags.GAS |
  OrganFlags.WING |
  OrganFlags.FLESH |
  OrganFlags.MERCURY |
  OrganFlags.GRANITE |
  OrganFlags.ELEC |
  OrganFlags.AQUATIC
);

/**
 * 校验掩码中是否包含特定器官标志
 * @param {number} mask - 器官掩码
 * @param {number} flag - 待检查的单个标志位
 * @returns {boolean}
 */
export function hasOrganFlag(mask, flag) {
  return (mask & flag) === flag;
}

/**
 * 解析掩码包含的所有器官名称
 * @param {number} mask - 器官掩码
 * @returns {string[]}
 */
export function getOrganFlagNames(mask) {
  const names = [];
  for (const [flagStr, name] of Object.entries(OrganFlagNames)) {
    const flag = Number(flagStr);
    if ((mask & flag) === flag) {
      names.push(name);
    }
  }
  return names;
}
