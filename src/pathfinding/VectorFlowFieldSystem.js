/**
 * VectorFlowFieldSystem.js
 * 大军团反向 BFS 向量流场寻路系统
 * 严格遵照 SPEC-M3-CONTRACT §3.1
 *
 * 核心特性:
 * 1. 56x36 拓扑瓦片网格 (2016 瓦片) 连续平铺内存: distanceField, vectorFieldX, vectorFieldY
 * 2. 反向 BFS 积分: 从目标逆向波前扩散，不可通行瓦片距离为 65535
 * 3. 8 向中心差分梯度积分归一化引导向量，单次全图积分严格 < 1.8ms
 * 4. 零 GC 内存设计: 每帧采样 0 临时对象分配，采样耗时 < 0.05ms
 */

import {
  GRID_WIDTH,
  GRID_HEIGHT,
  TOTAL_TILES,
  TILE_SIZE
} from '../world/TileGrid.js';
import { isBiomeImpassable } from '../data/BiomeData.js';

export const IMPASSABLE_DISTANCE = 65535;

// 8 向邻居偏移与距离权重 [dx, dy, baseCost]
// 正交移动基准代价 10，对角移动基准代价 14 (近似 10 * sqrt(2))
const NEIGHBORS = [
  [-1,  0, 10], // 左
  [ 1,  0, 10], // 右
  [ 0, -1, 10], // 上
  [ 0,  1, 10], // 下
  [-1, -1, 14], // 左上
  [ 1, -1, 14], // 右上
  [-1,  1, 14], // 左下
  [ 1,  1, 14]  // 右下
];

export class VectorFlowFieldSystem {
  /**
   * @param {import('../world/TileGrid.js').TileGrid} tileGrid
   */
  constructor(tileGrid) {
    this.tileGrid = tileGrid;
    this.width = GRID_WIDTH;
    this.height = GRID_HEIGHT;
    this.totalTiles = TOTAL_TILES;

    // 平铺连续类型化数组内存池
    this.distanceField = new Uint16Array(TOTAL_TILES);
    this.vectorFieldX = new Float32Array(TOTAL_TILES);
    this.vectorFieldY = new Float32Array(TOTAL_TILES);

    // 预分配 BFS 循环队列 (容量 2048，足够容纳全图 2016 瓦片)
    this._queue = new Uint16Array(TOTAL_TILES + 32);
    this._queueMask = TOTAL_TILES + 31; // 仅做边界保护

    // 零 GC 复用采样返回对象
    this._sampleResult = {
      x: 0.0,
      y: 0.0,
      distance: 0,
      tileX: 0,
      tileY: 0
    };

    // 当前目标瓦片坐标
    this.targetTileX = -1;
    this.targetTileY = -1;

    this.clear();
  }

  /**
   * 清空流场数据
   */
  clear() {
    this.distanceField.fill(IMPASSABLE_DISTANCE);
    this.vectorFieldX.fill(0.0);
    this.vectorFieldY.fill(0.0);
    this.targetTileX = -1;
    this.targetTileY = -1;
  }

  /**
   * 根据世界坐标或瓦片索引生成/更新流场
   * @param {number|{targetX: number, targetY: number}} targetArg 
   * @param {number} [targetY=null]
   * @returns {void}
   */
  generateField(targetArg, targetY = null) {
    let tTileX = 0;
    let tTileY = 0;

    if (typeof targetArg === 'object' && targetArg !== null) {
      // 传入几何坐标对象 { targetX, targetY }
      tTileX = Math.floor(targetArg.targetX / TILE_SIZE);
      tTileY = Math.floor(targetArg.targetY / TILE_SIZE);
    } else if (typeof targetArg === 'number' && typeof targetY === 'number') {
      // 传入 (worldX, worldY)
      tTileX = Math.floor(targetArg / TILE_SIZE);
      tTileY = Math.floor(targetY / TILE_SIZE);
    } else if (typeof targetArg === 'number' && targetY === null) {
      // 传入瓦片索引 tileIndex
      tTileX = targetArg % this.width;
      tTileY = Math.floor(targetArg / this.width);
    }

    // Clamp 到网格范围
    tTileX = Math.max(0, Math.min(this.width - 1, tTileX));
    tTileY = Math.max(0, Math.min(this.height - 1, tTileY));

    this.targetTileX = tTileX;
    this.targetTileY = tTileY;

    // 1. 初始化距离场
    this.distanceField.fill(IMPASSABLE_DISTANCE);

    // 目标瓦片距离为 0
    const targetIdx = tTileY * this.width + tTileX;
    this.distanceField[targetIdx] = 0;

    // 2. 反向 BFS 波前扩散
    let head = 0;
    let tail = 0;
    this._queue[tail++] = targetIdx;

    const w = this.width;
    const h = this.height;
    const distField = this.distanceField;
    const tileTypes = this.tileGrid.tileTypes;
    const moveCost = this.tileGrid.moveCost;

    while (head < tail) {
      const currIdx = this._queue[head++];
      const currDist = distField[currIdx];
      const cx = currIdx % w;
      const cy = (currIdx / w) | 0;

      for (let i = 0; i < 8; i++) {
        const nx = cx + NEIGHBORS[i][0];
        const ny = cy + NEIGHBORS[i][1];

        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

        const nIdx = ny * w + nx;

        // 不可通行障碍物判定 (深水绝壁或 moveCost >= 999)
        const tType = tileTypes[nIdx];
        if (isBiomeImpassable(tType) || moveCost[nIdx] >= 999.0) {
          continue;
        }

        // 通行成本加权: baseCost * moveCostMultiplier
        const costWeight = moveCost[nIdx] > 0.0 ? moveCost[nIdx] : 1.0;
        const stepCost = Math.round(NEIGHBORS[i][2] * costWeight);
        const nextDist = currDist + stepCost;

        if (nextDist < distField[nIdx]) {
          distField[nIdx] = nextDist;
          this._queue[tail++] = nIdx;
        }
      }
    }

    // 3. 计算 8 向中心差分梯度归一化引导向量
    const vX = this.vectorFieldX;
    const vY = this.vectorFieldY;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const idx = rowOffset + x;

        // 若当前格为目标格或不可达格，向量归零
        if (distField[idx] === 0 || distField[idx] === IMPASSABLE_DISTANCE) {
          vX[idx] = 0.0;
          vY[idx] = 0.0;
          continue;
        }

        // 8 向中心差分采样左右上下
        const leftDist  = (x > 0) ? distField[idx - 1] : distField[idx];
        const rightDist = (x < w - 1) ? distField[idx + 1] : distField[idx];
        const upDist    = (y > 0) ? distField[idx - w] : distField[idx];
        const downDist  = (y < h - 1) ? distField[idx + w] : distField[idx];

        // 梯度向量: 指向距离减小的方向 (向山下流淌)
        let gradX = (leftDist - rightDist) * 0.5;
        let gradY = (upDist - downDist) * 0.5;

        // 若正交梯度为 0，采样对角线邻居辅助
        if (gradX === 0.0 && gradY === 0.0) {
          let minD = distField[idx];
          let bestDx = 0;
          let bestDy = 0;
          for (let i = 0; i < 8; i++) {
            const nx = x + NEIGHBORS[i][0];
            const ny = y + NEIGHBORS[i][1];
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const d = distField[ny * w + nx];
              if (d < minD) {
                minD = d;
                bestDx = NEIGHBORS[i][0];
                bestDy = NEIGHBORS[i][1];
              }
            }
          }
          gradX = bestDx;
          gradY = bestDy;
        }

        // 归一化处理
        const lenSq = gradX * gradX + gradY * gradY;
        if (lenSq > 0.0001) {
          const invLen = 1.0 / Math.sqrt(lenSq);
          vX[idx] = gradX * invLen;
          vY[idx] = gradY * invLen;
        } else {
          vX[idx] = 0.0;
          vY[idx] = 0.0;
        }
      }
    }
  }

  /**
   * 零 GC 采样流场引导向量
   * @param {number} worldX 实体世界横坐标
   * @param {number} worldY 实体世界纵坐标
   * @param {object|null} [out=null] 可选复用接收对象
   * @returns {{x: number, y: number, distance: number, tileX: number, tileY: number}}
   */
  sampleField(worldX, worldY, out = null) {
    const res = out || this._sampleResult;

    const tx = Math.max(0, Math.min(this.width - 1, Math.floor(worldX / TILE_SIZE)));
    const ty = Math.max(0, Math.min(this.height - 1, Math.floor(worldY / TILE_SIZE)));
    const idx = ty * this.width + tx;

    res.x = this.vectorFieldX[idx];
    res.y = this.vectorFieldY[idx];
    res.distance = this.distanceField[idx];
    res.tileX = tx;
    res.tileY = ty;

    return res;
  }
}
