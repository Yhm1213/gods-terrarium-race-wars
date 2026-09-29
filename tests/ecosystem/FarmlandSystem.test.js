import { describe, it, expect, beforeEach } from 'vitest';
import {
  FarmlandSystem,
  FarmlandStage,
  SPROUT_DURATION,
  FALLOW_DURATION,
  HARVEST_YIELD,
  HARVEST_NUTRIENT_COST,
  PILLAGE_NUTRIENT_COST,
  REACTIVATION_NUTRIENT_THRESHOLD
} from '../../src/ecosystem/FarmlandSystem.js';
import { NutrientField } from '../../src/ecosystem/NutrientField.js';
import { TileGrid } from '../../src/world/TileGrid.js';

describe('FarmlandSystem (WP-2.2.3 2x2 农田四阶演替状态机与开垦轮作)', () => {
  let farmlandSys;
  let nutrientField;
  let tileGrid;

  beforeEach(() => {
    tileGrid = new TileGrid();
    nutrientField = new NutrientField(tileGrid);
    nutrientField.reset(30.0); // 初始充足养分 30.0
    farmlandSys = new FarmlandSystem();
  });

  it('状态机转换断言：完整经历 幼苗 (15s) -> 成熟 (产出 40 粮食) -> 收割扣 5 养分 -> 休耕 (20s) -> 自动重新激活', () => {
    // 1. 创建 2x2 农田在 (10, 10)
    const farmId = farmlandSys.createFarmland(10, 10, 1);
    expect(farmId).toBe(0);
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.SPROUT);
    expect(farmlandSys.farmYield[farmId]).toBe(0.0);

    // 2. 幼苗期步进 14 秒 (未满 15 秒)
    farmlandSys.step(14.0, nutrientField);
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.SPROUT);

    // 步进 1.0 秒达到 15 秒，转入成熟期
    farmlandSys.step(1.0, nutrientField);
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.MATURE);
    expect(farmlandSys.farmYield[farmId]).toBe(40.0);

    // 3. 记录收割前 2x2 瓦片总养分
    const initialNutrient = (
      nutrientField.getNutrient(10, 10) +
      nutrientField.getNutrient(11, 10) +
      nutrientField.getNutrient(10, 11) +
      nutrientField.getNutrient(11, 11)
    );

    // 收割农田
    const yieldHarvested = farmlandSys.harvestFarmland(farmId, nutrientField);
    expect(yieldHarvested).toBe(40.0);
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.FALLOW);

    // 验证扣除地脉 5 点养分
    const postHarvestNutrient = (
      nutrientField.getNutrient(10, 10) +
      nutrientField.getNutrient(11, 10) +
      nutrientField.getNutrient(10, 11) +
      nutrientField.getNutrient(11, 11)
    );
    expect(initialNutrient - postHarvestNutrient).toBeCloseTo(5.0, 4);

    // 4. 休耕期步进 19 秒 (未满 20 秒)
    farmlandSys.step(19.0, nutrientField);
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.FALLOW);

    // 步进 1.0 秒达到 20 秒 (养分 > 15，自动重新激活流转回幼苗期)
    farmlandSys.step(1.0, nutrientField);
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.SPROUT);
  });

  it('掠夺损毁断言：向成熟农田注入攻击/践踏事件，产出被销毁，瓦片养分即时扣除 10 点并跳跃至休耕期', () => {
    const farmId = farmlandSys.createFarmland(5, 5, 2);

    // 步进至成熟期
    farmlandSys.step(15.0, nutrientField);
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.MATURE);
    expect(farmlandSys.farmYield[farmId]).toBe(40.0);

    const nutrientBefore = (
      nutrientField.getNutrient(5, 5) +
      nutrientField.getNutrient(6, 5) +
      nutrientField.getNutrient(5, 6) +
      nutrientField.getNutrient(6, 6)
    );

    // 战火掠夺
    const pillaged = farmlandSys.pillageFarmland(farmId, nutrientField);
    expect(pillaged).toBe(true);

    // 产出销毁为 0，直接跳跃至休耕期
    expect(farmlandSys.farmYield[farmId]).toBe(0.0);
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.FALLOW);
    expect(farmlandSys.farmTimer[farmId]).toBe(0.0);

    // 地脉扣除 10 点养分
    const nutrientAfter = (
      nutrientField.getNutrient(5, 5) +
      nutrientField.getNutrient(6, 5) +
      nutrientField.getNutrient(5, 6) +
      nutrientField.getNutrient(6, 6)
    );
    expect(nutrientBefore - nutrientAfter).toBeCloseTo(10.0, 4);
  });

  it('休耕期低养分锁定断言：底层养分 <= 15 时休耕期不唤醒，地脉养分回流 > 15 后自动激活', () => {
    const farmId = farmlandSys.createFarmland(20, 20, 1);
    // 强制直接进入休耕期
    farmlandSys.farmStage[farmId] = FarmlandStage.FALLOW;
    farmlandSys.farmTimer[farmId] = 0.0;

    // 将底层 2x2 瓦片养分全部清零 (贫瘠)
    nutrientField.setNutrient(20, 20, 2.0);
    nutrientField.setNutrient(21, 20, 2.0);
    nutrientField.setNutrient(20, 21, 2.0);
    nutrientField.setNutrient(21, 21, 2.0);

    // 步进 25 秒 (超过 20 秒)
    farmlandSys.step(25.0, nutrientField);
    // 因为平均养分 2.0 <= 15.0，保持休耕锁闭
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.FALLOW);

    // 向底层瓦片回流注入丰富养分 (> 15)
    nutrientField.setNutrient(20, 20, 20.0);
    nutrientField.setNutrient(21, 20, 20.0);
    nutrientField.setNutrient(20, 21, 20.0);
    nutrientField.setNutrient(21, 21, 20.0);

    // 下一次步进，养分充沛，重新激活进入幼苗期
    farmlandSys.step(1.0, nutrientField);
    expect(farmlandSys.farmStage[farmId]).toBe(FarmlandStage.SPROUT);
  });

  it('幼苗期持续吸养断言：以 0.2/s 速率持续从 4 个瓦片均匀汲取养分', () => {
    const farmId = farmlandSys.createFarmland(30, 30, 1);
    nutrientField.setNutrient(30, 30, 20.0);
    nutrientField.setNutrient(31, 30, 20.0);
    nutrientField.setNutrient(30, 31, 20.0);
    nutrientField.setNutrient(31, 31, 20.0);

    const initialTotal = (
      nutrientField.getNutrient(30, 30) +
      nutrientField.getNutrient(31, 30) +
      nutrientField.getNutrient(30, 31) +
      nutrientField.getNutrient(31, 31)
    ); // 80.0

    // 幼苗期步进 10 秒
    farmlandSys.step(10.0, nutrientField);

    const postTotal = (
      nutrientField.getNutrient(30, 30) +
      nutrientField.getNutrient(31, 30) +
      nutrientField.getNutrient(30, 31) +
      nutrientField.getNutrient(31, 31)
    );

    // 10 秒消耗 0.2 * 10 = 2.0 点养分
    expect(initialTotal - postTotal).toBeCloseTo(2.0, 4);
    // 4 个瓦片均匀扣除，各扣除 0.5 点
    expect(nutrientField.getNutrient(30, 30)).toBeCloseTo(19.5, 4);
  });

  it('内存用量断言：128 农田池常驻连续内存 <= 2KB', () => {
    const bytes = farmlandSys.calculateMemoryUsageBytes();
    expect(bytes).toBeLessThanOrEqual(2048);
  });
});
