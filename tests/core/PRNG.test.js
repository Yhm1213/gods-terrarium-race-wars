/**
 * PRNG.test.js
 * Mulberry32 确定性伪随机数发生器单元测试套件
 * 严格对应 TDS v1.1 与 QA 规范 Milestone 0 验收标准
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PRNG } from '../../src/core/PRNG.js';

describe('PRNG (Mulberry32) Deterministic Generator Suite', () => {
  let prng;

  beforeEach(() => {
    prng = new PRNG(1337);
  });

  describe('1. 序列确定性与 100% 幂等可重现断言', () => {
    it('相同种子实例化的发生器生成 10,000 长度序列 100% 完全全等', () => {
      const seed = 0xDEADBEEF;
      const genA = new PRNG(seed);
      const genB = new PRNG(seed);

      const count = 10000;
      for (let i = 0; i < count; i++) {
        const valA = genA.next();
        const valB = genB.next();
        expect(valA).toBe(valB);
      }
    });

    it('nextFloat 在相同种子下同样具备 100% 确定性', () => {
      const seed = 42;
      const genA = new PRNG(seed);
      const genB = new PRNG(seed);

      for (let i = 0; i < 5000; i++) {
        expect(genA.nextFloat()).toBe(genB.nextFloat());
      }
    });

    it('重置相同种子 (setSeed) 后能 100% 精确复现初始随机序列 (支持回放)', () => {
      const seed = 88888;
      const gen = new PRNG(seed);

      const firstPass = [];
      for (let i = 0; i < 1000; i++) {
        firstPass.push(gen.next());
      }

      // 重设种子
      gen.setSeed(seed);

      for (let i = 0; i < 1000; i++) {
        expect(gen.next()).toBe(firstPass[i]);
      }
    });

    it('不同种子生成互不相同的随机序列', () => {
      const genA = new PRNG(12345);
      const genB = new PRNG(54321);

      let differences = 0;
      for (let i = 0; i < 100; i++) {
        if (genA.next() !== genB.next()) {
          differences++;
        }
      }
      expect(differences).toBeGreaterThan(90);
    });
  });

  describe('2. nextFloat [0, 1) 分布与数学统计特性', () => {
    it('所有生成值严格落在 [0.0, 1.0) 半开区间，且绝不等于 1.0', () => {
      const samples = 20000;
      for (let i = 0; i < samples; i++) {
        const r = prng.nextFloat();
        expect(Number.isFinite(r)).toBe(true);
        expect(r).toBeGreaterThanOrEqual(0.0);
        expect(r).toBeLessThan(1.0);
      }
    });

    it('数学期望均值测试：50,000 样本均值收敛于 0.5 左右 (误差 < 0.005)', () => {
      const samples = 50000;
      let sum = 0;
      for (let i = 0; i < samples; i++) {
        sum += prng.nextFloat();
      }
      const mean = sum / samples;
      expect(mean).toBeGreaterThan(0.495);
      expect(mean).toBeLessThan(0.505);
    });

    it('10 桶均匀分布直方图检验：各桶频数平衡，无严重偏倚', () => {
      const bucketCount = 10;
      const buckets = new Int32Array(bucketCount);
      const samples = 50000;

      for (let i = 0; i < samples; i++) {
        const r = prng.nextFloat();
        const b = Math.min(bucketCount - 1, Math.floor(r * bucketCount));
        buckets[b]++;
      }

      // 理想每个桶 5000 样本，允许 +/- 500 统计波动
      for (let b = 0; b < bucketCount; b++) {
        expect(buckets[b]).toBeGreaterThan(4500);
        expect(buckets[b]).toBeLessThan(5500);
      }
    });
  });

  describe('3. nextInt(min, max) 闭区间与边界守门断言', () => {
    it('生成值严格为闭区间整数，上下界均能被命中', () => {
      const min = 1;
      const max = 6; // 掷骰子模拟
      const hits = new Set();
      const samples = 10000;

      for (let i = 0; i < samples; i++) {
        const val = prng.nextInt(min, max);
        expect(Number.isInteger(val)).toBe(true);
        expect(val).toBeGreaterThanOrEqual(min);
        expect(val).toBeLessThanOrEqual(max);
        hits.add(val);
      }

      // 1 ~ 6 必须每个数字都至少命中一次
      expect(hits.size).toBe(6);
      for (let v = min; v <= max; v++) {
        expect(hits.has(v)).toBe(true);
      }
    });

    it('单点区间 nextInt(N, N) 恒等于 N', () => {
      for (let i = 0; i < 100; i++) {
        expect(prng.nextInt(42, 42)).toBe(42);
        expect(prng.nextInt(0, 0)).toBe(0);
        expect(prng.nextInt(-10, -10)).toBe(-10);
      }
    });

    it('支持跨零负数区间与大跨度区间', () => {
      const samples = 5000;
      for (let i = 0; i < samples; i++) {
        const negativeVal = prng.nextInt(-100, -50);
        expect(negativeVal).toBeGreaterThanOrEqual(-100);
        expect(negativeVal).toBeLessThanOrEqual(-50);

        const crossZeroVal = prng.nextInt(-20, 20);
        expect(crossZeroVal).toBeGreaterThanOrEqual(-20);
        expect(crossZeroVal).toBeLessThanOrEqual(20);
      }
    });

    it('倒置参数 (min > max) 自动纠偏为有效区间 [min, max]', () => {
      for (let i = 0; i < 100; i++) {
        const val = prng.nextInt(10, 5);
        expect(val).toBeGreaterThanOrEqual(5);
        expect(val).toBeLessThanOrEqual(10);
      }
    });
  });

});
