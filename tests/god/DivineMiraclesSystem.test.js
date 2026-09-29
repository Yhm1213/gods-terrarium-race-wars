/**
 * DivineMiraclesSystem.test.js
 * 上帝六大奇迹技能与信仰神恩池系统测试套件 (WP-4.1)
 * 验证 SPEC-M4-CONTRACT §2.1
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
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL
} from '../../src/core/ECS.js';
import {
  IS_SACRED_BODY,
  setStatus
} from '../../src/components/UnitStatusFlags.js';
import { TileGrid, GRID_WIDTH, TILE_SIZE } from '../../src/world/TileGrid.js';
import { Biomes, HazardTypes } from '../../src/data/BiomeData.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { createFactionRuntimeBuffer, FACTION_STRIDE, FAC_OFFSET_WAR_COOLDOWN, MAX_FACTIONS } from '../../src/data/FactionData.js';
import { BorderFrictionSystem } from '../../src/warfare/BorderFrictionSystem.js';
import {
  DivineMiraclesSystem,
  MiracleId,
  MiracleConfig,
  DEFAULT_FERVOR,
  MAX_FERVOR
} from '../../src/god/DivineMiraclesSystem.js';

describe('DivineMiraclesSystem Specification Suite (WP-4.1 §2.1)', () => {
  let ecs;
  let tileGrid;
  let eventBus;
  let factionBuffer;
  let frictionSystem;
  let miracles;

  beforeEach(() => {
    ecs = new ECS();
    tileGrid = new TileGrid();
    eventBus = new DomainEventBus();
    factionBuffer = createFactionRuntimeBuffer();
    frictionSystem = new BorderFrictionSystem(ecs, tileGrid, factionBuffer, eventBus);
    miracles = new DivineMiraclesSystem(ecs, tileGrid, eventBus, factionBuffer, frictionSystem);
  });

  describe('1. 信仰神恩池管理 (Fervor Management)', () => {
    it('初始神恩池应为 30.0，且可在 [0.0, 100.0] 范围内调整', () => {
      expect(miracles.fervor).toBe(DEFAULT_FERVOR);

      miracles.addFervor(50.0);
      expect(miracles.fervor).toBe(80.0);

      miracles.addFervor(50.0);
      expect(miracles.fervor).toBe(MAX_FERVOR); // 上限截断

      miracles.addFervor(-150.0);
      expect(miracles.fervor).toBe(0.0); // 下限截断
    });

    it('神恩不足或冷却未结束时拒绝施法，但在狂欢模式下始终允许', () => {
      // 灭世陨石消耗 90 神恩，初始 30 神恩不足
      expect(miracles.canCast(MiracleId.METEOR_CATACLYSM)).toBe(false);
      expect(miracles.castMiracle(MiracleId.METEOR_CATACLYSM, 100, 100)).toBe(false);

      // 狂欢模式下忽略神恩与冷却
      expect(miracles.canCast(MiracleId.METEOR_CATACLYSM, true)).toBe(true);
    });
  });

  describe('2. 神圣天雷 (HOLY_THUNDER)', () => {
    it('扣除 40 神恩，进入 15s 冷却，在目标 2 格内留下雷坑并造成 200 真伤', () => {
      miracles.addFervor(50.0); // 30 + 50 = 80
      const targetTx = 10;
      const targetTy = 10;
      const worldX = targetTx * TILE_SIZE + 12.0;
      const worldY = targetTy * TILE_SIZE + 12.0;

      // 创建一个目标单位
      const victim = ecs.allocateEntity();
      ecs.transforms[victim * TRANSFORM_STRIDE + TF_OFFSET_X] = worldX;
      ecs.transforms[victim * TRANSFORM_STRIDE + TF_OFFSET_Y] = worldY;
      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_MAX] = 300.0;
      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 300.0;

      // 创建一个金身无敌单位
      const sacredUnit = ecs.allocateEntity();
      ecs.transforms[sacredUnit * TRANSFORM_STRIDE + TF_OFFSET_X] = worldX;
      ecs.transforms[sacredUnit * TRANSFORM_STRIDE + TF_OFFSET_Y] = worldY;
      ecs.health[sacredUnit * HEALTH_STRIDE + HP_OFFSET_MAX] = 300.0;
      ecs.health[sacredUnit * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 300.0;
      setStatus(ecs.statusFlags, sacredUnit, IS_SACRED_BODY);

      let thunderFired = false;
      eventBus.subscribe(DomainEvents.EVT_MIRACLE_THUNDER, (type, loc, dmg) => {
        thunderFired = true;
        expect(dmg).toBe(200);
      });

      const castOk = miracles.castMiracle(MiracleId.HOLY_THUNDER, worldX, worldY);
      eventBus.flush();
      expect(castOk).toBe(true);
      expect(thunderFired).toBe(true);
      expect(miracles.fervor).toBe(80 - 40);
      expect(miracles.cooldowns[MiracleId.HOLY_THUNDER]).toBe(15.0);

      // 受害者扣除 200 血
      expect(ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBe(100.0);
      // 金身单位免受伤害
      expect(ecs.health[sacredUnit * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBe(300.0);

      // 地面留下火焰雷坑
      const tileIdx = targetTy * GRID_WIDTH + targetTx;
      expect(tileGrid.hazardType[tileIdx]).toBe(HazardTypes.FIRE);
      expect(tileGrid.hazardDamage[tileIdx]).toBe(1.0);
    });
  });

  describe('3. 生机甘霖 (DIVINE_RAIN)', () => {
    it('扑灭半径 4 格内的火灾，提升养分，并在持续 8 秒内为范围内实体回血', () => {
      const centerTx = 20;
      const centerTy = 20;
      const centerTile = centerTy * GRID_WIDTH + centerTx;

      // 预先点火
      tileGrid.hazardType[centerTile] = HazardTypes.FIRE;
      tileGrid.hazardDamage[centerTile] = 1.0;
      tileGrid.nutrientFloor[centerTile] = 0.2;

      const injured = ecs.allocateEntity();
      ecs.transforms[injured * TRANSFORM_STRIDE + TF_OFFSET_X] = centerTx * TILE_SIZE + 12.0;
      ecs.transforms[injured * TRANSFORM_STRIDE + TF_OFFSET_Y] = centerTy * TILE_SIZE + 12.0;
      ecs.health[injured * HEALTH_STRIDE + HP_OFFSET_MAX] = 100.0;
      ecs.health[injured * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 50.0;

      const castOk = miracles.castMiracle(MiracleId.DIVINE_RAIN, centerTx * TILE_SIZE, centerTy * TILE_SIZE);
      expect(castOk).toBe(true);
      expect(tileGrid.hazardType[centerTile]).toBe(HazardTypes.NONE);
      expect(tileGrid.nutrientFloor[centerTile]).toBeGreaterThan(0.5);

      // 模拟更新 1 秒，回血 6% (6 点)
      miracles.update(1.0);
      expect(ecs.health[injured * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBeCloseTo(56.0, 1);
    });
  });

  describe('4. 神圣果实 (HOLY_FRUIT)', () => {
    it('范围内最近活体食用后生命回满，体魄质量增大 1.3 倍', () => {
      miracles.addFervor(30.0); // 30 + 30 = 60
      const eater = ecs.allocateEntity();
      ecs.transforms[eater * TRANSFORM_STRIDE + TF_OFFSET_X] = 100;
      ecs.transforms[eater * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100;
      ecs.health[eater * HEALTH_STRIDE + HP_OFFSET_MAX] = 200.0;
      ecs.health[eater * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 40.0;
      ecs.physics[eater * PHYSICS_STRIDE + PHY_OFFSET_MASS] = 10.0;

      const castOk = miracles.castMiracle(MiracleId.HOLY_FRUIT, 105, 105);
      expect(castOk).toBe(true);
      expect(ecs.health[eater * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBe(200.0);
      expect(ecs.physics[eater * PHYSICS_STRIDE + PHY_OFFSET_MASS]).toBeCloseTo(13.0, 1);
    });
  });

  describe('5. 狂暴圣战 (WAR_HORN) 与 神圣休战 (PAX_DIVINA)', () => {
    it('狂暴圣战清除停战冷却，且全员士气拉满', () => {
      miracles.addFervor(50.0);
      factionBuffer[0 * FACTION_STRIDE + FAC_OFFSET_WAR_COOLDOWN] = 15;

      const soldier = ecs.allocateEntity();
      ecs.morale[soldier * MORALE_STRIDE + MORALE_OFFSET_VAL] = 30.0;

      const castOk = miracles.castMiracle(MiracleId.WAR_HORN, 0, 0);
      expect(castOk).toBe(true);
      expect(factionBuffer[0 * FACTION_STRIDE + FAC_OFFSET_WAR_COOLDOWN]).toBe(0);
      expect(ecs.morale[soldier * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBe(100.0);
    });

    it('神圣休战设置所有阵营 20 秒停战锁定，摩擦系统清零摩擦力', () => {
      miracles.addFervor(50.0);
      const castOk = miracles.castMiracle(MiracleId.PAX_DIVINA, 0, 0);
      expect(castOk).toBe(true);
      for (let f = 1; f <= MAX_FACTIONS; f++) {
        expect(factionBuffer[(f - 1) * FACTION_STRIDE + FAC_OFFSET_WAR_COOLDOWN]).toBe(20);
      }
    });
  });

  describe('6. 灭世陨石 (METEOR_CATACLYSM)', () => {
    it('造成 400 点真伤，将地形彻底转变为火山熔岩池', () => {
      miracles.addFervor(70.0); // 30 + 70 = 100
      const tx = 15;
      const ty = 15;
      const targetTile = ty * GRID_WIDTH + tx;

      const victim = ecs.allocateEntity();
      ecs.transforms[victim * TRANSFORM_STRIDE + TF_OFFSET_X] = tx * TILE_SIZE + 12;
      ecs.transforms[victim * TRANSFORM_STRIDE + TF_OFFSET_Y] = ty * TILE_SIZE + 12;
      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_MAX] = 500;
      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 500;

      const castOk = miracles.castMiracle(MiracleId.METEOR_CATACLYSM, tx * TILE_SIZE, ty * TILE_SIZE);
      expect(castOk).toBe(true);
      expect(ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBe(100);
      expect(tileGrid.tileTypes[targetTile]).toBe(Biomes.VOLCANO.id);
      expect(tileGrid.hazardType[targetTile]).toBe(HazardTypes.FIRE);
    });
  });
});
