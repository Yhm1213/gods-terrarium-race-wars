/**
 * HandOfGodSystem.test.js
 * 上帝之手六大物理安全边界与天命悬空防死锁测试套件 (WP-4.1)
 * 验证 SPEC-M4-CONTRACT §1.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  PHYSICS_STRIDE,
  PHY_OFFSET_MASS,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX
} from '../../src/core/ECS.js';
import {
  IS_HELD,
  IS_STATIC_ANCHOR,
  IS_SACRED_BODY,
  IS_LEADER,
  IS_CASTING,
  IS_IMMOBILIZED,
  hasStatus,
  setStatus
} from '../../src/components/UnitStatusFlags.js';
import { TileGrid, GRID_WIDTH, TILE_SIZE, WORLD_WIDTH, WORLD_HEIGHT } from '../../src/world/TileGrid.js';
import { Biomes } from '../../src/data/BiomeData.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { createFactionRuntimeBuffer, FAC_OFFSET_TOTEM_ID, FACTION_STRIDE } from '../../src/data/FactionData.js';
import {
  HandOfGodSystem,
  BOUNDARY_MARGIN,
  MAX_HELD_DURATION_SECONDS
} from '../../src/god/HandOfGodSystem.js';

describe('HandOfGodSystem Specification Suite (WP-4.1)', () => {
  let ecs;
  let tileGrid;
  let eventBus;
  let factionBuffer;
  let handOfGod;

  beforeEach(() => {
    ecs = new ECS();
    tileGrid = new TileGrid();
    eventBus = new DomainEventBus();
    factionBuffer = createFactionRuntimeBuffer();
    handOfGod = new HandOfGodSystem(ecs, tileGrid, eventBus, factionBuffer);
  });

  describe('1. 规范 1: 图腾绝对不可抓取锁', () => {
    it('带有 IS_STATIC_ANCHOR 的图腾拦截抓取，并派发 EVT_DIVINE_ACTION_BLOCKED', () => {
      const totem = ecs.allocateEntity();
      setStatus(ecs.statusFlags, totem, IS_STATIC_ANCHOR);

      let blockedFired = false;
      eventBus.subscribe(DomainEvents.EVT_DIVINE_ACTION_BLOCKED, () => {
        blockedFired = true;
      });

      const success = handOfGod.pickup(totem);
      eventBus.flush();

      expect(success).toBe(false);
      expect(blockedFired).toBe(true);
      expect(hasStatus(ecs.statusFlags, totem, IS_HELD)).toBe(false);
    });

    it('处于 IS_SACRED_BODY 金身霸体的实体拒绝抓取', () => {
      const unit = ecs.allocateEntity();
      setStatus(ecs.statusFlags, unit, IS_SACRED_BODY);

      const success = handOfGod.pickup(unit);
      expect(success).toBe(false);
    });
  });

  describe('2. 规范 2: 世界边缘刚性截断 (TC-EDGE-02)', () => {
    it('拖拽至世界边界以外时，实体坐标被截断在 [12, W-12] 范围内，绝无负数或 NaN', () => {
      const unit = ecs.allocateEntity();
      handOfGod.pickup(unit);

      // 拖拽至极端负坐标 (-500, -500)
      handOfGod.moveHeld(-500.0, -500.0);
      const tfOff = unit * TRANSFORM_STRIDE;
      expect(ecs.transforms[tfOff + TF_OFFSET_X]).toBe(BOUNDARY_MARGIN);
      expect(ecs.transforms[tfOff + TF_OFFSET_Y]).toBe(BOUNDARY_MARGIN);

      // 拖拽至极端越界坐标 (99999, 99999)
      handOfGod.moveHeld(99999.0, 99999.0);
      expect(ecs.transforms[tfOff + TF_OFFSET_X]).toBe(WORLD_WIDTH - BOUNDARY_MARGIN);
      expect(ecs.transforms[tfOff + TF_OFFSET_Y]).toBe(WORLD_HEIGHT - BOUNDARY_MARGIN);
    });
  });

  describe('3. 规范 3: 防穿模回弹与平地推挤', () => {
    it('落地帧位于深水不可通行阻挡时，自动 3x3 BFS 推挤至最近合法平地', () => {
      const unit = ecs.allocateEntity();
      handOfGod.pickup(unit);

      // 在瓦片 (10, 10) 设立深水绝壁阻挡
      const blockIdx = 10 * GRID_WIDTH + 10;
      tileGrid.tileTypes[blockIdx] = Biomes.DEEP_WATER.id;
      tileGrid.moveCost[blockIdx] = 999.0;

      // 移至深水中心 (10 * 24 + 12 = 252) 并松开
      handOfGod.moveHeld(10 * TILE_SIZE + 12, 10 * TILE_SIZE + 12);
      handOfGod.release(0, 0);

      const tfOff = unit * TRANSFORM_STRIDE;
      const finalX = ecs.transforms[tfOff + TF_OFFSET_X];
      const finalY = ecs.transforms[tfOff + TF_OFFSET_Y];

      const finalTx = Math.floor(finalX / TILE_SIZE);
      const finalTy = Math.floor(finalY / TILE_SIZE);

      // 断言: 实体被成功推离深水瓦片 (10, 10)
      expect(finalTx !== 10 || finalTy !== 10).toBe(true);
      expect(tileGrid.tileTypes[finalTy * GRID_WIDTH + finalTx]).not.toBe(Biomes.DEEP_WATER.id);
    });
  });

  describe('4. 规范 4 & 5: 动作打断、基于质量的冲击波与下落伤害', () => {
    it('抓取瞬间打断施法，高速甩出落地产生下落伤害与击退硬直', () => {
      const unit = ecs.allocateEntity();
      setStatus(ecs.statusFlags, unit, IS_CASTING);
      ecs.physics[unit * PHYSICS_STRIDE + PHY_OFFSET_MASS] = 100.0;
      ecs.health[unit * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 500.0;
      ecs.transforms[unit * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0;
      ecs.transforms[unit * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;

      // 敌兵位于旁边 (120, 100)
      const enemy = ecs.allocateEntity();
      ecs.identities[enemy * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 2;
      ecs.transforms[enemy * TRANSFORM_STRIDE + TF_OFFSET_X] = 120.0;
      ecs.transforms[enemy * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;

      // 抓取 -> 施法被打断
      handOfGod.pickup(unit);
      expect(hasStatus(ecs.statusFlags, unit, IS_CASTING)).toBe(false);

      // 高速甩下 (速度 200px/s)
      handOfGod.release(200.0, 0.0);

      // 断言: 承受下落伤害
      expect(ecs.health[unit * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBeLessThan(500.0);
      // 落地硬直
      expect(hasStatus(ecs.statusFlags, unit, IS_IMMOBILIZED)).toBe(true);

      // 周围敌兵被冲击波震退
      expect(ecs.physics[enemy * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBeGreaterThan(0.0);
      expect(hasStatus(ecs.statusFlags, enemy, IS_IMMOBILIZED)).toBe(true);
    });
  });

  describe('5. 规范 6: 天命悬空防死锁 (神威反噬与金身霸体缓降)', () => {
    it('抓取单位滞空超过 5.0 秒，触发神威反噬 EVT_DIVINE_BACKFIRE 强制震脱并赋予金身', () => {
      const facId = 1;
      const heir = ecs.allocateEntity();
      ecs.identities[heir * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facId;
      setStatus(ecs.statusFlags, heir, IS_LEADER);

      // 放置母国图腾在 (200, 200)
      const totem = ecs.allocateEntity();
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_X] = 200.0;
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_Y] = 200.0;
      factionBuffer[(facId - 1) * FACTION_STRIDE + FAC_OFFSET_TOTEM_ID] = totem;

      handOfGod.pickup(heir);

      let backfireFired = false;
      eventBus.subscribe(DomainEvents.EVT_DIVINE_BACKFIRE, () => {
        backfireFired = true;
      });

      // 模拟悬空 4.0 秒: 未达 5.0s
      handOfGod.update(4.0);
      expect(handOfGod.heldEntity).toBe(heir);
      expect(backfireFired).toBe(false);

      // 再悬空 1.5 秒 (累计 5.5s > 5.0s): 触发反噬
      handOfGod.update(1.5);
      eventBus.flush();

      // 断言: 强制震脱，不再被抓住
      expect(backfireFired).toBe(true);
      expect(handOfGod.heldEntity).toBe(NULL_ENTITY);
      expect(hasStatus(ecs.statusFlags, heir, IS_HELD)).toBe(false);

      // 断言: 赋予金身霸体与轻柔落地在图腾旁
      expect(hasStatus(ecs.statusFlags, heir, IS_SACRED_BODY)).toBe(true);
      const heirX = ecs.transforms[heir * TRANSFORM_STRIDE + TF_OFFSET_X];
      expect(heirX).toBeCloseTo(224.0, 1);
    });
  });
});
