/**
 * SocialCasteComponent.js
 * 四大社会阶级动态晋升连续平铺内存池组件
 * 
 * 内存规格 (Milestone 2 契约 2.3 节):
 * TOTAL_SLOTS = 4097, CASTE_STRIDE = 4
 * 内存布局: Float32Array(TOTAL_SLOTS * CASTE_STRIDE) ≈ 65.5 KB
 * 
 * 阶级枚举:
 * - CIVILIAN: 0 (平民)
 * - ARTISAN:  1 (工匠)
 * - SOLDIER:  2 (士兵)
 * - LEADER:   3 (领袖)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const CASTE_STRIDE = 4;
export const CASTE_OFFSET_TYPE = 0;       // 阶级枚举: 0=CIVILIAN, 1=ARTISAN, 2=SOLDIER, 3=LEADER
export const CASTE_OFFSET_EXP_LABOR = 1;  // 劳作经验积累 (浮点数)
export const CASTE_OFFSET_EXP_COMBAT = 2; // 战斗经验积累 (承伤+击杀)
export const CASTE_OFFSET_COOLDOWN = 3;   // 15s 晋升防振荡冷却倒计时 (秒)

export const CasteType = Object.freeze({
  CIVILIAN: 0,
  ARTISAN:  1,
  SOLDIER:  2,
  LEADER:   3
});

export const PROMOTION_COOLDOWN_SECONDS = 15.0; // 契约规定: 15s 晋升防振荡滞后锁

/**
 * 创建 SocialCasteComponent 连续内存 TypedArray
 * @returns {Float32Array}
 */
export function createSocialCasteBuffer() {
  return new Float32Array(TOTAL_SLOTS * CASTE_STRIDE);
}

/**
 * 初始化实体的阶级槽位
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 * @param {number} [type=0] 
 * @param {number} [expLabor=0] 
 * @param {number} [expCombat=0] 
 * @param {number} [cooldown=0] 
 */
export function initSocialCaste(buffer, entityId, type = CasteType.CIVILIAN, expLabor = 0, expCombat = 0, cooldown = 0) {
  const off = entityId * CASTE_STRIDE;
  buffer[off + CASTE_OFFSET_TYPE] = type;
  buffer[off + CASTE_OFFSET_EXP_LABOR] = expLabor;
  buffer[off + CASTE_OFFSET_EXP_COMBAT] = expCombat;
  buffer[off + CASTE_OFFSET_COOLDOWN] = cooldown;
}

/**
 * 重置实体的阶级槽位 (默认恢复为 CIVILIAN 且经验抹零)
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 */
export function resetSocialCaste(buffer, entityId) {
  const off = entityId * CASTE_STRIDE;
  buffer[off + CASTE_OFFSET_TYPE] = 0.0;
  buffer[off + CASTE_OFFSET_EXP_LABOR] = 0.0;
  buffer[off + CASTE_OFFSET_EXP_COMBAT] = 0.0;
  buffer[off + CASTE_OFFSET_COOLDOWN] = 0.0;
}

/**
 * 重置整个阶级内存池
 * @param {Float32Array} buffer 
 */
export function resetAllSocialCastes(buffer) {
  buffer.fill(0);
}
