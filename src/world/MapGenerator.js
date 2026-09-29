/**
 * MapGenerator.js
 * 确定性大陆生物群系地图生成器
 * 
 * 核心指标:
 * 1. 结合 PRNG (Mulberry32) 幂等生成大陆地貌、温带平原、高山岩矿、水体 (深/浅)、熔岩裂隙、沼泽与神圣泉眼
 * 2. 纯无状态/零 GC 算法，相同种子输出 100% 比对一致
 * 3. 严格对齐 56x36 规格与 BiomeData 枚举
 */

import { PRNG } from '../core/PRNG.js';
import { Biomes } from '../data/BiomeData.js';
import { GRID_WIDTH, GRID_HEIGHT, TOTAL_TILES } from './TileGrid.js';

export class MapGenerator {
  /**
   * @param {number} [seed=42]
   */
  constructor(seed = 42) {
    this.seed = seed >>> 0;
    this.prng = new PRNG(this.seed);

    // 预分配置换表 (用于确定性连续平滑噪声，512 字节常驻零 GC)
    this.perm = new Uint8Array(512);
    this._initPermutationTable();
  }

  /**
   * 使用 PRNG 初始化置换表
   * @private
   */
  _initPermutationTable() {
    this.prng.setSeed(this.seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      p[i] = i;
    }
    // Fisher-Yates 洗牌
    for (let i = 255; i > 0; i--) {
      const j = this.prng.nextInt(0, i);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    // 双倍平铺避免模运算
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
    }
  }

  /**
   * 设置新种子并重新初始化置换表
   * @param {number} seed
   */
  setSeed(seed) {
    this.seed = seed >>> 0;
    this._initPermutationTable();
  }

  /**
   * 缓和曲线 (Quintic ease curve: 6t^5 - 15t^4 + 10t^3)
   * @private
   */
  _fade(t) {
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  }

  /**
   * 线性插值
   * @private
   */
  _lerp(t, a, b) {
    return a + t * (b - a);
  }

  /**
   * 二维确定性连续梯度噪声 [-1.0, 1.0]
   * @private
   */
  _noise2D(x, y, offset = 0) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;

    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const u = this._fade(xf);
    const v = this._fade(yf);

    const p = this.perm;
    const A = (p[(X + offset) & 255] + Y) & 255;
    const B = (p[(X + offset + 1) & 255] + Y) & 255;

    const g00 = (p[A] & 7) - 3.5;
    const g10 = (p[B] & 7) - 3.5;
    const g01 = (p[A + 1] & 7) - 3.5;
    const g11 = (p[B + 1] & 7) - 3.5;

    const n00 = g00 * (xf * 0.5 + yf * 0.5);
    const n10 = g10 * ((xf - 1.0) * 0.5 + yf * 0.5);
    const n01 = g01 * (xf * 0.5 + (yf - 1.0) * 0.5);
    const n11 = g11 * ((xf - 1.0) * 0.5 + (yf - 1.0) * 0.5);

    const nx0 = this._lerp(u, n00, n10);
    const nx1 = this._lerp(u, n01, n11);

    return this._lerp(v, nx0, nx1) * 0.5;
  }

  /**
   * 分形布朗多八度噪声
   * @private
   */
  _fbm(x, y, octaves = 3, lacunarity = 2.0, gain = 0.5, offset = 0) {
    let sum = 0.0;
    let amp = 1.0;
    let freq = 1.0;
    let max = 0.0;

    for (let i = 0; i < octaves; i++) {
      sum += this._noise2D(x * freq, y * freq, offset + i * 37) * amp;
      max += amp;
      freq *= lacunarity;
      amp *= gain;
    }

    return sum / max;
  }

  /**
   * 幂等生成全图群系分布并写入目标 TileGrid
   * @param {import('./TileGrid.js').TileGrid} tileGrid
   */
  generate(tileGrid) {
    const cx = (GRID_WIDTH - 1) * 0.5;
    const cy = (GRID_HEIGHT - 1) * 0.5;

    // 1. 遍历 56x36 网格计算高度、湿度与特殊地质点
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        const idx = y * GRID_WIDTH + x;

        // 地图边缘绝壁强制屏障 (最外层一圈或近边界)
        if (x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1) {
          tileGrid.setTileByIndex(idx, Biomes.DEEP_WATER.id, -1.0);
          continue;
        }

        // 大陆向心距离 (椭圆归一化距离 [0.0, 1.4])
        const dx = (x - cx) / (GRID_WIDTH * 0.48);
        const dy = (y - cy) / (GRID_HEIGHT * 0.48);
        const distSq = dx * dx + dy * dy;
        const radialFalloff = Math.max(0.0, 1.0 - distSq);

        // 海拔高度场 FBM: [-1.0, 1.0]
        const rawElev = this._fbm(x * 0.09, y * 0.09, 3, 2.0, 0.5, 0);
        // 结合大陆径向衰减形成中心大陆
        const elevation = rawElev * 0.6 + (radialFalloff - 0.4) * 0.8;

        // 湿度场 FBM
        const moisture = this._fbm(x * 0.08 + 10.5, y * 0.08 + 5.5, 2, 2.0, 0.5, 89);
        // 地热裂隙/温度场
        const heat = this._fbm(x * 0.12 + 25.0, y * 0.12 + 40.0, 2, 2.0, 0.5, 173);

        // 群系分类决策机 (确保各大群系稳定涌现)
        if (elevation < -0.15) {
          // 深水绝壁
          tileGrid.setTileByIndex(idx, Biomes.DEEP_WATER.id, elevation);
        } else if (elevation < 0.05) {
          // 浅水滩涂
          tileGrid.setTileByIndex(idx, Biomes.SHALLOW_WATER.id, elevation);
        } else if (y > GRID_HEIGHT * 0.65 && heat > 0.15 && elevation < 0.45) {
          // 南部地热熔岩裂隙 (Volcano rift)
          tileGrid.setTileByIndex(idx, Biomes.VOLCANO.id, elevation);
        } else if (elevation > 0.48) {
          // 高山岩矿
          tileGrid.setTileByIndex(idx, Biomes.MOUNTAINS.id, elevation);
        } else if (moisture > 0.12 && elevation < 0.25) {
          // 腐蚀沼泽低洼湿地
          tileGrid.setTileByIndex(idx, Biomes.SWAMP.id, elevation);
        } else {
          // 温带平原
          tileGrid.setTileByIndex(idx, Biomes.PLAINS.id, elevation);
        }
      }
    }

    // 2. 确定性播种神圣泉眼 (HOLY_SPRING)
    // 在中心大陆挑选 2 处避世圣水泉眼
    this.prng.setSeed((this.seed ^ 0x9E3779B9) >>> 0);
    let holySpringPlaced = 0;
    const maxSprings = 2;
    const searchAttempts = 200;

    for (let k = 0; k < searchAttempts && holySpringPlaced < maxSprings; k++) {
      const rx = this.prng.nextInt(12, GRID_WIDTH - 13);
      const ry = this.prng.nextInt(8, GRID_HEIGHT - 9);
      const idx = ry * GRID_WIDTH + rx;

      // 仅在平原或浅滩边缘生成神圣泉眼
      const type = tileGrid.tileTypes[idx];
      if (type === Biomes.PLAINS.id || type === Biomes.SHALLOW_WATER.id) {
        tileGrid.setTileByIndex(idx, Biomes.HOLY_SPRING.id, 0.3);
        holySpringPlaced++;
      }
    }

    // 防御性保底：若因极端种子未命中，直接在安全中心位安放
    if (holySpringPlaced === 0) {
      const fallbackIdx = Math.floor(cy) * GRID_WIDTH + Math.floor(cx);
      tileGrid.setTileByIndex(fallbackIdx, Biomes.HOLY_SPRING.id, 0.3);
    }
  }
}
