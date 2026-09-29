/**
 * Camera2D.test.js
 * 2D 摄像机平移、缩放与坐标投影零 GC 规范测试套件 (WP-4.1)
 * 验证 SPEC-M4-CONTRACT §1.1
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Camera2D, MIN_ZOOM, MAX_ZOOM } from '../../src/camera/Camera2D.js';

describe('Camera2D Specification Suite (WP-4.1)', () => {
  let camera;

  beforeEach(() => {
    // 视口 800x600，世界尺寸 1344x864
    camera = new Camera2D(800, 600, 1344, 864);
  });

  describe('1. 视口映射与坐标双向投影 (Zero-GC)', () => {
    it('screenToWorld 与 worldToScreen 双向投影自洽，且支持 out 传参复用零 GC', () => {
      camera.x = 100;
      camera.y = 50;
      camera.zoom = 2.0;

      const screenX = 200;
      const screenY = 150;

      // 屏幕转世界: worldX = 100 + 200 / 2 = 200, worldY = 50 + 150 / 2 = 125
      const outWorld = { x: 0, y: 0 };
      const resWorld = camera.screenToWorld(screenX, screenY, outWorld);
      expect(resWorld).toBe(outWorld); // 严格复用传入对象
      expect(outWorld.x).toBeCloseTo(200.0, 2);
      expect(outWorld.y).toBeCloseTo(125.0, 2);

      // 世界转回屏幕: screenX = (200 - 100) * 2 = 200, screenY = (125 - 50) * 2 = 150
      const outScreen = { x: 0, y: 0 };
      const resScreen = camera.worldToScreen(outWorld.x, outWorld.y, outScreen);
      expect(resScreen).toBe(outScreen);
      expect(outScreen.x).toBeCloseTo(screenX, 2);
      expect(outScreen.y).toBeCloseTo(screenY, 2);
    });
  });

  describe('2. 缩放范围与光标锚点保持', () => {
    it('zoom 严格限制在 [0.35, 3.0] 范围内', () => {
      camera.setZoom(0.1);
      expect(camera.zoom).toBeCloseTo(MIN_ZOOM, 2);

      camera.setZoom(5.0);
      expect(camera.zoom).toBeCloseTo(MAX_ZOOM, 2);
    });

    it('zoomAt 以光标为锚点缩放时，光标所指世界坐标点缩放前后绝对保持一致', () => {
      camera.x = 200;
      camera.y = 100;
      camera.zoom = 1.0;

      const cursorScreenX = 400;
      const cursorScreenY = 300;

      // 缩放前的世界坐标点
      const worldBefore = camera.screenToWorld(cursorScreenX, cursorScreenY);
      const targetWX = worldBefore.x;
      const targetWY = worldBefore.y;

      // 放大 1.5 倍
      camera.zoomAt(cursorScreenX, cursorScreenY, 1.5);
      expect(camera.zoom).toBeCloseTo(1.5, 2);

      // 缩放后的世界坐标点必须与原来完全一致
      const worldAfter = camera.screenToWorld(cursorScreenX, cursorScreenY);
      expect(worldAfter.x).toBeCloseTo(targetWX, 2);
      expect(worldAfter.y).toBeCloseTo(targetWY, 2);
    });
  });

  describe('3. 1200px/s 平滑巡航与边界 Clamp', () => {
    it('smoothPanTo 平滑巡航至目标并居中，巡航完毕后精准对准', () => {
      camera.x = 0;
      camera.y = 0;
      camera.zoom = 1.0;

      // 平滑巡航至世界中心 (672, 432)
      camera.smoothPanTo(672, 432, 1200.0);
      expect(camera.isPanning).toBe(true);

      // 推进 0.2 秒: 走 240px
      camera.update(0.2);
      expect(camera.x).toBeGreaterThan(0);

      // 推进 2.0 秒完成巡航
      camera.update(2.0);
      expect(camera.isPanning).toBe(false);

      // 视口中心 (400, 300) 对应世界坐标应当为 (672, 432)
      const centerWorld = camera.screenToWorld(400, 300);
      expect(centerWorld.x).toBeCloseTo(672, 1);
      expect(centerWorld.y).toBeCloseTo(432, 1);
    });
  });
});
