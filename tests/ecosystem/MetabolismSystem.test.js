import { describe, it, expect, beforeEach } from 'vitest';
import { MetabolismSystem, STARVATION_HUNGER_THRESHOLD, STARVATION_DPS } from '../../src/ecosystem/MetabolismSystem.js';
import { ECS, NULL_ENTITY, HEALTH_STRIDE, HP_OFFSET_CURRENT, HP_OFFSET_MAX, PHYSIOLOGY_STRIDE, PHY_OFFSET_HUNGER, IDENTITY_STRIDE, ID_OFFSET_FACTION, TRANSFORM_STRIDE, TF_OFFSET_X, TF_OFFSET_Y, MORALE_STRIDE, MORALE_OFFSET_VAL } from '../../src/core/ECS.js';
import { NutrientField } from '../../src/ecosystem/NutrientField.js';
import { TileGrid } from '../../src/world/TileGrid.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { Races, MetabolicTypes } from '../../src/data/RaceData.js';

describe('MetabolismSystem (WP-3.1.1 基础主干代谢与饥饿系统)', () => {
  let ecs;
  let tileGrid;
  let nutrientField;
  let eventBus;
  let metabolismSys;

  beforeEach(() => {
    ecs = new ECS();
    tileGrid = new TileGrid();
    nutrientField = new NutrientField(tileGrid);
    nutrientField.reset(0.0);
    eventBus = new DomainEventBus();
    metabolismSys = new MetabolismSystem(ecs, nutrientField, eventBus);
  });

  it('12 种族代谢率与参数对齐断言', () => {
    // 人类帝国 (Faction 2): metabolicRate = 1.0, mass = 65
    const humanEntity = ecs.allocateEntity();
    ecs.identities[humanEntity * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 2;
    const humanProfile = metabolismSys.getEntityMetabolicProfile(humanEntity);
    expect(humanProfile.metabolicRate).toBeCloseTo(1.0, 4);
    expect(humanProfile.mass).toBeCloseTo(65.0, 4);
    expect(humanProfile.metabolicType).toBe(MetabolicTypes.AGRARIAN);

    // 深渊角魔 (Faction 6): metabolicRate = 1.5, mass = 90
    const demonEntity = ecs.allocateEntity();
    ecs.identities[demonEntity * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 6;
    const demonProfile = metabolismSys.getEntityMetabolicProfile(demonEntity);
    expect(demonProfile.metabolicRate).toBeCloseTo(1.5, 4);
    expect(demonProfile.mass).toBeCloseTo(90.0, 4);
    expect(demonProfile.metabolicType).toBe(MetabolicTypes.MARAUDER);
  });

  it('无机断言：墓园亡灵实体在饥荒环境中运行 1000 Tick，饥饿度恒等于 0，生命值不发生衰减', () => {
    // 墓园亡灵聚落 (Faction 4)
    const undeadId = ecs.allocateEntity();
    ecs.identities[undeadId * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 4;
    ecs.health[undeadId * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 75.0;
    ecs.health[undeadId * HEALTH_STRIDE + HP_OFFSET_MAX] = 75.0;

    // 运行 1000 步
    for (let i = 0; i < 1000; i++) {
      metabolismSys.update(1.0);
    }

    const hunger = ecs.physiology[undeadId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER];
    const hp = ecs.health[undeadId * HEALTH_STRIDE + HP_OFFSET_CURRENT];

    expect(hunger).toBe(0.0);
    expect(hp).toBe(75.0);
    expect(ecs.isAlive(undeadId)).toBe(true);
  });

  it('饥饿累加与生命损耗断言：hunger > 80 时持续以 0.5 HP/s 损耗生命值', () => {
    const humanId = ecs.allocateEntity();
    ecs.identities[humanId * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 2; // 人类
    ecs.health[humanId * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 100.0;
    ecs.health[humanId * HEALTH_STRIDE + HP_OFFSET_MAX] = 100.0;
    ecs.morale[humanId * MORALE_STRIDE + MORALE_OFFSET_VAL] = 100.0;

    // 初始饥饿设为 79.0 (未达到损耗阈值)
    ecs.physiology[humanId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 79.0;
    metabolismSys.update(0.5); // hunger 增至 79.5
    expect(ecs.health[humanId * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBe(100.0);
    expect(ecs.morale[humanId * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBe(100.0);

    // 步进 1.0 秒，hunger 达到 80.5 > 80
    metabolismSys.update(1.0);
    // 触发饥饿损耗: 0.5 HP/s * 1.0s = 0.5 HP
    expect(ecs.health[humanId * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBeCloseTo(99.5, 4);
    // 触发士气崩溃损耗: 2.0/s * 1.0s = 2.0 点士气
    expect(ecs.morale[humanId * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBeCloseTo(98.0, 4);

    // 持续步进 10 秒
    metabolismSys.update(10.0);
    // 扣除 0.5 * 10 = 5.0 HP
    expect(ecs.health[humanId * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBeCloseTo(94.5, 4);
    // 持续扣除 2.0 * 10 = 20.0 士气
    expect(ecs.morale[humanId * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBeCloseTo(78.0, 4);
  });

  it('饥饿致死断言：hp <= 0 时派发 EVT_DEATH_STARVATION，安全回收实体并沉降骨肥到瓦片养分', () => {
    const humanId = ecs.allocateEntity();
    ecs.identities[humanId * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 2; // 人类 (mass = 65)

    // 设置位置在瓦片 (5, 5)，像素坐标 (5 * 24, 5 * 24) = (120, 120)
    ecs.transforms[humanId * TRANSFORM_STRIDE + TF_OFFSET_X] = 120.0;
    ecs.transforms[humanId * TRANSFORM_STRIDE + TF_OFFSET_Y] = 120.0;

    // 饥饿 90，濒死生命值 0.2 HP
    ecs.physiology[humanId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 90.0;
    ecs.health[humanId * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 0.2;
    ecs.health[humanId * HEALTH_STRIDE + HP_OFFSET_MAX] = 100.0;

    // 监听事件
    const events = [];
    eventBus.subscribe(DomainEvents.EVT_DEATH_STARVATION, (type, src, dst, p1, p2) => {
      events.push({ type, src, dst, p1, p2 });
    });

    const tileNutrientBefore = nutrientField.getNutrient(5, 5);
    expect(tileNutrientBefore).toBe(0.0);

    // 步进 1 秒 (消耗 0.5 HP，致死)
    metabolismSys.update(1.0);
    eventBus.flush();

    // 验证事件派发 (p1: tileIndex = 5 * 56 + 5 = 285)
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(DomainEvents.EVT_DEATH_STARVATION);
    expect(events[0].src).toBe(humanId);
    expect(events[0].p1).toBe(5 * 56 + 5); // tileIdx = 285

    // 验证骨肥沉降 (保底 15.0 点)
    const tileNutrientAfter = nutrientField.getNutrient(5, 5);
    expect(tileNutrientAfter).toBeCloseTo(15.0, 4);

    // 验证实体已被安全释放
    expect(ecs.isAlive(humanId)).toBe(false);
  });

  it('0 号墓碑免受代谢影响断言', () => {
    // 0 号墓碑
    ecs.physiology[NULL_ENTITY * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 90.0;
    ecs.health[NULL_ENTITY * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 50.0;

    metabolismSys.update(10.0);

    // 0 号实体属性绝对不受代谢系统更改
    expect(ecs.health[NULL_ENTITY * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBe(50.0);
  });
});
