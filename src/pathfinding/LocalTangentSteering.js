/**
 * LocalTangentSteering.js
 * 微观切线避障与密度自适应解拥堵分离力系统
 * 严格遵照 SPEC-M3-CONTRACT §3.2 & §3.3
 *
 * 核心机制:
 * 1. 前向 2 瓦片 (约 48px) 切线避障: 探测到动态火海/沼泽/障碍物时，旋转 90 度顺边缘平滑绕行
 * 2. 密度自适应解拥堵分离力: alpha_sep = max(0.05, 0.30 - 0.05 * LocalDensity)
 * 3. 100% 物理零 GC: 复用出参对象
 */

import { TILE_SIZE, GRID_WIDTH, GRID_HEIGHT } from '../world/TileGrid.js';
import { HazardTypes, isBiomeImpassable } from '../data/BiomeData.js';

export const PROBE_DISTANCE_PX = 48.0; // 前方 2 瓦片探测距离 (48px)
export const AVOID_WEIGHT = 1.2;       // 切线避障权重

export class LocalTangentSteering {
  /**
   * @param {import('../world/TileGrid.js').TileGrid} tileGrid 
   */
  constructor(tileGrid) {
    this.tileGrid = tileGrid;
    this.width = GRID_WIDTH;
    this.height = GRID_HEIGHT;

    // 零 GC 复用计算结果
    this._steerResult = {
      vx: 0.0,
      vy: 0.0,
      isAvoiding: false,
      alphaSep: 0.30
    };
  }

  /**
   * 检查指定瓦片是否存在动态环境危险或物理阻碍
   * @param {number} tx 瓦片横坐标
   * @param {number} ty 瓦片纵坐标
   * @returns {boolean}
   */
  isHazardOrBlocked(tx, ty) {
    if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) {
      return true; // 越界视为阻挡
    }
    const idx = ty * this.width + tx;

    // 1. 危险地貌 (烈焰/剧毒腐蚀沼泽)
    const hazard = this.tileGrid.hazardType[idx];
    if (hazard === HazardTypes.FIRE || hazard === HazardTypes.ACID) {
      return true;
    }

    // 2. 物理绝壁/深水
    const tType = this.tileGrid.tileTypes[idx];
    if (isBiomeImpassable(tType) || this.tileGrid.moveCost[idx] >= 999.0) {
      return true;
    }

    return false;
  }

  /**
   * 计算局部密度自适应分离力阻尼系数
   * alpha_sep = max(0.05, 0.30 - 0.05 * LocalDensity)
   * 隘口极度拥挤时弱化横向推挤，优先顺应流场前向推移，彻底消灭千人卡死死锁
   *
   * @param {number} localDensity 局部单位密度 (周围单位数量)
   * @returns {number}
   */
  computeSeparationAlpha(localDensity) {
    return Math.max(0.05, 0.30 - 0.05 * localDensity);
  }

  /**
   * 微观转向与切线合成
   *
   * @param {number} worldX 实体世界横坐标
   * @param {number} worldY 实体世界纵坐标
   * @param {number} flowVx 宏观流场引导 X 速度分量
   * @param {number} flowVy 宏观流场引导 Y 速度分量
   * @param {number} [localDensity=0] 局部邻居密度
   * @param {number} [sepVx=0] 原始排斥分离力 X 分量
   * @param {number} [sepVy=0] 原始排斥分离力 Y 分量
   * @param {object|null} [out=null] 可选复用结果对象
   * @returns {{vx: number, vy: number, isAvoiding: boolean, alphaSep: number}}
   */
  steer(worldX, worldY, flowVx, flowVy, localDensity = 0, sepVx = 0.0, sepVy = 0.0, out = null) {
    const res = out || this._steerResult;
    res.vx = flowVx;
    res.vy = flowVy;
    res.isAvoiding = false;
    res.alphaSep = this.computeSeparationAlpha(localDensity);

    // 引导速度为 0 时直接返回
    const flowLenSq = flowVx * flowVx + flowVy * flowVy;
    if (flowLenSq <= 0.0001) {
      return res;
    }

    // 1. 前向 2 瓦片射线探测 (PROBE_DISTANCE_PX = 48px)
    const probeX = worldX + flowVx * PROBE_DISTANCE_PX;
    const probeY = worldY + flowVy * PROBE_DISTANCE_PX;

    const probeTx = Math.floor(probeX / TILE_SIZE);
    const probeTy = Math.floor(probeY / TILE_SIZE);

    if (this.isHazardOrBlocked(probeTx, probeTy)) {
      res.isAvoiding = true;

      // 计算正切向量 (旋转 90 度: [-vy, vx] 与 [vy, -vx])
      const tan1X = -flowVy;
      const tan1Y = flowVx;
      const tan2X = flowVy;
      const tan2Y = -flowVx;

      // 评估两侧切线探测点的通行安全性，择优选择切线
      const probe1Tx = Math.floor((worldX + tan1X * TILE_SIZE) / TILE_SIZE);
      const probe1Ty = Math.floor((worldY + tan1Y * TILE_SIZE) / TILE_SIZE);
      const safe1 = !this.isHazardOrBlocked(probe1Tx, probe1Ty);

      let bestTanX = tan1X;
      let bestTanY = tan1Y;
      if (!safe1) {
        bestTanX = tan2X;
        bestTanY = tan2Y;
      }

      // 速度合成: V_steer = V_flow + N_tangent * w_avoid
      let combinedVx = flowVx + bestTanX * AVOID_WEIGHT;
      let combinedVy = flowVy + bestTanY * AVOID_WEIGHT;

      // 归一化
      const cLenSq = combinedVx * combinedVx + combinedVy * combinedVy;
      if (cLenSq > 0.0001) {
        const invLen = 1.0 / Math.sqrt(cLenSq);
        res.vx = combinedVx * invLen;
        res.vy = combinedVy * invLen;
      }
    }

    // 2. 注入密度自适应分离力: 弱化狭窄隘口横向推挤
    if (sepVx !== 0.0 || sepVy !== 0.0) {
      const alpha = res.alphaSep;
      res.vx += sepVx * alpha;
      res.vy += sepVy * alpha;

      // 二次归一化
      const fLenSq = res.vx * res.vx + res.vy * res.vy;
      if (fLenSq > 0.0001) {
        const invF = 1.0 / Math.sqrt(fLenSq);
        res.vx *= invF;
        res.vy *= invF;
      }
    }

    return res;
  }
}
