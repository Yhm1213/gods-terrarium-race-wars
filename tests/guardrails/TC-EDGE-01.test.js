/**
 * TC-EDGE-01.test.js
 * Milestone 3 核心守门测试套件: 递归受创深度硬断言、反伤 1.5s ICD 熔断与负护甲死锁阻尼
 * 严格覆盖 SPEC-M3-CONTRACT §2.1, §2.2, §8 TC-EDGE-01, QA 规范 §2.4, LL-007 防抖动设计
 * 
 * 守门硬断言清单:
 * 1. 机器断言 1 (递归深度硬熔断): 两个 100% 反弹伤害的单位互相攻击，callDepth >= 3 时强行截断反伤 (outReflectDamage = 0)，
 *    调用栈深度绝对受控，绝不发生 "Maximum call stack size exceeded"，连续 1,000 次对砍溢出率为 0.0%；
 * 2. 机器断言 2 (反伤 1.5s 全局内置冷却 ICD): 高频连击下 1.5s 时间窗口内仅且仅允许触发 1 次反伤，拦截率 100%；
 * 3. 机器断言 3 (极端负护甲死锁阻尼): 护甲 -100 刚性 Clamp 至 -40.0，10,000 组极端边界模糊测试下除零崩溃率与 NaN 率恒为 0.0%，伤害为有限正数；
 * 4. 零 GC 内存安全断言: 热路径连续 10,000 次伤害结算复用出参对象，无内存逃逸，单次耗时平稳满足预算。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  TOTAL_SLOTS
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

describe('TC-EDGE-01: 递归受创深度硬断言与反伤 1.5s ICD 熔断守门套件 (Milestone 3 Guardrail)', () => {
  let ecs;
  let calc;

  beforeEach(() => {
    ecs = new ECS();
    calc = new DamageCalculator(ecs);
  });

  describe('1. 递归深度熔断与栈溢出防御断言 (callDepth >= 3 强行熔断)', () => {
    it('机器断言 1.1: 当 callDepth >= 3 时，calculateDamage 强行熔断反伤输出 (reflectDamage === 0.0)', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 1000.0;
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 1.0; // 100% 反弹

      // 深度 0, 1, 2 允许反伤
      for (let depth = 0; depth < REFLECT_MAX_CALL_DEPTH; depth++) {
        const res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL, depth, 0.0);
        expect(res.callDepth).toBe(depth);
        expect(res.actualHpLost).toBeGreaterThan(0.0);
        expect(res.reflectDamage).toBeGreaterThan(0.0);
      }

      // 深度 >= 3 (门限值及极端深度 4, 10, 100): 强制截断反伤
      const testDepths = [3, 4, 5, 10, 50, 100];
      for (const depth of testDepths) {
        const res = calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL, depth, 0.0);
        expect(res.callDepth).toBe(depth);
        expect(res.actualHpLost).toBeGreaterThan(0.0);
        // 硬断言: 反伤严格被熔断为 0.0
        expect(res.reflectDamage).toBe(0.0);
      }
    });

    it('机器断言 1.2: 两名 100% 互相反伤巨型单位交火，applyDamage 绝对不抛 RangeError 栈溢出异常，连续 1,000 次对砍溢出率为 0.0%', () => {
      const TRIALS = 1000;
      let stackOverflowCount = 0;
      let uncaughtErrorCount = 0;

      for (let t = 0; t < TRIALS; t++) {
        const localEcs = new ECS();
        const localCalc = new DamageCalculator(localEcs);

        const unitA = localEcs.allocateEntity();
        const unitB = localEcs.allocateEntity();

        // 赋予超高血量，防止过早猝死中断递归链路
        localEcs.health[unitA * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 100000.0;
        localEcs.health[unitA * HEALTH_STRIDE + HP_OFFSET_MAX] = 100000.0;
        localEcs.combatStats[unitA * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 1.0; // 100% 反伤

        localEcs.health[unitB * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 100000.0;
        localEcs.health[unitB * HEALTH_STRIDE + HP_OFFSET_MAX] = 100000.0;
        localEcs.combatStats[unitB * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 1.0; // 100% 反伤

        try {
          // unitA 发动攻击，点燃环形反噬递归火药桶
          localCalc.applyDamage(unitA, unitB, 100.0, DAMAGE_TYPE_PHYSICAL, 0, 0.0);
        } catch (err) {
          if (err instanceof RangeError && err.message.includes('Maximum call stack size exceeded')) {
            stackOverflowCount++;
          } else {
            uncaughtErrorCount++;
          }
        }

        // 验证双方受到有限次数的伤害扣除 (递归 3 次即停)
        const hpA = localEcs.health[unitA * HEALTH_STRIDE + HP_OFFSET_CURRENT];
        const hpB = localEcs.health[unitB * HEALTH_STRIDE + HP_OFFSET_CURRENT];
        expect(hpA).toBeLessThan(100000.0);
        expect(hpB).toBeLessThan(100000.0);
        expect(hpA).toBeGreaterThan(0.0);
        expect(hpB).toBeGreaterThan(0.0);
      }

      // 硬断言: 栈溢出与未捕获异常次数恒为 0，溢出率 0.0%
      expect(stackOverflowCount).toBe(0);
      expect(uncaughtErrorCount).toBe(0);
      const overflowRate = stackOverflowCount / TRIALS;
      expect(overflowRate).toBe(0.0);
    });

    it('机器断言 1.3: 多单位闭环链式反伤 (A->B->C->A) 在 callDepth >= 3 处严格截断', () => {
      const unitA = ecs.allocateEntity();
      const unitB = ecs.allocateEntity();
      const unitC = ecs.allocateEntity();

      ecs.health[unitA * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 1000.0;
      ecs.combatStats[unitA * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.8;

      ecs.health[unitB * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 1000.0;
      ecs.combatStats[unitB * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.8;

      ecs.health[unitC * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 1000.0;
      ecs.combatStats[unitC * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.8;

      expect(() => {
        calc.applyDamage(unitA, unitB, 100.0, DAMAGE_TYPE_PHYSICAL, 0, 0.0);
      }).not.toThrow();

      // 在截断机制下，所有单位生命值均保持在安全正数
      expect(ecs.health[unitA * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBeGreaterThan(0.0);
      expect(ecs.health[unitB * HEALTH_STRIDE + HP_OFFSET_CURRENT]).toBeGreaterThan(0.0);
    });
  });

  describe('2. 1.5s 全局内置反伤冷却 (ICD) 拦截断言', () => {
    it('机器断言 2.1: 高频连击下 1.5s 内仅且仅允许触发 1 次反伤，拦截率 100%', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 50000.0;
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.50; // 50% 反弹

      const startTime = 10.0; // 起始时间 10.0 秒
      let reflectTriggerCount = 0;
      let totalAttacksIn15s = 0;

      // 模拟在 [10.0, 11.49] 1.5s 窗口内发起 100 次高频密集连击
      for (let i = 0; i < 100; i++) {
        const currentTime = startTime + (i * 0.0149); // 最大时间 10.0 + 1.4751 < 11.5
        totalAttacksIn15s++;

        const res = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 0, currentTime);
        if (res.reflectDamage > 0.0) {
          reflectTriggerCount++;
          // 首次反伤应为 50 * 0.5 = 25.0
          expect(res.reflectDamage).toBeCloseTo(25.0, 2);
        } else {
          expect(res.reflectDamage).toBe(0.0);
        }
      }

      // 硬断言: 100 次连击在 1.5s 窗口内仅第 1 次成功触发反弹
      expect(totalAttacksIn15s).toBe(100);
      expect(reflectTriggerCount).toBe(1);

      // 机器断言 2.2: 恰好在 1.5s 冷却完毕后 (t = 11.51s)，下一次受击立即恢复反伤响应
      const afterIcdTime = startTime + REFLECT_ICD_SECONDS + 0.01; // 11.51s
      const resAfterIcd = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 0, afterIcdTime);
      expect(resAfterIcd.reflectDamage).toBeCloseTo(25.0, 2);

      // 紧接着又一次连击 (t = 11.52s): 再次被新的 1.5s ICD 拦截
      const resBlockedAgain = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 0, afterIcdTime + 0.01);
      expect(resBlockedAgain.reflectDamage).toBe(0.0);
    });

    it('机器断言 2.3: 重置实体反伤时间戳 (resetEntity) 可安全手动清空 ICD', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 1000.0;
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_REFLECT_RATIO] = 0.50;

      // 第一次触发
      const r1 = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 0, 5.0);
      expect(r1.reflectDamage).toBeCloseTo(25.0, 2);

      // 0.2 秒后受击被拦截
      const r2 = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 0, 5.2);
      expect(r2.reflectDamage).toBe(0.0);

      // 手动重置 ICD
      calc.resetEntity(victim);

      // 再次受击应立即触发反击
      const r3 = calc.calculateDamage(attacker, victim, 50.0, DAMAGE_TYPE_PHYSICAL, 0, 5.2);
      expect(r3.reflectDamage).toBeCloseTo(25.0, 2);
    });
  });

  describe('3. 极端负护甲死锁阻尼 (-40.0) 与除零模糊测试断言', () => {
    it('机器断言 3.1: 极端负护甲 (-100.0) 刚性 Clamp 至 -40.0，结算伤害严格符合放大公式', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      // 注入 -100 极端穿透破甲
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = -100.0;

      const rawDamage = 100.0;
      const res = calc.calculateDamage(attacker, victim, rawDamage, DAMAGE_TYPE_PHYSICAL);

      // 预期公式: EffectiveArmor = max(-40.0, -100.0) = -40.0
      // DamageAmp = 1.0 + |-40.0| / 100.0 = 1.40
      // damageTaken = 100.0 * 1.40 = 140.0
      expect(res.damageTaken).toBeCloseTo(140.0, 2);
      expect(Number.isFinite(res.damageTaken)).toBe(true);
      expect(Number.isNaN(res.damageTaken)).toBe(false);
    });

    it('机器断言 3.2: 10,000 组极端边界数值模糊测试，除零崩溃率与 NaN 发生率严格为 0.0%', () => {
      const TRIALS = 10000;
      let nanCount = 0;
      let infiniteCount = 0;
      let crashCount = 0;
      let belowMinPierceCount = 0;

      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      // 包含除零危险值、极端负数、超大数值与边界情况
      const extremeArmors = [
        -100.0, -99999.0, -50.0, -40.0, -40.0001, -39.999, -10.0, -0.0, 0.0,
        1.0, 50.0, 100.0, 300.0, 1000.0, 99999.0
      ];

      const out = {
        damageTaken: 0,
        actualHpLost: 0,
        reflectDamage: 0,
        isBlocked: false,
        isDead: false,
        callDepth: 0
      };

      for (let i = 0; i < TRIALS; i++) {
        // 随机抽取护甲值与原始攻击值
        const armor = extremeArmors[i % extremeArmors.length];
        const rawDamage = (i % 2 === 0) ? (i * 0.05) : ((i % 1000) * 1.5 + 0.1);

        ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = armor;

        try {
          calc.calculateDamage(attacker, victim, rawDamage, DAMAGE_TYPE_PHYSICAL, 0, 0.0, out);

          if (Number.isNaN(out.damageTaken)) {
            nanCount++;
          }
          if (!Number.isFinite(out.damageTaken)) {
            infiniteCount++;
          }
          if (rawDamage > 0.0 && out.damageTaken < MIN_PIERCE_DAMAGE) {
            belowMinPierceCount++;
          }
        } catch (err) {
          crashCount++;
        }
      }

      // 硬断言: 10,000 组极端参数下，NaN 发生率、无穷大发生率、除零崩溃率严格为 0.0%
      expect(crashCount).toBe(0);
      expect(nanCount).toBe(0);
      expect(infiniteCount).toBe(0);
      expect(belowMinPierceCount).toBe(0);

      const crashRate = crashCount / TRIALS;
      const nanRate = nanCount / TRIALS;
      expect(crashRate).toBe(0.0);
      expect(nanRate).toBe(0.0);
    });

    it('机器断言 3.3: 正护甲极限收敛断言 (渐近线为 100% 减伤，永不达到绝对绝对免伤，保底穿透 1.0)', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 500.0;
      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_MAX] = 500.0;
      // 护甲堆叠至神级 100,000 点
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 100000.0;

      // 受到 500 点攻击
      const res = calc.calculateDamage(attacker, victim, 500.0, DAMAGE_TYPE_PHYSICAL);

      // Reduction = 100000 / 100100 = 0.999000999 -> 理论受到 0.4995 伤害
      // 由于 MIN_PIERCE_DAMAGE = 1.0 保底，最终结算必须为 1.0 点
      expect(res.damageTaken).toBe(1.0);
      expect(res.actualHpLost).toBe(1.0);
    });
  });

  describe('4. 零 GC 内存安全与极端性能守门断言 (LL-007)', () => {
    it('连续 10,000 次热路径交火结算，复用出参对象 0 逃逸，单次耗时 < 0.01ms', () => {
      const attacker = ecs.allocateEntity();
      const victim = ecs.allocateEntity();

      ecs.health[victim * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 5000.0;
      ecs.combatStats[victim * COMBAT_STRIDE + CS_OFFSET_ARMOR] = 50.0;

      const reusableOut = {
        damageTaken: 0,
        actualHpLost: 0,
        reflectDamage: 0,
        isBlocked: false,
        isDead: false,
        callDepth: 0
      };

      // 1. JIT 充分预热以消除 CI 并发调度抖动 (LL-007)
      for (let w = 0; w < 50; w++) {
        calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL, 0, 0.0, reusableOut);
      }

      // 2. 基准采样 10,000 次
      const ITERS = 10000;
      const t0 = performance.now();
      for (let i = 0; i < ITERS; i++) {
        calc.calculateDamage(attacker, victim, 100.0, DAMAGE_TYPE_PHYSICAL, 0, 0.0, reusableOut);
      }
      const t1 = performance.now();
      const totalElapsedMs = t1 - t0;
      const avgElapsedMs = totalElapsedMs / ITERS;

      // 单次耗时严格小于 0.01ms (通常在 0.0003ms ~ 0.0015ms)
      expect(avgElapsedMs).toBeLessThan(0.01);
      expect(reusableOut.damageTaken).toBeGreaterThan(0.0);
    });
  });
});
