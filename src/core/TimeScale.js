/**
 * TimeScale.js
 * 时间法则控制器与电影级绝杀慢动作定格
 * 严格遵照 SPEC-M4-CONTRACT §1.2
 *
 * 核心特性:
 * 1. 支持 0x (PAUSED), 0.2x (SLOW_MO), 1.0x, 2.0x, 5.0x, 10.0x 快进倍率
 * 2. 支持首领绝杀触发 1.2s 的 0.2x 电影级定格慢动作 (Cinematic Freeze)
 * 3. 100% 物理零 GC
 */

export const TimeScaleMode = Object.freeze({
  PAUSED: 0.0,
  SLOW_MO: 0.2,    // 0.2x 绝杀慢动作
  NORMAL: 1.0,     // 1.0x 标准速度
  FAST_2X: 2.0,
  FAST_5X: 5.0,
  FAST_10X: 10.0
});

export const DEFAULT_CINEMATIC_DURATION = 1.2; // 绝杀定格慢动作 1.2 秒

export class TimeScale {
  constructor() {
    this.scale = TimeScaleMode.NORMAL;
    this.savedScale = TimeScaleMode.NORMAL; // 暂停前保存的速度

    // 电影级绝杀定格慢动作计时器 (秒)
    this.freezeTimer = 0.0;
  }

  /**
   * 设置全局时间缩放倍率 (0.0 ~ 10.0)
   * @param {number} scale 
   */
  setScale(scale) {
    this.scale = Math.max(0.0, Math.min(10.0, scale));
    if (this.scale > 0.0) {
      this.savedScale = this.scale;
    }
  }

  /**
   * 切换暂停 / 恢复
   * @returns {boolean} 当前是否处于暂停状态
   */
  togglePause() {
    if (this.scale === TimeScaleMode.PAUSED) {
      this.scale = this.savedScale > 0.0 ? this.savedScale : TimeScaleMode.NORMAL;
    } else {
      this.savedScale = this.scale;
      this.scale = TimeScaleMode.PAUSED;
    }
    return this.isPaused();
  }

  /**
   * 是否处于暂停状态
   * @returns {boolean}
   */
  isPaused() {
    return this.scale === TimeScaleMode.PAUSED;
  }

  /**
   * 触发首领斩杀或绝杀瞬间 1.2s 0.2x 慢动作
   * @param {number} [durationSec=1.2] 
   */
  triggerCinematicFreeze(durationSec = DEFAULT_CINEMATIC_DURATION) {
    this.freezeTimer = Math.max(this.freezeTimer, durationSec);
  }

  /**
   * 时间推进，返回缩放后的 scaledDt
   * @param {number} rawDt 真实世界帧耗时 (秒)
   * @returns {number} 逻辑世界推进的 delta time
   */
  update(rawDt) {
    if (this.scale === TimeScaleMode.PAUSED) {
      return 0.0;
    }

    // 若处于电影级绝杀慢动作状态中
    if (this.freezeTimer > 0.0) {
      this.freezeTimer = Math.max(0.0, this.freezeTimer - rawDt);
      return rawDt * TimeScaleMode.SLOW_MO;
    }

    return rawDt * this.scale;
  }
}
