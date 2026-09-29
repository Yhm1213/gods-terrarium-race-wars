/**
 * MoraleSystem.js
 * 四级士气动态状态机与图腾 5 格破釜沉舟绝地死战系统
 * 
 * 核心设计指标 (Milestone 3 契约 1.4 节):
 * 1. 四级士气状态机: 稳固(100~60), 动摇(59~30), 惊恐后撤(29~1), 溃不成军(0)
 * 2. 状态改变派发 EVT_MORALE_STATE_CHANGED
 * 3. 友军阵亡目睹衰减: 4 格内 (<=2 格扣 3, 2~4 格扣 1)
 * 4. 3 秒滑动时间窗封顶: 3 秒内目睹友军阵亡扣除上限 15 点
 * 5. 首领阵亡扣 25 点，迅速继任回补 15 点
 * 6. 破釜沉舟 (Last Stand): 退至母国图腾 5 瓦片内士气锁死 1 点，移速+20%，置位 IS_LAST_STAND，派发 EVT_LAST_STAND_ACTIVATED
 * 7. 绝对零 GC: 连续平铺类型化数组维护
 */

import {
  NULL_ENTITY,
  TOTAL_SLOTS,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  MORALE_OFFSET_TIMER,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../core/ECS.js';

import {
  IS_ALIVE,
  IS_LAST_STAND,
  IS_PANICKED,
  hasStatus,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';

import { DomainEvents } from '../data/DomainEvents.js';
import { MAX_FACTIONS } from '../data/FactionData.js';

export const MoraleState = Object.freeze({
  SOLID: 0,         // 稳固 (100 ~ 60)
  WAVERING: 1,      // 动摇 (59 ~ 30)
  DISORGANIZED: 2,  // 惊恐后撤 (29 ~ 1)
  ROUTED: 3         // 溃不成军 (0)
});

export const MORALE_SOLID_MIN = 60.0;
export const MORALE_WAVERING_MIN = 30.0;
export const MORALE_DISORGANIZED_MIN = 1.0;

export const TILE_SIZE = 24;
export const WITNESS_NEAR_DISTANCE_PX = 2 * TILE_SIZE; // 48px (<= 2 瓦片)
export const WITNESS_FAR_DISTANCE_PX = 4 * TILE_SIZE;  // 96px (<= 4 瓦片)

export const WITNESS_NEAR_PENALTY = 3.0;
export const WITNESS_FAR_PENALTY = 1.0;
export const WITNESS_MAX_WINDOW_PENALTY = 15.0; // 3 秒内封顶 15 点
export const WITNESS_WINDOW_SECONDS = 3.0;

export const LEADER_DIED_PENALTY = 25.0;
export const HEIR_CROWNED_BOOST = 15.0;

export const LAST_STAND_RADIUS_TILES = 5; // 5 瓦片
export const LAST_STAND_RADIUS_PX = LAST_STAND_RADIUS_TILES * TILE_SIZE; // 120px

export class MoraleSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null]
   * @param {import('../warfare/TotemDefenseSystem.js').TotemDefenseSystem|null} [totemDefense=null]
   */
  constructor(ecs, eventBus = null, totemDefense = null) {
    this.ecs = ecs;
    this.eventBus = eventBus;
    this.totemDefense = totemDefense;

    // 实体当前士气状态枚举缓存 (Uint8Array: 4097)
    this.moraleStates = new Uint8Array(TOTAL_SLOTS);

    // 3 秒滑动窗口统计
    this.witnessWindowTimer = new Float32Array(TOTAL_SLOTS);
    this.witnessDeductedAmount = new Float32Array(TOTAL_SLOTS);
  }

  /**
   * 获取实体当前士气等级
   * @param {number} entityId 
   * @returns {number} MoraleState
   */
  getMoraleState(entityId) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return MoraleState.SOLID;
    return this.moraleStates[entityId];
  }

  /**
   * 计算指定士气数值对应的状态枚举
   * @param {number} val 
   * @returns {number}
   */
  calculateStateFromVal(val) {
    if (val >= MORALE_SOLID_MIN) return MoraleState.SOLID;
    if (val >= MORALE_WAVERING_MIN) return MoraleState.WAVERING;
    if (val >= MORALE_DISORGANIZED_MIN) return MoraleState.DISORGANIZED;
    return MoraleState.ROUTED;
  }

  /**
   * 设置实体的士气值并驱动状态机流转
   * @param {number} entityId 
   * @param {number} newVal 
   */
  setMorale(entityId, newVal) {
    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) return;

    const morOff = entityId * MORALE_STRIDE;
    const clampedVal = Math.max(0.0, Math.min(100.0, newVal));
    this.ecs.morale[morOff + MORALE_OFFSET_VAL] = clampedVal;

    const oldState = this.moraleStates[entityId];
    const newState = this.calculateStateFromVal(clampedVal);

    if (oldState !== newState) {
      this.moraleStates[entityId] = newState;

      // 溃退时置位 IS_PANICKED
      if (newState === MoraleState.ROUTED) {
        setStatus(this.ecs.statusFlags, entityId, IS_PANICKED);
      } else {
        clearStatus(this.ecs.statusFlags, entityId, IS_PANICKED);
      }

      if (this.eventBus) {
        this.eventBus.emit(DomainEvents.EVT_MORALE_STATE_CHANGED, entityId, 0, newState, 0);
      }
    }
  }

  /**
   * 实体目睹友军阵亡事件响应 (4 格内距离衰减 + 3s 滑动窗口 15 点封顶)
   * @param {number} victimId 
   */
  onAllyKilled(victimId) {
    if (victimId <= NULL_ENTITY) return;

    const vTf = victimId * TRANSFORM_STRIDE;
    const vx = this.ecs.transforms[vTf + TF_OFFSET_X];
    const vy = this.ecs.transforms[vTf + TF_OFFSET_Y];
    const facId = this.ecs.identities[victimId * IDENTITY_STRIDE + ID_OFFSET_FACTION];

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;
    const r2Far = WITNESS_FAR_DISTANCE_PX * WITNESS_FAR_DISTANCE_PX;
    const r2Near = WITNESS_NEAR_DISTANCE_PX * WITNESS_NEAR_DISTANCE_PX;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY || eid === victimId) continue;

      const allyFac = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (allyFac !== facId) continue; // 仅同阵营

      const oTf = eid * TRANSFORM_STRIDE;
      const dx = this.ecs.transforms[oTf + TF_OFFSET_X] - vx;
      const dy = this.ecs.transforms[oTf + TF_OFFSET_Y] - vy;
      const d2 = dx * dx + dy * dy;

      if (d2 <= r2Far) {
        const rawPenalty = (d2 <= r2Near) ? WITNESS_NEAR_PENALTY : WITNESS_FAR_PENALTY;

        // 检查 3 秒滑动窗口封顶
        const currentDeducted = this.witnessDeductedAmount[eid];
        const allowablePenalty = Math.max(0.0, WITNESS_MAX_WINDOW_PENALTY - currentDeducted);
        const actualPenalty = Math.min(rawPenalty, allowablePenalty);

        if (actualPenalty > 0) {
          this.witnessDeductedAmount[eid] += actualPenalty;
          const curVal = this.ecs.morale[eid * MORALE_STRIDE + MORALE_OFFSET_VAL];
          this.setMorale(eid, curVal - actualPenalty);
        }
      }
    }
  }

  /**
   * 首领驾崩士气震荡 (-25 点)
   * @param {number} factionId 
   */
  onLeaderDied(factionId) {
    if (factionId <= 0 || factionId > MAX_FACTIONS) return;

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f === factionId) {
        const curVal = this.ecs.morale[eid * MORALE_STRIDE + MORALE_OFFSET_VAL];
        this.setMorale(eid, curVal - LEADER_DIED_PENALTY);
      }
    }
  }

  /**
   * 新王即位加冕稳定军心 (+15 点回补)
   * @param {number} factionId 
   */
  onHeirCrowned(factionId) {
    if (factionId <= 0 || factionId > MAX_FACTIONS) return;

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f === factionId) {
        const curVal = this.ecs.morale[eid * MORALE_STRIDE + MORALE_OFFSET_VAL];
        this.setMorale(eid, curVal + HEIR_CROWNED_BOOST);
      }
    }
  }

  /**
   * 系统每帧更新 (维护滑动窗口时钟与图腾 5 格破釜沉舟)
   * 绝对零 GC
   * @param {number} dt 
   */
  update(dt) {
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;
    const r2LastStand = LAST_STAND_RADIUS_PX * LAST_STAND_RADIUS_PX;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      // 1. 推进 3 秒滑动窗口
      this.witnessWindowTimer[eid] += dt;
      if (this.witnessWindowTimer[eid] >= WITNESS_WINDOW_SECONDS) {
        this.witnessWindowTimer[eid] = 0.0;
        this.witnessDeductedAmount[eid] = 0.0;
      }

      // 2. 检查图腾 5 格破釜沉舟 (Last Stand)
      const facId = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      let inLastStandRange = false;

      if (this.totemDefense && facId > 0 && facId <= MAX_FACTIONS) {
        const totemId = this.totemDefense.totemEntityIds[facId];
        if (totemId > NULL_ENTITY && this.ecs.isAlive(totemId) && eid !== totemId) {
          const eTf = eid * TRANSFORM_STRIDE;
          const tTf = totemId * TRANSFORM_STRIDE;
          const dx = this.ecs.transforms[eTf + TF_OFFSET_X] - this.ecs.transforms[tTf + TF_OFFSET_X];
          const dy = this.ecs.transforms[eTf + TF_OFFSET_Y] - this.ecs.transforms[tTf + TF_OFFSET_Y];
          if (dx * dx + dy * dy <= r2LastStand) {
            inLastStandRange = true;
          }
        }
      }

      const morOff = eid * MORALE_STRIDE;
      const curVal = this.ecs.morale[morOff + MORALE_OFFSET_VAL];

      if (inLastStandRange && curVal <= MORALE_WAVERING_MIN) {
        // 退至母国图腾 5 瓦片内：士气锁死在 1 点，死战不退！
        if (curVal < 1.0) {
          this.setMorale(eid, 1.0);
        }
        if (!hasStatus(this.ecs.statusFlags, eid, IS_LAST_STAND)) {
          setStatus(this.ecs.statusFlags, eid, IS_LAST_STAND);
          if (this.eventBus) {
            this.eventBus.emit(DomainEvents.EVT_LAST_STAND_ACTIVATED, eid, 0, 0, 0);
          }
        }
      } else {
        if (hasStatus(this.ecs.statusFlags, eid, IS_LAST_STAND)) {
          clearStatus(this.ecs.statusFlags, eid, IS_LAST_STAND);
        }
      }
    }
  }
}
