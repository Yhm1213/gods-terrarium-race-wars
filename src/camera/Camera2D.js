/**
 * Camera2D.js
 * 2D 摄像机与视口变换矩阵
 * 严格遵照 SPEC-M4-CONTRACT §1.1
 * 
 * 核心特性:
 * 1. zoom 缩放范围 [0.35, 3.0]，支持以屏幕光标为锚点等比缩放
 * 2. smoothPanTo 1200px/s 平滑巡航
 * 3. screenToWorld / worldToScreen 100% 物理零 GC (复用 out 传参)
 * 4. 单次 setTransform 应用视口矩阵
 */

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 3.0;
export const DEFAULT_PAN_SPEED = 1200.0; // 巡航速度 1200px/s

export class Camera2D {
  /**
   * @param {number} [viewportWidth=1344] 
   * @param {number} [viewportHeight=864] 
   * @param {number} [worldWidth=1344] 
   * @param {number} [worldHeight=864] 
   */
  constructor(viewportWidth = 1344, viewportHeight = 864, worldWidth = 1344, worldHeight = 864) {
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;

    // 视口左上角对应的世界坐标
    this.x = 0.0;
    this.y = 0.0;

    // 当前缩放比例
    this.zoom = 1.0;

    // 平滑巡航状态
    this.isPanning = false;
    this.targetX = 0.0;
    this.targetY = 0.0;
    this.panSpeed = DEFAULT_PAN_SPEED;

    // 零 GC 复用缺省传参
    this._defaultOut = { x: 0.0, y: 0.0 };
  }

  /**
   * 更新视口窗口尺寸
   * @param {number} w 
   * @param {number} h 
   */
  setViewportSize(w, h) {
    this.viewportWidth = Math.max(1, w);
    this.viewportHeight = Math.max(1, h);
    this._clampBounds();
  }

  /**
   * 视口平移
   * @param {number} dx 世界坐标增量
   * @param {number} dy 世界坐标增量
   */
  pan(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.isPanning = false; // 手动拖拽打断平滑巡航
    this._clampBounds();
  }

  /**
   * 以屏幕光标为锚点进行等比缩放
   * 缩放前后，光标所指世界坐标点绝对保持恒定
   * 
   * @param {number} screenX 光标在屏幕上的像素坐标 X
   * @param {number} screenY 光标在屏幕上的像素坐标 Y
   * @param {number} zoomFactor 缩放倍率增量 (如 1.1 或 0.9)
   */
  zoomAt(screenX, screenY, zoomFactor) {
    const oldZoom = this.zoom;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * zoomFactor));
    if (Math.abs(newZoom - oldZoom) < 0.0001) return;

    // 光标当前指向的世界坐标点
    const worldX = this.x + screenX / oldZoom;
    const worldY = this.y + screenY / oldZoom;

    this.zoom = newZoom;

    // 保持世界坐标点与屏幕光标点对齐
    this.x = worldX - screenX / newZoom;
    this.y = worldY - screenY / newZoom;

    this._clampBounds();
  }

  /**
   * 直接设置缩放比例 (以视口中心为锚点)
   * @param {number} z 
   */
  setZoom(z) {
    this.zoomAt(this.viewportWidth * 0.5, this.viewportHeight * 0.5, z / this.zoom);
  }

  /**
   * 启动平滑巡航，使摄像机中心对准目标世界坐标
   * @param {number} targetWorldX 目标世界坐标 X
   * @param {number} targetWorldY 目标世界坐标 Y
   * @param {number} [speed=1200] 巡航速度 (px/s)
   */
  smoothPanTo(targetWorldX, targetWorldY, speed = DEFAULT_PAN_SPEED) {
    // 目标左上角坐标 = 目标中心 - 可视半宽/高
    const halfViewW = (this.viewportWidth / this.zoom) * 0.5;
    const halfViewH = (this.viewportHeight / this.zoom) * 0.5;

    this.targetX = targetWorldX - halfViewW;
    this.targetY = targetWorldY - halfViewH;
    this.panSpeed = speed;
    this.isPanning = true;
  }

  /**
   * 屏幕坐标转世界坐标 (绝对零 GC)
   * @param {number} screenX 
   * @param {number} screenY 
   * @param {{x: number, y: number}} [out] 
   * @returns {{x: number, y: number}}
   */
  screenToWorld(screenX, screenY, out = null) {
    const res = out || this._defaultOut;
    res.x = this.x + screenX / this.zoom;
    res.y = this.y + screenY / this.zoom;
    return res;
  }

  /**
   * 世界坐标转屏幕坐标 (绝对零 GC)
   * @param {number} worldX 
   * @param {number} worldY 
   * @param {{x: number, y: number}} [out] 
   * @returns {{x: number, y: number}}
   */
  worldToScreen(worldX, worldY, out = null) {
    const res = out || this._defaultOut;
    res.x = (worldX - this.x) * this.zoom;
    res.y = (worldY - this.y) * this.zoom;
    return res;
  }

  /**
   * 限制摄像机范围
   * @private
   */
  _clampBounds() {
    const visibleW = this.viewportWidth / this.zoom;
    const visibleH = this.viewportHeight / this.zoom;

    if (visibleW >= this.worldWidth) {
      // 可见范围大于世界宽度，水平居中
      this.x = (this.worldWidth - visibleW) * 0.5;
    } else {
      this.x = Math.max(0, Math.min(this.worldWidth - visibleW, this.x));
    }

    if (visibleH >= this.worldHeight) {
      // 可见范围大于世界高度，垂直居中
      this.y = (this.worldHeight - visibleH) * 0.5;
    } else {
      this.y = Math.max(0, Math.min(this.worldHeight - visibleH, this.y));
    }
  }

  /**
   * 摄像机时钟推进 (驱动平滑巡航)
   * @param {number} dt 
   */
  update(dt) {
    if (!this.isPanning) {
      this._clampBounds();
      return;
    }

    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < 1.0) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.isPanning = false;
      this._clampBounds();
      return;
    }

    const dist = Math.sqrt(distSq);
    const step = this.panSpeed * dt;

    if (step >= dist) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.isPanning = false;
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }

    this._clampBounds();
  }

  /**
   * 应用摄像机仿射变换至 Canvas 绘图上下文
   * 严格遵守 0 次 save/restore，单次 setTransform 覆盖
   * @param {CanvasRenderingContext2D} ctx 
   */
  applyTransform(ctx) {
    if (!ctx) return;
    ctx.setTransform(
      this.zoom,
      0,
      0,
      this.zoom,
      -this.x * this.zoom,
      -this.y * this.zoom
    );
  }
}
