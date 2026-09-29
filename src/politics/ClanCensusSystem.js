/**
 * ClanCensusSystem.js
 * 部族微观普查与政治张力累加系统
 * 严格遵照 SPEC-M3-CONTRACT §4.2
 *
 * 核心机制:
 * 1. 60-Tick (约 1.0s) 周期真实微观普查: 汇聚存活人口、饥饿比例、战损比例
 * 2. 真实张力累加公式:
 *    ΔTension = (StarvationRatio * 2.0) + (CasualtyRatio * 1.5) + (MismatchFactor * 0.8) - (GloryMod * 0.5)
 * 3. 张力蓄满 100 引爆图腾大裂变或内部流血政变
 * 4. 100% 物理零 GC: 平铺连续数组统计
 */

import {
  NULL_ENTITY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER
} from '../core/ECS.js';
import {
  IS_PETRIFIED,
  hasStatus
} from '../components/UnitStatusFlags.js';
import {
  MAX_FACTIONS,
  FACTION_STRIDE,
  FAC_OFFSET_TENSION,
  FAC_OFFSET_POP_COUNT,
  FAC_OFFSET_CIVIC_ID,
  FAC_OFFSET_FLAGS,
  FactionFlags
} from '../data/FactionData.js';
import { DomainEvents } from '../data/DomainEvents.js';

export const CENSUS_INTERVAL_TICKS = 60; // 普查周期 (60 Tick = 1.0s)
export const STARVATION_THRESHOLD = 80.0;// 饥饿警戒阈值 (>= 80.0 计入饥饿人口)
export const TENSION_MAX = 100.0;        // 张力极限制

export class ClanCensusSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {Int32Array} factionBuffer 
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null] 
   * @param {import('./SchismSystem.js').SchismSystem|null} [schismSystem=null] 
   */
  constructor(ecs, factionBuffer, eventBus = null, schismSystem = null) {
    this.ecs = ecs;
    this.factionBuffer = factionBuffer;
    this.eventBus = eventBus;
    this.schismSystem = schismSystem;

    this.tickCounter = 0;

    // 零 GC 预分配统计平铺数组 (容量 MAX_FACTIONS + 1 = 17)
    this.popCounts = new Uint16Array(MAX_FACTIONS + 1);
    this.starvingCounts = new Uint16Array(MAX_FACTIONS + 1);
    this.casualtyCounts = new Uint16Array(MAX_FACTIONS + 1);
    this.gloryMods = new Float32Array(MAX_FACTIONS + 1);
  }

  /**
   * 记录战损伤亡增量
   * @param {number} factionId 
   * @param {number} [count=1] 
   */
  recordCasualty(factionId, count = 1) {
    if (factionId >= 1 && factionId <= MAX_FACTIONS) {
      this.casualtyCounts[factionId] += count;
    }
  }

  /**
   * 记录战争胜利/占领等战功荣耀
   * @param {number} factionId 
   * @param {number} amount 
   */
  addGlory(factionId, amount) {
    if (factionId >= 1 && factionId <= MAX_FACTIONS) {
      this.gloryMods[factionId] = Math.min(2.0, this.gloryMods[factionId] + amount);
    }
  }

  /**
   * 获取指定阵营当前政治张力
   * @param {number} factionId 
   * @returns {number}
   */
  getTension(factionId) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return 0.0;
    const baseOffset = (factionId - 1) * FACTION_STRIDE;
    return this.factionBuffer[baseOffset + FAC_OFFSET_TENSION];
  }

  /**
   * 设置指定阵营政治张力 (Clamp 在 0 ~ 100)
   * @param {number} factionId 
   * @param {number} val 
   */
  setTension(factionId, val) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return;
    const baseOffset = (factionId - 1) * FACTION_STRIDE;
    this.factionBuffer[baseOffset + FAC_OFFSET_TENSION] = Math.max(0, Math.min(TENSION_MAX, Math.round(val)));
  }

  /**
   * 执行全大陆微观普查与张力汇总
   * 严格零 GC
   */
  executeCensus() {
    this.popCounts.fill(0);
    this.starvingCounts.fill(0);

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    // 1. 遍历微观存活实体汇总人口与饥饿
    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      // 石化魔像与沉寂古代遗迹标记解耦 (TC-EDGE-09)
      if (hasStatus(this.ecs.statusFlags, eid, IS_PETRIFIED)) continue;
      if (this.ecs.isDormant && this.ecs.isDormant[eid]) continue;

      const facId = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (facId < 1 || facId > MAX_FACTIONS) continue;

      this.popCounts[facId]++;

      const hunger = this.ecs.physiology[eid * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER];
      if (hunger >= STARVATION_THRESHOLD) {
        this.starvingCounts[facId]++;
      }
    }

    // 2. 计算各阵营张力累加
    for (let f = 1; f <= MAX_FACTIONS; f++) {
      const baseOffset = (f - 1) * FACTION_STRIDE;
      const flags = this.factionBuffer[baseOffset + FAC_OFFSET_FLAGS];

      // 仅普查活跃且非古代遗迹非灭亡政权 (TC-EDGE-09)
      if ((flags & FactionFlags.ACTIVE) === 0 || 
          (flags & FactionFlags.DESTROYED) !== 0 || 
          (flags & FactionFlags.IS_RUINS) !== 0) {
        continue;
      }

      const pop = this.popCounts[f];
      this.factionBuffer[baseOffset + FAC_OFFSET_POP_COUNT] = pop;

      if (pop <= 0) continue;

      const starvationRatio = this.starvingCounts[f] / pop;
      const casualtyRatio = this.casualtyCounts[f] / pop;

      // 市政不匹配度 (军阀独裁与神权易激化民怨)
      const civic = this.factionBuffer[baseOffset + FAC_OFFSET_CIVIC_ID];
      let mismatch = 0.0;
      if (civic === 1) mismatch = 0.25; // 军阀
      else if (civic === 3) mismatch = 0.20; // 神权

      const glory = this.gloryMods[f];

      // 契约张力累加公式:
      // ΔTension = (StarvationRatio * 2.0) + (CasualtyRatio * 1.5) + (MismatchFactor * 0.8) - (GloryMod * 0.5)
      const deltaTension = (starvationRatio * 2.0) + (casualtyRatio * 1.5) + (mismatch * 0.8) - (glory * 0.5);

      let currentTension = this.factionBuffer[baseOffset + FAC_OFFSET_TENSION];
      currentTension = Math.max(0.0, Math.min(TENSION_MAX, currentTension + deltaTension));
      this.factionBuffer[baseOffset + FAC_OFFSET_TENSION] = Math.round(currentTension);

      // 重置当轮战损与荣耀衰减
      this.casualtyCounts[f] = 0;
      this.gloryMods[f] = Math.max(0.0, glory * 0.8);

      // 3. 张力蓄满 100 引爆裂变判定
      if (currentTension >= TENSION_MAX) {
        if (this.schismSystem) {
          this.schismSystem.attemptSchism(f);
        } else if (this.eventBus) {
          this.eventBus.emit(DomainEvents.EVT_FACTION_SCHISM, f, 0, 0, 0);
        }
      }
    }
  }

  /**
   * 彻底覆灭指定阵营 (TC-EDGE-09)
   * 领地瓦片全部释放为中立，残兵转为流寇，阵营永久置位 DESTROYED
   * @param {number} factionId 
   * @param {import('../world/TileGrid.js').TileGrid|null} [tileGrid=null]
   */
  destroyFaction(factionId, tileGrid = null) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return;

    const baseOffset = (factionId - 1) * FACTION_STRIDE;
    this.factionBuffer[baseOffset + FAC_OFFSET_FLAGS] = FactionFlags.DESTROYED;
    this.factionBuffer[baseOffset + FAC_OFFSET_POP_COUNT] = 0;
    this.factionBuffer[baseOffset + FAC_OFFSET_TENSION] = 0;

    // 释放全部领地瓦片为中立荒原 (0)
    if (tileGrid && tileGrid.territoryFaction) {
      const tFac = tileGrid.territoryFaction;
      const totalTiles = tileGrid.totalTiles || tFac.length;
      for (let i = 0; i < totalTiles; i++) {
        if (tFac[i] === factionId) {
          tFac[i] = 0;
        }
      }
    }

    // 残兵改写为流寇或无国籍 (0)
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;
    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;
      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f === factionId) {
        this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 0; // 中立/流寇
      }
    }

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_FACTION_DESTROYED, factionId, 0, 0, 0);
    }
  }

  /**
   * 系统每帧更新
   * @param {number} dt 帧间隔
   */
  update(dt) {
    this.tickCounter++;
    if (this.tickCounter >= CENSUS_INTERVAL_TICKS) {
      this.tickCounter = 0;
      this.executeCensus();
    }
  }
}
