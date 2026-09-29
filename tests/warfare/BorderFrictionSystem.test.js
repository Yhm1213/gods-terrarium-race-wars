/**
 * BorderFrictionSystem.test.js
 * 领地边境摩擦、远征疲劳与四级士气状态机测试套件 (WP-3.1)
 * 严格对齐 Milestone 3 契约 1.1 ~ 1.4 节设计指标
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
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../../src/core/ECS.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { TileGrid } from '../../src/world/TileGrid.js';
import { BorderFrictionSystem, FrictionStage } from '../../src/warfare/BorderFrictionSystem.js';
import { TotemDefenseSystem } from '../../src/warfare/TotemDefenseSystem.js';
import { MoraleSystem, MoraleState } from '../../src/warfare/MoraleSystem.js';
import {
  IS_ALIVE,
  IS_STUNNED,
  IS_SACRED_BODY,
  IS_LAST_STAND,
  IS_PANICKED,
  hasStatus
} from '../../src/components/UnitStatusFlags.js';

describe('BorderFrictionSystem & Warfare Morale Specification Suite (WP-3.1)', () => {
  let ecs;
  let eventBus;
  let tileGrid;
  let frictionSys;
  let totemSys;
  let moraleSys;

  beforeEach(() => {
    ecs = new ECS();
    eventBus = new DomainEventBus();
    tileGrid = new TileGrid();
    frictionSys = new BorderFrictionSystem(eventBus);
    totemSys = new TotemDefenseSystem(ecs, eventBus);
    moraleSys = new MoraleSystem(ecs, eventBus, totemSys);
  });

  describe('1. 领地权属容器与边界摩擦三阶梯状态机', () => {
    it('TileGrid 领地权属平铺维护正确', () => {
      tileGrid.setTerritory(100, 1);
      tileGrid.setTerritoryByCoord(10, 5, 2);

      expect(tileGrid.getTerritory(100)).toBe(1);
      expect(tileGrid.getTerritoryByCoord(10, 5)).toBe(2);
      expect(tileGrid.getTerritoryByCoord(0, 0)).toBe(0); // 默认中立

      tileGrid.reset();
      expect(tileGrid.getTerritory(100)).toBe(0);
    });

    it('边境摩擦三阶梯平滑推进与宣战触发', () => {
      const facA = 1;
      const facB = 2;

      // 初始阶段 0: 中立
      expect(frictionSys.getStage(facA, facB)).toBe(FrictionStage.NEUTRAL);
      expect(frictionSys.isAtWar(facA, facB)).toBe(false);

      // 偷粮 +10 -> 阶段 1: 微观私怨 (10)
      frictionSys.recordFriction(facA, facB, 10.0);
      expect(frictionSys.getStage(facA, facB)).toBe(FrictionStage.FRICTION);
      expect(frictionSys.getFriction(facA, facB)).toBe(10.0);

      // 边境互殴致伤 +15 -> 累积 25 (仍阶段 1)
      frictionSys.recordFriction(facA, facB, 15.0);
      expect(frictionSys.getFriction(facA, facB)).toBe(25.0);
      expect(frictionSys.getStage(facA, facB)).toBe(FrictionStage.FRICTION);

      // 再次互殴 +15 -> 累积 40 -> 阶段 2: 边境哨戒与小队械斗
      frictionSys.recordFriction(facA, facB, 15.0);
      expect(frictionSys.getFriction(facA, facB)).toBe(40.0);
      expect(frictionSys.getStage(facA, facB)).toBe(FrictionStage.SKIRMISH);

      // 累加突破 70 -> 阶段 3: 全面战争爆发
      frictionSys.recordFriction(facA, facB, 35.0); // 40 + 35 = 75
      expect(frictionSys.getStage(facA, facB)).toBe(FrictionStage.TOTAL_WAR);
      expect(frictionSys.isAtWar(facA, facB)).toBe(true);
    });

    it('皇子/将领阵亡瞬间注入 +45 仇隙并直接引爆阶段 3 全面宣战', () => {
      const facA = 3;
      const facB = 4;
      frictionSys.onPrinceOrGeneralKilled(facB, facA);

      expect(frictionSys.getStage(facA, facB)).toBe(FrictionStage.TOTAL_WAR);
      expect(frictionSys.isAtWar(facA, facB)).toBe(true);
    });

    it('外交血誓同盟连带宣战机制', () => {
      const facA = 1;
      const facB = 2;
      const facC = 3;

      // A 与 C 结为血誓同盟
      frictionSys.setAlliance(facA, facC, true);
      expect(frictionSys.isAllied(facA, facC)).toBe(true);

      // A 向 B 宣战
      frictionSys.declareWar(facA, facB);

      // 断言: A 与 B 开战，且盟友 C 自动连带向 B 宣战
      expect(frictionSys.isAtWar(facA, facB)).toBe(true);
      expect(frictionSys.isAtWar(facC, facB)).toBe(true);
    });
  });

  describe('2. 远征后勤疲劳光环与图腾 25% 圣盾波', () => {
    it('远征疲劳光环: 脱离图腾 3 瓦片外每 3 瓦片增加 1 层 (上限 5 层，-20% 移速，-25% 伤害)', () => {
      const factionId = 1;
      const totem = ecs.allocateEntity();
      ecs.identities[totem * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0;
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;
      totemSys.registerTotem(factionId, totem);

      const soldier = ecs.allocateEntity();
      ecs.identities[soldier * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;

      // 距离图腾 2 瓦片 (48px) 内: 0 层疲劳
      ecs.transforms[soldier * TRANSFORM_STRIDE + TF_OFFSET_X] = 140.0;
      ecs.transforms[soldier * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;
      let f = totemSys.getExpeditionFatigue(soldier);
      expect(f.layers).toBe(0);
      expect(f.speedMod).toBe(1.0);
      expect(f.damageMod).toBe(1.0);

      // 距离图腾 7 瓦片 (168px): 脱离 3 瓦片外多出 4 瓦片 -> 1 层疲劳
      ecs.transforms[soldier * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0 + 7 * 24;
      f = totemSys.getExpeditionFatigue(soldier);
      expect(f.layers).toBe(1);
      expect(f.speedMod).toBeCloseTo(0.96, 2);
      expect(f.damageMod).toBeCloseTo(0.95, 2);

      // 距离图腾 25 瓦片 (600px): 上限 5 层疲劳
      ecs.transforms[soldier * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0 + 25 * 24;
      f = totemSys.getExpeditionFatigue(soldier);
      expect(f.layers).toBe(5);
      expect(f.speedMod).toBeCloseTo(0.80, 2);
      expect(f.damageMod).toBeCloseTo(0.75, 2);
    });

    it('图腾 25% 圣火涅槃冲击波: 震飞 6 瓦片敌军并眩晕，产生 12s 金身无敌圣盾，单次战争限 1 次', () => {
      const myFac = 1;
      const enemyFac = 2;

      const totem = ecs.allocateEntity();
      ecs.identities[totem * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_X] = 200.0;
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_Y] = 200.0;
      const hpOff = totem * HEALTH_STRIDE;
      ecs.health[hpOff + HP_OFFSET_MAX] = 1000.0;
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 1000.0;
      totemSys.registerTotem(myFac, totem);

      // 敌军位于图腾旁 2 瓦片处 (48px)
      const enemy = ecs.allocateEntity();
      ecs.identities[enemy * IDENTITY_STRIDE + ID_OFFSET_FACTION] = enemyFac;
      ecs.transforms[enemy * TRANSFORM_STRIDE + TF_OFFSET_X] = 248.0;
      ecs.transforms[enemy * TRANSFORM_STRIDE + TF_OFFSET_Y] = 200.0;

      // 图腾生命掉至 200 HP (20% <= 25%)
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 200.0;
      totemSys.update(0.1);

      // 断言: 触发圣火冲击波
      expect(hasStatus(ecs.statusFlags, totem, IS_SACRED_BODY)).toBe(true);
      expect(totemSys.aegisDuration[myFac]).toBeCloseTo(12.0, 1);
      // 敌军被震退并眩晕
      expect(ecs.physics[enemy * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBeGreaterThan(50.0);
      expect(hasStatus(ecs.statusFlags, enemy, IS_STUNNED)).toBe(true);

      // 再次受创，单次战争不再重复触发
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 100.0;
      totemSys.update(0.1);
      expect(totemSys.totemTriggeredFlags[myFac]).toBe(1);
    });
  });

  describe('3. 四级士气状态机与图腾 5 格破釜沉舟', () => {
    it('四级士气状态机流转正确并派发事件', () => {
      const unit = ecs.allocateEntity();
      moraleSys.setMorale(unit, 100.0);
      expect(moraleSys.getMoraleState(unit)).toBe(MoraleState.SOLID);

      moraleSys.setMorale(unit, 45.0);
      expect(moraleSys.getMoraleState(unit)).toBe(MoraleState.WAVERING);

      moraleSys.setMorale(unit, 15.0);
      expect(moraleSys.getMoraleState(unit)).toBe(MoraleState.DISORGANIZED);

      moraleSys.setMorale(unit, 0.0);
      expect(moraleSys.getMoraleState(unit)).toBe(MoraleState.ROUTED);
      expect(hasStatus(ecs.statusFlags, unit, IS_PANICKED)).toBe(true);
    });

    it('友军阵亡 3 秒滑动时间窗封顶最多扣除 15 点士气', () => {
      const facId = 1;
      const survivor = ecs.allocateEntity();
      ecs.identities[survivor * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facId;
      ecs.transforms[survivor * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0;
      ecs.transforms[survivor * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;
      moraleSys.setMorale(survivor, 100.0);

      // 连续 10 个友军在身旁贴脸阵亡 (单次本应扣 3 点，10 次共 30 点)
      for (let i = 0; i < 10; i++) {
        const ally = ecs.allocateEntity();
        ecs.identities[ally * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facId;
        ecs.transforms[ally * TRANSFORM_STRIDE + TF_OFFSET_X] = 110.0;
        ecs.transforms[ally * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;
        moraleSys.onAllyKilled(ally);
        ecs.freeEntity(ally);
      }

      // 断言: 3 秒滑动窗口强行截断，最多扣除 15 点，剩余 85 点
      const curMorale = ecs.morale[survivor * MORALE_STRIDE + MORALE_OFFSET_VAL];
      expect(curMorale).toBe(85.0);

      // 过去 3.1 秒，滑动窗口重置
      moraleSys.update(3.1);
      expect(moraleSys.witnessDeductedAmount[survivor]).toBe(0.0);
    });

    it('溃退士兵退至母国图腾 5 瓦片内触发【破釜沉舟】，士气锁死 1 点，死战不退', () => {
      const facId = 2;
      const totem = ecs.allocateEntity();
      ecs.identities[totem * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facId;
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_X] = 300.0;
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_Y] = 300.0;
      totemSys.registerTotem(facId, totem);

      const soldier = ecs.allocateEntity();
      ecs.identities[soldier * IDENTITY_STRIDE + ID_OFFSET_FACTION] = facId;
      // 位于图腾 3 瓦片内 (72px)
      ecs.transforms[soldier * TRANSFORM_STRIDE + TF_OFFSET_X] = 372.0;
      ecs.transforms[soldier * TRANSFORM_STRIDE + TF_OFFSET_Y] = 300.0;

      // 士气崩溃至 0 点
      moraleSys.setMorale(soldier, 0.0);
      moraleSys.update(0.1);

      // 断言: 触发破釜沉舟，士气锁死在 1 点，置位 IS_LAST_STAND
      expect(hasStatus(ecs.statusFlags, soldier, IS_LAST_STAND)).toBe(true);
      expect(ecs.morale[soldier * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBe(1.0);
    });
  });
});
