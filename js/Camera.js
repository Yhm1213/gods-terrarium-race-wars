// ==========================================
// 上帝视角摄像机控制类 (平移、自由缩放、坐标转换)
// ==========================================

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0; // 摄像机左上角在世界中的绝对 X
    this.y = 0; // 摄像机左上角在世界中的绝对 Y
    this.zoom = 1.0; // 缩放比例 (0.5x ~ 3.0x)

    this.minZoom = 0.5;
    this.maxZoom = 3.0;

    this.isPanning = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
  }

  // 居中对齐世界某一点
  centerOn(worldX, worldY) {
    this.x = worldX - (this.canvas.width / 2) / this.zoom;
    this.y = worldY - (this.canvas.height / 2) / this.zoom;
  }

  // 屏幕坐标 -> 世界坐标
  screenToWorld(screenX, screenY) {
    return {
      x: this.x + screenX / this.zoom,
      y: this.y + screenY / this.zoom
    };
  }

  // 世界坐标 -> 屏幕坐标
  worldToScreen(worldX, worldY) {
    return {
      x: (worldX - this.x) * this.zoom,
      y: (worldY - this.y) * this.zoom
    };
  }

  // 以屏幕鼠标落点为锚点进行缩放
  handleZoom(delta, cursorScreenX, cursorScreenY) {
    const worldBefore = this.screenToWorld(cursorScreenX, cursorScreenY);
    const zoomFactor = delta < 0 ? 1.15 : 0.87;
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * zoomFactor));

    if (newZoom !== this.zoom) {
      this.zoom = newZoom;
      // 保持光标指向的世界坐标在缩放后依然在光标下
      this.x = worldBefore.x - cursorScreenX / this.zoom;
      this.y = worldBefore.y - cursorScreenY / this.zoom;
    }
  }

  startPan(screenX, screenY) {
    this.isPanning = true;
    this.lastMouseX = screenX;
    this.lastMouseY = screenY;
  }

  pan(screenX, screenY) {
    if (!this.isPanning) return;
    const dx = (screenX - this.lastMouseX) / this.zoom;
    const dy = (screenY - this.lastMouseY) / this.zoom;
    this.x -= dx;
    this.y -= dy;
    this.lastMouseX = screenX;
    this.lastMouseY = screenY;
  }

  endPan() {
    this.isPanning = false;
  }

  // 应用变换矩阵到 Canvas 上下文
  applyTransform(ctx) {
    ctx.save();
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  restoreTransform(ctx) {
    ctx.restore();
  }
}
