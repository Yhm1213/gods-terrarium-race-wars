/**
 * PhysiologyComponent.js
 * 实体生理代谢与死锁防御组件 (饥饿、应急互斥锁、上帝滞空、金身霸体)
 * 连续平铺内存规格: Float32Array((4097) * 4)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const PHYSIOLOGY_STRIDE = 4;
export const PHY_OFFSET_HUNGER = 0;         // 当前饥饿度 (0.0 ~ 100.0, >80.0 激活应急降级)
export const PHY_OFFSET_EMERGENCY_LOCK = 1; // 应急代谢 10s 独占互斥锁倒计时 (秒)
export const PHY_OFFSET_HOLD_TIMER = 2;     // 上帝之手抓取滞空计时器 (防加冕死锁，累加至 5.0s)
export const PHY_OFFSET_SACRED_BODY = 3;    // 反加冕金身霸体剩余时间 (1.5s 倒计时)

/**
 * 创建 Physiology 连续内存 TypedArray
 * @returns {Float32Array}
 */
export function createPhysiologyBuffer() {
  return new Float32Array(TOTAL_SLOTS * PHYSIOLOGY_STRIDE);
}

/**
 * 初始化单个实体的 Physiology 数据
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 * @param {number} [hunger=0.0] 
 * @param {number} [emergencyLockTimer=0.0] 
 * @param {number} [holdTimer=0.0] 
 * @param {number} [sacredBodyTimer=0.0] 
 */
export function initPhysiology(buffer, entityId, hunger = 0.0, emergencyLockTimer = 0.0, holdTimer = 0.0, sacredBodyTimer = 0.0) {
  const offset = entityId * PHYSIOLOGY_STRIDE;
  buffer[offset + PHY_OFFSET_HUNGER] = hunger;
  buffer[offset + PHY_OFFSET_EMERGENCY_LOCK] = emergencyLockTimer;
  buffer[offset + PHY_OFFSET_HOLD_TIMER] = holdTimer;
  buffer[offset + PHY_OFFSET_SACRED_BODY] = sacredBodyTimer;
}

/**
 * 重置实体的 Physiology 槽位为初始状态
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 */
export function resetPhysiology(buffer, entityId) {
  const offset = entityId * PHYSIOLOGY_STRIDE;
  buffer[offset + PHY_OFFSET_HUNGER] = 0.0;
  buffer[offset + PHY_OFFSET_EMERGENCY_LOCK] = 0.0;
  buffer[offset + PHY_OFFSET_HOLD_TIMER] = 0.0;
  buffer[offset + PHY_OFFSET_SACRED_BODY] = 0.0;
}
