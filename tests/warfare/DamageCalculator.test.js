/**
 * DamageCalculator.test.js
 * 边际递减护甲与反伤递归熔断规范测试套件 (WP-3.2)
 * 验证 SPEC-M3-CONTRACT §2.1 & §2.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX
} from '../../src/core/ECS.js';
import {
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  CS_OFFSET_BLUNT_RESIST,
  CS_OFFSET_PIERCE_RESIST,
  CS_OFFSET_REFLECT_RATIO,
  initCombatStats
} from '../../src/components/CombatStatsComponent.js';
import {
  IS_ALIVE,
  IS_SACRED_BODY,
  setStatus,
  clearStatus,
  hasStatus
} from '../../src/components/UnitStatusFlags.js';
import {
  DamageCalculator,
  DAMAGE_TYPE_PHYSICAL,
  DAMAGE_TYPE_BLUNT,
  DAMAGE_TYPE_PIERCE,
  DAMAGE_TYPE_TRUE,
  ARMOR_MIN_CLAMP,
  REFLECT_MAX_CALL_DEPTH,
  REFLECT_ICD_SECONDS,
  MIN_PIERCE_DAMAGE
} from '../../src/warfare/DamageCalculator.js';

describe('DamageCalculator Specification Suite (WP-3.2)', () => {
  let ecs;
  let calc;

  beforeEach(() => {
    ecs = new ECS();
    calc = new DamageCalculator(ecs);
  });

  describe('1. 边际递减护甲减伤公式与保底穿透', () => {
    it('正护甲非线性渐近收敛: 护甲 50/100/300 减伤分别为 33.3%/50%/75%', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      // 护甲 0
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 0.0;
      let res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL);
      expect(res.damageTaken).toBeCloseTo(100.0, 2);

      // 护甲 50: 减伤 50 / (50 + 100) = 33.333% -> 受到 66.67 伤害
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 50.0;
      res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL);
      expect(res.damageTaken).toBeCloseTo(66.67, 1);

      // 护甲 100: 减伤 100 / (100 + 100) = 50.0% -> 受到 50.0 伤害
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 100.0;
      res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL);
      expect(res.damageTaken).toBeCloseTo(50.0, 2);

      // 极限高防 300: 减伤 300 / (300 + 100) = 75.0% -> 受到 25.0 伤害
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 300.0;
      res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL);
      expect(res.damageTaken).toBeCloseTo(25.0, 2);
    });

    it('保底穿透伤害: 任何微小攻击保底至少造成 1.0 点伤害', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 300.0;
      const res = calc.calculateDamage(attacker, victim, 0.5, DAMAGE_TYPE_PHYSICAL);
      expect(res.damageTaken).toBe(1.0);
    });
  });

  describe('2. 负护甲死锁阻尼 (-40.0) 与除零防御', () => {
    it('负护甲伤害线性放大: -20 护甲放大 20%', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = -20.0;
      const res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL);
      expect(res.damageTaken).toBeCloseTo(120.0, 2);
    });

    it('极端破甲死锁下限 -40.0: -100 护甲严格钳位至 -40.0，消除除零与 NaN 崩溃', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = -100.0;
      const res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL);
      // 放大 1.40 倍 -> 140.0 伤害
      expect(res.damageTaken).toBeCloseTo(140.0, 2);
      expect(Number.isNaN(res.damageTaken)).toBe(false);
      expect(Number.isFinite(res.damageTaken)).toBe(true);
    });
  });

  describe('3. 抗性与真实伤害无视护甲', () => {
    it('钝击与穿刺抗性正确修正最终伤害', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      // 护甲 100 (减半)，钝击抗性 40% (再乘 0.6)
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 100.0;
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_BLUNT_RESIST] = 0.40;

      const res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_BLUNT);
      expect(res.damageTaken).toBeCloseTo(30.0, 2);
    });

    it('真实伤害完全无视护甲与抗性', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 300.0;
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_BLUNT_RESIST] = 0.60;

      const res = calc.calculateDamage(attacker, victim, 80.0, DAMAGE_TYPE_TRUE);
      expect(res.damageTaken).toBeCloseTo(80.0, 2);
    });

    it('IS_SACRED_BODY 金身霸体完全免疫任何伤害', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      setStatus(ecs.statusFlags, victim, IS_SACRED_BODY);
      const res = calc.calculateDamage(attacker, victim, 500.0, DAMAGE_TYPE_TRUE);
      expect(res.damageTaken).toBe(0.0);
      expect(res.isBlocked).toBe(true);
    });
  });

  describe('4. 税后真实反伤与递归深度熔断 (TC-EDGE-01)', () => {
    it('税后真实反伤: 反伤严格基于受害者实际扣除的 HP，而非原始税前伤害', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      // 受害者仅剩 20 点血，反伤系数 30%
      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 20.0;
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.30;

      // 受到 100 点原始伤害 (护甲 0)
      const res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL);
      expect(res.actualHpLost).toBe(20.0);
      // 税后反伤: 20 * 0.3 = 6.0，绝非 100 * 0.3 = 30.0
      expect(res.reflectDamage).toBeCloseTo(6.0, 2);
    });

    it('递归深度熔断 (TC-EDGE-01): callDepth >= 3 时强制熔断反伤输出，杜绝栈溢出', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 200.0;
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.50;

      const resDepth2 = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 2);
      expect(resDepth2.reflectDamage).toBeGreaterThan(0.0);

      const resDepth3 = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 3);
      expect(resDepth3.reflectDamage).toBe(0.0);
    });

    it('互持反伤单位对战: applyDamage 能够递归反击并在 3 层平稳熔断', () => {
      const unitA = ecs.allocateEntity();
      const unitB = ecs.allocateEntity();

      ecs.health[unitA * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 500.0;
      ecs.health[unitA * HEALTH_STRIDE + HP_OFFSET_MAX] = 500.0;
      ecs.combatStats[unitA * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.50;

      ecs.health[unitB * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 500.0;
      ecs.health[unitB * HEALTH_STRIDE + HP_OFFSET_MAX] = 500.0;
      ecs.combatStats[unitB * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.50;

      // 执行伤害交火，若没有 callDepth 熔断，这里会导致 RangeError: Maximum call stack size exceeded
      expect(() => {
        calc.applyDamage(unitA, unitB, 100.0, DAMAGE_TYPE_PHYSICAL, 0, 0.0);
      }).not.toThrow();

      // B 受到 100 伤害
      expect(ecs.health[unitB * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBeLessThan(500.0);
      // A 受到 B 的反伤
      expect(ecs.health[unitA * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBeLessThan(500.0);
    });
  });

  describe('5. 反伤 1.5s 全局内置冷却 (ICD)', () => {
    it('1.5s 冷却期内受击不再响应反伤判定', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 200.0;
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.40;

      // 时钟 10.0s: 触发首次反伤
      const res1 = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 0, 10.0);
      expect(res1.reflectDamage).toBeCloseTo(20.0, 2);

      // 时钟 10.5s (相隔 0.5s < 1.5s): 处于 ICD 冷却，反伤为 0
      const res2 = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 0, 10.5);
      expect(res2.reflectDamage).toBe(0.0);

      // 时钟 11.6s (相隔 1.6s >= 1.5s): ICD 冷却完毕，再次触发反伤
      const res3 = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 0, 11.6);
      expect(res3.reflectDamage).toBeCloseTo(20.0, 2);
    });
  });
});
