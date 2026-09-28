/**
 * SpatialHash.js
 * 48px 平铺连续内存空间哈希网格 (基于类计数排序的双趟连续切片布局)
 * 彻底消灭链表指针追逐与节点分配，支持千人以上高频实体实时重构，单次耗时严格 < 0.2ms (零 GC)
 */

import { TOTAL_SLOTS, TF_OFFSET_X, TF_OFFSET_Y, TRANSFORM_STRIDE } from '../components/TransformComponent.js';
import { IS_ALIVE } from '../components/UnitStatusFlags.js';

export const DEFAULT_MAP_WIDTH = 1344;
export const DEFAULT_MAP_HEIGHT = 864;
export const DEFAULT_CELL_SIZE = 48;

export class SpatialHash {
  /**
   * @param {number} [mapWidthPx=1344] 地图宽度 (像素)
   * @param {number} [mapHeightPx=864] 地图高度 (像素)
   * @param {number} [cellSize=48] 空间单元格边长 (默认 48px, 共 28x18=504 桶)
   */
  constructor(mapWidthPx = DEFAULT_MAP_WIDTH, mapHeightPx = DEFAULT_MAP_HEIGHT, cellSize = DEFAULT_CELL_SIZE) {
    this.mapWidthPx = mapWidthPx;
    this.mapHeightPx = mapHeightPx;
    this.cellSize = cellSize;
    this.invCellSize = 1.0 / cellSize;

    this.cols = Math.ceil(mapWidthPx / cellSize); // 28
    this.rows = Math.ceil(mapHeightPx / cellSize); // 18
    this.totalCells = this.cols * this.rows;       // 504

    // 预分配连续 TypedArray 内存
    this.cellCounts = new Int16Array(this.totalCells);
    this.cellOffsets = new Int32Array(this.totalCells);
    this.compactEntityIds = new Int16Array(TOTAL_SLOTS);

    // 预分配内部重构工作暂存区 (彻底杜绝运行期 GC)
    this._currentOffsets = new Int32Array(this.totalCells);

    // 保存最新一次重构传入的 transforms 引用 (供 SpatialQuery 快速精确访问)
    this.transforms = null;
  }

  /**
   * 测算 SpatialHash 静态常驻连续内存字节总数
   * @returns {number}
   */
  calculateMemoryUsageBytes() {
    return (
      this.cellCounts.byteLength +
      this.cellOffsets.byteLength +
      this.compactEntityIds.byteLength +
      this._currentOffsets.byteLength
    );
  }

  /**
   * 刷新重建空间网格 (耗时严格 < 0.2ms，零对象分配)
   * @param {Float32Array} transforms - 空间位置连续内存
   * @param {Uint32Array} statusFlags - 状态掩码连续内存
   * @param {Uint16Array} denseEntities - 稠密活跃实体数组
   * @param {number} activeCount - 活跃总数
   * @returns {void}
   */
  rebuild(transforms, statusFlags, denseEntities, activeCount) {
    this.transforms = transforms;

    const totalCells = this.totalCells;
    const invCellSize = this.invCellSize;
    const cols = this.cols;
    const maxCol = cols - 1;
    const maxRow = this.rows - 1;

    const cellCounts = this.cellCounts;
    const cellOffsets = this.cellOffsets;
    const currentOffsets = this._currentOffsets;
    const compactEntityIds = this.compactEntityIds;

    // 1. 清空单元格计数器
    cellCounts.fill(0);

    // 2. 第一趟统计 (Pass 1): 筛选存活实体并统计所属单元格
    for (let i = 0; i < activeCount; i++) {
      const id = denseEntities[i];
      if ((statusFlags[id] & IS_ALIVE) === 0) {
        continue;
      }

      const tfOffset = id << 2; // TRANSFORM_STRIDE = 4
      const x = transforms[tfOffset];
      const y = transforms[tfOffset + 1];

      let col = (x * invCellSize) | 0;
      let row = (y * invCellSize) | 0;

      // 视口边界防御 Clamp (无分支三目加速)
      col = col < 0 ? 0 : (col > maxCol ? maxCol : col);
      row = row < 0 ? 0 : (row > maxRow ? maxRow : row);

      const cellIdx = row * cols + col;
      cellCounts[cellIdx]++;
    }

    // 3. 计算前缀和 (Prefix Sum) 生成平铺切片偏移量
    let runningOffset = 0;
    for (let c = 0; c < totalCells; c++) {
      cellOffsets[c] = runningOffset;
      currentOffsets[c] = runningOffset;
      runningOffset += cellCounts[c];
    }

    // 4. 第二趟装填 (Pass 2): 顺序写入 compactEntityIds 连续切片
    for (let i = 0; i < activeCount; i++) {
      const id = denseEntities[i];
      if ((statusFlags[id] & IS_ALIVE) === 0) {
        continue;
      }

      const tfOffset = id << 2;
      const x = transforms[tfOffset];
      const y = transforms[tfOffset + 1];

      let col = (x * invCellSize) | 0;
      let row = (y * invCellSize) | 0;

      col = col < 0 ? 0 : (col > maxCol ? maxCol : col);
      row = row < 0 ? 0 : (row > maxRow ? maxRow : row);

      const cellIdx = row * cols + col;
      compactEntityIds[currentOffsets[cellIdx]++] = id;
    }
  }

  /**
   * 将世界像素坐标转换为单元格线性索引
   * @param {number} x 
   * @param {number} y 
   * @returns {number} cellIndex
   */
  getCellIndex(x, y) {
    let col = (x * this.invCellSize) | 0;
    let row = (y * this.invCellSize) | 0;

    col = col < 0 ? 0 : (col >= this.cols ? this.cols - 1 : col);
    row = row < 0 ? 0 : (row >= this.rows ? this.rows - 1 : row);

    return row * this.cols + col;
  }

  /**
   * 将世界坐标转换为网格行列号
   * @param {number} x 
   * @param {number} y 
   * @param {Int32Array} [outCoords] 可选复用接收数组 [col, row]
   * @returns {number} combined (row << 16 | col)
   */
  getGridCoords(x, y, outCoords = null) {
    let col = (x * this.invCellSize) | 0;
    let row = (y * this.invCellSize) | 0;

    col = col < 0 ? 0 : (col >= this.cols ? this.cols - 1 : col);
    row = row < 0 ? 0 : (row >= this.rows ? this.rows - 1 : row);

    if (outCoords) {
      outCoords[0] = col;
      outCoords[1] = row;
    }

    return (row << 16) | (col & 0xFFFF);
  }
}
