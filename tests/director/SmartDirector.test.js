/**
 * SmartDirector.test.js
 * 智能导播画中画系统单元测试套件
 * 严格遵照 SPEC-M4-CONTRACT §3 与 QA 规范
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SmartDirector,
  PIP_WIDTH,
  PIP_HEIGHT,
  SCAN_INTERVAL_SEC,
  AUTO_FADE_SECONDS,
  CRUISE_SPEED,
  HighlightEventType
} from '../../src/director/SmartDirector.js';

import {
  ECS,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../../src/core/ECS.js';

import {
  IS_ALIVE,
  IS_LEADER,
  IN_COMBAT,
  setStatus
} from '../../src/components/UnitStatusFlags.js';

import { Camera2D } from '../../src/camera/Camera2D.js';

describe('SmartDirector 智能导播画中画系统规范套件', () => {
  let director;
  let ecs;
  let camera;

  beforeEach(() => {
    director = new SmartDirector();
    ecs = new ECS();
    camera = new Camera2D(800, 600, 2000, 2000);
    camera.x = 0;
    camera.y = 0;
    camera.zoom = 1.0;
  });

  describe('1. 画中画尺寸规格与时间常数断言', () => {
    it('特写视口严格对齐 160x120 像素', () => {
      expect(PIP_WIDTH).toBe(160);
      expect(PIP_HEIGHT).toBe(120);
      expect(director.canvas.width).toBe(160);
      expect(director.canvas.height).toBe(120);
      expect(SCAN_INTERVAL_SEC).toBe(1.0);
      expect(AUTO_FADE_SECONDS).toBe(10.0);
      expect(CRUISE_SPEED).toBe(1200.0);
    });
  });

  describe('2. 视口外部判定断言 (isOutOfView)', () => {
    it('精确识别目标坐标是在当前视口内还是视口外', () => {
      camera.x = 100;
      camera.y = 100;
      camera.setViewportSize(400, 300);
      camera.zoom = 1.0;
      // 可见视野范围: [100, 500], [100, 400]

      // 视口内点
      expect(director.isOutOfView(200, 200, camera)).toBe(false);
      expect(director.isOutOfView(499, 399, camera)).toBe(false);

      // 视口外点
      expect(director.isOutOfView(50, 200, camera)).toBe(true);  // 左侧视口外
      expect(director.isOutOfView(600, 200, camera)).toBe(true); // 右侧视口外
      expect(director.isOutOfView(200, 500, camera)).toBe(true); // 下方视口外
    });
  });

  describe('3. 威胁传感器自动扫描与高潮捕获断言', () => {
    it('扫描视口外部交火且濒危的首领，自动激活画中画', () => {
      // 在视口外部 (1200, 1200) 创建首领
      const eid = ecs.allocateEntity();
      const tfOff = eid * TRANSFORM_STRIDE;
      ecs.transforms[tfOff + TF_OFFSET_X] = 1200;
      ecs.transforms[tfOff + TF_OFFSET_Y] = 1200;

      // 赋予领袖与交火状态
      setStatus(ecs.statusFlags, eid, IS_LEADER);
      setStatus(ecs.statusFlags, eid, IN_COMBAT);

      // 生命低于 30%
      const hpOff = eid * HEALTH_STRIDE;
      ecs.health[hpOff + HP_OFFSET_MAX] = 1000;
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 200; // 20%

      director.scanThreats(ecs, camera, null);

      expect(director.isActive).toBe(true);
      expect(director.opacity).toBe(1.0);
      expect(director.currentEvent.type).toBe(HighlightEventType.LEADER_PERIL);
      expect(director.currentEvent.targetEntityId).toBe(eid);
      expect(director.currentEvent.targetWorldX).toBe(1200);
      expect(director.currentEvent.targetWorldY).toBe(1200);
    });

    it('视口内部的濒危首领不触发画中画 (避免视觉干扰)', () => {
      // 在视口内部 (200, 200) 创建首领
      const eid = ecs.allocateEntity();
      const tfOff = eid * TRANSFORM_STRIDE;
      ecs.transforms[tfOff + TF_OFFSET_X] = 200;
      ecs.transforms[tfOff + TF_OFFSET_Y] = 200;

      setStatus(ecs.statusFlags, eid, IS_LEADER);
      setStatus(ecs.statusFlags, eid, IN_COMBAT);
      const hpOff = eid * HEALTH_STRIDE;
      ecs.health[hpOff + HP_OFFSET_MAX] = 1000;
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 200;

      director.scanThreats(ecs, camera, null);
      expect(director.isActive).toBe(false);
    });

    it('图腾受创生命跌破 50% 且在视口外，捕获 TOTEM_PERIL', () => {
      const totemId = ecs.allocateEntity();
      const tfOff = totemId * TRANSFORM_STRIDE;
      ecs.transforms[tfOff + TF_OFFSET_X] = 1500;
      ecs.transforms[tfOff + TF_OFFSET_Y] = 1500;

      const hpOff = totemId * HEALTH_STRIDE;
      ecs.health[hpOff + HP_OFFSET_MAX] = 2000;
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 900; // 45%

      const mockTotemSys = {
        totemEntityIds: new Uint16Array(17)
      };
      mockTotemSys.totemEntityIds[1] = totemId;

      director.scanThreats(ecs, camera, mockTotemSys);
      expect(director.isActive).toBe(true);
      expect(director.currentEvent.type).toBe(HighlightEventType.TOTEM_PERIL);
      expect(director.currentEvent.targetWorldX).toBe(1500);
    });
  });

  describe('4. 10.0 秒平滑淡出与时钟推进断言', () => {
    it('10 秒内平滑淡出并关闭画中画', () => {
      director.triggerHighlight(HighlightEventType.LEADER_PERIL, '领袖交火', 1, 100, 100, 1);
      expect(director.isActive).toBe(true);
      expect(director.opacity).toBe(1.0);

      // 推进 5.0 秒
      director.update(5.0);
      expect(director.isActive).toBe(true);
      expect(director.opacity).toBe(1.0);

      // 推进至 9.0 秒 (进入最后 1.5s 淡出)
      director.update(4.0);
      expect(director.isActive).toBe(true);
      expect(director.opacity).toBeLessThan(1.0);
      expect(director.opacity).toBeGreaterThan(0.0);

      // 推进至 10.5 秒 (彻底关闭)
      director.update(1.5);
      expect(director.isActive).toBe(false);
      expect(director.opacity).toBe(0.0);
    });
  });

  describe('5. 点击联动与 1200px/s 平滑巡航断言', () => {
    it('点击画中画视口内区域，摄像机发起 1200px/s 平滑巡航', () => {
      director.triggerHighlight(HighlightEventType.LEADER_PERIL, '弑君绝地', 1, 1500, 1200, 1);
      const panSpy = vi.spyOn(camera, 'smoothPanTo');

      // 假设画中画位于屏幕右上角 (600, 20)
      const res = director.handleClick(650, 50, 600, 20, camera);

      expect(res.handled).toBe(true);
      expect(panSpy).toHaveBeenCalledWith(1500, 1200, 1200.0);
    });

    it('点击画中画视口外部，不触发平滑巡航', () => {
      director.triggerHighlight(HighlightEventType.LEADER_PERIL, '弑君绝地', 1, 1500, 1200, 1);
      const panSpy = vi.spyOn(camera, 'smoothPanTo');

      // 点击外部 (100, 100)
      const res = director.handleClick(100, 100, 600, 20, camera);
      expect(res.handled).toBe(false);
      expect(panSpy).not.toHaveBeenCalled();
    });
  });
});
