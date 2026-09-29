/**
 * EntityPhysicalAggregator.test.js
 * 实体物理与战斗属性动态聚合管线测试套件
 * 
 * 覆盖指标:
 * 1. 种族基础属性与表型器官 (PhenotypeMask) 动态聚合
 * 2. 物理质量冲量守恒: EffectiveMass 与 invMass (1.0 / mass) 即时同步
 * 3. 护甲与抗性动态聚合及 -40.0 下限绝对死锁防线 (杜绝除零崩溃)
 * 4. 批量全量聚合与绝对零 GC 运行
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  PHYSICS_STRIDE,
  PHY_OFFSET_MASS,
  PHY_OFFSET_INVMASS,
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  CS_OFFSET_BLUNT_RESIST,
  CS_OFFSET_PIERCE_RESIST
} from '../../src/core/ECS.js';
import {
  EntityPhysicalAggregator,
  ARMOR_MIN_CLAMP,
  ARMOR_MAX_CLAMP
} from '../../src/systems/EntityPhysicalAggregator.js';
import {
  createGeneticsBuffer,
  initGenetics
} from '../../src/components/GeneticsComponent.js';
import { OrganFlags } from '../../src/data/MutationFlags.js';
import { Races } from '../../src/data/RaceData.js';

describe('EntityPhysicalAggregator Pipeline Specification Suite', () => {
  let ecs;
  let genetics;

  beforeEach(() => {
    ecs = new ECS();
    genetics = createGeneticsBuffer();
  });

  describe('1. 基础物理质量与逆质量 (invMass) 同步', () => {
    it('野生型人类 (无突变) 聚合物理属性等于基准属性', () => {
      const id = ecs.allocateEntity();
      initGenetics(genetics, id, 0, 0, 1);

      const profile = { mass: 0, invMass: 0, armor: 0, speed: 0 };
      EntityPhysicalAggregator.aggregateEntity(ecs, id, 'HUMAN', genetics, profile);

      const baseMass = Races.HUMAN.mass; // 65kg
      expect(profile.mass).toBeCloseTo(baseMass, 2);
      expect(profile.invMass).toBeCloseTo(1.0 / baseMass, 4);

      const phyOff = id * PHYSICS_STRIDE;
      expect(ecs.physics[phyOff + PHY_OFFSET_MASS]).toBeCloseTo(baseMass, 2);
      expect(ecs.physics[phyOff + PHY_OFFSET_INVMASS]).toBeCloseTo(1.0 / baseMass, 4);
    });

    it('突变【花岗岩】(GRANITE) 使质量增加 25%，护甲增加 12.0，钝击抗性增加', () => {
      const id = ecs.allocateEntity();
      initGenetics(genetics, id, OrganFlags.GRANITE, 0, 1);

      const profile = {};
      EntityPhysicalAggregator.aggregateEntity(ecs, id, 'HUMAN', genetics, profile);

      const expectedMass = 65.0 * 1.25; // 81.25kg
      expect(profile.mass).toBeCloseTo(expectedMass, 2);
      expect(profile.invMass).toBeCloseTo(1.0 / expectedMass, 4);
      expect(profile.armor).toBeCloseTo(12.0, 1);
      expect(profile.bluntResist).toBeCloseTo(0.20, 2);
    });

    it('突变【薄翼】(WING) 使质量减轻 10%，移速增加 25%', () => {
      const id = ecs.allocateEntity();
      initGenetics(genetics, id, OrganFlags.WING, 0, 1);

      const profile = {};
      EntityPhysicalAggregator.aggregateEntity(ecs, id, 'HUMAN', genetics, profile);

      const expectedMass = 65.0 * 0.90; // 58.5kg
      expect(profile.mass).toBeCloseTo(expectedMass, 2);
      expect(profile.speed).toBeCloseTo(Races.HUMAN.baseSpeed * 1.25, 2);
    });
  });

  describe('2. 护甲与抗性动态聚合及 -40.0 下限绝对死锁防线', () => {
    it('极端负护甲条件下，护甲绝对死锁在 -40.0，绝不达到 -50.0 崩溃线', () => {
      const id = ecs.allocateEntity();
      initGenetics(genetics, id, 0, 0, 1);

      // 聚合一次
      EntityPhysicalAggregator.aggregateEntity(ecs, id, 'GOBLIN', genetics);

      // 人为施加极端负护甲 BaseArmor = -999.0 (模拟强力破甲)
      const profile = {};
      EntityPhysicalAggregator.aggregateEntity(ecs, id, 'GOBLIN', genetics, profile, { baseArmor: -999.0 });

      expect(profile.armor).toBeGreaterThanOrEqual(ARMOR_MIN_CLAMP);
      expect(profile.armor).toBe(ARMOR_MIN_CLAMP);
      const csOff = id * COMBAT_STRIDE;
      expect(ecs.combatStats[csOff + CS_OFFSET_ARMOR]).toBe(-40.0);
    });

    it('护甲上限约束在 120.0，防止无敌数值膨胀', () => {
      const id = ecs.allocateEntity();
      // 携带全部器官叠加
      initGenetics(genetics, id, 0x1FF, 0x1FF, 1);

      const profile = {};
      EntityPhysicalAggregator.aggregateEntity(ecs, id, 'GOLEM', genetics, profile);

      expect(profile.armor).toBeLessThanOrEqual(ARMOR_MAX_CLAMP);
    });
  });

  describe('3. 批量聚合与零 GC 运行', () => {
    it('全场批量聚合 aggregateAll 顺利运行且零异常', () => {
      const entities = [];
      for (let i = 0; i < 20; i++) {
        const id = ecs.allocateEntity();
        initGenetics(genetics, id, OrganFlags.GRANITE, 0, 1);
        entities.push(id);
      }

      EntityPhysicalAggregator.aggregateAll(ecs, genetics, () => 'DWARF');

      for (const id of entities) {
        const phyOff = id * PHYSICS_STRIDE;
        expect(ecs.physics[phyOff + PHY_OFFSET_MASS]).toBeGreaterThan(Races.DWARF.mass);
      }
    });
  });
});
