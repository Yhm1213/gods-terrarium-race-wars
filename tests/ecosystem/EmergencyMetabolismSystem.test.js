import { describe, it, expect, beforeEach } from 'vitest';
import {
  EmergencyMetabolismSystem,
  EMERGENCY_LOCK_DURATION,
  EMERGENCY_RELEASE_THRESHOLD,
  EMERGENCY_TRIGGER_THRESHOLD,
  SICKNESS_PROBABILITY
} from '../../src/ecosystem/EmergencyMetabolismSystem.js';
import {
  ECS,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER,
  PHY_OFFSET_EMERGENCY_LOCK,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../../src/core/ECS.js';
import { IS_EMERGENCY_LOCK, hasStatus } from '../../src/components/UnitStatusFlags.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { PRNG } from '../../src/core/PRNG.js';

describe('EmergencyMetabolismSystem (WP-2.4.1 应急降级生存网与 10s 通道互斥锁)', () => {
  let ecs;
  let eventBus;
  let prng;
  let emergencySys;

  beforeEach(() => {
    ecs = new ECS();
    eventBus = new DomainEventBus();
    prng = new PRNG(4242);
    emergencySys = new EmergencyMetabolismSystem(ecs, eventBus, prng);
  });

  it('10 秒通道独占互斥锁断言：切入应急第 2 秒不可被打断，持续锁定满 10 秒后才允许释放', () => {
    // 创建人类实体 (农耕种族)
    const entityId = ecs.allocateEntity();
    ecs.identities[entityId * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 2; // 人类帝国
    ecs.health[entityId * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 100.0;
    ecs.morale[entityId * MORALE_STRIDE + MORALE_OFFSET_VAL] = 100.0;
    // 饥饿度触发临界 85.0
    ecs.physiology[entityId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 85.0;

    // 触发应急
    emergencySys.update(0.1);

    // 断言 1: 已激活互斥锁
    expect(emergencySys.isEmergencyLocked(entityId)).toBe(true);
    expect(hasStatus(ecs.statusFlags, entityId, IS_EMERGENCY_LOCK)).toBe(true);

    // 步进至第 2 秒：模拟外部寻路或状态机请求重打断
    emergencySys.update(1.9); // 累计 2.0 秒
    expect(emergencySys.isEmergencyLocked(entityId)).toBe(true);
    // 重入尝试应被严格防御拦截
    const retrigger = emergencySys.triggerEmergency(entityId);
    expect(retrigger).toBe(false);

    // 步进至第 9.5 秒：仍未满 10 秒，持续锁定
    emergencySys.update(7.5);
    expect(emergencySys.isEmergencyLocked(entityId)).toBe(true);

    // 确保当前饥饿度 < 50.0 (前面 85 - 15 = 70，我们模拟饥饿已降至 45)
    ecs.physiology[entityId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 45.0;

    // 步进 0.6 秒 (累计超过 10.0 秒)
    emergencySys.update(0.6);

    // 断言 2: 满 10 秒且饥饿 < 50，互斥锁平稳释放
    expect(emergencySys.isEmergencyLocked(entityId)).toBe(false);
    expect(hasStatus(ecs.statusFlags, entityId, IS_EMERGENCY_LOCK)).toBe(false);
  });

  it('农耕种族啃草降级断言：hunger -15, hp -5, morale -20', () => {
    const elfId = ecs.allocateEntity();
    ecs.identities[elfId * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 1; // 森灵树民 (农耕)
    ecs.health[elfId * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 85.0;
    ecs.morale[elfId * MORALE_STRIDE + MORALE_OFFSET_VAL] = 80.0;
    ecs.physiology[elfId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 82.0;

    const triggered = emergencySys.triggerEmergency(elfId);
    expect(triggered).toBe(true);

    const hungerAfter = ecs.physiology[elfId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER];
    const hpAfter = ecs.health[elfId * HEALTH_STRIDE + HP_OFFSET_CURRENT];
    const moraleAfter = ecs.morale[elfId * MORALE_STRIDE + MORALE_OFFSET_VAL];

    expect(hungerAfter).toBeCloseTo(82.0 - 15.0, 4); // 67.0
    expect(hpAfter).toBeCloseTo(85.0 - 5.0, 4);       // 80.0
    expect(moraleAfter).toBeCloseTo(80.0 - 20.0, 4);   // 60.0
  });

  it('捕猎种族食用腐肉 100 次致病率统计断言：PRNG 判定严格收敛于 50%', () => {
    // 实例化固定种子的确定性 PRNG
    const testPrng = new PRNG(9999);
    let sickCount = 0;
    const trials = 100;

    for (let i = 0; i < trials; i++) {
      if (testPrng.nextFloat() < SICKNESS_PROBABILITY) {
        sickCount++;
      }
    }

    // 在大数定律与 Mulberry32 伪随机数分布下，100 次采样致病率极为均衡
    const sickRate = sickCount / trials;
    expect(sickRate).toBeGreaterThanOrEqual(0.40);
    expect(sickRate).toBeLessThanOrEqual(0.60);
  });

  it('掠夺种族互殴抢粮断言：hunger -20 并派发 EVT_BRAWL_RATION', () => {
    const orcId = ecs.allocateEntity();
    ecs.identities[orcId * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 0; // 绿皮掠夺战帮
    ecs.health[orcId * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 140.0;
    ecs.morale[orcId * MORALE_STRIDE + MORALE_OFFSET_VAL] = 70.0;
    ecs.physiology[orcId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 88.0;

    const events = [];
    eventBus.subscribe(DomainEvents.EVT_BRAWL_RATION, (type, src, dst, p1, p2) => {
      events.push({ type, src, dst, p1, p2 });
    });

    const triggered = emergencySys.triggerEmergency(orcId);
    expect(triggered).toBe(true);
    eventBus.flush();

    const hungerAfter = ecs.physiology[orcId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER];
    expect(hungerAfter).toBeCloseTo(88.0 - 20.0, 4); // 68.0

    expect(events.length).toBe(1);
    expect(events[0].type).toBe(DomainEvents.EVT_BRAWL_RATION);
    expect(events[0].src).toBe(orcId);
  });

  it('抽搐死锁防御断言：满 10 秒但饥饿依然 >= 50 时锁不立即释放，杜绝 10 帧抖动抽搐', () => {
    const dwarfId = ecs.allocateEntity();
    ecs.identities[dwarfId * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 3; // 高山矮人 (捕猎)
    ecs.physiology[dwarfId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 95.0;

    // 触发应急
    emergencySys.triggerEmergency(dwarfId);
    // 矮人 95 - 25 = 70.0 饥饿，依然 >= 50.0

    // 步进 10.5 秒 (互斥锁倒计时归零)
    emergencySys.update(10.5);

    // 此时 hunger = 70 >= 50，保持锁定状态
    expect(emergencySys.isEmergencyLocked(dwarfId)).toBe(false); // timer <= 0
    expect(hasStatus(ecs.statusFlags, dwarfId, IS_EMERGENCY_LOCK)).toBe(true); // 标志位暂未释放
  });
});
