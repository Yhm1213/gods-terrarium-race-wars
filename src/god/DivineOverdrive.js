/**
 * DivineOverdrive.js
 * 15 秒神恩满溢狂欢时刻状态机
 * 严格遵照 SPEC-M4-CONTRACT §2.2
 *
 * 核心机制:
 * 1. 激活条件: 神恩池 Fervor >= 100.0，触发 15 秒黄金超载
 * 2. 无限神力: 六大上帝技能 0 消耗、0 冷却
 * 3. 狂喜光环: 全图生物置位 IS_ECSTASY (移速+50%, 劳作+100%, 饱食消耗定格)
 * 4. 生草事故概率 200% 倍率
 * 5. 终末神圣烟花与《狂欢纪元快报》快照结算 (零 GC)
 */

import { NULL_ENTITY } from '../core/ECS.js';
import {
  IS_ALIVE,
  IS_ECSTASY,
  hasStatus,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';
import { DomainEvents } from '../data/DomainEvents.js';

export const OVERDRIVE_DURATION_SECONDS = 15.0;
export const OVERDRIVE_ACTIVATION_THRESHOLD = 100.0;

export class DivineOverdrive {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {import('./DivineMiraclesSystem.js').DivineMiraclesSystem} miraclesSystem 
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null] 
   */
  constructor(ecs, miraclesSystem, eventBus = null) {
    this.ecs = ecs;
    this.miraclesSystem = miraclesSystem;
    this.eventBus = eventBus;

    this.isActive = false;
    this.remainingTime = 0.0;
    this.currentTick = 0;

    // 狂欢统计计数 (用于结算快报，纯数值，零 GC)
    this.miraclesCastCount = 0;
    this.killsDuringOverdrive = 0;
    this.totalOverdriveCount = 0;

    // 快报快照缓存 (零 GC 复用对象)
    this.lastReport = {
      epochId: 0,
      duration: OVERDRIVE_DURATION_SECONDS,
      endTick: 0,
      miraclesCast: 0,
      killsCount: 0,
      headline: ''
    };
  }

  /**
   * 尝试触发狂欢时刻
   * @param {number} [currentTick=0] 
   * @param {boolean} [force=false] 是否强制激活 (无视神恩阈值)
   * @returns {boolean} 是否成功激活
   */
  triggerOverdrive(currentTick = 0, force = false) {
    if (this.isActive) return false;

    if (!force && this.miraclesSystem.fervor < OVERDRIVE_ACTIVATION_THRESHOLD) {
      return false;
    }

    this.isActive = true;
    this.remainingTime = OVERDRIVE_DURATION_SECONDS;
    this.currentTick = currentTick;
    this.miraclesCastCount = 0;
    this.killsDuringOverdrive = 0;
    this.totalOverdriveCount++;

    // 消耗神恩
    this.miraclesSystem.fervor = 0.0;

    // 清零当前所有技能冷却
    for (let i = 0; i < this.miraclesSystem.cooldowns.length; i++) {
      this.miraclesSystem.cooldowns[i] = 0.0;
    }

    // 全图活体生物施加狂喜状态 IS_ECSTASY
    this._applyEcstasyToAllLiving();

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_OVERDRIVE_STARTED, currentTick, 0, 0, 0);
    }

    return true;
  }

  /**
   * 记录狂欢期间施放的神迹
   */
  recordMiracleCast() {
    if (this.isActive) {
      this.miraclesCastCount++;
    }
  }

  /**
   * 记录狂欢期间发生的击杀
   */
  recordKill() {
    if (this.isActive) {
      this.killsDuringOverdrive++;
    }
  }

  /**
   * 状态机帧更新
   * @param {number} dt 
   * @param {number} [currentTick=0] 
   */
  update(dt, currentTick = 0) {
    this.currentTick = currentTick;

    if (!this.isActive) return;

    // 维持技能零冷却
    for (let i = 0; i < this.miraclesSystem.cooldowns.length; i++) {
      this.miraclesSystem.cooldowns[i] = 0.0;
    }

    this.remainingTime -= dt;

    if (this.remainingTime <= 0.0) {
      this._endOverdrive();
    }
  }

  /**
   * 狂欢结束结算
   * @private
   */
  _endOverdrive() {
    this.isActive = false;
    this.remainingTime = 0.0;

    // 移除全图狂喜状态
    this._removeEcstasyFromAll();

    // 生成《狂欢纪元快报》快照 (复用 lastReport，零 GC)
    this.lastReport.epochId = this.totalOverdriveCount;
    this.lastReport.duration = OVERDRIVE_DURATION_SECONDS;
    this.lastReport.endTick = this.currentTick;
    this.lastReport.miraclesCast = this.miraclesCastCount;
    this.lastReport.killsCount = this.killsDuringOverdrive;
    this.lastReport.headline = `【狂欢纪元快报 第${this.totalOverdriveCount}期】神威照彻寰宇！共施降神迹 ${this.miraclesCastCount} 次，狂喜见证者无算！`;

    if (this.eventBus) {
      this.eventBus.emit(
        DomainEvents.EVT_OVERDRIVE_ENDED,
        this.currentTick,
        this.killsDuringOverdrive,
        this.miraclesCastCount,
        0
      );
    }
  }

  /**
   * 遍历所有活跃活体实体，置位狂喜状态
   * @private
   */
  _applyEcstasyToAllLiving() {
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      if (hasStatus(this.ecs.statusFlags, eid, IS_ALIVE)) {
        setStatus(this.ecs.statusFlags, eid, IS_ECSTASY);
      }
    }
  }

  /**
   * 移除所有实体的狂喜状态
   * @private
   */
  _removeEcstasyFromAll() {
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      clearStatus(this.ecs.statusFlags, eid, IS_ECSTASY);
    }
  }

  /**
   * 获取最近一份狂欢快报
   * @returns {Object}
   */
  getLastReport() {
    return this.lastReport;
  }

  /**
   * 获取最近一份狂欢快报 (别名兼容)
   * @returns {Object}
   */
  getSummaryReport() {
    return this.getLastReport();
  }
}
