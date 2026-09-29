/**
 * DivineMiraclesSystem.js
 * 六大上帝玩具技能与信仰神恩池系统
 * 严格遵照 SPEC-M4-CONTRACT §2.1
 *
 * 核心特性:
 * 1. 信仰神恩池 (Fervor 0.0 ~ 100.0, 默认 30.0)
 * 2. 六大神迹: 生机甘霖, 神圣果实, 神圣天雷, 狂暴圣战, 神圣休战, 灭世陨石
 * 3. 冷却与消耗独立管理，零 GC 驱动
 */

import {
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  PHYSICS_STRIDE,
  PHY_OFFSET_MASS,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../core/ECS.js';
import {
  IS_ALIVE,
  IS_SACRED_BODY,
  hasStatus
} from '../components/UnitStatusFlags.js';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  TOTAL_TILES,
  TILE_SIZE
} from '../world/TileGrid.js';
import { HazardTypes, Biomes } from '../data/BiomeData.js';
import { DomainEvents } from '../data/DomainEvents.js';
import { MAX_FACTIONS, FACTION_STRIDE, FAC_OFFSET_WAR_COOLDOWN } from '../data/FactionData.js';

export const MiracleId = Object.freeze({
  DIVINE_RAIN: 0,      // 生机甘霖 (8s 圣雨灭火回血)
  HOLY_FRUIT: 1,       // 神圣果实 (满血体魄高阶突变)
  HOLY_THUNDER: 2,     // 神圣天雷 (200 真伤雷坑)
  WAR_HORN: 3,         // 狂暴圣战 (破除休战全军冲锋)
  PAX_DIVINA: 4,       // 神圣休战 (20s 仇恨清零休战)
  METEOR_CATACLYSM: 5  // 灭世陨石 (400 真伤熔岩池大灭绝)
});

export const MiracleConfig = Object.freeze([
  // 0: DIVINE_RAIN
  Object.freeze({ cost: 20, cd: 12.0, radiusTiles: 4 }),
  // 1: HOLY_FRUIT
  Object.freeze({ cost: 35, cd: 18.0, radiusTiles: 1 }),
  // 2: HOLY_THUNDER
  Object.freeze({ cost: 40, cd: 15.0, radiusTiles: 2 }),
  // 3: WAR_HORN
  Object.freeze({ cost: 50, cd: 30.0, radiusTiles: 0 }),
  // 4: PAX_DIVINA
  Object.freeze({ cost: 50, cd: 30.0, radiusTiles: 0 }),
  // 5: METEOR_CATACLYSM
  Object.freeze({ cost: 90, cd: 60.0, radiusTiles: 5 })
]);

export const DEFAULT_FERVOR = 30.0;
export const MAX_FERVOR = 100.0;

export class DivineMiraclesSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {import('../world/TileGrid.js').TileGrid} tileGrid 
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null] 
   * @param {Int32Array|null} [factionBuffer=null] 
   * @param {import('../warfare/BorderFrictionSystem.js').BorderFrictionSystem|null} [frictionSystem=null]
   */
  constructor(ecs, tileGrid, eventBus = null, factionBuffer = null, frictionSystem = null) {
    this.ecs = ecs;
    this.tileGrid = tileGrid;
    this.eventBus = eventBus;
    this.factionBuffer = factionBuffer;
    this.frictionSystem = frictionSystem;

    // 全局神恩值 (0.0 ~ 100.0)
    this.fervor = DEFAULT_FERVOR;

    // 各神迹当前冷却时间倒计时 (秒)
    this.cooldowns = new Float32Array(6);

    // 活跃持续性神迹 (如生机甘霖圣雨计时器)
    this.activeRainTimers = new Float32Array(TOTAL_TILES);
  }

  /**
   * 注入神恩值 (祈祷 +2.0, 史诗击杀 +5.0, 神迹命中 +10.0)
   * @param {number} amount 
   */
  addFervor(amount) {
    this.fervor = Math.max(0.0, Math.min(MAX_FERVOR, this.fervor + amount));
  }

  /**
   * 检查神迹是否可释放 (神恩充足且冷却完毕)
   * @param {number} miracleId 
   * @param {boolean} [isOverdrive=false] 是否处于狂欢免消耗无冷却模式
   * @returns {boolean}
   */
  canCast(miracleId, isOverdrive = false) {
    if (miracleId < 0 || miracleId >= MiracleConfig.length) return false;
    if (isOverdrive) return true;

    const cfg = MiracleConfig[miracleId];
    return this.fervor >= cfg.cost && this.cooldowns[miracleId] <= 0.0;
  }

  /**
   * 释放上帝神技
   *
   * @param {number} miracleId 神迹 ID
   * @param {number} targetWorldX 目标世界坐标 X
   * @param {number} targetWorldY 目标世界坐标 Y
   * @param {boolean} [isOverdrive=false] 是否处于狂欢免费模式
   * @returns {boolean} 是否施放成功
   */
  castMiracle(miracleId, targetWorldX, targetWorldY, isOverdrive = false) {
    if (!this.canCast(miracleId, isOverdrive)) {
      return false;
    }

    const cfg = MiracleConfig[miracleId];

    // 扣除神恩并重置冷却 (狂欢模式免除)
    if (!isOverdrive) {
      this.fervor -= cfg.cost;
      this.cooldowns[miracleId] = cfg.cd;
    }

    const tx = Math.max(0, Math.min(GRID_WIDTH - 1, Math.floor(targetWorldX / TILE_SIZE)));
    const ty = Math.max(0, Math.min(GRID_HEIGHT - 1, Math.floor(targetWorldY / TILE_SIZE)));
    const tileIdx = ty * GRID_WIDTH + tx;

    switch (miracleId) {
      case MiracleId.DIVINE_RAIN:
        this._applyDivineRain(tx, ty, cfg.radiusTiles);
        break;

      case MiracleId.HOLY_FRUIT:
        this._applyHolyFruit(tx, ty);
        break;

      case MiracleId.HOLY_THUNDER:
        this._applyHolyThunder(tx, ty, cfg.radiusTiles);
        break;

      case MiracleId.WAR_HORN:
        this._applyWarHorn();
        break;

      case MiracleId.PAX_DIVINA:
        this._applyPaxDivina();
        break;

      case MiracleId.METEOR_CATACLYSM:
        this._applyMeteorCataclysm(tx, ty, cfg.radiusTiles);
        break;
    }

    return true;
  }

  /**
   * 1. 生机甘霖: 半径 4 格灭火、提升养分、持续 8 秒每秒回血
   * @private
   */
  _applyDivineRain(centerTx, centerTy, radiusTiles) {
    const r = radiusTiles;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = centerTx + dx;
        const ny = centerTy + dy;
        if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT) continue;
        if (dx * dx + dy * dy <= r * r) {
          const idx = ny * GRID_WIDTH + nx;
          // 扑灭火灾
          if (this.tileGrid.hazardType[idx] === HazardTypes.FIRE) {
            this.tileGrid.hazardType[idx] = HazardTypes.NONE;
            this.tileGrid.hazardDamage[idx] = 0.0;
          }
          // 提升养分
          this.tileGrid.nutrientFloor[idx] = Math.min(1.0, this.tileGrid.nutrientFloor[idx] + 0.35);
          // 激活 8 秒圣雨
          this.activeRainTimers[idx] = 8.0;
        }
      }
    }

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_MIRACLE_RAIN, centerTy * GRID_WIDTH + centerTx, r, 0, 0);
    }
  }

  /**
   * 2. 神圣果实: 光标点降下金苹果，争夺吃下者生命全满、质量变大 1.3 倍
   * @private
   */
  _applyHolyFruit(centerTx, centerTy) {
    const worldX = centerTx * TILE_SIZE + 12.0;
    const worldY = centerTy * TILE_SIZE + 12.0;

    // 寻找距该中心最近的一名存活实体食用
    let closestEid = NULL_ENTITY;
    let minD2 = 48.0 * 48.0; // 2 瓦片内寻找

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      const tf = eid * TRANSFORM_STRIDE;
      const ex = this.ecs.transforms[tf + TF_OFFSET_X];
      const ey = this.ecs.transforms[tf + TF_OFFSET_Y];
      const d2 = (ex - worldX) * (ex - worldX) + (ey - worldY) * (ey - worldY);

      if (d2 < minD2) {
        minD2 = d2;
        closestEid = eid;
      }
    }

    if (closestEid > NULL_ENTITY) {
      // HP 回满
      const hpOff = closestEid * HEALTH_STRIDE;
      this.ecs.health[hpOff + HP_OFFSET_CURRENT] = this.ecs.health[hpOff + HP_OFFSET_MAX];
      // 质量增加 1.3 倍
      const phyOff = closestEid * PHYSICS_STRIDE;
      this.ecs.physics[phyOff + PHY_OFFSET_MASS] *= 1.3;
    }

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_MIRACLE_FRUIT, centerTy * GRID_WIDTH + centerTx, closestEid, 0, 0);
    }
  }

  /**
   * 3. 神圣天雷: 半径 2 格轰出 200 点毁灭真伤与焦黑雷坑
   * @private
   */
  _applyHolyThunder(centerTx, centerTy, radiusTiles) {
    const r = radiusTiles;
    const centerX = centerTx * TILE_SIZE + 12.0;
    const centerY = centerTy * TILE_SIZE + 12.0;
    const rPx = r * TILE_SIZE;
    const r2 = rPx * rPx;

    // 地面留下焦黑雷坑 (烈焰伤害)
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = centerTx + dx;
        const ny = centerTy + dy;
        if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT) continue;
        if (dx * dx + dy * dy <= r * r) {
          const idx = ny * GRID_WIDTH + nx;
          this.tileGrid.hazardType[idx] = HazardTypes.FIRE;
          this.tileGrid.hazardDamage[idx] = 1.0;
        }
      }
    }

    // 轰击范围内实体
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      if (hasStatus(this.ecs.statusFlags, eid, IS_SACRED_BODY)) continue;

      const tf = eid * TRANSFORM_STRIDE;
      const ex = this.ecs.transforms[tf + TF_OFFSET_X];
      const ey = this.ecs.transforms[tf + TF_OFFSET_Y];
      const d2 = (ex - centerX) * (ex - centerX) + (ey - centerY) * (ey - centerY);

      if (d2 <= r2) {
        const hpOff = eid * HEALTH_STRIDE;
        const curHp = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
        this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.max(0.0, curHp - 200.0);
      }
    }

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_MIRACLE_THUNDER, centerTy * GRID_WIDTH + centerTx, 200, 0, 0);
    }
  }

  /**
   * 4. 狂暴圣战: 破除所有停战保护锁，全军士气拉满发起冲锋
   * @private
   */
  _applyWarHorn() {
    // 清除阵营停战冷却锁
    if (this.factionBuffer) {
      for (let f = 1; f <= MAX_FACTIONS; f++) {
        this.factionBuffer[(f - 1) * FACTION_STRIDE + FAC_OFFSET_WAR_COOLDOWN] = 0;
      }
    }

    // 全图活体士兵士气拉满至 100
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      const mOff = eid * MORALE_STRIDE;
      this.ecs.morale[mOff + MORALE_OFFSET_VAL] = 100.0;
    }

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_MIRACLE_WAR_HORN, 0, 0, 0, 0);
    }
  }

  /**
   * 5. 神圣休战: 20 秒神圣和平锁，全员仇恨清零
   * @private
   */
  _applyPaxDivina() {
    if (this.factionBuffer) {
      for (let f = 1; f <= MAX_FACTIONS; f++) {
        this.factionBuffer[(f - 1) * FACTION_STRIDE + FAC_OFFSET_WAR_COOLDOWN] = 20;
      }
    }

    if (this.frictionSystem) {
      for (let a = 1; a <= MAX_FACTIONS; a++) {
        for (let b = a + 1; b <= MAX_FACTIONS; b++) {
          this.frictionSystem.enforcePeace(a, b, 20.0);
        }
      }
    }

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_PAX_DIVINA_FORCED, 0, 0, 0, 0);
    }
  }

  /**
   * 6. 灭世陨石: 半径 5 格 400 点真伤，化为熔岩池
   * @private
   */
  _applyMeteorCataclysm(centerTx, centerTy, radiusTiles) {
    const r = radiusTiles;
    const centerX = centerTx * TILE_SIZE + 12.0;
    const centerY = centerTy * TILE_SIZE + 12.0;
    const rPx = r * TILE_SIZE;
    const r2 = rPx * rPx;

    // 地形化为地热熔岩
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = centerTx + dx;
        const ny = centerTy + dy;
        if (nx < 0 || nx >= GRID_WIDTH || ny < 0 || ny >= GRID_HEIGHT) continue;
        if (dx * dx + dy * dy <= r * r) {
          const idx = ny * GRID_WIDTH + nx;
          this.tileGrid.tileTypes[idx] = Biomes.VOLCANO.id;
          this.tileGrid.moveCost[idx] = Biomes.VOLCANO.moveCostMultiplier;
          this.tileGrid.hazardType[idx] = HazardTypes.FIRE;
          this.tileGrid.hazardDamage[idx] = 2.0;
        }
      }
    }

    // 伤害结算
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY) continue;

      if (hasStatus(this.ecs.statusFlags, eid, IS_SACRED_BODY)) continue;

      const tf = eid * TRANSFORM_STRIDE;
      const ex = this.ecs.transforms[tf + TF_OFFSET_X];
      const ey = this.ecs.transforms[tf + TF_OFFSET_Y];
      const d2 = (ex - centerX) * (ex - centerX) + (ey - centerY) * (ey - centerY);

      if (d2 <= r2) {
        const hpOff = eid * HEALTH_STRIDE;
        const curHp = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
        this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.max(0.0, curHp - 400.0);
      }
    }

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_MIRACLE_METEOR, centerTy * GRID_WIDTH + centerTx, 400, 0, 0);
    }
  }

  /**
   * 系统每帧更新 (冷却衰减与圣雨滋润回血)
   * @param {number} dt 
   */
  update(dt) {
    // 冷却倒计时衰减
    for (let i = 0; i < this.cooldowns.length; i++) {
      if (this.cooldowns[i] > 0.0) {
        this.cooldowns[i] = Math.max(0.0, this.cooldowns[i] - dt);
      }
    }

    // 活跃圣雨衰减与范围内回血
    let hasActiveRain = false;
    for (let i = 0; i < TOTAL_TILES; i++) {
      if (this.activeRainTimers[i] > 0.0) {
        this.activeRainTimers[i] = Math.max(0.0, this.activeRainTimers[i] - dt);
        hasActiveRain = true;
      }
    }

    if (hasActiveRain) {
      const dense = this.ecs.denseEntities;
      const total = this.ecs.activeCount;

      for (let i = 0; i < total; i++) {
        const eid = dense[i];
        if (eid === NULL_ENTITY) continue;

        const tf = eid * TRANSFORM_STRIDE;
        const tx = Math.floor(this.ecs.transforms[tf + TF_OFFSET_X] / TILE_SIZE);
        const ty = Math.floor(this.ecs.transforms[tf + TF_OFFSET_Y] / TILE_SIZE);

        if (tx >= 0 && tx < GRID_WIDTH && ty >= 0 && ty < GRID_HEIGHT) {
          const idx = ty * GRID_WIDTH + tx;
          if (this.activeRainTimers[idx] > 0.0) {
            // 每秒回血 6% 最大生命
            const hpOff = eid * HEALTH_STRIDE;
            const curHp = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
            const maxHp = this.ecs.health[hpOff + HP_OFFSET_MAX];
            const heal = maxHp * 0.06 * dt;
            this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.min(maxHp, curHp + heal);
          }
        }
      }
    }
  }
}
