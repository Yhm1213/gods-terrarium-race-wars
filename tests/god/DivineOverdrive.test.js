/**
 * DivineOverdrive.test.js
 * 15 秒神恩狂欢状态机规范测试套件 (WP-4.1 §2.2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY
} from '../../src/core/ECS.js';
import {
  IS_ALIVE,
  IS_ECSTASY,
  hasStatus,
  setStatus,
  clearStatus
} from '../../src/components/UnitStatusFlags.js';
import { TileGrid } from '../../src/world/TileGrid.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import {
  DivineMiraclesSystem,
  MiracleId
} from '../../src/god/DivineMiraclesSystem.js';
import {
  DivineOverdrive,
  OVERDRIVE_DURATION_SECONDS
} from '../../src/god/DivineOverdrive.js';

describe('DivineOverdrive Specification Suite (WP-4.1 §2.2)', () => {
  let ecs;
  let tileGrid;
  let eventBus;
  let miracles;
  let overdrive;

  beforeEach(() => {
    ecs = new ECS();
    tileGrid = new TileGrid();
    eventBus = new DomainEventBus();
    miracles = new DivineMiraclesSystem(ecs, tileGrid, eventBus);
    overdrive = new DivineOverdrive(ecs, miracles, eventBus);
  });

  describe('1. 狂欢触发条件与状态初始化', () => {
    it('神恩未满 100 时拒绝激活，满 100 时成功进入狂欢', () => {
      miracles.fervor = 99.0;
      expect(overdrive.triggerOverdrive(100)).toBe(false);
      expect(overdrive.isActive).toBe(false);

      miracles.fervor = 100.0;
      let startEventFired = false;
      eventBus.subscribe(DomainEvents.EVT_OVERDRIVE_STARTED, (type, tick) => {
        startEventFired = true;
        expect(tick).toBe(100);
      });

      expect(overdrive.triggerOverdrive(100)).toBe(true);
      eventBus.flush();

      expect(overdrive.isActive).toBe(true);
      expect(overdrive.remainingTime).toBe(OVERDRIVE_DURATION_SECONDS);
      expect(miracles.fervor).toBe(0.0); // 神恩已倾泻
      expect(startEventFired).toBe(true);
    });

    it('狂欢开启时，所有存活实体被赋予 IS_ECSTASY 狂喜状态', () => {
      const live1 = ecs.allocateEntity();
      setStatus(ecs.statusFlags, live1, IS_ALIVE);

      const live2 = ecs.allocateEntity();
      setStatus(ecs.statusFlags, live2, IS_ALIVE);

      const dead = ecs.allocateEntity();
      clearStatus(ecs.statusFlags, dead, IS_ALIVE);

      miracles.fervor = 100.0;
      overdrive.triggerOverdrive(50);

      expect(hasStatus(ecs.statusFlags, live1, IS_ECSTASY)).toBe(true);
      expect(hasStatus(ecs.statusFlags, live2, IS_ECSTASY)).toBe(true);
      expect(hasStatus(ecs.statusFlags, dead, IS_ECSTASY)).toBe(false);
    });
  });

  describe('2. 狂欢运行机制与无限神力', () => {
    it('狂欢期间所有技能冷却硬清零，且记录神迹释放与击杀', () => {
      miracles.fervor = 100.0;
      overdrive.triggerOverdrive(200);

      // 人为给技能设置冷却
      miracles.cooldowns[MiracleId.HOLY_THUNDER] = 10.0;

      // 更新一帧
      overdrive.update(1.0, 260);
      expect(miracles.cooldowns[MiracleId.HOLY_THUNDER]).toBe(0.0);

      // 记录事件
      overdrive.recordMiracleCast();
      overdrive.recordMiracleCast();
      overdrive.recordKill();

      expect(overdrive.miraclesCastCount).toBe(2);
      expect(overdrive.killsDuringOverdrive).toBe(1);
    });
  });

  describe('3. 终末结算与快报生成', () => {
    it('15 秒倒计时结束，移除狂喜光环，派发 EVT_OVERDRIVE_ENDED 并生成快报快照', () => {
      const live = ecs.allocateEntity();
      setStatus(ecs.statusFlags, live, IS_ALIVE);

      miracles.fervor = 100.0;
      overdrive.triggerOverdrive(1000);
      expect(hasStatus(ecs.statusFlags, live, IS_ECSTASY)).toBe(true);

      overdrive.recordMiracleCast();
      overdrive.recordKill();

      let endEventFired = false;
      eventBus.subscribe(DomainEvents.EVT_OVERDRIVE_ENDED, (type, endTick, kills, casts) => {
        endEventFired = true;
        expect(endTick).toBe(1900);
        expect(kills).toBe(1);
        expect(casts).toBe(1);
      });

      // 模拟推进 15.1 秒
      overdrive.update(15.1, 1900);
      eventBus.flush();

      expect(overdrive.isActive).toBe(false);
      expect(endEventFired).toBe(true);
      expect(hasStatus(ecs.statusFlags, live, IS_ECSTASY)).toBe(false);

      const report = overdrive.getLastReport();
      expect(report.epochId).toBe(1);
      expect(report.miraclesCast).toBe(1);
      expect(report.killsCount).toBe(1);
      expect(report.headline).toContain('【狂欢纪元快报');
    });
  });
});
