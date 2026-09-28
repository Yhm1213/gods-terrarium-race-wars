/**
 * MoraleComponent.js
 * 实体士气与恐慌倒计时组件
 * 连续平铺内存规格: Float32Array((4097) * 2)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const MORALE_STRIDE = 2;
export const MORALE_OFFSET_VAL = 0;   // 当前士气 (0.0 ~ 100.0)
export const MORALE_OFFSET_MORALE = 0;// 便捷别名
export const MORALE_OFFSET_TIMER = 1; // 状态倒计时 (如破釜沉舟/溃逃剩余时间，秒)
export const MORALE_OFFSET_PANIC_TIMER = 1; // 便捷别名

/**
 * 创建 Morale 连续内存 TypedArray
 * @returns {Float32Array}
 */
export function createMoraleBuffer() {
  const buffer = new Float32Array(TOTAL_SLOTS * MORALE_STRIDE);
  // 初始化默认士气为 100.0 (除 0 号墓碑外)
  for (let i = 1; i < TOTAL_SLOTS; i++) {
    buffer[i * MORALE_STRIDE + MORALE_OFFSET_VAL] = 100.0;
  }
  return buffer;
}

/**
 * 初始化单个实体的 Morale 数据
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 * @param {number} [morale=100.0] 
 * @param {number} [panicTimer=0.0] 
 */
export function initMorale(buffer, entityId, morale = 100.0, panicTimer = 0.0) {
  const offset = entityId * MORALE_STRIDE;
  buffer[offset + MORALE_OFFSET_VAL] = morale;
  buffer[offset + MORALE_OFFSET_TIMER] = panicTimer;
}

/**
 * 重置实体的 Morale 槽位为初始状态
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 */
export function resetMorale(buffer, entityId) {
  const offset = entityId * MORALE_STRIDE;
  buffer[offset + MORALE_OFFSET_VAL] = 0.0;
  buffer[offset + MORALE_OFFSET_TIMER] = 0.0;
}
