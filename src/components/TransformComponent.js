/**
 * TransformComponent.js
 * 实体空间位置与变换组件 (纯 SoA 拆分排布)
 * 连续平铺内存规格: Float32Array((4097) * 4)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097; // MAX_ENTITIES + 1, 0 索引为 NULL_ENTITY 墓碑

export const TRANSFORM_STRIDE = 4;
export const TF_OFFSET_X = 0;        // 世界坐标 X 浮点数 (px)
export const TF_OFFSET_Y = 1;        // 世界坐标 Y 浮点数 (px)
export const TF_OFFSET_ROTATION = 2; // 弧度朝向 (-PI ~ PI)
export const TF_OFFSET_ROT = 2;      // 简写别名
export const TF_OFFSET_SCALE = 3;    // 视觉缩放因子 (基准=1.0)

/**
 * 创建 Transform 连续内存 TypedArray
 * @returns {Float32Array}
 */
export function createTransformBuffer() {
  const buffer = new Float32Array(TOTAL_SLOTS * TRANSFORM_STRIDE);
  // 初始化默认缩放为 1.0 (除 0 号墓碑外)
  for (let i = 1; i < TOTAL_SLOTS; i++) {
    buffer[i * TRANSFORM_STRIDE + TF_OFFSET_SCALE] = 1.0;
  }
  return buffer;
}

/**
 * 初始化单个实体的 Transform 数据
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 * @param {number} [x=0] 
 * @param {number} [y=0] 
 * @param {number} [rot=0] 
 * @param {number} [scale=1.0] 
 */
export function initTransform(buffer, entityId, x = 0, y = 0, rot = 0, scale = 1.0) {
  const offset = entityId * TRANSFORM_STRIDE;
  buffer[offset + TF_OFFSET_X] = x;
  buffer[offset + TF_OFFSET_Y] = y;
  buffer[offset + TF_OFFSET_ROTATION] = rot;
  buffer[offset + TF_OFFSET_SCALE] = scale;
}

/**
 * 重置实体的 Transform 槽位为初始状态
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 */
export function resetTransform(buffer, entityId) {
  const offset = entityId * TRANSFORM_STRIDE;
  buffer[offset + TF_OFFSET_X] = 0.0;
  buffer[offset + TF_OFFSET_Y] = 0.0;
  buffer[offset + TF_OFFSET_ROTATION] = 0.0;
  buffer[offset + TF_OFFSET_SCALE] = 1.0;
}
