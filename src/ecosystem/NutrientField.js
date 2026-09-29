/**
 * NutrientField.js
 * 二维拉普拉斯连续地脉养分扩散场与 Neumann 绝热反射边界系统
 * 
 * 核心设计指标:
 * 1. 规格: 56x36 = 2016 瓦片，双缓冲 Float32Array(2016)
 * 2. 偏微分方程: dN/dt = alpha * Laplacian(N) + S - D
 * 3. 冯·诺伊曼 (Neumann) 绝热反射算子: 边界法向通量严格为 0，封闭系统绝对能量守恒
 * 4. 群系底温保底: N = Math.max(N, baseHeat)，杜绝热寂
 * 5. 绝对零 GC: 双缓冲指针原地 Ping-Pong 切换，单物理帧零内存分配
 */

import { GRID_WIDTH, GRID_HEIGHT, TOTAL_TILES } from '../world/TileGrid.js';

export const DIFFUSION_ALPHA = 0.05; // 默认拉普拉斯扩散系数

export class NutrientField {
  /**
   * @param {import('../world/TileGrid.js').TileGrid|null} [tileGrid=null]
   * @param {number} [alpha=DIFFUSION_ALPHA]
   */
  constructor(tileGrid = null, alpha = DIFFUSION_ALPHA) {
    this.width = GRID_WIDTH;
    this.height = GRID_HEIGHT;
    this.totalTiles = TOTAL_TILES;
    this.alpha = alpha;
    this.tileGrid = tileGrid;

    // 双缓冲 Float32Array (各 2016 * 4 = 8064 字节，常驻零 GC)
    this.bufferA = new Float32Array(TOTAL_TILES);
    this.bufferB = new Float32Array(TOTAL_TILES);

    this.current = this.bufferA;
    this.next = this.bufferB;

    // 预分配底温场 (floors 契约别名)
    this.baseHeat = new Float32Array(TOTAL_TILES);
    this.floors = this.baseHeat;
    this.syncBaseHeatFromGrid();
  }

  /**
   * 从绑定的 TileGrid 同步底温场
   */
  syncBaseHeatFromGrid() {
    if (!this.tileGrid) return;
    const floors = this.tileGrid.nutrientFloor;
    const base = this.baseHeat;
    for (let i = 0; i < TOTAL_TILES; i++) {
      base[i] = floors[i] * 50.0;
    }
  }

  /**
   * 获取指定坐标的一维索引 (内部快速 clamp)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getIndex(x, y) {
    const cx = x < 0 ? 0 : x >= GRID_WIDTH ? GRID_WIDTH - 1 : x | 0;
    const cy = y < 0 ? 0 : y >= GRID_HEIGHT ? GRID_HEIGHT - 1 : y | 0;
    return cy * GRID_WIDTH + cx;
  }

  /**
   * 获取指定瓦片的养分值
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getNutrient(x, y) {
    return this.current[this.getIndex(x, y)];
  }

  /**
   * 获取指定索引的养分值
   * @param {number} idx
   * @returns {number}
   */
  getNutrientByIndex(idx) {
    if (idx < 0 || idx >= TOTAL_TILES) return 0.0;
    return this.current[idx];
  }

  /**
   * 设置指定瓦片的养分值
   * @param {number} x
   * @param {number} y
   * @param {number} val
   */
  setNutrient(x, y, val) {
    this.current[this.getIndex(x, y)] = Math.max(0.0, val);
  }

  /**
   * 设置指定索引的养分值
   * @param {number} idx
   * @param {number} val
   */
  setNutrientByIndex(idx, val) {
    if (idx < 0 || idx >= TOTAL_TILES) return;
    this.current[idx] = Math.max(0.0, val);
  }

  /**
   * 向指定瓦片注入养分
   * @param {number} x
   * @param {number} y
   * @param {number} amount
   */
  addNutrient(x, y, amount) {
    const idx = this.getIndex(x, y);
    this.current[idx] = Math.max(0.0, this.current[idx] + amount);
  }

  /**
   * 向指定索引瓦片注入养分
   * @param {number} idx
   * @param {number} amount
   */
  addNutrientByIndex(idx, amount) {
    if (idx < 0 || idx >= TOTAL_TILES) return;
    this.current[idx] = Math.max(0.0, this.current[idx] + amount);
  }

  /**
   * 从指定瓦片消耗/汲取养分 (保底不为负)
   * @param {number} x
   * @param {number} y
   * @param {number} amount
   * @returns {number} 实际扣减的养分量
   */
  consumeNutrient(x, y, amount) {
    const idx = this.getIndex(x, y);
    return this.consumeNutrientByIndex(idx, amount);
  }

  /**
   * 从指定索引瓦片消耗养分
   * @param {number} idx
   * @param {number} amount
   * @returns {number}
   */
  consumeNutrientByIndex(idx, amount) {
    if (idx < 0 || idx >= TOTAL_TILES || amount <= 0) return 0.0;
    const cur = this.current[idx];
    const actual = Math.min(cur, amount);
    this.current[idx] = cur - actual;
    return actual;
  }

  /**
   * 统计全图当前总养分值
   * @returns {number}
   */
  getTotalNutrient() {
    let sum = 0.0;
    const cur = this.current;
    for (let i = 0; i < TOTAL_TILES; i++) {
      sum += cur[i];
    }
    return sum;
  }

  /**
   * 执行一次拉普拉斯扩散步进
   * 采用冯·诺伊曼绝热反射边界条件 (Neumann Boundary Condition: dN/dn = 0)
   * 
   * @param {number} dt - 步进步长 (秒)
   * @param {Float32Array|null} [sources=null] - 外部源项 S
   * @param {Float32Array|null} [sinks=null] - 外部汇项 D
   * @param {boolean} [applyBaseHeat=false] - 是否施加群系底温保底
   */
  step(dt = 1.0, sources = null, sinks = null, applyBaseHeat = false) {
    const cur = this.current;
    const nxt = this.next;
    const base = this.baseHeat;
    const alphaRate = this.alpha * dt;
    const w = GRID_WIDTH;
    const h = GRID_HEIGHT;

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const idx = rowOffset + x;
        const centerVal = cur[idx];

        // 冯·诺伊曼绝热反射边界算子：
        // 边界邻居镜像映射自身，即越界方向通量为 (centerVal - centerVal) = 0
        // 等价于只向合法网格内邻居累加拉普拉斯交换量
        let laplacian = 0.0;

        // 左邻居
        if (x > 0) {
          laplacian += cur[idx - 1] - centerVal;
        }
        // 右邻居
        if (x < w - 1) {
          laplacian += cur[idx + 1] - centerVal;
        }
        // 上邻居
        if (y > 0) {
          laplacian += cur[idx - w] - centerVal;
        }
        // 下邻居
        if (y < h - 1) {
          laplacian += cur[idx + w] - centerVal;
        }

        // 微分方程积分: N^{t+1} = N^t + alpha * dt * Laplacian + S - D
        let newVal = centerVal + alphaRate * laplacian;

        // 源项与汇项
        if (sources) {
          newVal += sources[idx];
        }
        if (sinks) {
          newVal -= sinks[idx];
        }

        // 底温保底截断
        if (applyBaseHeat) {
          const floor = base[idx];
          if (newVal < floor) {
            newVal = floor;
          }
        }

        // 数值下限硬防御 (非负)
        nxt[idx] = newVal > 0.0 ? newVal : 0.0;
      }
    }

    // 双缓冲原地指针切换 (绝对零 GC)
    const temp = this.current;
    this.current = this.next;
    this.next = temp;
  }

  /**
   * 遵循 M1 契约的单帧更新入口 (零 GC)
   * @param {number} [dt=1.0]
   * @param {boolean} [applyBaseHeat=false]
   */
  update(dt = 1.0, applyBaseHeat = false) {
    this.step(dt, null, null, applyBaseHeat);
  }

  /**
   * 将全图重置为指定均匀养分值
   * @param {number} [uniformValue=10.0]
   */
  reset(uniformValue = 10.0) {
    this.bufferA.fill(uniformValue);
    this.bufferB.fill(uniformValue);
    this.current = this.bufferA;
    this.next = this.bufferB;
  }

  /**
   * 测算 NutrientField 静态常驻连续内存字节总数
   * @returns {number}
   */
  calculateMemoryUsageBytes() {
    return (
      this.bufferA.byteLength +
      this.bufferB.byteLength +
      this.baseHeat.byteLength
    );
  }
}
