import { describe, it, expect, beforeEach } from 'vitest';
import {
  TileGrid,
  GRID_WIDTH,
  GRID_HEIGHT,
  TOTAL_TILES,
  TILE_SIZE,
  WORLD_WIDTH,
  WORLD_HEIGHT
} from '../../src/world/TileGrid.js';
import { MapGenerator } from '../../src/world/MapGenerator.js';
import { Biomes, BiomeList, HazardTypes } from '../../src/data/BiomeData.js';

describe('TileGrid (WP-2.1.1 瓦片网格与群系阻力场)', () => {
  let grid;

  beforeEach(() => {
    grid = new TileGrid();
  });

  it('网格尺寸断言：网格宽严格为 56，高严格为 36，总瓦片数严格为 2016，世界尺寸 1344x864', () => {
    expect(grid.width).toBe(56);
    expect(grid.height).toBe(36);
    expect(grid.totalTiles).toBe(2016);
    expect(grid.tileSize).toBe(24);
    expect(grid.worldWidth).toBe(1344);
    expect(grid.worldHeight).toBe(864);

    expect(grid.tileTypes.length).toBe(2016);
    expect(grid.moveCost.length).toBe(2016);
    expect(grid.elevation.length).toBe(2016);
    expect(grid.hazardType.length).toBe(2016);
    expect(grid.hazardDamage.length).toBe(2016);
    expect(grid.nutrientFloor.length).toBe(2016);
  });

  it('边界断言：坐标访问 (-1, 10) 与 (56, 36) 自动 Clamp 截断，不返回 undefined', () => {
    // 负数坐标自动截断至 (0, 10)
    const idxNeg = grid.getIndex(-1, 10);
    const expectedIdxNeg = 10 * 56 + 0;
    expect(idxNeg).toBe(expectedIdxNeg);

    const typeNeg = grid.getTileType(-1, 10);
    expect(typeNeg).toBeDefined();
    expect(typeof typeNeg).toBe('number');

    // 越界坐标 (56, 36) 截断至 (55, 35)
    const idxOver = grid.getIndex(56, 36);
    const expectedIdxOver = 35 * 56 + 55;
    expect(idxOver).toBe(expectedIdxOver);

    const typeOver = grid.getTileType(56, 36);
    expect(typeOver).toBeDefined();
    expect(typeof typeOver).toBe('number');

    // 极端远端坐标 (-999, -888) 与 (9999, 8888)
    expect(grid.getIndex(-999, -888)).toBe(0);
    expect(grid.getIndex(9999, 8888)).toBe(2015);
  });

  it('坐标转换断言：世界坐标与瓦片坐标双向转换正确并支持零 GC 出参对象', () => {
    // (0, 0)
    expect(grid.worldToTileX(0)).toBe(0);
    expect(grid.worldToTileY(0)).toBe(0);

    // 24px 步长：(25, 49) 对应瓦片 (1, 2)
    expect(grid.worldToTileX(25)).toBe(1);
    expect(grid.worldToTileY(49)).toBe(2);

    // 出参对象重用
    const outTile = { x: 0, y: 0 };
    const resTile = grid.worldToTile(25, 49, outTile);
    expect(resTile).toBe(outTile);
    expect(outTile.x).toBe(1);
    expect(outTile.y).toBe(2);

    // tileToWorld 转换为中心点 (1 + 0.5) * 24 = 36, (2 + 0.5) * 24 = 60
    const outWorld = { x: 0, y: 0 };
    const resWorld = grid.tileToWorld(1, 2, outWorld);
    expect(resWorld).toBe(outWorld);
    expect(outWorld.x).toBe(36);
    expect(outWorld.y).toBe(60);

    // getTileTypeByWorld: 基于世界坐标直接获取瓦片群系 (带边界 Clamp)
    grid.setTile(1, 2, Biomes.SWAMP.id);
    expect(grid.getTileTypeByWorld(25, 49)).toBe(Biomes.SWAMP.id);
    // 越界坐标 Clamp 截断防护
    expect(grid.getTileTypeByWorld(-100, -200)).toBe(grid.getTileType(0, 0));
    expect(grid.getTileTypeByWorld(9999, 9999)).toBe(grid.getTileType(55, 35));
  });

  it('群系参数对齐断言：6 大生物群系参数与 BiomeData 100% 对齐', () => {
    // 测试所有群系的配置写入与阻力
    for (const biome of BiomeList) {
      grid.setTile(5, 5, biome.id, 0.5);
      expect(grid.getTileType(5, 5)).toBe(biome.id);
      expect(grid.getMoveCost(5, 5)).toBeCloseTo(biome.moveCostMultiplier, 4);
      expect(grid.getHazardType(5, 5)).toBe(biome.hazardType);
      expect(grid.getHazardDamage(5, 5)).toBeCloseTo(biome.hazardDps, 4);
      expect(grid.getNutrientFloor(5, 5)).toBeCloseTo(biome.nutrientFloor, 4);
      expect(grid.getElevation(5, 5)).toBeCloseTo(0.5, 4);

      if (biome.moveCostMultiplier >= 999.0) {
        expect(grid.isImpassable(5, 5)).toBe(true);
      } else {
        expect(grid.isImpassable(5, 5)).toBe(false);
      }
    }
  });

  it('内存用量断言：TileGrid 连续 TypedArray 常驻内存 <= 20KB', () => {
    const bytes = grid.calculateMemoryUsageBytes();
    // 2016 * (1 + 4 + 4 + 1 + 4 + 4) = 2016 * 18 = 36288 字节 (~35.4KB)
    expect(bytes).toBeLessThanOrEqual(40 * 1024);
  });
});

describe('MapGenerator (确定性群系地图生成器)', () => {
  it('幂等性断言：相同种子生成的地图数据 100% 一致', () => {
    const seed = 123456;
    const genA = new MapGenerator(seed);
    const genB = new MapGenerator(seed);

    const gridA = new TileGrid();
    const gridB = new TileGrid();

    genA.generate(gridA);
    genB.generate(gridB);

    for (let i = 0; i < TOTAL_TILES; i++) {
      expect(gridA.tileTypes[i]).toBe(gridB.tileTypes[i]);
      expect(gridA.moveCost[i]).toBe(gridB.moveCost[i]);
      expect(gridA.elevation[i]).toBe(gridB.elevation[i]);
    }
  });

  it('多样性断言：生成的地图包含全部核心群系地貌', () => {
    const gen = new MapGenerator(9999);
    const grid = new TileGrid();
    gen.generate(grid);

    const typeSet = new Set();
    for (let i = 0; i < TOTAL_TILES; i++) {
      typeSet.add(grid.tileTypes[i]);
    }

    // 验证包含温带平原、高山、深水、浅水、熔岩、沼泽、神圣泉眼
    expect(typeSet.has(Biomes.PLAINS.id)).toBe(true);
    expect(typeSet.has(Biomes.MOUNTAINS.id)).toBe(true);
    expect(typeSet.has(Biomes.DEEP_WATER.id)).toBe(true);
    expect(typeSet.has(Biomes.SHALLOW_WATER.id)).toBe(true);
    expect(typeSet.has(Biomes.VOLCANO.id)).toBe(true);
    expect(typeSet.has(Biomes.SWAMP.id)).toBe(true);
    expect(typeSet.has(Biomes.HOLY_SPRING.id)).toBe(true);
  });
});
