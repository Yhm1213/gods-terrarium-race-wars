/**
 * UnitStatusFlags.js
 * 实体 32 位状态位掩码字典与工具函数
 * 所有常量均以 `>>> 0` 保证无符号安全
 * 连续平铺内存规格: Uint32Array(4097)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const IS_ALIVE             = ((1 << 0)  >>> 0); // 0x0001: 实体是否存活
export const IS_HELD              = ((1 << 1)  >>> 0); // 0x0002: 是否正被上帝之手悬空抓取 (挂起站队事务)
export const IS_AIRBORNE          = ((1 << 2)  >>> 0); // 0x0004: 是否正在弹射飞行中 (忽略地面摩擦)
export const IS_STUNNED           = ((1 << 3)  >>> 0); // 0x0008: 眩晕麻痹中 (禁止位移与攻击)
export const IS_SLAVE             = ((1 << 4)  >>> 0); // 0x0010: 是否为戴项圈战俘奴隶 (绝嗣角斗过滤)
export const IS_LEADER            = ((1 << 5)  >>> 0); // 0x0020: 是否为部族酋长/统治者 (破除 24px 金色描边)
export const IS_MUTANT            = ((1 << 6)  >>> 0); // 0x0040: 是否拥有突变器官 (10% 突变色着色)
export const HAS_WRATH_OF_LIBERTY = ((1 << 7)  >>> 0); // 0x0080: 叛乱军【自由之怒】45 秒无敌士气
export const IS_LAST_STAND        = ((1 << 8)  >>> 0); // 0x0100: 图腾 5 格内【破釜沉舟】绝地死战中
export const IS_STATIC_ANCHOR     = ((1 << 9)  >>> 0); // 0x0200: 物理绝对静态锚点 (图腾柱专用，质量无穷大)
export const IS_PETRIFIED         = ((1 << 10) >>> 0); // 0x0400: 魔像断能石化解耦为遗迹 (普查系统排除)
export const IS_EMERGENCY_LOCK    = ((1 << 11) >>> 0); // 0x0800: 应急代谢 10s 独占互斥锁生效中
export const IS_AVENGED           = ((1 << 12) >>> 0); // 0x1000: 已完成血亲复仇
export const IS_CORPSE_DEGRADING  = ((1 << 13) >>> 0); // 0x2000: 尸体残骸自然降解中
export const IS_SACRED_BODY       = ((1 << 14) >>> 0); // 0x4000: 反加冕金身霸体中 (免疫上帝之手抓取与伤害)
export const IS_REGENT            = ((1 << 15) >>> 0); // 0x8000: 摄政王身份 (幼主摄政代行王权)
export const IN_COMBAT            = ((1 << 16) >>> 0); // 0x10000: 交火交战状态中
export const IS_PANICKED          = ((1 << 17) >>> 0); // 0x20000: 士气崩溃逃窜状态中
export const IS_SKILL_ACTIVE       = ((1 << 18) >>> 0); // 0x40000: 主动技能效果持续生效中
export const IS_CASTING            = ((1 << 19) >>> 0); // 0x80000: 正在施法读条中 (动作轨道占用)
export const IS_DISARMED           = ((1 << 20) >>> 0); // 0x100000: 处于缴械状态 (拔出备用短刀)
export const IS_GENE_DRIVEN        = ((1 << 21) >>> 0); // 0x200000: 携带模式 A 基因驱动显性偏向
export const IS_IMMOBILIZED        = ((1 << 22) >>> 0); // 0x400000: 处于定身状态 (机动轨锁死)

export const StatusFlags = Object.freeze({
  IS_ALIVE,
  IS_HELD,
  IS_AIRBORNE,
  IS_STUNNED,
  IS_SLAVE,
  IS_LEADER,
  IS_MUTANT,
  HAS_WRATH_OF_LIBERTY,
  IS_LAST_STAND,
  IS_STATIC_ANCHOR,
  IS_PETRIFIED,
  IS_EMERGENCY_LOCK,
  IS_AVENGED,
  IS_CORPSE_DEGRADING,
  IS_SACRED_BODY,
  IS_REGENT,
  IN_COMBAT,
  IS_PANICKED,
  IS_SKILL_ACTIVE,
  IS_CASTING,
  IS_DISARMED,
  IS_GENE_DRIVEN,
  IS_IMMOBILIZED
});

/**
 * 创建 StatusFlags 连续内存 TypedArray
 * @returns {Uint32Array}
 */
export function createStatusFlagsBuffer() {
  return new Uint32Array(TOTAL_SLOTS);
}

/**
 * 判断实体是否拥有某个或某些状态标志
 * @param {Uint32Array} flagsArray 
 * @param {number} entityId 
 * @param {number} flagMask 
 * @returns {boolean}
 */
export function hasStatus(flagsArray, entityId, flagMask) {
  return ((flagsArray[entityId] & flagMask) >>> 0) !== 0;
}

/**
 * 为实体添加状态标志
 * @param {Uint32Array} flagsArray 
 * @param {number} entityId 
 * @param {number} flagMask 
 */
export function setStatus(flagsArray, entityId, flagMask) {
  flagsArray[entityId] = ((flagsArray[entityId] | flagMask) >>> 0);
}

/**
 * 清除实体的指定状态标志
 * @param {Uint32Array} flagsArray 
 * @param {number} entityId 
 * @param {number} flagMask 
 */
export function clearStatus(flagsArray, entityId, flagMask) {
  flagsArray[entityId] = ((flagsArray[entityId] & (~flagMask)) >>> 0);
}

/**
 * 翻转实体的指定状态标志
 * @param {Uint32Array} flagsArray 
 * @param {number} entityId 
 * @param {number} flagMask 
 */
export function toggleStatus(flagsArray, entityId, flagMask) {
  flagsArray[entityId] = ((flagsArray[entityId] ^ flagMask) >>> 0);
}
