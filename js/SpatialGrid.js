// ==========================================
// 零 GC 紧凑静态单链表空间哈希网格 (Zero-GC Spatial Hash Grid)
// (基于 Int32Array 实现，杜绝每帧 GC 内存分配与帧率抖动)
// ==========================================

import { CONFIG } from './config.js';

export class SpatialGrid {
  /**
   * @param {number} maxUnits - 支持的最大实体数量 (例如 1024)
   */
  constructor(maxUnits = 1024) {
    this.maxUnits = maxUnits;
    this.cellSize = CONFIG.SPATIAL_CELL_SIZE;
    this.cols = CONFIG.SPATIAL_COLS;
    this.rows = CONFIG.SPATIAL_ROWS;
    this.numBuckets = this.cols * this.rows;

    // 桶头指针数组：每个桶指向第一个单位在 units 列表中的 index，无单位填 -1
    this.head = new Int32Array(this.numBuckets);
    // 单链表 Next 指针数组：当前单位指向桶内下一个单位的 index，无下一个填 -1
    this.next = new Int32Array(this.maxUnits);

    // 查询复用结果数组（避免每次 query 创建新 Array）
    this.queryResults = new Int32Array(256);
    this.queryCount = 0;

    this.clear();
  }

  /**
   * 每帧清空哈希网格 (仅需 O(B) 清空头指针，0 堆内存分配)
   */
  clear() {
    this.head.fill(-1);
  }

  /**
   * 插入实体到对应空间桶内
   * @param {number} unitIndex - 实体的唯一索引 (0 <= index < maxUnits)
   * @param {number} x - 世界坐标 X
   * @param {number} y - 世界坐标 Y
   */
  insert(unitIndex, x, y) {
    if (unitIndex < 0 || unitIndex >= this.maxUnits) return;

    const col = Math.max(0, Math.min(this.cols - 1, (x / this.cellSize) | 0));
    const row = Math.max(0, Math.min(this.rows - 1, (y / this.cellSize) | 0));
    const bucket = row * this.cols + col;

    // 插入链表头部
    this.next[unitIndex] = this.head[bucket];
    this.head[bucket] = unitIndex;
  }

  /**
   * 查询指定世界坐标半径内的所有实体索引
   * @param {number} x - 世界中心 X
   * @param {number} y - 世界中心 Y
   * @param {number} radius - 查询半径
   * @param {Function} callback - 回调函数 (unitIndex) => void
   */
  queryRadius(x, y, radius, callback) {
    const minCol = Math.max(0, ((x - radius) / this.cellSize) | 0);
    const maxCol = Math.min(this.cols - 1, ((x + radius) / this.cellSize) | 0);
    const minRow = Math.max(0, ((y - radius) / this.cellSize) | 0);
    const maxRow = Math.min(this.rows - 1, ((y + radius) / this.cellSize) | 0);
    const radiusSq = radius * radius;

    for (let r = minRow; r <= maxRow; r++) {
      const rowOffset = r * this.cols;
      for (let c = minCol; c <= maxCol; c++) {
        const bucket = rowOffset + c;
        let curr = this.head[bucket];

        while (curr !== -1) {
          callback(curr);
          curr = this.next[curr];
        }
      }
    }
  }

  /**
   * 查询指定桶内的所有单位
   * @param {number} col - 桶列
   * @param {number} row - 桶行
   * @param {Function} callback - 回调函数
   */
  queryBucket(col, row, callback) {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    const bucket = row * this.cols + col;
    let curr = this.head[bucket];
    while (curr !== -1) {
      callback(curr);
      curr = this.next[curr];
    }
  }
}
