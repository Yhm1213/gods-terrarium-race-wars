/**
 * TotemDefenseSystem.js
 * 图腾防卫机制、远征后勤疲劳光环与圣火涅槃冲击波系统
 * 
 * 核心设计指标 (Milestone 3 契约 1.3 节):
 * 1. 远征后勤疲劳光环: 脱离母国图腾 3 瓦片外每 3 瓦片增加 1 层 (上限 5 层，-20% 移速，-25% 伤害)
 * 2. 图腾 25% 圣火涅槃冲击波: 图腾生命首次跌破 25% 瞬间震退 6 瓦片敌军 + 2.5s 眩晕，获取 12s 金身无敌圣盾
 * 3. 图腾绝对静态锁: IS_STATIC_ANCHOR，invMass = 0.0，位移恒为 0
 * 4. 绝对零 GC: 纯连续类型化数组查表与复用出参
 */

import {
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  PHY_OFFSET_MASS,
  PHY_OFFSET_INVMASS,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../core/ECS.js';

import {
  IS_ALIVE,
  IS_STUNNED,
  IS_STATIC_ANCHOR,
  IS_SACRED_BODY,
  hasStatus,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';

import { DomainEvents } from '../data/DomainEvents.js';
import { MAX_FACTIONS } from '../data/FactionData.js';

export const TOTEM_AEGIS_HP_THRESHOLD = 0.25; // 25% 生命触发阈值
export const TOTEM_AEGIS_DURATION = 12.0;      // 12.0s 金身无敌
export const TOTEM_AEGIS_RADIUS_TILES = 6;    // 6 瓦片冲击波半径
export const TOTEM_AEGIS_STUN_DURATION = 2.5; // 2.5s 眩晕
export const TOTEM_KNOCKBACK_FORCE = 80.0;    // 弹飞冲击力

export const TILE_SIZE = 24;                  // 瓦片边长 24px
export const FATIGUE_SAFE_RADIUS_TILES = 3;   // 3 瓦片母国安全区
export const FATIGUE_TILES_PER_LAYER = 3;     // 每脱离 3 瓦片累加 1 层
export const FATIGUE_MAX_LAYERS = 5;          // 上限 5 层

export class TotemDefenseSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null]
   */
  constructor(ecs, eventBus = null) {
    this.ecs = ecs;
    this.eventBus = eventBus;

    // 各阵营图腾实体 ID 映射表 (1 ~ 16)
    this.totemEntityIds = new Uint16Array(MAX_FACTIONS + 1);

    // 图腾圣盾波单次战争触发标记 (1 ~ 16)
    this.totemTriggeredFlags = new Uint8Array(MAX_FACTIONS + 1);

    // 图腾金色圣盾持续时间倒计时 (1 ~ 16)
    this.aegisDuration = new Float32Array(MAX_FACTIONS + 1);

    // 复用出参对象
    this._fatigueResult = {
      layers: 0,
      speedMod: 1.0,
      damageMod: 1.0,
      stunResistMod: 1.0
    };
  }

  /**
   * 注册阵营图腾实体
   * @param {number} factionId 
   * @param {number} totemEntityId 
   */
  registerTotem(factionId, totemEntityId) {
    if (factionId <= 0 || factionId > MAX_FACTIONS || totemEntityId <= NULL_ENTITY) return;
    this.totemEntityIds[factionId] = totemEntityId;

    // 赋予绝对静态锁
    setStatus(this.ecs.statusFlags, totemEntityId, IS_STATIC_ANCHOR);
    const phyOff = totemEntityId * PHYSICS_STRIDE;
    this.ecs.physics[phyOff + PHY_OFFSET_MASS] = Infinity;
    this.ecs.physics[phyOff + PHY_OFFSET_INVMASS] = 0.0;
    this.ecs.physics[phyOff + PHY_OFFSET_VX] = 0.0;
    this.ecs.physics[phyOff + PHY_OFFSET_VY] = 0.0;
  }

  /**
   * 重置阵营图腾防御触发状态 (战争重置或和平时期)
   * @param {number} factionId 
   */
  resetTotemTrigger(factionId) {
    if (factionId <= 0 || factionId > MAX_FACTIONS) return;
    this.totemTriggeredFlags[factionId] = 0;
    this.aegisDuration[factionId] = 0.0;
    const totemId = this.totemEntityIds[factionId];
    if (totemId > NULL_ENTITY && this.ecs.isAlive(totemId)) {
      clearStatus(this.ecs.statusFlags, totemId, IS_SACRED_BODY);
    }
  }

  /**
   * 计算实体的远征疲劳惩罚系数
   * @param {number} entityId 
   * @param {object|null} [out=null] 可选复用接收对象
   * @returns {{layers: number, speedMod: number, damageMod: number, stunResistMod: number}}
   */
  getExpeditionFatigue(entityId, out = null) {
    const res = out || this._fatigueResult;
    res.layers = 0;
    res.speedMod = 1.0;
    res.damageMod = 1.0;
    res.stunResistMod = 1.0;

    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) return res;

    const facId = this.ecs.identities[entityId * IDENTITY_STRIDE + ID_OFFSET_FACTION];
    if (facId <= 0 || facId > MAX_FACTIONS) return res;

    const totemId = this.totemEntityIds[facId];
    if (totemId <= NULL_ENTITY || !this.ecs.isAlive(totemId)) return res;

    const uTf = entityId * TRANSFORM_STRIDE;
    const tTf = totemId * TRANSFORM_STRIDE;

    const dx = this.ecs.transforms[uTf + TF_OFFSET_X] - this.ecs.transforms[tTf + TF_OFFSET_X];
    const dy = this.ecs.transforms[uTf + TF_OFFSET_Y] - this.ecs.transforms[tTf + TF_OFFSET_Y];
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const distTiles = distPx / TILE_SIZE;

    if (distTiles > FATIGUE_SAFE_RADIUS_TILES) {
      const extraTiles = distTiles - FATIGUE_SAFE_RADIUS_TILES;
      const layers = Math.min(FATIGUE_MAX_LAYERS, Math.floor(extraTiles / FATIGUE_TILES_PER_LAYER));
      res.layers = layers;
      res.speedMod = 1.0 - 0.04 * layers;
      res.damageMod = 1.0 - 0.05 * layers;
      res.stunResistMod = 1.0 - 0.08 * layers;
    }

    return res;
  }

  /**
   * 触发图腾 25% 圣火涅槃冲击波
   * @param {number} factionId 
   */
  triggerTotemAegis(factionId) {
    if (factionId <= 0 || factionId > MAX_FACTIONS) return;
    if (this.totemTriggeredFlags[factionId] !== 0) return; // 单次战争限 1 次

    const totemId = this.totemEntityIds[factionId];
    if (totemId <= NULL_ENTITY || !this.ecs.isAlive(totemId)) return;

    this.totemTriggeredFlags[factionId] = 1;
    this.aegisDuration[factionId] = TOTEM_AEGIS_DURATION;

    // 图腾获得金色无敌圣盾
    setStatus(this.ecs.statusFlags, totemId, IS_SACRED_BODY);

    const tTf = totemId * TRANSFORM_STRIDE;
    const tx = this.ecs.transforms[tTf + TF_OFFSET_X];
    const ty = this.ecs.transforms[tTf + TF_OFFSET_Y];

    const radiusPx = TOTEM_AEGIS_RADIUS_TILES * TILE_SIZE; // 144px
    const r2 = radiusPx * radiusPx;

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    // 冲击波范围内敌军强力弹飞并施加 2.5s 眩晕
    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY || eid === totemId) continue;

      const otherFac = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (otherFac === factionId) continue; // 不伤同阵营

      const oTf = eid * TRANSFORM_STRIDE;
      const dx = this.ecs.transforms[oTf + TF_OFFSET_X] - tx;
      const dy = this.ecs.transforms[oTf + TF_OFFSET_Y] - ty;
      const d2 = dx * dx + dy * dy;

      if (d2 <= r2 && d2 > 0.0001) {
        const dist = Math.sqrt(d2);
        const nx = dx / dist;
        const ny = dy / dist;

        // 强力弹飞
        const phyOff = eid * PHYSICS_STRIDE;
        this.ecs.physics[phyOff + PHY_OFFSET_VX] = nx * TOTEM_KNOCKBACK_FORCE;
        this.ecs.physics[phyOff + PHY_OFFSET_VY] = ny * TOTEM_KNOCKBACK_FORCE;

        // 眩晕
        setStatus(this.ecs.statusFlags, eid, IS_STUNNED);
      }
    }

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_TOTEM_AEGIS_TRIGGERED, factionId, totemId, 0, 0);
    }
  }

  /**
   * 系统每帧更新
   * @param {number} dt 
   */
  update(dt) {
    for (let f = 1; f <= MAX_FACTIONS; f++) {
      const totemId = this.totemEntityIds[f];
      if (totemId <= NULL_ENTITY || !this.ecs.isAlive(totemId)) continue;

      // 保证图腾物理绝对静态
      const phyOff = totemId * PHYSICS_STRIDE;
      this.ecs.physics[phyOff + PHY_OFFSET_VX] = 0.0;
      this.ecs.physics[phyOff + PHY_OFFSET_VY] = 0.0;

      // 检查圣盾倒计时
      if (this.aegisDuration[f] > 0.0) {
        this.aegisDuration[f] = Math.max(0.0, this.aegisDuration[f] - dt);
        if (this.aegisDuration[f] === 0.0) {
          clearStatus(this.ecs.statusFlags, totemId, IS_SACRED_BODY);
        }
      }

      // 检查生命值是否跌破 25%
      if (this.totemTriggeredFlags[f] === 0) {
        const hpOff = totemId * HEALTH_STRIDE;
        const curHp = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
        const maxHp = this.ecs.health[hpOff + HP_OFFSET_MAX];
        if (maxHp > 0 && curHp <= maxHp * TOTEM_AEGIS_HP_THRESHOLD) {
          this.triggerTotemAegis(f);
        }
      }
    }
  }
}
