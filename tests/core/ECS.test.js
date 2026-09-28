/**
 * ECS.test.js
 * ECS 实体管理器与连续内存池单元测试套件
 * 严格对应 TDS v1.1 第三章与 QA 规范 Milestone 0 验收标准
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  MAX_ENTITIES,
  TOTAL_SLOTS,
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  TF_OFFSET_SCALE,
  PHYSICS_STRIDE,
  PHY_OFFSET_MASS,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../../src/core/ECS.js';
import { StatusFlags } from '../../src/components/UnitStatusFlags.js';

describe('ECS Core Architecture & Memory Pool Suite', () => {
  let ecs;

  beforeEach(() => {
    ecs = new ECS();
  });

  describe('1. 实体生命周期分配与释放 (allocateEntity & freeEntity)', () => {
    it('能够成功分配单个实体并初始化默认状态', () => {
      const eid = ecs.allocateEntity();
      expect(eid).toBeGreaterThanOrEqual(1);
      expect(eid).toBeLessThanOrEqual(MAX_ENTITIES);
      expect(ecs.activeCount).toBe(1);
      expect(ecs.isAlive(eid)).toBe(true);
      expect(ecs.denseEntities[0]).toBe(eid);
      expect(ecs.sparseIndices[eid]).toBe(0);
      // 默认缩放比应为 1.0
      expect(ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_SCALE]).toBe(1.0);
    });

    it('能够从 1 连续分配至 4096，所有 ID 互不重复且在有效闭区间内', () => {
      const allocatedIds = new Set();
      for (let i = 0; i < MAX_ENTITIES; i++) {
        const eid = ecs.allocateEntity();
        expect(eid).toBeGreaterThanOrEqual(1);
        expect(eid).toBeLessThanOrEqual(MAX_ENTITIES);
        allocatedIds.add(eid);
      }
      expect(ecs.activeCount).toBe(MAX_ENTITIES);
      expect(allocatedIds.size).toBe(MAX_ENTITIES);
    });

    it('释放实体后能够正确注销存活状态并更新活跃计数', () => {
      const eid = ecs.allocateEntity();
      expect(ecs.isAlive(eid)).toBe(true);

      const freed = ecs.freeEntity(eid);
      expect(freed).toBe(true);
      expect(ecs.isAlive(eid)).toBe(false);
      expect(ecs.activeCount).toBe(0);
      expect((ecs.statusFlags[eid] & StatusFlags.IS_ALIVE) >>> 0).toBe(0);
    });

    it('释放实体后再次分配能够复用被释放的 ID', () => {
      const eid1 = ecs.allocateEntity();
      const eid2 = ecs.allocateEntity();
      expect(ecs.activeCount).toBe(2);

      ecs.freeEntity(eid1);
      expect(ecs.activeCount).toBe(1);

      const reusedId = ecs.allocateEntity();
      expect(reusedId).toBe(eid1);
      expect(ecs.activeCount).toBe(2);
      expect(ecs.isAlive(reusedId)).toBe(true);
    });

    it('全量分配 4096 个实体后全量释放，状态完全归零并能再次循环全量分配', () => {
      const ids = [];
      for (let i = 0; i < MAX_ENTITIES; i++) {
        ids.push(ecs.allocateEntity());
      }
      expect(ecs.activeCount).toBe(MAX_ENTITIES);

      for (let i = 0; i < MAX_ENTITIES; i++) {
        const freed = ecs.freeEntity(ids[i]);
        expect(freed).toBe(true);
      }
      expect(ecs.activeCount).toBe(0);

      // 第二轮全量分配验证
      for (let i = 0; i < MAX_ENTITIES; i++) {
        const eid = ecs.allocateEntity();
        expect(eid).toBeGreaterThanOrEqual(1);
        expect(eid).toBeLessThanOrEqual(MAX_ENTITIES);
      }
      expect(ecs.activeCount).toBe(MAX_ENTITIES);
    });
  });

  describe('2. 稠密栈 Swap-and-Pop 机制与连续性断言', () => {
    it('活跃实体数组 denseEntities 在分配时保持连续填充', () => {
      const e1 = ecs.allocateEntity();
      const e2 = ecs.allocateEntity();
      const e3 = ecs.allocateEntity();

      expect(ecs.denseEntities[0]).toBe(e1);
      expect(ecs.denseEntities[1]).toBe(e2);
      expect(ecs.denseEntities[2]).toBe(e3);
      expect(ecs.activeCount).toBe(3);
    });

    it('删除中间实体时，尾部实体置换到被删除实体的槽位，维持数组无缝连续', () => {
      const e1 = ecs.allocateEntity();
      const e2 = ecs.allocateEntity();
      const e3 = ecs.allocateEntity();
      const e4 = ecs.allocateEntity();

      // 当前稠密栈: [e1, e2, e3, e4], 长度 4
      expect(ecs.denseEntities[0]).toBe(e1);
      expect(ecs.denseEntities[1]).toBe(e2);
      expect(ecs.denseEntities[2]).toBe(e3);
      expect(ecs.denseEntities[3]).toBe(e4);

      // 删除中间实体 e2 (索引 1)
      const freed = ecs.freeEntity(e2);
      expect(freed).toBe(true);

      // 尾部 e4 应该置换到索引 1 的位置，稠密栈变为 [e1, e4, e3]，有效长度 3
      expect(ecs.activeCount).toBe(3);
      expect(ecs.denseEntities[0]).toBe(e1);
      expect(ecs.denseEntities[1]).toBe(e4);
      expect(ecs.denseEntities[2]).toBe(e3);
      expect(ecs.denseEntities[3]).toBe(0); // 原尾部清理

      // sparseIndices 索引映射必须同步更新
      expect(ecs.sparseIndices[e1]).toBe(0);
      expect(ecs.sparseIndices[e4]).toBe(1);
      expect(ecs.sparseIndices[e3]).toBe(2);
      expect(ecs.sparseIndices[e2]).toBe(0); // 被释放者索引重置
    });

    it('删除头部实体时，尾部置换至索引 0', () => {
      const e1 = ecs.allocateEntity();
      const e2 = ecs.allocateEntity();
      const e3 = ecs.allocateEntity();

      ecs.freeEntity(e1);

      expect(ecs.activeCount).toBe(2);
      expect(ecs.denseEntities[0]).toBe(e3);
      expect(ecs.denseEntities[1]).toBe(e2);
      expect(ecs.sparseIndices[e3]).toBe(0);
      expect(ecs.sparseIndices[e2]).toBe(1);
    });

    it('删除尾部实体时直接出栈，无需置换', () => {
      const e1 = ecs.allocateEntity();
      const e2 = ecs.allocateEntity();

      ecs.freeEntity(e2);

      expect(ecs.activeCount).toBe(1);
      expect(ecs.denseEntities[0]).toBe(e1);
      expect(ecs.denseEntities[1]).toBe(0);
      expect(ecs.sparseIndices[e1]).toBe(0);
    });
  });

  describe('3. 0 号墓碑隔离机制 (Tombstone Isolation)', () => {
    it('EntityID = 0 (NULL_ENTITY) 始终视为非存活状态', () => {
      expect(ecs.isAlive(NULL_ENTITY)).toBe(false);
      expect(ecs.isAlive(0)).toBe(false);
      expect(ecs.statusFlags[0]).toBe(0);
    });

    it('向 EntityID = 0 读写组件数据不会越界崩溃，且不会污染有效实体', () => {
      const e1 = ecs.allocateEntity();
      ecs.transforms[e1 * TRANSFORM_STRIDE + TF_OFFSET_X] = 123.45;
      ecs.health[e1 * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 100.0;

      // 针对 0 号墓碑读写
      ecs.transforms[0 * TRANSFORM_STRIDE + TF_OFFSET_X] = 99999.0;
      ecs.transforms[0 * TRANSFORM_STRIDE + TF_OFFSET_Y] = -88888.0;
      ecs.health[0 * HEALTH_STRIDE + HP_OFFSET_CURRENT] = -50.0;

      // 断言有效实体不受任何干扰
      expect(ecs.transforms[e1 * TRANSFORM_STRIDE + TF_OFFSET_X]).toBeCloseTo(123.45);
      expect(ecs.health[e1 * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBeCloseTo(100.0);
      expect(ecs.isAlive(0)).toBe(false);
    });

    it('尝试 freeEntity(0) 被静默安全拦截，不减少 activeCount 且返回 false', () => {
      const e1 = ecs.allocateEntity();
      expect(ecs.activeCount).toBe(1);

      const result = ecs.freeEntity(0);
      expect(result).toBe(false);
      expect(ecs.activeCount).toBe(1);
      expect(ecs.isAlive(e1)).toBe(true);
    });

    it('稠密栈中绝不包含 0 号墓碑实体', () => {
      for (let i = 0; i < 50; i++) {
        ecs.allocateEntity();
      }
      for (let i = 0; i < ecs.activeCount; i++) {
        expect(ecs.denseEntities[i]).not.toBe(0);
        expect(ecs.denseEntities[i]).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('4. 分配超额越界保护与异常防御', () => {
    it('当 4096 实体耗尽时，再次分配返回受控值 0 (NULL_ENTITY)，不越界崩溃', () => {
      for (let i = 0; i < MAX_ENTITIES; i++) {
        const id = ecs.allocateEntity();
        expect(id).toBeGreaterThan(0);
      }
      expect(ecs.activeCount).toBe(MAX_ENTITIES);

      // 第 4097 次分配应被刚性拦截
      const overflowId = ecs.allocateEntity();
      expect(overflowId).toBe(NULL_ENTITY);
      expect(ecs.activeCount).toBe(MAX_ENTITIES);
    });

    it('连续释放同个实体 (Double-Free 防御) 触发防御拦截并返回 false', () => {
      const eid = ecs.allocateEntity();
      expect(ecs.freeEntity(eid)).toBe(true);
      expect(ecs.freeEntity(eid)).toBe(false); // 重复释放
      expect(ecs.activeCount).toBe(0);
    });

    it('释放超出范围的非法 ID (负数/超界数) 被安全拦截并返回 false', () => {
      expect(ecs.freeEntity(-1)).toBe(false);
      expect(ecs.freeEntity(MAX_ENTITIES + 1)).toBe(false);
      expect(ecs.freeEntity(99999)).toBe(false);
    });

    it('释放未被分配的实体被安全拦截', () => {
      expect(ecs.freeEntity(100)).toBe(false);
    });
  });

  describe('5. 组件数据清除与 reset 重置', () => {
    it('释放实体时其所属组件连续数据被清零重置', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 50.0;
      ecs.physics[eid * PHYSICS_STRIDE + PHY_OFFSET_MASS] = 240.0;
      ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 80.0;
      ecs.combatStats[eid * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 15.0;
      ecs.physiology[eid * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 30.0;
      ecs.morale[eid * MORALE_STRIDE + MORALE_OFFSET_VAL] = 100.0;
      ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 2;

      ecs.freeEntity(eid);

      // 断言内存切片全部被安全抹零
      expect(ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X]).toBe(0);
      expect(ecs.physics[eid * PHYSICS_STRIDE + PHY_OFFSET_MASS]).toBe(0);
      expect(ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBe(0);
      expect(ecs.combatStats[eid * COMBAT_STRIDE + CS_OFFSET_ARMOR]).toBe(0);
      expect(ecs.physiology[eid * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER]).toBe(0);
      expect(ecs.morale[eid * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBe(0);
      expect(ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION]).toBe(0);
    });

    it('reset 调用后完整恢复至初始零状态', () => {
      for (let i = 0; i < 100; i++) {
        ecs.allocateEntity();
      }
      expect(ecs.activeCount).toBe(100);

      ecs.reset();
      expect(ecs.activeCount).toBe(0);
      expect(ecs.isAlive(1)).toBe(false);
      expect(ecs.denseEntities[0]).toBe(0);
      expect(ecs.isAlive(NULL_ENTITY)).toBe(false);
    });
  });
});
