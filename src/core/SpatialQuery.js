/**
 * SpatialQuery.js
 * 零分配空间范围检索纯函数类 (显式依赖注入)
 * 支持圆形与视锥矩形检索，内部严格实施防溢出截断保护，全程零临时对象与零 GC
 */

import { TF_OFFSET_X, TF_OFFSET_Y, TRANSFORM_STRIDE } from '../components/TransformComponent.js';

export class SpatialQuery {
  /**
   * 零分配圆形区域范围实体检索
   * @param {import('./SpatialHash.js').SpatialHash} hashInstance - 空间网格实例
   * @param {number} centerX - 查询中心 X (px)
   * @param {number} centerY - 查询中心 Y (px)
   * @param {number} radius - 查询半径 (px)
   * @param {Int32Array|Uint16Array|Array} outResults - 外部复用接收缓冲区
   * @param {number} [maxCapacity=512] - 缓冲区最大容量限制 (防越界)
   * @returns {number} writtenCount - 实际写入缓冲区的有效实体数
   */
  static queryRadius(hashInstance, centerX, centerY, radius, outResults, maxCapacity = 512) {
    if (!hashInstance || radius <= 0) return 0;

    const cellSize = hashInstance.cellSize;
    const cols = hashInstance.cols;
    const rows = hashInstance.rows;
    const maxCol = cols - 1;
    const maxRow = rows - 1;

    let minCol = Math.floor((centerX - radius) / cellSize);
    let maxColCandidate = Math.floor((centerX + radius) / cellSize);
    let minRow = Math.floor((centerY - radius) / cellSize);
    let maxRowCandidate = Math.floor((centerY + radius) / cellSize);

    // 完全在视口边界外提前阻断
    if (maxColCandidate < 0 || minCol > maxCol || maxRowCandidate < 0 || minRow > maxRow) {
      return 0;
    }

    // 边界 Clamp
    if (minCol < 0) minCol = 0;
    if (maxColCandidate > maxCol) maxColCandidate = maxCol;
    if (minRow < 0) minRow = 0;
    if (maxRowCandidate > maxRow) maxRowCandidate = maxRow;

    const cap = Math.min(maxCapacity, outResults.length);
    const r2 = radius * radius;
    const cellOffsets = hashInstance.cellOffsets;
    const cellCounts = hashInstance.cellCounts;
    const compactEntityIds = hashInstance.compactEntityIds;
    const transforms = hashInstance.transforms;

    let count = 0;

    for (let r = minRow; r <= maxRowCandidate; r++) {
      const rowOffset = r * cols;
      for (let c = minCol; c <= maxColCandidate; c++) {
        const cellIdx = rowOffset + c;
        const start = cellOffsets[cellIdx];
        const end = start + cellCounts[cellIdx];

        for (let k = start; k < end; k++) {
          const id = compactEntityIds[k];

          // 若有 transforms 数据，执行欧式距离平方精确测试
          if (transforms) {
            const tfOffset = id * TRANSFORM_STRIDE;
            const dx = transforms[tfOffset + TF_OFFSET_X] - centerX;
            const dy = transforms[tfOffset + TF_OFFSET_Y] - centerY;
            if (dx * dx + dy * dy <= r2) {
              outResults[count++] = id;
              if (count >= cap) return count;
            }
          } else {
            outResults[count++] = id;
            if (count >= cap) return count;
          }
        }
      }
    }

    return count;
  }

  /**
   * 零分配矩形范围 (AABB / 视锥) 实体检索
   * @param {import('./SpatialHash.js').SpatialHash} hashInstance - 空间网格实例
   * @param {number} minX - 矩形左边界 X
   * @param {number} minY - 矩形上边界 Y
   * @param {number} maxX - 矩形右边界 X
   * @param {number} maxY - 矩形下边界 Y
   * @param {Int32Array|Uint16Array|Array} outResults - 外部复用接收缓冲区
   * @param {number} [maxCapacity=512] - 缓冲区最大容量限制
   * @returns {number} writtenCount - 实际写入缓冲区的有效实体数
   */
  static queryRect(hashInstance, minX, minY, maxX, maxY, outResults, maxCapacity = 512) {
    if (!hashInstance || minX > maxX || minY > maxY) return 0;

    const cellSize = hashInstance.cellSize;
    const cols = hashInstance.cols;
    const rows = hashInstance.rows;
    const maxCol = cols - 1;
    const maxRow = rows - 1;

    let minCol = Math.floor(minX / cellSize);
    let maxColCandidate = Math.floor(maxX / cellSize);
    let minRow = Math.floor(minY / cellSize);
    let maxRowCandidate = Math.floor(maxY / cellSize);

    // 完全在视口边界外提前阻断
    if (maxColCandidate < 0 || minCol > maxCol || maxRowCandidate < 0 || minRow > maxRow) {
      return 0;
    }

    // 边界防御 Clamp
    if (minCol < 0) minCol = 0;
    if (maxColCandidate > maxCol) maxColCandidate = maxCol;
    if (minRow < 0) minRow = 0;
    if (maxRowCandidate > maxRow) maxRowCandidate = maxRow;

    const cap = Math.min(maxCapacity, outResults.length);
    const cellOffsets = hashInstance.cellOffsets;
    const cellCounts = hashInstance.cellCounts;
    const compactEntityIds = hashInstance.compactEntityIds;
    const transforms = hashInstance.transforms;

    let count = 0;

    for (let r = minRow; r <= maxRowCandidate; r++) {
      const rowOffset = r * cols;
      for (let c = minCol; c <= maxColCandidate; c++) {
        const cellIdx = rowOffset + c;
        const start = cellOffsets[cellIdx];
        const end = start + cellCounts[cellIdx];

        for (let k = start; k < end; k++) {
          const id = compactEntityIds[k];

          if (transforms) {
            const tfOffset = id * TRANSFORM_STRIDE;
            const x = transforms[tfOffset + TF_OFFSET_X];
            const y = transforms[tfOffset + TF_OFFSET_Y];
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
              outResults[count++] = id;
              if (count >= cap) return count;
            }
          } else {
            outResults[count++] = id;
            if (count >= cap) return count;
          }
        }
      }
    }

    return count;
  }
}
