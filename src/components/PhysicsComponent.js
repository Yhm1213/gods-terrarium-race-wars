/**
 * PhysicsComponent.js
 * 实体物理属性组件 (线速度、质量与逆质量)
 * 连续平铺内存规格: Float32Array((4097) * 4)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const PHYSICS_STRIDE = 4;
export const PHY_OFFSET_VX = 0;      // X 轴线性初速度 (px/s)
export const PHY_OFFSET_VY = 1;      // Y 轴线性初速度 (px/s)
export const PHY_OFFSET_MASS = 2;    // 实体有效质量 (kg)
export const PHY_OFFSET_INVMASS = 3; // 质量倒数 1/mass (静态图腾/锚点为 0.0)

/**
 * 创建 Physics 连续内存 TypedArray
 * @returns {Float32Array}
 */
export function createPhysicsBuffer() {
  const buffer = new Float32Array(TOTAL_SLOTS * PHYSICS_STRIDE);
  // 初始化默认质量为 1.0, 逆质量 1.0 (除 0 号墓碑外)
  for (let i = 1; i < TOTAL_SLOTS; i++) {
    const offset = i * PHYSICS_STRIDE;
    buffer[offset + PHY_OFFSET_MASS] = 1.0;
    buffer[offset + PHY_OFFSET_INVMASS] = 1.0;
  }
  return buffer;
}

/**
 * 初始化单个实体的 Physics 数据
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 * @param {number} [vx=0.0] 
 * @param {number} [vy=0.0] 
 * @param {number} [mass=1.0] 
 * @param {number} [invMass=undefined] 
 */
export function initPhysics(buffer, entityId, vx = 0.0, vy = 0.0, mass = 1.0, invMass = undefined) {
  const offset = entityId * PHYSICS_STRIDE;
  buffer[offset + PHY_OFFSET_VX] = vx;
  buffer[offset + PHY_OFFSET_VY] = vy;
  buffer[offset + PHY_OFFSET_MASS] = mass;
  buffer[offset + PHY_OFFSET_INVMASS] = invMass !== undefined ? invMass : (mass > 0 ? 1.0 / mass : 0.0);
}

/**
 * 重置实体的 Physics 槽位为初始状态
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 */
export function resetPhysics(buffer, entityId) {
  const offset = entityId * PHYSICS_STRIDE;
  buffer[offset + PHY_OFFSET_VX] = 0.0;
  buffer[offset + PHY_OFFSET_VY] = 0.0;
  buffer[offset + PHY_OFFSET_MASS] = 1.0;
  buffer[offset + PHY_OFFSET_INVMASS] = 1.0;
}
