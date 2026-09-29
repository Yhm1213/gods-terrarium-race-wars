import { describe, it, expect, beforeEach } from 'vitest';
import { NutrientField, DIFFUSION_ALPHA } from '../../src/ecosystem/NutrientField.js';
import { TileGrid, TOTAL_TILES } from '../../src/world/TileGrid.js';
import { Biomes } from '../../src/data/BiomeData.js';

describe('NutrientField (WP-2.2.1 二维拉普拉斯连续地脉养分扩散场与绝热反射)', () => {
  let tileGrid;
  let field;

  beforeEach(() => {
    tileGrid = new TileGrid();
    field = new NutrientField(tileGrid, 0.05);
  });

  it('能量守恒断言：封闭系统（S=0, D=0）连续 1000 步扩散，全图养分总和浮点误差 < 10^-4', () => {
    // 初始化非均匀养分分布
    field.reset(0.0);
    // 在中心几个点注入养分
    field.setNutrient(20, 15, 500.0);
    field.setNutrient(25, 18, 350.0);
    field.setNutrient(30, 20, 150.0);

    const initialTotal = field.getTotalNutrient();
    expect(initialTotal).toBeCloseTo(1000.0, 4);

    // 连续运行 1000 步扩散 (封闭系统: 无源项、无汇项、不截断底温)
    for (let step = 0; step < 1000; step++) {
      field.step(1.0, null, null, false);
    }

    const finalTotal = field.getTotalNutrient();
    const absDiff = Math.abs(finalTotal - initialTotal);
    expect(absDiff).toBeLessThan(1e-4);
  });

  it('绝热断言：贴近边界 (0, 15) 注入 100 养分，向地图外侧逸散通量恒等于 0，封闭系统绝对守恒', () => {
    field.reset(0.0);
    field.setNutrient(0, 15, 100.0);

    const initialTotal = field.getTotalNutrient();
    expect(initialTotal).toBeCloseTo(100.0, 4);

    // 运行 200 步
    for (let i = 0; i < 200; i++) {
      field.step(1.0, null, null, false);
    }

    // 养分应向内陆平滑扩散，但全图总养分依然完全守恒
    expect(field.getNutrient(0, 15)).toBeLessThan(100.0); // 已向内扩散
    expect(field.getNutrient(1, 15)).toBeGreaterThan(0.0);  // 邻居获得养分
    expect(field.getTotalNutrient()).toBeCloseTo(100.0, 4);
  });

  it('四角与四边绝热断言：在四个角落注入养分，能量完全封闭守恒', () => {
    field.reset(0.0);
    field.setNutrient(0, 0, 50.0);
    field.setNutrient(55, 0, 50.0);
    field.setNutrient(0, 35, 50.0);
    field.setNutrient(55, 35, 50.0);

    const initialTotal = field.getTotalNutrient();
    expect(initialTotal).toBeCloseTo(200.0, 4);

    for (let i = 0; i < 500; i++) {
      field.step(1.0, null, null, false);
    }

    expect(field.getTotalNutrient()).toBeCloseTo(200.0, 4);
  });

  it('群系底温保底断言：施加底温保底时，养分不会低于 Biome nutrientFloor', () => {
    // 设置 (10, 10) 为神圣泉眼 (nutrientFloor = 0.85)
    tileGrid.setTile(10, 10, Biomes.HOLY_SPRING.id);
    field.syncBaseHeatFromGrid();

    // 初始清零
    field.reset(0.0);
    expect(field.getNutrient(10, 10)).toBe(0.0);

    // 验证 floors 属性与底温量纲乘以 50.0 契约
    const idx = tileGrid.getIndex(10, 10);
    expect(field.floors[idx]).toBeCloseTo(0.85 * 50.0, 4);

    // 步进并开启 applyBaseHeat
    field.step(1.0, null, null, true);

    // 神圣泉眼瓦片被自动拉回保底 0.85 * 50.0 = 42.5
    expect(field.getNutrient(10, 10)).toBeGreaterThanOrEqual(0.85 * 50.0);
  });

  it('内存用量断言：双缓冲 Float32Array 占驻内存 <= 25KB', () => {
    const bytes = field.calculateMemoryUsageBytes();
    // 2016 * 4 * 3 = 24192 字节 (~23.6KB)
    expect(bytes).toBeLessThanOrEqual(25 * 1024);
  });
});
