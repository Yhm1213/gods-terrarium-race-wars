/**
 * TimeScale.test.js
 * 时间控制器与电影级绝杀慢动作规范测试套件 (WP-4.1)
 * 验证 SPEC-M4-CONTRACT §1.2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TimeScale, TimeScaleMode } from '../../src/core/TimeScale.js';

describe('TimeScale Specification Suite (WP-4.1)', () => {
  let timeScale;

  beforeEach(() => {
    timeScale = new TimeScale();
  });

  describe('1. 时间倍率与暂停切换', () => {
    it('正常倍率缩放与暂停恢复状态保持', () => {
      expect(timeScale.isPaused()).toBe(false);
      expect(timeScale.update(0.1)).toBeCloseTo(0.1, 4);

      // 设置 5x 快进
      timeScale.setScale(TimeScaleMode.FAST_5X);
      expect(timeScale.update(0.1)).toBeCloseTo(0.5, 4);

      // 切换暂停
      timeScale.togglePause();
      expect(timeScale.isPaused()).toBe(true);
      expect(timeScale.update(0.1)).toBe(0.0);

      // 再次切换，恢复到暂停前的 5x
      timeScale.togglePause();
      expect(timeScale.isPaused()).toBe(false);
      expect(timeScale.update(0.1)).toBeCloseTo(0.5, 4);
    });
  });

  describe('2. 1.2s 绝杀慢动作定格 (Cinematic Freeze)', () => {
    it('触发绝杀定格后，在 1.2s 期间强制以 0.2x 慢动作推演，结束后自动恢复', () => {
      timeScale.setScale(TimeScaleMode.FAST_2X); // 原本是 2x

      // 触发绝杀慢动作 1.2s
      timeScale.triggerCinematicFreeze(1.2);

      // 推进 0.5s: 处于慢动作中，scaledDt 应当为 0.5 * 0.2 = 0.1
      const dt1 = timeScale.update(0.5);
      expect(dt1).toBeCloseTo(0.1, 4);

      // 推进 0.7s: 刚好耗尽 1.2s 慢动作 (0.7 * 0.2 = 0.14)
      const dt2 = timeScale.update(0.7);
      expect(dt2).toBeCloseTo(0.14, 4);

      // 慢动作结束，下一帧自动恢复至原有的 2x (0.1 * 2 = 0.2)
      const dt3 = timeScale.update(0.1);
      expect(dt3).toBeCloseTo(0.2, 4);
    });
  });
});
