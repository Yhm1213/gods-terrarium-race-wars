/**
 * WarWatchdogSystem.test.js
 * 300s 战争交火超时双门限防伪看门狗规范测试套件 (WP-3.2)
 * 验证 SPEC-M3-CONTRACT §2.3 (TC-EDGE-04)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL
} from '../../src/core/ECS.js';
import {
  IN_COMBAT,
  hasStatus,
  setStatus
} from '../../src/components/UnitStatusFlags.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { BorderFrictionSystem } from '../../src/warfare/BorderFrictionSystem.js';
import { MoraleSystem } from '../../src/warfare/MoraleSystem.js';
import {
  WarWatchdogSystem,
  WAR_STALEMATE_TIMEOUT,
  WAR_MAX_DURATION,
  WAR_MORALE_ATTRITION_RATE,
  FORCED_PEACE_LOCK_SECONDS
} from '../../src/warfare/WarWatchdogSystem.js';

describe('WarWatchdogSystem Specification Suite (WP-3.2, TC-EDGE-04)', () => {
  let ecs;
  let eventBus;
  let frictionSys;
  let moraleSys;
  let watchdog;

  const facA = 1;
  const facB = 2;

  beforeEach(() => {
    ecs = new ECS();
    eventBus = new DomainEventBus();
    frictionSys = new BorderFrictionSystem(eventBus);
    moraleSys = new MoraleSystem(ecs, eventBus);
    watchdog = new WarWatchdogSystem(ecs, eventBus, frictionSys, moraleSys);
  });

  describe('1. 战争启动与双向对称状态维护', () => {
    it('显式启动战争与 EventBus 宣战事件自动激活双向战争状态', () => {
      expect(watchdog.isWarActive(facA, facB)).toBe(false);

      // 派发宣战事件并 flush
      eventBus.emit(DomainEvents.EVT_WAR_DECLARED, facA, facB, 0, 0);
      eventBus.flush();

      expect(watchdog.isWarActive(facA, facB)).toBe(true);
      expect(watchdog.isWarActive(facB, facA)).toBe(true);
      expect(watchdog.getWarDuration(facA, facB)).toBe(0.0);
    });

    it('战争时长随时间推进平滑累加', () => {
      watchdog.startWar(facA, facB);
      watchdog.update(10.0);

      expect(watchdog.getWarDuration(facA, facB)).toBeCloseTo(10.0, 1);
      expect(watchdog.getStalemateTimer(facA, facB)).toBeCloseTo(10.0, 1);
    });
  });

  describe('2. 门限 1: 60s 僵局无战果战意消磨与伪保活排查', () => {
    it('未达 60s 期间不触发战意消磨，突破 60s 后全体士兵士气每秒扣除 5.0 点', () => {
      watchdog.startWar(facA, facB);

      // 阵营 A 创建一名士兵，初始士气 100
      const soldierA = ecs.allocateEntity();
      ecs.identities[soldierA * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facA;
      ecs.morale[soldierA * MORALE_STRIDE + MORALE_OFFSET_VAL] = 100.0;

      // 阵营 B 创建一名士兵，初始士气 80
      const soldierB = ecs.allocateEntity();
      ecs.identities[soldierB * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facB;
      ecs.morale[soldierB * MORALE_STRIDE + MORALE_OFFSET_VAL] = 80.0;

      // 推进 50 秒 (未满 60s 门限)
      watchdog.update(50.0);
      expect(ecs.morale[soldierA * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBe(100.0);
      expect(ecs.morale[soldierB * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBe(80.0);

      // 再推进 10 秒达到 60s 僵局门限
      watchdog.update(10.0);
      expect(watchdog.getStalemateTimer(facA, facB)).toBeCloseTo(60.0, 1);

      // 僵局生效后推进 2.0 秒: 扣除 5.0 * 2.0 = 10.0 点士气
      watchdog.update(2.0);
      expect(ecs.morale[soldierA * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBeCloseTo(90.0, 1);
      expect(ecs.morale[soldierB * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBeCloseTo(70.0, 1);
    });

    it('有效战果刷新: 敌军核心阵亡刷新僵局计时器，击杀中立小动物不刷新 (排查伪保活)', () => {
      watchdog.startWar(facA, facB);
      watchdog.update(40.0);
      expect(watchdog.getStalemateTimer(facA, facB)).toBeCloseTo(40.0, 1);

      // 场景 1: 击杀中立小动物 (victimFac = 0)
      watchdog.recordCasualty(0, facA);
      expect(watchdog.getStalemateTimer(facA, facB)).toBeCloseTo(40.0, 1); // 不被刷新！

      // 场景 2: 敌方作战士兵阵亡 (victimFac = facB, killerFac = facA)
      watchdog.recordCasualty(facB, facA);
      expect(watchdog.getStalemateTimer(facA, facB)).toBe(0.0); // 成功重置有效战果
    });

    it('图腾实质受损刷新战果，图腾心跳回血不刷新 (排查刷血伪保活)', () => {
      const totemA = ecs.allocateEntity();
      ecs.identities[totemA * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facA;
      ecs.health[totemA * HEALTH_STRIDE + HP_OFFSET_MAX] = 1000.0;
      ecs.health[totemA * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 800.0;
      watchdog.registerTotem(facA, totemA);

      watchdog.startWar(facA, facB);
      watchdog.update(45.0);
      expect(watchdog.getStalemateTimer(facA, facB)).toBeCloseTo(45.0, 1);

      // 图腾回血至 850 (心跳刷血保活企图)
      ecs.health[totemA * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 850.0;
      watchdog.update(1.0);
      // 计时器不应被清零，而是继续累加至 46.0
      expect(watchdog.getStalemateTimer(facA, facB)).toBeCloseTo(46.0, 1);

      // 图腾受到实质攻击跌至 800 (受损 50 >= 1.0)
      ecs.health[totemA * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 800.0;
      watchdog.update(1.0);
      // 成功检测到图腾受创，战果刷新，僵局计时器清零并重新从当帧 1.0s 累计
      expect(watchdog.getStalemateTimer(facA, facB)).toBeCloseTo(1.0, 1);
      expect(watchdog.getStalemateTimer(facA, facB)).toBeLessThan(45.0);
    });
  });

  describe('3. 门限 2: 300s 战争绝对硬熔断 (TC-EDGE-04)', () => {
    it('持续交火达到 300s 强制休战: 广播事件、和平锁 120s、清除 IN_COMBAT', () => {
      watchdog.startWar(facA, facB);

      // 注册双方士兵处于战斗状态
      const soldierA = ecs.allocateEntity();
      ecs.identities[soldierA * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facA;
      setStatus(ecs.statusFlags, soldierA, IN_COMBAT);

      const soldierB = ecs.allocateEntity();
      ecs.identities[soldierB * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facB;
      setStatus(ecs.statusFlags, soldierB, IN_COMBAT);

      // 监听强制休战事件
      let forcedPeaceFired = false;
      let eventFacA = 0;
      let eventFacB = 0;
      eventBus.subscribe(DomainEvents.EVT_PAX_DIVINA_FORCED, (type, src, dst) => {
        forcedPeaceFired = true;
        eventFacA = src;
        eventFacB = dst;
      });

      // 模拟战争推进到 299s
      watchdog.update(299.0);
      expect(watchdog.isWarActive(facA, facB)).toBe(true);
      expect(forcedPeaceFired).toBe(false);

      // 再推进 1.5s (累计 300.5s >= 300s 门限)
      watchdog.update(1.5);
      eventBus.flush();

      // 断言: 门限 2 硬熔断触发
      expect(forcedPeaceFired).toBe(true);
      expect(eventFacA).toBe(facA);
      expect(eventFacB).toBe(facB);
      expect(watchdog.isWarActive(facA, facB)).toBe(false);

      // 断言: 施加 120s 绝对和平锁
      expect(frictionSys.isAtWar(facA, facB)).toBe(false);
      expect(frictionSys.peaceLocks[frictionSys._index(facA, facB)]).toBeCloseTo(120.0, 1);

      // 断言: 双方战斗状态清除
      expect(hasStatus(ecs.statusFlags, soldierA, IN_COMBAT)).toBe(false);
      expect(hasStatus(ecs.statusFlags, soldierB, IN_COMBAT)).toBe(false);
    });

    it('停战离心退避 (Centrifugal Retreat): 重叠单位向相反方向平移推开，杜绝抽搐死循环', () => {
      watchdog.startWar(facA, facB);

      // 两个敌兵在战场重叠 (坐标 100, 100 与 102, 100，相隔 2px < 48px)
      const soldierA = ecs.allocateEntity();
      ecs.identities[soldierA * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facA;
      ecs.transforms[soldierA * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0;
      ecs.transforms[soldierA * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;
      ecs.physics[soldierA * PHYSICS_STRIDE + PHY_OFFSET_VX] = 50.0; // 正在推搡冲锋

      const soldierB = ecs.allocateEntity();
      ecs.identities[soldierB * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facB;
      ecs.transforms[soldierB * TRANSFORM_STRIDE + TF_OFFSET_X] = 102.0;
      ecs.transforms[soldierB * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;
      ecs.physics[soldierB * PHYSICS_STRIDE + PHY_OFFSET_VX] = -50.0;

      // 触发 300s 熔断
      watchdog.forcePaxDivina(facA, facB);

      // 断言: 双方被离心推开
      const xA = ecs.transforms[soldierA * TRANSFORM_STRIDE + TF_OFFSET_X];
      const xB = ecs.transforms[soldierB * TRANSFORM_STRIDE + TF_OFFSET_X];
      expect(xA).toBeLessThan(100.0);
      expect(xB).toBeGreaterThan(102.0);
      expect(xB - xA).toBeGreaterThanOrEqual(48.0);

      // 动量清零
      expect(ecs.physics[soldierA * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBe(0.0);
      expect(ecs.physics[soldierB * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBe(0.0);
    });
  });
});
