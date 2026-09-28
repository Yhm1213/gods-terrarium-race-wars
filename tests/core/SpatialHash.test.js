/**
 * SpatialHash.test.js
 * 48px 平铺连续内存空间哈希网格与零分配空间检索单元测试套件
 * 严格对应 TDS v1.1 第 4.1 节与 QA 规范 Milestone 0 验收标准
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  SpatialHash,
  DEFAULT_MAP_WIDTH,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_CELL_SIZE
} from '../../src/core/SpatialHash.js';
import { SpatialQuery } from '../../src/core/SpatialQuery.js';
import {
  ECS,
  MAX_ENTITIES,
  TOTAL_SLOTS,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y
} from '../../src/core/ECS.js';
import { StatusFlags } from '../../src/components/UnitStatusFlags.js';

describe('SpatialHash & SpatialQuery Specification Suite', () => {
  let spatialHash;
  let ecs;

  beforeEach(() => {
    spatialHash = new SpatialHash(DEFAULT_MAP_WIDTH, DEFAULT_MAP_HEIGHT, DEFAULT_CELL_SIZE);
    ecs = new ECS();
  });

  describe('1. 连续平铺网格规格与初始化', () => {
    it('正确计算 48px 网格尺寸为 28 列 x 18 行共 504 桶', () => {
      expect(spatialHash.cols).toBe(28); // 1344 / 48 = 28
      expect(spatialHash.rows).toBe(18); // 864 / 48 = 18
      const totalCells = spatialHash.totalCells || (spatialHash.cols * spatialHash.rows);
      expect(totalCells).toBe(504);
      expect(spatialHash.cellCounts.length).toBe(504);
      expect(spatialHash.cellOffsets.length).toBe(504);
      expect(spatialHash.compactEntityIds.length).toBeGreaterThanOrEqual(MAX_ENTITIES);
    });
  });

  describe('2. 网格重构 (rebuild) 机制与多桶分布', () => {
    it('实体准确映射至所属单元格桶，且非存活实体被自动忽略', () => {
      const e1 = ecs.allocateEntity(); // col 0, row 0 -> bucket 0
      ecs.transforms[e1 * TRANSFORM_STRIDE + TF_OFFSET_X] = 20.0;
      ecs.transforms[e1 * TRANSFORM_STRIDE + TF_OFFSET_Y] = 20.0;

      const e2 = ecs.allocateEntity(); // col 1, row 0 -> bucket 1
      ecs.transforms[e2 * TRANSFORM_STRIDE + TF_OFFSET_X] = 50.0;
      ecs.transforms[e2 * TRANSFORM_STRIDE + TF_OFFSET_Y] = 20.0;

      const e3 = ecs.allocateEntity(); // col 0, row 1 -> bucket 28
      ecs.transforms[e3 * TRANSFORM_STRIDE + TF_OFFSET_X] = 20.0;
      ecs.transforms[e3 * TRANSFORM_STRIDE + TF_OFFSET_Y] = 60.0;

      const deadEntity = ecs.allocateEntity();
      ecs.transforms[deadEntity * TRANSFORM_STRIDE + TF_OFFSET_X] = 20.0;
      ecs.transforms[deadEntity * TRANSFORM_STRIDE + TF_OFFSET_Y] = 20.0;
      ecs.freeEntity(deadEntity); // 标记死亡

      spatialHash.rebuild(
        ecs.transforms,
        ecs.statusFlags,
        ecs.denseEntities,
        ecs.activeCount
      );

      expect(spatialHash.cellCounts[0]).toBe(1);
      expect(spatialHash.cellCounts[1]).toBe(1);
      expect(spatialHash.cellCounts[28]).toBe(1);

      // 验证 compactEntityIds 中的存储
      const bucket0Offset = spatialHash.cellOffsets[0];
      expect(spatialHash.compactEntityIds[bucket0Offset]).toBe(e1);

      const bucket1Offset = spatialHash.cellOffsets[1];
      expect(spatialHash.compactEntityIds[bucket1Offset]).toBe(e2);

      const bucket28Offset = spatialHash.cellOffsets[28];
      expect(spatialHash.compactEntityIds[bucket28Offset]).toBe(e3);
    });
  });

  describe('3. 性能基准测试：4096 活跃实体重构耗时 strictly < 0.2ms', () => {
    it('注入 4096 个活跃实体随机坐标，rebuild 耗时严格低于 0.2ms (200 微秒)', () => {
      // 1. 全量分配 4096 个实体
      for (let i = 0; i < MAX_ENTITIES; i++) {
        const id = ecs.allocateEntity();
        // 随机散布在地图范围内
        const x = (Math.sin(i * 1.7) * 0.5 + 0.5) * DEFAULT_MAP_WIDTH;
        const y = (Math.cos(i * 2.3) * 0.5 + 0.5) * DEFAULT_MAP_HEIGHT;
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_X] = x;
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_Y] = y;
      }
      expect(ecs.activeCount).toBe(MAX_ENTITIES);

      // 2. 预热 JIT (Warm up 30 轮)
      for (let w = 0; w < 30; w++) {
        spatialHash.rebuild(
          ecs.transforms,
          ecs.statusFlags,
          ecs.denseEntities,
          ecs.activeCount
        );
      }

      // 3. 统计 50 轮基准耗时
      const benchmarkRuns = 50;
      const start = performance.now();
      for (let r = 0; r < benchmarkRuns; r++) {
        spatialHash.rebuild(
          ecs.transforms,
          ecs.statusFlags,
          ecs.denseEntities,
          ecs.activeCount
        );
      }
      const totalMs = performance.now() - start;
      const avgMs = totalMs / benchmarkRuns;

      // 客观守门断言: 耗时 strictly < 0.2ms
      expect(avgMs).toBeLessThan(0.2);
    });
  });

  describe('4. queryRadius 检索准确性与 maxCapacity 硬截断防溢出', () => {
    it('精准检索半径内实体，排除半径外实体', () => {
      const center = { x: 500, y: 400 };
      const radius = 60;

      // 放置 3 个在半径内的实体
      const in1 = ecs.allocateEntity();
      ecs.transforms[in1 * TRANSFORM_STRIDE + TF_OFFSET_X] = center.x + 10;
      ecs.transforms[in1 * TRANSFORM_STRIDE + TF_OFFSET_Y] = center.y + 10;

      const in2 = ecs.allocateEntity();
      ecs.transforms[in2 * TRANSFORM_STRIDE + TF_OFFSET_X] = center.x - 30;
      ecs.transforms[in2 * TRANSFORM_STRIDE + TF_OFFSET_Y] = center.y;

      const in3 = ecs.allocateEntity();
      ecs.transforms[in3 * TRANSFORM_STRIDE + TF_OFFSET_X] = center.x;
      ecs.transforms[in3 * TRANSFORM_STRIDE + TF_OFFSET_Y] = center.y + 40;

      // 放置 2 个在半径外的实体 (但在同个或邻近单元格)
      const out1 = ecs.allocateEntity();
      ecs.transforms[out1 * TRANSFORM_STRIDE + TF_OFFSET_X] = center.x + 80;
      ecs.transforms[out1 * TRANSFORM_STRIDE + TF_OFFSET_Y] = center.y;

      const out2 = ecs.allocateEntity();
      ecs.transforms[out2 * TRANSFORM_STRIDE + TF_OFFSET_X] = center.x;
      ecs.transforms[out2 * TRANSFORM_STRIDE + TF_OFFSET_Y] = center.y + 120;

      spatialHash.rebuild(
        ecs.transforms,
        ecs.statusFlags,
        ecs.denseEntities,
        ecs.activeCount
      );

      const outResults = new Int32Array(512);
      const count = SpatialQuery.queryRadius(
        spatialHash,
        center.x,
        center.y,
        radius,
        outResults,
        512
      );

      expect(count).toBe(3);
      const found = new Set();
      for (let i = 0; i < count; i++) {
        found.add(outResults[i]);
      }
      expect(found.has(in1)).toBe(true);
      expect(found.has(in2)).toBe(true);
      expect(found.has(in3)).toBe(true);
      expect(found.has(out1)).toBe(false);
      expect(found.has(out2)).toBe(false);
    });

    it('当检索结果超出 maxCapacity 时实施刚性截断防溢出', () => {
      const center = { x: 300, y: 300 };
      // 密集注入 600 个同位置实体
      for (let i = 0; i < 600; i++) {
        const id = ecs.allocateEntity();
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_X] = center.x;
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_Y] = center.y;
      }

      spatialHash.rebuild(
        ecs.transforms,
        ecs.statusFlags,
        ecs.denseEntities,
        ecs.activeCount
      );

      const outResults = new Int32Array(512);
      const writtenCount = SpatialQuery.queryRadius(
        spatialHash,
        center.x,
        center.y,
        50,
        outResults,
        512 // 最大容量硬门限
      );

      // 绝不溢出 512
      expect(writtenCount).toBe(512);

      // 测试小容量自定义截断
      const smallResults = new Int32Array(16);
      const smallCount = SpatialQuery.queryRadius(
        spatialHash,
        center.x,
        center.y,
        50,
        smallResults,
        16
      );
      expect(smallCount).toBe(16);
    });
  });

  describe('5. queryRect 视锥矩形检索准确性与截断', () => {
    it('精准检索矩形包围盒内实体', () => {
      const minX = 200, minY = 200, maxX = 400, maxY = 350;

      const inside = ecs.allocateEntity();
      ecs.transforms[inside * TRANSFORM_STRIDE + TF_OFFSET_X] = 250;
      ecs.transforms[inside * TRANSFORM_STRIDE + TF_OFFSET_Y] = 250;

      const outside = ecs.allocateEntity();
      ecs.transforms[outside * TRANSFORM_STRIDE + TF_OFFSET_X] = 450;
      ecs.transforms[outside * TRANSFORM_STRIDE + TF_OFFSET_Y] = 250;

      spatialHash.rebuild(
        ecs.transforms,
        ecs.statusFlags,
        ecs.denseEntities,
        ecs.activeCount
      );

      const outResults = new Int32Array(512);
      const count = SpatialQuery.queryRect(
        spatialHash,
        minX,
        minY,
        maxX,
        maxY,
        outResults,
        512
      );

      expect(count).toBe(1);
      expect(outResults[0]).toBe(inside);
    });
  });

  describe('6. 极端超界坐标 Clamp 阻尼与防崩溃断言', () => {
    it('向实体注入 [-99999, 99999] 极端坐标，rebuild 与检索绝不抛出越界异常', () => {
      const eNegative = ecs.allocateEntity();
      ecs.transforms[eNegative * TRANSFORM_STRIDE + TF_OFFSET_X] = -99999.0;
      ecs.transforms[eNegative * TRANSFORM_STRIDE + TF_OFFSET_Y] = -88888.0;

      const ePositive = ecs.allocateEntity();
      ecs.transforms[ePositive * TRANSFORM_STRIDE + TF_OFFSET_X] = 99999.0;
      ecs.transforms[ePositive * TRANSFORM_STRIDE + TF_OFFSET_Y] = 88888.0;

      const eMixed = ecs.allocateEntity();
      ecs.transforms[eMixed * TRANSFORM_STRIDE + TF_OFFSET_X] = -50000.0;
      ecs.transforms[eMixed * TRANSFORM_STRIDE + TF_OFFSET_Y] = 50000.0;

      expect(() => {
        spatialHash.rebuild(
          ecs.transforms,
          ecs.statusFlags,
          ecs.denseEntities,
          ecs.activeCount
        );
      }).not.toThrow();

      // 执行超界范围查询，验证不抛异常
      const outResults = new Int32Array(512);
      expect(() => {
        SpatialQuery.queryRadius(
          spatialHash,
          -99999,
          -99999,
          100,
          outResults,
          512
        );
      }).not.toThrow();

      expect(() => {
        SpatialQuery.queryRect(
          spatialHash,
          -99999,
          -99999,
          99999,
          99999,
          outResults,
          512
        );
      }).not.toThrow();
    });
  });
});
