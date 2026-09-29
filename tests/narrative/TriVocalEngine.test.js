/**
 * TriVocalEngine.test.js
 * 三声道人格叙事引擎与高信噪比节流器测试套件 (WP-4.3 §4.1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { ContextSlabPool } from '../../src/narrative/ContextSlabPool.js';
import { TriVocalEngine, AGGREGATION_WINDOW_SECONDS } from '../../src/narrative/TriVocalEngine.js';

describe('TriVocalEngine Specification Suite (WP-4.3 §4.1)', () => {
  let pool;
  let engine;

  beforeEach(() => {
    pool = new ContextSlabPool(32);
    engine = new TriVocalEngine(pool);
  });

  describe('1. 高信噪比降频节流器 (Signal-to-Noise Throttle)', () => {
    it('普通平砍 (无暴击、不断肢、小额伤害) 被自动静默折叠，不消耗 Slab', () => {
      const slab = engine.recordEvent(
        DomainEvents.EVT_DAMAGE_APPLIED,
        1,
        2,
        15, // 仅 15 点普通伤害
        0,
        1.0,
        { isCritical: false, isMutilation: false }
      );

      expect(slab).toBeNull();
      expect(pool.getActiveCount()).toBe(0);
    });

    it('关键暴击或断肢伤害成功放行并生成三声道战报', () => {
      const slabCrit = engine.recordEvent(
        DomainEvents.EVT_DAMAGE_APPLIED,
        1,
        2,
        45,
        0,
        1.2,
        { isCritical: true }
      );

      expect(slabCrit).not.toBeNull();
      expect(slabCrit.textA).toContain('【法医解剖】');
      expect(slabCrit.textB).toContain('【崇高诗人】');
      expect(slabCrit.textC).toContain('【官僚审计】');

      pool.release(slabCrit);
    });
  });

  describe('2. 重磅事件立即发布与三声道文本质量', () => {
    it('君主驾崩 (EVT_RULER_DIED) 立即触发派发，文案包含解剖反射、虚无王权与户籍税收', () => {
      let emittedSlab = null;
      engine.onNarrativeReady((slab) => {
        emittedSlab = slab;
      });

      const slab = engine.recordEvent(
        DomainEvents.EVT_RULER_DIED,
        1,
        10, // 老王 ID
        1,
        0,
        10.0
      );

      expect(emittedSlab).not.toBeNull();
      expect(emittedSlab.textA).toContain('心主动脉破裂');
      expect(emittedSlab.textB).toContain('冠冕坠入血污');
      expect(emittedSlab.textC).toContain('注销 #10 君主户籍');

      pool.release(slab);
    });

    it('突变诞生 (EVT_ORGAN_MUTATED) 生成体态异端增值税审计与外骨骼解剖词条', () => {
      let emittedSlab = null;
      engine.onNarrativeReady((slab) => {
        emittedSlab = slab;
      });

      const slab = engine.recordEvent(
        DomainEvents.EVT_ORGAN_MUTATED,
        5,
        0,
        1,
        0,
        12.0
      );

      // 非立即事件，等待 2.0s 聚合窗口
      expect(emittedSlab).toBeNull();

      engine.update(AGGREGATION_WINDOW_SECONDS);
      expect(emittedSlab).not.toBeNull();
      expect(emittedSlab.textA).toContain('外骨骼');
      expect(emittedSlab.textC).toContain('异常体态增值税');

      pool.release(slab);
    });
  });

  describe('3. 2.0s 聚合队列窗口机制', () => {
    it('连续次级关键事件排入聚合队列，并在 update(2.0s) 后统一冲刷派发', () => {
      const received = [];
      engine.onNarrativeReady((slab) => {
        received.push(slab);
      });

      engine.recordEvent(DomainEvents.EVT_ENTITY_SLAIN, 10, 20, 0, 0, 1.0);
      engine.recordEvent(DomainEvents.EVT_ENTITY_SLAIN, 10, 21, 0, 0, 1.5);

      expect(received.length).toBe(0);

      // 仅推进 1.0 秒，未达 2.0s 阈值
      engine.update(1.0);
      expect(received.length).toBe(0);

      // 再次推进 1.0 秒，达到 2.0s 聚合窗口触发
      engine.update(1.0);
      expect(received.length).toBe(2);

      for (const s of received) {
        pool.release(s);
      }
    });
  });
});
