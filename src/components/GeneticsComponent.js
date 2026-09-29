/**
 * GeneticsComponent.js
 * 双倍体孟德尔遗传与突变位图连续平铺内存池组件
 * 
 * 内存规格 (Milestone 2 契约 3.6 节):
 * TOTAL_SLOTS = 4097, GENETICS_STRIDE = 4
 * 内存布局: Uint32Array(TOTAL_SLOTS * GENETICS_STRIDE) ≈ 65.5 KB
 * 
 * 字段偏移量:
 * - GEN_OFFSET_MATERNAL = 0   // 母系等位基因器官掩码 (Uint32)
 * - GEN_OFFSET_PATERNAL = 1   // 父系等位基因器官掩码 (Uint32)
 * - GEN_OFFSET_PHENOTYPE = 2  // 表型表达位掩码 (计算缓存: maternal | paternal)
 * - GEN_OFFSET_GENERATION = 3 // 实体代数 (从第 1 代始祖递增)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const GENETICS_STRIDE = 4;
export const GEN_OFFSET_MATERNAL   = 0; // 母系等位基因器官掩码
export const GEN_OFFSET_PATERNAL   = 1; // 父系等位基因器官掩码
export const GEN_OFFSET_PHENOTYPE  = 2; // 表型表达位掩码 (Maternal | Paternal)
export const GEN_OFFSET_GENERATION = 3; // 实体代数 (从第 1 代递增)

/**
 * 创建 GeneticsComponent 连续内存 TypedArray
 * @returns {Uint32Array}
 */
export function createGeneticsBuffer() {
  return new Uint32Array(TOTAL_SLOTS * GENETICS_STRIDE);
}

/**
 * 初始化单个实体的遗传基因数据
 * @param {Uint32Array} buffer 
 * @param {number} entityId 
 * @param {number} [maternal=0] 
 * @param {number} [paternal=0] 
 * @param {number} [generation=1] 
 */
export function initGenetics(buffer, entityId, maternal = 0, paternal = 0, generation = 1) {
  const off = entityId * GENETICS_STRIDE;
  buffer[off + GEN_OFFSET_MATERNAL] = maternal >>> 0;
  buffer[off + GEN_OFFSET_PATERNAL] = paternal >>> 0;
  buffer[off + GEN_OFFSET_PHENOTYPE] = ((maternal | paternal) >>> 0);
  buffer[off + GEN_OFFSET_GENERATION] = generation >>> 0;
}

/**
 * 刷新计算实体的表型掩码
 * @param {Uint32Array} buffer 
 * @param {number} entityId 
 * @returns {number} phenotypeMask
 */
export function updatePhenotype(buffer, entityId) {
  const off = entityId * GENETICS_STRIDE;
  const phenotype = ((buffer[off + GEN_OFFSET_MATERNAL] | buffer[off + GEN_OFFSET_PATERNAL]) >>> 0);
  buffer[off + GEN_OFFSET_PHENOTYPE] = phenotype;
  return phenotype;
}

/**
 * 重置实体的遗传数据
 * @param {Uint32Array} buffer 
 * @param {number} entityId 
 */
export function resetGenetics(buffer, entityId) {
  const off = entityId * GENETICS_STRIDE;
  buffer[off + GEN_OFFSET_MATERNAL] = 0;
  buffer[off + GEN_OFFSET_PATERNAL] = 0;
  buffer[off + GEN_OFFSET_PHENOTYPE] = 0;
  buffer[off + GEN_OFFSET_GENERATION] = 0;
}

/**
 * 重置整个遗传内存池
 * @param {Uint32Array} buffer 
 */
export function resetAllGenetics(buffer) {
  buffer.fill(0);
}
