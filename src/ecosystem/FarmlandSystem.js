/**
 * FarmlandSystem.js
 * 2x2 农田四阶演替状态机与开垦轮作系统
 * 
 * 核心指标:
 * 1. 2x2 瓦片农田建筑复合体
 * 2. 四阶演替阶段:
 *    - 幼苗期 (SPROUT, 15s): 汲取养分生长
 *    - 成熟期 (MATURE): 产出 40 单位粮食，等待收割
 *    - 枯黄期 (WITHERED): 收割后扣除地脉 5 点养分
 *    - 休耕期 (FALLOW, 20s): 锁闭开垦 20 秒，养分 > 15 重新激活流转
 * 3. 战火与践踏损毁处理: 直接跳跃至休耕期，扣除 10 点地脉养分并销毁产出
 * 4. 纯 SoA TypedArray 连续平铺内存池，绝对零 GC
 */

import { GRID_WIDTH, GRID_HEIGHT } from '../world/TileGrid.js';

export const MAX_FARMLANDS = 128;

export const FarmlandStage = Object.freeze({
  SPROUT:    0, // 幼苗期 (15s)
  MATURE:    1, // 成熟期 (产出 40 粮食)
  WITHERED:  2, // 枯黄期 (扣减地脉 5 养分)
  HARVESTED: 2, // 枯黄期契约别名
  FALLOW:    3  // 休耕期 (20s，养分 > 15 重新激活)
});

export const FarmlandPhase = FarmlandStage;

export const SPROUT_DURATION = 15.0; // 幼苗期 15 秒
export const FALLOW_DURATION = 20.0; // 休耕期 20 秒
export const SPROUT_NUTRIENT_RATE = 0.2; // 幼苗期持续从地脉汲取 0.2/s 养分
export const HARVEST_YIELD = 40.0;   // 成熟产出 40 粮食
export const HARVEST_NUTRIENT_COST = 5.0; // 正常收割扣除地脉 5 点养分
export const PILLAGE_NUTRIENT_COST = 10.0;// 践踏损毁扣除地脉 10 点养分
export const REACTIVATION_NUTRIENT_THRESHOLD = 15.0; // 重新激活养分阈值

export class FarmlandSystem {
  constructor() {
    this.maxCapacity = MAX_FARMLANDS;
    this.activeCount = 0;

    // SoA 连续平铺内存布局
    this.farmActive = new Uint8Array(MAX_FARMLANDS);
    this.farmX = new Uint8Array(MAX_FARMLANDS);
    this.farmY = new Uint8Array(MAX_FARMLANDS);
    this.farmFactionId = new Uint8Array(MAX_FARMLANDS);
    this.farmStage = new Uint8Array(MAX_FARMLANDS);
    this.farmTimer = new Float32Array(MAX_FARMLANDS);
    this.farmYield = new Float32Array(MAX_FARMLANDS);
  }

  /**
   * 分配并初始化一个 2x2 农田复合体
   * @param {number} x - 农田左上角 X 瓦片坐标 [0, 54]
   * @param {number} y - 农田左上角 Y 瓦片坐标 [0, 34]
   * @param {number} [factionId=0] - 归属阵营 ID
   * @returns {number} 农田 ID (0 ~ 127)，若已满则返回 -1
   */
  createFarmland(x, y, factionId = 0) {
    if (this.activeCount >= this.maxCapacity) {
      return -1;
    }

    // 寻找空闲槽位
    let slot = -1;
    for (let i = 0; i < this.maxCapacity; i++) {
      if (this.farmActive[i] === 0) {
        slot = i;
        break;
      }
    }
    if (slot === -1) return -1;

    // 边界 Clamp 保障 2x2 位于网格内
    const clampedX = Math.max(0, Math.min(GRID_WIDTH - 2, x | 0));
    const clampedY = Math.max(0, Math.min(GRID_HEIGHT - 2, y | 0));

    this.farmActive[slot] = 1;
    this.farmX[slot] = clampedX;
    this.farmY[slot] = clampedY;
    this.farmFactionId[slot] = factionId;
    this.farmStage[slot] = FarmlandStage.SPROUT;
    this.farmTimer[slot] = 0.0;
    this.farmYield[slot] = 0.0;
    this.activeCount++;

    return slot;
  }

  /**
   * 销毁指定农田
   * @param {number} farmId 
   * @returns {boolean}
   */
  destroyFarmland(farmId) {
    if (farmId < 0 || farmId >= this.maxCapacity || this.farmActive[farmId] === 0) {
      return false;
    }
    this.farmActive[farmId] = 0;
    this.farmStage[farmId] = FarmlandStage.SPROUT;
    this.farmTimer[farmId] = 0.0;
    this.farmYield[farmId] = 0.0;
    this.activeCount--;
    return true;
  }

  /**
   * 计算指定农田 2x2 瓦片的平均地脉养分
   * @param {number} farmId 
   * @param {import('./NutrientField.js').NutrientField} nutrientField 
   * @returns {number}
   */
  getAverageNutrient(farmId, nutrientField) {
    if (this.farmActive[farmId] === 0) return 0.0;
    const x = this.farmX[farmId];
    const y = this.farmY[farmId];
    const n00 = nutrientField.getNutrient(x, y);
    const n10 = nutrientField.getNutrient(x + 1, y);
    const n01 = nutrientField.getNutrient(x, y + 1);
    const n11 = nutrientField.getNutrient(x + 1, y + 1);
    return (n00 + n10 + n01 + n11) * 0.25;
  }

  /**
   * 从 2x2 瓦片地脉中均摊扣除养分
   * @private
   * @param {number} farmId 
   * @param {import('./NutrientField.js').NutrientField} nutrientField 
   * @param {number} totalAmount 
   */
  _deductNutrient2x2(farmId, nutrientField, totalAmount) {
    const x = this.farmX[farmId];
    const y = this.farmY[farmId];
    const quarter = totalAmount * 0.25;
    nutrientField.consumeNutrient(x, y, quarter);
    nutrientField.consumeNutrient(x + 1, y, quarter);
    nutrientField.consumeNutrient(x, y + 1, quarter);
    nutrientField.consumeNutrient(x + 1, y + 1, quarter);
  }

  /**
   * 遭受战火掠夺或践踏损毁
   * 成熟期遭遇践踏直接跳跃至休耕期，扣除地脉 10 点养分并销毁产出
   * @param {number} farmId 
   * @param {import('./NutrientField.js').NutrientField} nutrientField 
   * @returns {boolean} 是否成功处理损毁
   */
  pillageFarmland(farmId, nutrientField) {
    if (farmId < 0 || farmId >= this.maxCapacity || this.farmActive[farmId] === 0) {
      return false;
    }

    // 扣除地脉 10 点养分
    this._deductNutrient2x2(farmId, nutrientField, PILLAGE_NUTRIENT_COST);

    // 产出销毁并直接跳入休耕期
    this.farmYield[farmId] = 0.0;
    this.farmStage[farmId] = FarmlandStage.FALLOW;
    this.farmTimer[farmId] = 0.0;

    return true;
  }

  /**
   * 收割成熟农田
   * @param {number} farmId 
   * @param {import('./NutrientField.js').NutrientField} nutrientField 
   * @returns {number} 产出的粮食数量 (成熟期产出 40，未成熟产出 0)
   */
  harvestFarmland(farmId, nutrientField) {
    if (farmId < 0 || farmId >= this.maxCapacity || this.farmActive[farmId] === 0) {
      return 0.0;
    }

    if (this.farmStage[farmId] !== FarmlandStage.MATURE) {
      return 0.0;
    }

    const grainYield = this.farmYield[farmId];

    // 进入枯黄收割结算: 扣减地脉 5 点养分
    this._deductNutrient2x2(farmId, nutrientField, HARVEST_NUTRIENT_COST);

    // 转入休耕期 (20s)
    this.farmStage[farmId] = FarmlandStage.FALLOW;
    this.farmTimer[farmId] = 0.0;
    this.farmYield[farmId] = 0.0;

    return grainYield;
  }

  /**
   * 驱动四阶演替状态机迭代 (绝对零 GC)
   * @param {number} dt - 步进步长 (秒)
   * @param {import('./NutrientField.js').NutrientField} nutrientField 
   */
  step(dt, nutrientField) {
    const total = this.maxCapacity;
    const active = this.farmActive;
    const stage = this.farmStage;
    const timer = this.farmTimer;
    const yld = this.farmYield;

    for (let i = 0; i < total; i++) {
      if (active[i] === 0) continue;

      const currentStage = stage[i];

      switch (currentStage) {
        case FarmlandStage.SPROUT: {
          // 幼苗期: 持续从 4 个瓦片地脉汲取 0.2 * dt 养分，累加计时满 15 秒转入成熟期
          if (nutrientField) {
            this._deductNutrient2x2(i, nutrientField, SPROUT_NUTRIENT_RATE * dt);
          }
          timer[i] += dt;
          if (timer[i] >= SPROUT_DURATION) {
            stage[i] = FarmlandStage.MATURE;
            timer[i] = 0.0;
            yld[i] = HARVEST_YIELD; // 产出 40 粮食储备
          }
          break;
        }

        case FarmlandStage.MATURE: {
          // 成熟期: 等待收割或被掠夺
          break;
        }

        case FarmlandStage.WITHERED: {
          // 枯黄期: 扣除地脉 5 点养分并立刻切入休耕
          this._deductNutrient2x2(i, nutrientField, HARVEST_NUTRIENT_COST);
          stage[i] = FarmlandStage.FALLOW;
          timer[i] = 0.0;
          yld[i] = 0.0;
          break;
        }

        case FarmlandStage.FALLOW: {
          // 休耕期: 倒计时 20 秒
          timer[i] += dt;
          if (timer[i] >= FALLOW_DURATION) {
            // 检测 2x2 瓦片底层地脉养分
            const avgNutrient = this.getAverageNutrient(i, nutrientField);
            if (avgNutrient > REACTIVATION_NUTRIENT_THRESHOLD) {
              // 养分充沛 (> 15)，重新激活进入幼苗期开始新一轮耕作
              stage[i] = FarmlandStage.SPROUT;
              timer[i] = 0.0;
              yld[i] = 0.0;
            }
            // 若养分不足，则继续停留在休耕期等待地脉养分回流
          }
          break;
        }
      }
    }
  }

  /**
   * 遵循 M1 契约的单帧更新入口 (零 GC)
   * @param {number} dt 
   * @param {import('./NutrientField.js').NutrientField} nutrientField 
   */
  update(dt, nutrientField) {
    this.step(dt, nutrientField);
  }

  /**
   * 测算 FarmlandSystem 连续 TypedArray 常驻内存字节总数
   * @returns {number}
   */
  calculateMemoryUsageBytes() {
    return (
      this.farmActive.byteLength +
      this.farmX.byteLength +
      this.farmY.byteLength +
      this.farmFactionId.byteLength +
      this.farmStage.byteLength +
      this.farmTimer.byteLength +
      this.farmYield.byteLength
    );
  }
}
