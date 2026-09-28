/**
 * GameLoop: 60 FPS 定步长物理累加器循环与单向管线调度骨架
 * 物理步长严格锁定为 1/60s (16.666ms)
 */
export class GameLoop {
  constructor(updateFn, renderFn) {
    this.updateFn = updateFn;
    this.renderFn = renderFn;

    this.fixedDeltaSec = 1.0 / 60.0;
    this.fixedDeltaMs = 1000.0 / 60.0;

    this.accumulatorMs = 0;
    this.lastTimeMs = 0;
    this.isRunning = false;
    this.rafId = null;
  }

  start() {
    this.isRunning = true;
    this.lastTimeMs = performance.now();
    const tick = (now) => {
      if (!this.isRunning) return;

      let deltaMs = now - this.lastTimeMs;
      this.lastTimeMs = now;

      // 螺旋掉帧螺旋保护 Clamp (最多累积 100ms)
      if (deltaMs > 100.0) deltaMs = 100.0;
      this.accumulatorMs += deltaMs;

      while (this.accumulatorMs >= this.fixedDeltaMs) {
        this.updateFn(this.fixedDeltaSec);
        this.accumulatorMs -= this.fixedDeltaMs;
      }

      this.renderFn(this.accumulatorMs / this.fixedDeltaMs);
      this.rafId = requestAnimationFrame(tick);
    };

    this.rafId = requestAnimationFrame(tick);
  }

  stop() {
    this.isRunning = false;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
