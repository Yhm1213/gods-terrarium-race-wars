/**
 * Identities.js
 * 实体身份与兼职职业组件 (阵营、生产主职、战斗副职)
 * 连续平铺内存规格: Uint32Array((4097) * 3)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const IDENTITY_STRIDE = 3;
export const ID_OFFSET_FACTION = 0;    // 阵营 ID (1 ~ 16)
export const ID_OFFSET_PROD_JOB = 1;   // 生产生活底色职业 ID (石工/农夫/草药/屠夫等)
export const ID_OFFSET_COMBAT_JOB = 2; // 战斗副职 ID (铁卫/狂战/伏击/长弓等)

/**
 * 创建 Identities 连续内存 TypedArray
 * @returns {Uint32Array}
 */
export function createIdentitiesBuffer() {
  return new Uint32Array(TOTAL_SLOTS * IDENTITY_STRIDE);
}

/**
 * 初始化单个实体的 Identities 数据
 * @param {Uint32Array} buffer 
 * @param {number} entityId 
 * @param {number} [factionId=0] 
 * @param {number} [prodJobId=0] 
 * @param {number} [combatJobId=0] 
 */
export function initIdentities(buffer, entityId, factionId = 0, prodJobId = 0, combatJobId = 0) {
  const offset = entityId * IDENTITY_STRIDE;
  buffer[offset + ID_OFFSET_FACTION] = factionId >>> 0;
  buffer[offset + ID_OFFSET_PROD_JOB] = prodJobId >>> 0;
  buffer[offset + ID_OFFSET_COMBAT_JOB] = combatJobId >>> 0;
}

/**
 * 重置实体的 Identities 槽位为初始状态
 * @param {Uint32Array} buffer 
 * @param {number} entityId 
 */
export function resetIdentities(buffer, entityId) {
  const offset = entityId * IDENTITY_STRIDE;
  buffer[offset + ID_OFFSET_FACTION] = 0;
  buffer[offset + ID_OFFSET_PROD_JOB] = 0;
  buffer[offset + ID_OFFSET_COMBAT_JOB] = 0;
}
