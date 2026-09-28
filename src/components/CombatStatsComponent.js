/**
 * CombatStatsComponent.js
 * 实体战斗攻防抗性数值组件 (聚合有效护甲与抗性反伤)
 * 连续平铺内存规格: Float32Array((4097) * 4)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const COMBAT_STRIDE = 4;
export const CS_OFFSET_ARMOR = 0;        // 聚合有效护甲值 (下限 Clamp 至 -40.0)
export const CS_OFFSET_BLUNT_RESIST = 1; // 钝击抗性 (-0.40 ~ 0.60)
export const CS_OFFSET_PIERCE_RESIST = 2;// 穿刺抗性 (-0.40 ~ 0.60)
export const CS_OFFSET_REFLECT_RATIO = 3;// 税后反伤系数 (默认 0.0, 0.0 ~ 0.50)

/**
 * 创建 CombatStats 连续内存 TypedArray
 * @returns {Float32Array}
 */
export function createCombatStatsBuffer() {
  return new Float32Array(TOTAL_SLOTS * COMBAT_STRIDE);
}

/**
 * 初始化单个实体的 CombatStats 数据
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 * @param {number} [armor=0.0] 
 * @param {number} [bluntResist=0.0] 
 * @param {number} [pierceResist=0.0] 
 * @param {number} [reflectRatio=0.0] 
 */
export function initCombatStats(buffer, entityId, armor = 0.0, bluntResist = 0.0, pierceResist = 0.0, reflectRatio = 0.0) {
  const offset = entityId * COMBAT_STRIDE;
  buffer[offset + CS_OFFSET_ARMOR] = armor;
  buffer[offset + CS_OFFSET_BLUNT_RESIST] = bluntResist;
  buffer[offset + CS_OFFSET_PIERCE_RESIST] = pierceResist;
  buffer[offset + CS_OFFSET_REFLECT_RATIO] = reflectRatio;
}

/**
 * 重置实体的 CombatStats 槽位为初始状态
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 */
export function resetCombatStats(buffer, entityId) {
  const offset = entityId * COMBAT_STRIDE;
  buffer[offset + CS_OFFSET_ARMOR] = 0.0;
  buffer[offset + CS_OFFSET_BLUNT_RESIST] = 0.0;
  buffer[offset + CS_OFFSET_PIERCE_RESIST] = 0.0;
  buffer[offset + CS_OFFSET_REFLECT_RATIO] = 0.0;
}
