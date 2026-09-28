/**
 * HealthComponent.js
 * 实体生命值与受创历史组件
 * 连续平铺内存规格: Float32Array((4097) * 4)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const HEALTH_STRIDE = 4;
export const HP_OFFSET_CURRENT = 0;   // 当前生命值 (<=0 触发阵亡注销)
export const HP_OFFSET_HP = 0;        // 便捷别名
export const HP_OFFSET_MAX = 1;       // 生命值上限
export const HP_OFFSET_LAST_SRC = 2;  // 上次伤害来源 EntityID (整型)
export const HP_OFFSET_LAST_SRC_ID = 2; // 便捷别名
export const HP_OFFSET_LAST_TICK = 3; // 上次受创的世界 Tick (用于反伤 ICD 计算)
export const HP_OFFSET_LAST_DAMAGE_TICK = 3; // 便捷别名

/**
 * 创建 Health 连续内存 TypedArray
 * @returns {Float32Array}
 */
export function createHealthBuffer() {
  const buffer = new Float32Array(TOTAL_SLOTS * HEALTH_STRIDE);
  // 初始化默认生命值为 100.0 (除 0 号墓碑外)
  for (let i = 1; i < TOTAL_SLOTS; i++) {
    const offset = i * HEALTH_STRIDE;
    buffer[offset + HP_OFFSET_CURRENT] = 100.0;
    buffer[offset + HP_OFFSET_MAX] = 100.0;
  }
  return buffer;
}

/**
 * 初始化单个实体的 Health 数据
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 * @param {number} [hp=100.0] 
 * @param {number} [maxHp=100.0] 
 * @param {number} [lastSrcId=0] 
 * @param {number} [lastDamageTick=0] 
 */
export function initHealth(buffer, entityId, hp = 100.0, maxHp = 100.0, lastSrcId = 0, lastDamageTick = 0) {
  const offset = entityId * HEALTH_STRIDE;
  buffer[offset + HP_OFFSET_CURRENT] = hp;
  buffer[offset + HP_OFFSET_MAX] = maxHp;
  buffer[offset + HP_OFFSET_LAST_SRC] = lastSrcId;
  buffer[offset + HP_OFFSET_LAST_TICK] = lastDamageTick;
}

/**
 * 重置实体的 Health 槽位为初始状态
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 */
export function resetHealth(buffer, entityId) {
  const offset = entityId * HEALTH_STRIDE;
  buffer[offset + HP_OFFSET_CURRENT] = 0.0;
  buffer[offset + HP_OFFSET_MAX] = 0.0;
  buffer[offset + HP_OFFSET_LAST_SRC] = 0.0;
  buffer[offset + HP_OFFSET_LAST_TICK] = 0.0;
}
