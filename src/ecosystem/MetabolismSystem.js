/**
 * MetabolismSystem.js
 * 12 种族专属主干生存代谢与饥饿损耗系统
 * 
 * 核心指标:
 * 1. 12 种族专属生存代谢率 (严格对齐 RaceData.js)
 * 2. 连续平铺内存读写: ECS PhysiologyComponent (hunger, emergencyLock) 与 HealthComponent
 * 3. hunger > 80 时以 0.5 HP/s 持续损耗生命值
 * 4. hp <= 0 时派发 EVT_DEATH_STARVATION 关键领域事件 (0x8001/0x800F)
 *    载荷: srcId = entityId, targetId = 0, p1 = tileIndex, p2 = raceNumericId
 * 5. 安全回收实体并沉降骨肥到地脉连续养分场 (保底 15.0 点)
 * 6. 0 号墓碑 (NULL_ENTITY) 绝对隔离，免受任何代谢影响
 * 7. 热路径纯 TypedArray 查表，100% 物理零 GC
 */

import {
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL
} from '../core/ECS.js';
import { IS_ALIVE } from '../components/UnitStatusFlags.js';
import { Races, RaceList, MetabolicTypes } from '../data/RaceData.js';
import { InitialFactions, MAX_FACTIONS } from '../data/FactionData.js';
import { DomainEvents } from '../data/DomainEvents.js';
import { GRID_WIDTH, GRID_HEIGHT, TILE_SIZE, TOTAL_TILES } from '../world/TileGrid.js';

export const STARVATION_HUNGER_THRESHOLD = 80.0; // 饥饿警戒阈值
export const STARVATION_DPS = 0.5;               // 饥荒每秒损耗 0.5 HP
export const STARVATION_MORALE_DPS = 2.0;        // 饥饿持续损耗士气 2.0/s
export const BASE_HUNGER_RATE = 1.0;             // 基准每秒饥饿增加量
export const CORPSE_NUTRIENT_RATIO = 0.20;       // 骨肥沉降养分比例 (质量的 20%)
export const MIN_BONE_MEAL = 15.0;               // 契约规定的保底骨肥养分

export class MetabolismSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs
   * @param {import('../ecosystem/NutrientField.js').NutrientField|null} [nutrientField=null]
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null]
   */
  constructor(ecs, nutrientField = null, eventBus = null) {
    this.ecs = ecs;
    this.nutrientField = nutrientField;
    this.eventBus = eventBus;

    // 预编译 12 种族原生参数表 (Float32/Uint8Array，零 GC 查表)
    const numRaces = RaceList.length;
    this.raceMetabolicRate = new Float32Array(numRaces);
    this.raceMetabolicType = new Uint8Array(numRaces);
    this.raceMass = new Float32Array(numRaces);

    for (let r = 0; r < numRaces; r++) {
      const race = RaceList[r];
      this.raceMetabolicRate[r] = race.metabolicRate;
      this.raceMetabolicType[r] = race.metabolicType;
      this.raceMass[r] = race.mass;
    }

    // 预编译 16 阵营对应的种族查找表 (MAX_FACTIONS = 16)
    this.factionMetabolicRate = new Float32Array(MAX_FACTIONS);
    this.factionMetabolicType = new Uint8Array(MAX_FACTIONS);
    this.factionMass = new Float32Array(MAX_FACTIONS);
    this.factionRaceIndex = new Uint8Array(MAX_FACTIONS);

    // 独立实体种族重写表 (4097 槽，支持自定义单体种族)
    this.entityRaceOverride = new Int8Array(4097).fill(-1);

    // 出参单例对象 (供冷路径查询调用，杜绝临时分配)
    this._profileResult = {
      metabolicRate: 1.0,
      metabolicType: MetabolicTypes.AGRARIAN,
      mass: 65.0,
      raceNumericId: 0
    };

    this._initFactionLookup();
  }

  /**
   * 预编译 16 阵营对应的种族代谢物理参数
   * @private
   */
  _initFactionLookup() {
    for (let f = 0; f < MAX_FACTIONS; f++) {
      const fac = InitialFactions[f];
      let rIdx = 0;
      if (fac) {
        rIdx = RaceList.findIndex(r => r.id === fac.raceId);
        if (rIdx < 0) rIdx = 0;
      }
      this.factionRaceIndex[f] = rIdx;
      this.factionMetabolicRate[f] = this.raceMetabolicRate[rIdx];
      this.factionMetabolicType[f] = this.raceMetabolicType[rIdx];
      this.factionMass[f] = this.raceMass[rIdx];
    }
  }

  /**
   * 显式设置某个实体的种族映射覆盖
   * @param {number} entityId 
   * @param {string} raceId 
   */
  setEntityRace(entityId, raceId) {
    if (entityId <= NULL_ENTITY || entityId > 4096) return;
    const raceIdx = RaceList.findIndex(r => r.id === raceId);
    this.entityRaceOverride[entityId] = raceIdx;
  }

  /**
   * 获取实体的代谢率与代谢范式 (冷路径查询，重用内部单例)
   * @param {number} entityId 
   * @returns {{ metabolicRate: number, metabolicType: number, mass: number, raceNumericId: number }}
   */
  getEntityMetabolicProfile(entityId) {
    const overrideIdx = this.entityRaceOverride[entityId];
    if (overrideIdx >= 0 && overrideIdx < RaceList.length) {
      this._profileResult.metabolicRate = this.raceMetabolicRate[overrideIdx];
      this._profileResult.metabolicType = this.raceMetabolicType[overrideIdx];
      this._profileResult.mass = this.raceMass[overrideIdx];
      this._profileResult.raceNumericId = overrideIdx;
      return this._profileResult;
    }

    const factionId = this.ecs.identities[entityId * IDENTITY_STRIDE + ID_OFFSET_FACTION];
    const safeFac = factionId >= 0 && factionId < MAX_FACTIONS ? factionId : 0;
    this._profileResult.metabolicRate = this.factionMetabolicRate[safeFac];
    this._profileResult.metabolicType = this.factionMetabolicType[safeFac];
    this._profileResult.mass = this.factionMass[safeFac];
    this._profileResult.raceNumericId = this.factionRaceIndex[safeFac];
    return this._profileResult;
  }

  /**
   * 主干代谢更新步进 (热路径绝对零 GC，连续内存无缝迭代)
   * @param {number} dt - 步进步长 (秒)
   */
  update(dt) {
    const ecs = this.ecs;
    const activeCount = ecs.getActiveCount();
    const dense = ecs.getActiveEntities();
    const flags = ecs.statusFlags;
    const phys = ecs.physiology;
    const health = ecs.health;
    const tf = ecs.transforms;
    const identities = ecs.identities;
    const bus = this.eventBus;
    const nf = this.nutrientField;

    const hungerDps = STARVATION_DPS * dt;

    // 倒序遍历以支持在循环中安全 freeEntity
    for (let i = activeCount - 1; i >= 0; i--) {
      const entityId = dense[i];

      // 0 号墓碑 (NULL_ENTITY) 绝对隔离守卫
      if (entityId <= NULL_ENTITY) continue;

      // 存活位校验
      if ((flags[entityId] & IS_ALIVE) === 0) continue;

      // 纯 TypedArray 极速查表 (零对象分配)
      const overrideIdx = this.entityRaceOverride[entityId];
      let metabolicRate, metabolicType, mass, raceNumericId;

      if (overrideIdx >= 0) {
        metabolicRate = this.raceMetabolicRate[overrideIdx];
        metabolicType = this.raceMetabolicType[overrideIdx];
        mass = this.raceMass[overrideIdx];
        raceNumericId = overrideIdx;
      } else {
        const factionId = identities[entityId * IDENTITY_STRIDE + ID_OFFSET_FACTION];
        const safeFac = factionId >= 0 && factionId < MAX_FACTIONS ? factionId : 0;
        metabolicRate = this.factionMetabolicRate[safeFac];
        metabolicType = this.factionMetabolicType[safeFac];
        mass = this.factionMass[safeFac];
        raceNumericId = this.factionRaceIndex[safeFac];
      }

      // 无机死灵型生物 (UNDEAD, GOLEM, ABERR) 完全免除有机饥饿
      if (metabolicType === MetabolicTypes.INORGANIC || metabolicRate === 0.0) {
        phys[entityId * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 0.0;
        continue;
      }

      const physOffset = entityId * PHYSIOLOGY_STRIDE;
      let currentHunger = phys[physOffset + PHY_OFFSET_HUNGER];

      // 正常主干饥饿消耗累加
      currentHunger += metabolicRate * BASE_HUNGER_RATE * dt;
      if (currentHunger > 100.0) {
        currentHunger = 100.0;
      }
      phys[physOffset + PHY_OFFSET_HUNGER] = currentHunger;

      // 饥饿损耗生命值与士气结算
      if (currentHunger >= STARVATION_HUNGER_THRESHOLD) {
        // 持续降低士气 (崩溃减益 STARVATION_MORALE_DPS = 2.0 / s)
        const moraleOffset = entityId * MORALE_STRIDE + MORALE_OFFSET_VAL;
        if (ecs.morale[moraleOffset] > 0.0) {
          ecs.morale[moraleOffset] = Math.max(0.0, ecs.morale[moraleOffset] - STARVATION_MORALE_DPS * dt);
        }

        const hpOffset = entityId * HEALTH_STRIDE + HP_OFFSET_CURRENT;
        let hp = health[hpOffset] - hungerDps;

        if (hp <= 0.0) {
          hp = 0.0;
          health[hpOffset] = 0.0;

          // 获取实体当前所在瓦片
          const tfOffset = entityId * TRANSFORM_STRIDE;
          const wx = tf[tfOffset + TF_OFFSET_X];
          const wy = tf[tfOffset + TF_OFFSET_Y];
          const tx = Math.max(0, Math.min(GRID_WIDTH - 1, Math.floor(wx / TILE_SIZE)));
          const ty = Math.max(0, Math.min(GRID_HEIGHT - 1, Math.floor(wy / TILE_SIZE)));
          const tileIdx = ty * GRID_WIDTH + tx;

          // 沉降骨肥回流地脉连续养分场 (契约保底 15.0 点)
          if (nf) {
            const boneMeal = mass > 0 ? Math.max(MIN_BONE_MEAL, mass * CORPSE_NUTRIENT_RATIO) : MIN_BONE_MEAL;
            nf.addNutrientByIndex(tileIdx, boneMeal);
          }

          // 派发 EVT_DEATH_STARVATION 关键领域事件
          // 契约签名: srcId = entityId, targetId = 0, p1 = tileIndex, p2 = raceNumericId
          if (bus) {
            bus.emit(
              DomainEvents.EVT_DEATH_STARVATION,
              entityId,
              0,
              tileIdx,
              raceNumericId
            );
          }

          // 安全原子回收实体
          ecs.freeEntity(entityId);
        } else {
          health[hpOffset] = hp;
        }
      }
    }
  }
}
