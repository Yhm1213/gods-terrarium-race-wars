/**
 * MemoryFootprint.test.js
 * ECS 连续平铺内存底座、空间哈希与事件总线静态常驻 RAM 严格核算测试套件
 * 严格对应 TDS v1.1 规范与 QA 规范 Milestone 0 验收标准 (strictly <= 0.55MB / 560KB)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  MAX_ENTITIES,
  TOTAL_SLOTS,
  TRANSFORM_STRIDE,
  PHYSICS_STRIDE,
  HEALTH_STRIDE,
  COMBAT_STRIDE,
  PHYSIOLOGY_STRIDE,
  MORALE_STRIDE,
  IDENTITY_STRIDE
} from '../../src/core/ECS.js';
import { SpatialHash } from '../../src/core/SpatialHash.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';

describe('Core Static TypedArray Memory Footprint Specification Suite', () => {
  let ecs;
  let spatialHash;
  let eventBus;

  beforeEach(() => {
    ecs = new ECS();
    spatialHash = new SpatialHash();
    eventBus = new DomainEventBus();
  });

  describe('1. ECS 核心连续 SoA 内存池精细审计', () => {
    it('ECS 8 大核心连续组件 TypedArray 符合 TDS v1.1 严格规格，无虚标字段', () => {
      // 1. TransformComponent: Float32Array(4097 * 4) = 65,552 B
      expect(ecs.transforms.byteLength).toBe(TOTAL_SLOTS * TRANSFORM_STRIDE * 4);
      expect(ecs.transforms.byteLength).toBe(65552);

      // 2. PhysicsComponent: Float32Array(4097 * 4) = 65,552 B
      expect(ecs.physics.byteLength).toBe(TOTAL_SLOTS * PHYSICS_STRIDE * 4);
      expect(ecs.physics.byteLength).toBe(65552);

      // 3. HealthComponent: Float32Array(4097 * 4) = 65,552 B
      expect(ecs.health.byteLength).toBe(TOTAL_SLOTS * HEALTH_STRIDE * 4);
      expect(ecs.health.byteLength).toBe(65552);

      // 4. CombatStatsComponent: Float32Array(4097 * 4) = 65,552 B
      expect(ecs.combatStats.byteLength).toBe(TOTAL_SLOTS * COMBAT_STRIDE * 4);
      expect(ecs.combatStats.byteLength).toBe(65552);

      // 5. PhysiologyComponent: Float32Array(4097 * 4) = 65,552 B
      expect(ecs.physiology.byteLength).toBe(TOTAL_SLOTS * PHYSIOLOGY_STRIDE * 4);
      expect(ecs.physiology.byteLength).toBe(65552);

      // 6. MoraleComponent: Float32Array(4097 * 2) = 32,776 B
      expect(ecs.morale.byteLength).toBe(TOTAL_SLOTS * MORALE_STRIDE * 4);
      expect(ecs.morale.byteLength).toBe(32776);

      // 7. StatusFlags: Uint32Array(4097) = 16,388 B
      expect(ecs.statusFlags.byteLength).toBe(TOTAL_SLOTS * 4);
      expect(ecs.statusFlags.byteLength).toBe(16388);

      // 8. Identities: Uint32Array(4097 * 3) = 49,164 B
      expect(ecs.identities.byteLength).toBe(TOTAL_SLOTS * IDENTITY_STRIDE * 4);
      expect(ecs.identities.byteLength).toBe(49164);

      const componentTotalBytes =
        ecs.transforms.byteLength +
        ecs.physics.byteLength +
        ecs.health.byteLength +
        ecs.combatStats.byteLength +
        ecs.physiology.byteLength +
        ecs.morale.byteLength +
        ecs.statusFlags.byteLength +
        ecs.identities.byteLength;

      // 8 大组件连续内存精算严格为 426,088 字节 (~416 KB)
      expect(componentTotalBytes).toBe(426088);
    });

    it('稠密栈与稀疏集辅助数组保持紧凑规格，无额外对象分配', () => {
      expect(ecs.denseEntities.byteLength).toBe(TOTAL_SLOTS * 2); // 8,194 B
      expect(ecs.sparseIndices.byteLength).toBe(TOTAL_SLOTS * 2); // 8,194 B
      expect(ecs.freeStack.byteLength).toBe(TOTAL_SLOTS * 2);     // 8,194 B

      const ecsTotalBytes = ecs.calculateMemoryUsageBytes();
      // ECS 全量常驻内存严格为 450,670 字节 (~440.1 KB)
      expect(ecsTotalBytes).toBe(450670);
    });
  });

  describe('2. SpatialHash 连续平铺网格内存审计', () => {
    it('空间哈希网格彻底消灭单链表指针追逐，总常驻 RAM <= 15KB', () => {
      const countsBytes = spatialHash.cellCounts.byteLength;       // 504 * 2 = 1,008 B
      const offsetsBytes = spatialHash.cellOffsets.byteLength;     // 504 * 4 = 2,016 B
      const entityIdsBytes = spatialHash.compactEntityIds.byteLength; // 4097 * 2 = 8,194 B
      const currentOffsetsBytes = spatialHash._currentOffsets.byteLength; // 504 * 4 = 2,016 B

      expect(countsBytes).toBe(1008);
      expect(offsetsBytes).toBe(2016);
      expect(entityIdsBytes).toBe(8194);
      expect(currentOffsetsBytes).toBe(2016);

      const spatialBytes = spatialHash.calculateMemoryUsageBytes();
      expect(spatialBytes).toBe(13234);
      expect(spatialBytes).toBeLessThanOrEqual(15 * 1024); // 严格低于 15KB
    });
  });

  describe('3. DomainEventBus 环形双缓冲内存审计', () => {
    it('领域事件总线采用定长平铺连续内存，总常驻 RAM <= 95KB', () => {
      const busBytes = eventBus.calculateMemoryUsageBytes();
      // 80KB 主缓冲 (20,480 Int32) + 10KB 紧凑重入缓冲 (2,560 Int32) = 90KB
      expect(busBytes).toBe(92160);
      expect(busBytes).toBeLessThanOrEqual(95 * 1024);
    });
  });

  describe('4. 核心基础设施全量常驻 RAM 守门门禁断言 (Final Gate)', () => {
    it('ECS + SpatialHash + DomainEventBus 常驻连续内存严格 <= 0.55MB (约 560KB)', () => {
      const ecsBytes = ecs.calculateMemoryUsageBytes();
      const spatialBytes = spatialHash.calculateMemoryUsageBytes();
      const busBytes = eventBus.calculateMemoryUsageBytes();

      const totalResidentBytes = ecsBytes + spatialBytes + busBytes;
      const totalResidentKB = totalResidentBytes / 1024;
      const totalResidentMB = totalResidentBytes / (1024 * 1024);

      // 精确数值核对: 556,064 字节 (~543.03 KB, ~0.5303 MB)
      expect(totalResidentBytes).toBe(556064);

      // 核心质量守门门禁断言:
      // 1. strictly <= 560KB (573,440 字节)
      expect(totalResidentKB).toBeLessThanOrEqual(560);
      // 2. strictly <= 0.55MB (576,716 字节)
      expect(totalResidentMB).toBeLessThanOrEqual(0.55);
    });

    it('连续执行高频写操作后底层连续内存 byteLength 恒定不变，绝对零动态扩容与零 GC 漂移', () => {
      const initialTotalBytes =
        ecs.calculateMemoryUsageBytes() +
        spatialHash.calculateMemoryUsageBytes() +
        eventBus.calculateMemoryUsageBytes();

      // 模拟高频运行 500 次
      for (let i = 0; i < 500; i++) {
        const eid = ecs.allocateEntity();
        if (eid > 0) {
          ecs.transforms[eid * TRANSFORM_STRIDE + 0] = i * 2.5;
          ecs.transforms[eid * TRANSFORM_STRIDE + 1] = i * 1.5;
        }
        eventBus.emit(0x0001, eid, 0, 10, 0);
      }

      spatialHash.rebuild(
        ecs.transforms,
        ecs.statusFlags,
        ecs.denseEntities,
        ecs.activeCount
      );
      eventBus.flush();

      const finalTotalBytes =
        ecs.calculateMemoryUsageBytes() +
        spatialHash.calculateMemoryUsageBytes() +
        eventBus.calculateMemoryUsageBytes();

      // 内存恒定相等，绝对无扩容
      expect(finalTotalBytes).toBe(initialTotalBytes);
    });
  });
});
