/**
 * RebelWrathSystem.js
 * 叛乱军【自由之怒】45 秒 Buff 与图腾坍塌瞬时驱散系统
 * 严格遵照 SPEC-M3-CONTRACT §4.4
 *
 * 核心机制:
 * 1. 分裂起义全员置位 HAS_WRATH_OF_LIBERTY，持续 45.0s: 攻速+30%, 移速+20%, 士气锁死 >= 50
 * 2. 提前驱散平叛机制 (Premature Purge): 45s 内叛乱图腾被毁，自由之怒全员驱散，士气归零跪地投降
 * 3. 100% 物理零 GC: 平铺连续数组维护时钟
 */

import {
  NULL_ENTITY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL
} from '../core/ECS.js';
import {
  HAS_WRATH_OF_LIBERTY,
  IS_PANICKED,
  hasStatus,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';
import { MAX_FACTIONS } from '../data/FactionData.js';

export const REBEL_WRATH_DURATION = 45.0; // 自由之怒持续时间 45 秒
export const REBEL_MIN_MORALE = 50.0;     // 自由之怒士气锁定下限

export class RebelWrathSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null] 
   * @param {import('../warfare/MoraleSystem.js').MoraleSystem|null} [moraleSystem=null] 
   */
  constructor(ecs, eventBus = null, moraleSystem = null) {
    this.ecs = ecs;
    this.eventBus = eventBus;
    this.moraleSystem = moraleSystem;

    // 各阵营自由之怒剩余时长 (秒)
    this.wrathTimers = new Float32Array(MAX_FACTIONS + 1);
  }

  /**
   * 激活指定阵营的【自由之怒】起义狂暴 Buff
   * @param {number} factionId 
   */
  activateRebelWrath(factionId) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return;

    this.wrathTimers[factionId] = REBEL_WRATH_DURATION;

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f === factionId) {
        setStatus(this.ecs.statusFlags, eid, HAS_WRATH_OF_LIBERTY);
        clearStatus(this.ecs.statusFlags, eid, IS_PANICKED);

        const mOff = eid * MORALE_STRIDE;
        const curMorale = this.ecs.morale[mOff + MORALE_OFFSET_VAL];
        if (curMorale < REBEL_MIN_MORALE) {
          if (this.moraleSystem) {
            this.moraleSystem.setMorale(eid, REBEL_MIN_MORALE);
          } else {
            this.ecs.morale[mOff + MORALE_OFFSET_VAL] = REBEL_MIN_MORALE;
          }
        }
      }
    }
  }

  /**
   * 叛乱图腾倒塌，触发提前驱散与平叛跪降 (Premature Purge)
   * @param {number} factionId 
   */
  onTotemDestroyed(factionId) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return;

    this.wrathTimers[factionId] = 0.0;

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f === factionId) {
        clearStatus(this.ecs.statusFlags, eid, HAS_WRATH_OF_LIBERTY);
        setStatus(this.ecs.statusFlags, eid, IS_PANICKED);

        if (this.moraleSystem) {
          this.moraleSystem.setMorale(eid, 0.0);
        } else {
          this.ecs.morale[eid * MORALE_STRIDE + MORALE_OFFSET_VAL] = 0.0;
        }
      }
    }
  }

  /**
   * 检查指定实体是否处于自由之怒狂暴状态
   * @param {number} entityId 
   * @returns {boolean}
   */
  hasWrath(entityId) {
    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) return false;
    return hasStatus(this.ecs.statusFlags, entityId, HAS_WRATH_OF_LIBERTY);
  }

  /**
   * 获取指定阵营自由之怒剩余时长
   * @param {number} factionId 
   * @returns {number}
   */
  getWrathTimer(factionId) {
    if (factionId < 1 || factionId > MAX_FACTIONS) return 0.0;
    return this.wrathTimers[factionId];
  }

  /**
   * 系统每帧更新
   * @param {number} dt 
   */
  update(dt) {
    for (let f = 1; f <= MAX_FACTIONS; f++) {
      if (this.wrathTimers[f] > 0.0) {
        this.wrathTimers[f] = Math.max(0.0, this.wrathTimers[f] - dt);

        const isExpired = (this.wrathTimers[f] === 0.0);
        const dense = this.ecs.denseEntities;
        const total = this.ecs.activeCount;

        for (let i = 0; i < total; i++) {
          const eid = dense[i];
          if (eid === NULL_ENTITY) continue;

          const facId = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
          if (facId === f) {
            if (isExpired) {
              clearStatus(this.ecs.statusFlags, eid, HAS_WRATH_OF_LIBERTY);
            } else {
              // 持续锁定士气下限在 50 点以上
              const mOff = eid * MORALE_STRIDE;
              if (this.ecs.morale[mOff + MORALE_OFFSET_VAL] < REBEL_MIN_MORALE) {
                this.ecs.morale[mOff + MORALE_OFFSET_VAL] = REBEL_MIN_MORALE;
              }
            }
          }
        }
      }
    }
  }
}
