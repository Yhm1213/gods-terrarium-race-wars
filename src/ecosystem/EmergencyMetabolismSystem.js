/**
 * EmergencyMetabolismSystem.js
 * 极端饥荒应急生存网与 10s 通道互斥锁系统
 * 
 * 核心设计指标:
 * 1. 饥荒降级策略分支表:
 *    - 农耕种族 (AGRARIAN): 就地啃食杂草/树皮 (hunger -15, hp -5, morale -20)
 *    - 捕猎种族 (HUNTER): 食用腐肉残渣 (hunger -25, PRNG 50% 确定性致病率)
 *    - 掠夺种族 (MARAUDER): 同伴互殴抢夺口粮 (hunger -20, 派发 EVT_BRAWL_RATION)
 * 2. 10 秒通道独占互斥锁 (Channel Mutex):
 *    - 激活写入 emergencyLockTimer = 10.0 并置位 IS_EMERGENCY_LOCK
 *    - 锁定期间行为树与寻路绝对不可打断
 *    - 满 10 秒且 hunger < 50.0 释放互斥锁，彻底杜绝 10 帧抖动抽搐死锁
 * 3. 纯 SoA TypedArray 读写，绝对零 GC
 */

import {
  NULL_ENTITY,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER,
  PHY_OFFSET_EMERGENCY_LOCK,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../core/ECS.js';
import {
  IS_ALIVE,
  IS_EMERGENCY_LOCK,
  hasStatus,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';
import { Races, RaceList, MetabolicTypes } from '../data/RaceData.js';
import { InitialFactions, MAX_FACTIONS } from '../data/FactionData.js';
import { DomainEvents } from '../data/DomainEvents.js';
import { PRNG } from '../core/PRNG.js';

export const EMERGENCY_TRIGGER_THRESHOLD = 80.0; // 应急切入阈值
export const EMERGENCY_RELEASE_THRESHOLD = 50.0; // 互斥锁释放阈值
export const EMERGENCY_LOCK_DURATION = 10.0;     // 互斥锁独占锁定时长 10.0 秒
export const SICKNESS_PROBABILITY = 0.50;        // 食用腐肉致病率 50%

export class EmergencyMetabolismSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null]
   * @param {import('../core/PRNG.js').PRNG|null} [prng=null]
   */
  constructor(ecs, eventBus = null, prng = null) {
    this.ecs = ecs;
    this.eventBus = eventBus;
    this.prng = prng || new PRNG(1337);

    // 预编译 16 阵营对应的代谢范式查找表 (MAX_FACTIONS = 16)
    this.factionMetabolicType = new Uint8Array(MAX_FACTIONS);
    // 独立实体种族重写表 (4097 槽)
    this.entityRaceOverride = new Int8Array(4097).fill(-1);

    this._initFactionLookup();
  }

  /**
   * 预编译 16 阵营对应的种族代谢类型
   * @private
   */
  _initFactionLookup() {
    for (let f = 0; f < MAX_FACTIONS; f++) {
      const fac = InitialFactions[f];
      if (fac) {
        const race = Races[fac.raceId] || Races.HUMAN;
        this.factionMetabolicType[f] = race.metabolicType;
      } else {
        this.factionMetabolicType[f] = MetabolicTypes.AGRARIAN;
      }
    }
  }

  /**
   * 显式指定实体的种族
   * @param {number} entityId 
   * @param {string} raceId 
   */
  setEntityRace(entityId, raceId) {
    if (entityId <= NULL_ENTITY || entityId > 4096) return;
    const raceIdx = RaceList.findIndex(r => r.id === raceId);
    this.entityRaceOverride[entityId] = raceIdx;
  }

  /**
   * 获取实体的代谢范式
   * @param {number} entityId 
   * @returns {number}
   */
  getEntityMetabolicType(entityId) {
    const overrideIdx = this.entityRaceOverride[entityId];
    if (overrideIdx >= 0 && overrideIdx < RaceList.length) {
      return RaceList[overrideIdx].metabolicType;
    }
    const factionId = this.ecs.identities[entityId * IDENTITY_STRIDE + ID_OFFSET_FACTION];
    const safeFac = factionId >= 0 && factionId < MAX_FACTIONS ? factionId : 0;
    return this.factionMetabolicType[safeFac];
  }

  /**
   * 检查实体当前是否处于应急互斥锁锁定状态 (timer > 0 且拥有标志位)
   * 锁定期间严禁外部寻路或状态机打断啃食动作
   * @param {number} entityId 
   * @returns {boolean}
   */
  isEmergencyLocked(entityId) {
    if (entityId <= NULL_ENTITY) return false;
    if (!hasStatus(this.ecs.statusFlags, entityId, IS_EMERGENCY_LOCK)) {
      return false;
    }
    const lockTimer = this.ecs.physiology[entityId * PHYSIOLOGY_STRIDE + PHY_OFFSET_EMERGENCY_LOCK];
    return lockTimer > 0.0;
  }

  /**
   * 触发实体的应急代谢动作 (加锁 10s 并执行对应范式进食)
   * @param {number} entityId 
   * @returns {boolean} 是否成功切入 (若已在锁定中则返回 false 拦截)
   */
  triggerEmergency(entityId) {
    if (entityId <= NULL_ENTITY) return false;
    const flags = this.ecs.statusFlags;
    if ((flags[entityId] & IS_ALIVE) === 0) return false;

    // 若互斥锁未走完，严禁打断重入
    if (this.isEmergencyLocked(entityId)) {
      return false;
    }

    const metabolicType = this.getEntityMetabolicType(entityId);
    // 无机种族 (INORGANIC) 免饥饿，不切应急
    if (metabolicType === MetabolicTypes.INORGANIC) {
      return false;
    }

    const phys = this.ecs.physiology;
    const health = this.ecs.health;
    const morale = this.ecs.morale;
    const physOffset = entityId * PHYSIOLOGY_STRIDE;
    const hpOffset = entityId * HEALTH_STRIDE + HP_OFFSET_CURRENT;
    const morOffset = entityId * MORALE_STRIDE + MORALE_OFFSET_VAL;

    // 1. 原子激活 10s 独占互斥锁
    phys[physOffset + PHY_OFFSET_EMERGENCY_LOCK] = EMERGENCY_LOCK_DURATION;
    setStatus(flags, entityId, IS_EMERGENCY_LOCK);

    // 2. 按种族范式执行应急进食策略分支
    let currentHunger = phys[physOffset + PHY_OFFSET_HUNGER];
    let currentHp = health[hpOffset];
    let currentMorale = morale[morOffset];

    switch (metabolicType) {
      case MetabolicTypes.AGRARIAN: {
        // 农耕种族: 啃食杂草/树皮
        // 恢复 15 饥饿，扣 5 点生命，扣 20 士气
        currentHunger = Math.max(0.0, currentHunger - 15.0);
        currentHp = Math.max(1.0, currentHp - 5.0); // 啃树皮保底 1 点生命，不致死
        currentMorale = Math.max(0.0, currentMorale - 20.0);
        break;
      }

      case MetabolicTypes.HUNTER: {
        // 捕猎种族: 食用腐肉残渣
        // 恢复 25 饥饿，PRNG 50% 确定性致病率判定
        currentHunger = Math.max(0.0, currentHunger - 25.0);
        const fellSick = this.prng.nextFloat() < SICKNESS_PROBABILITY;
        if (fellSick) {
          // 致病减损 10 HP 与 15 士气
          currentHp = Math.max(1.0, currentHp - 10.0);
          currentMorale = Math.max(0.0, currentMorale - 15.0);
        }
        break;
      }

      case MetabolicTypes.MARAUDER: {
        // 掠夺种族: 同伴互殴抢夺口粮
        // 恢复 20 饥饿，扣 10 士气
        currentHunger = Math.max(0.0, currentHunger - 20.0);
        currentMorale = Math.max(0.0, currentMorale - 10.0);

        if (this.eventBus) {
          this.eventBus.emit(
            DomainEvents.EVT_BRAWL_RATION,
            entityId,
            0,
            20,
            0
          );
        }
        break;
      }
    }

    phys[physOffset + PHY_OFFSET_HUNGER] = currentHunger;
    health[hpOffset] = currentHp;
    morale[morOffset] = currentMorale;

    return true;
  }

  /**
   * 应急代谢系统逐帧更新 (热路径绝对零 GC)
   * @param {number} dt - 步进步长 (秒)
   */
  update(dt) {
    const ecs = this.ecs;
    const activeCount = ecs.getActiveCount();
    const dense = ecs.getActiveEntities();
    const flags = ecs.statusFlags;
    const phys = ecs.physiology;

    for (let i = 0; i < activeCount; i++) {
      const entityId = dense[i];
      if (entityId <= NULL_ENTITY) continue;
      if ((flags[entityId] & IS_ALIVE) === 0) continue;

      const physOffset = entityId * PHYSIOLOGY_STRIDE;
      let lockTimer = phys[physOffset + PHY_OFFSET_EMERGENCY_LOCK];

      // 1. 处理正在生效的 10 秒独占互斥锁倒计时
      if (hasStatus(flags, entityId, IS_EMERGENCY_LOCK)) {
        const remaining = lockTimer - dt;
        lockTimer = remaining > 1e-4 ? remaining : 0.0;
        phys[physOffset + PHY_OFFSET_EMERGENCY_LOCK] = lockTimer;

        // 释放硬契约: emergencyLockTimer <= 0.0 且 hunger < 50.0
        const hunger = phys[physOffset + PHY_OFFSET_HUNGER];
        if (lockTimer <= 0.0 && hunger < EMERGENCY_RELEASE_THRESHOLD) {
          clearStatus(flags, entityId, IS_EMERGENCY_LOCK);
        }
      } else {
        // 2. 若当前未上锁，且饥饿突破 80 阈值，自动切入应急生存
        const hunger = phys[physOffset + PHY_OFFSET_HUNGER];
        if (hunger >= EMERGENCY_TRIGGER_THRESHOLD) {
          this.triggerEmergency(entityId);
        }
      }
    }
  }
}
