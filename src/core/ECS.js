/**
 * ECS.js
 * 紧凑型 ECS 实体组件管理器与连续平铺内存池底座
 * 
 * 内存铁律:
 * 1. MAX_ENTITIES = 4096, TOTAL_SLOTS = 4097 (0 索引永久作为 NULL_ENTITY 墓碑)
 * 2. 纯 SoA 平铺连续 TypedArray 布局，常驻总内存 <= 0.52MB
 * 3. denseEntities 稠密栈管理与 Swap-and-Pop 机制，遍历零空洞
 * 4. freeEntity 时原子清除 IS_ALIVE 状态并重置组件槽位，消灭 Double Free
 */

import {
  TOTAL_SLOTS,
  MAX_ENTITIES,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  TF_OFFSET_ROTATION,
  TF_OFFSET_ROT,
  TF_OFFSET_SCALE,
  createTransformBuffer,
  resetTransform
} from '../components/TransformComponent.js';

import {
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  PHY_OFFSET_MASS,
  PHY_OFFSET_INVMASS,
  createPhysicsBuffer,
  resetPhysics
} from '../components/PhysicsComponent.js';

import {
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_HP,
  HP_OFFSET_MAX,
  HP_OFFSET_LAST_SRC,
  HP_OFFSET_LAST_SRC_ID,
  HP_OFFSET_LAST_TICK,
  HP_OFFSET_LAST_DAMAGE_TICK,
  createHealthBuffer,
  resetHealth
} from '../components/HealthComponent.js';

import {
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  CS_OFFSET_BLUNT_RESIST,
  CS_OFFSET_PIERCE_RESIST,
  CS_OFFSET_REFLECT_RATIO,
  createCombatStatsBuffer,
  resetCombatStats
} from '../components/CombatStatsComponent.js';

import {
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER,
  PHY_OFFSET_EMERGENCY_LOCK,
  PHY_OFFSET_HOLD_TIMER,
  PHY_OFFSET_SACRED_BODY,
  createPhysiologyBuffer,
  resetPhysiology
} from '../components/PhysiologyComponent.js';

import {
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  MORALE_OFFSET_MORALE,
  MORALE_OFFSET_TIMER,
  MORALE_OFFSET_PANIC_TIMER,
  createMoraleBuffer,
  resetMorale
} from '../components/MoraleComponent.js';

import {
  StatusFlags,
  IS_ALIVE,
  IS_HELD,
  IS_AIRBORNE,
  IS_STUNNED,
  IS_SLAVE,
  IS_LEADER,
  IS_MUTANT,
  HAS_WRATH_OF_LIBERTY,
  IS_LAST_STAND,
  IS_STATIC_ANCHOR,
  IS_PETRIFIED,
  IS_EMERGENCY_LOCK,
  IS_AVENGED,
  IS_CORPSE_DEGRADING,
  IS_SACRED_BODY,
  IS_REGENT,
  IN_COMBAT,
  IS_PANICKED,
  createStatusFlagsBuffer
} from '../components/UnitStatusFlags.js';

import {
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  ID_OFFSET_PROD_JOB,
  ID_OFFSET_COMBAT_JOB,
  createIdentitiesBuffer,
  resetIdentities
} from '../components/Identities.js';

export const NULL_ENTITY = 0;

// Re-export all schema strides and offsets for external systems and test suites
export {
  MAX_ENTITIES,
  TOTAL_SLOTS,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  TF_OFFSET_ROTATION,
  TF_OFFSET_ROT,
  TF_OFFSET_SCALE,
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  PHY_OFFSET_MASS,
  PHY_OFFSET_INVMASS,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_HP,
  HP_OFFSET_MAX,
  HP_OFFSET_LAST_SRC,
  HP_OFFSET_LAST_SRC_ID,
  HP_OFFSET_LAST_TICK,
  HP_OFFSET_LAST_DAMAGE_TICK,
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  CS_OFFSET_BLUNT_RESIST,
  CS_OFFSET_PIERCE_RESIST,
  CS_OFFSET_REFLECT_RATIO,
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER,
  PHY_OFFSET_EMERGENCY_LOCK,
  PHY_OFFSET_HOLD_TIMER,
  PHY_OFFSET_SACRED_BODY,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  MORALE_OFFSET_MORALE,
  MORALE_OFFSET_TIMER,
  MORALE_OFFSET_PANIC_TIMER,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  ID_OFFSET_PROD_JOB,
  ID_OFFSET_COMBAT_JOB
};

export class ECS {
  constructor() {
    // 1. 全局平铺连续 TypedArray 内存池 (TOTAL_SLOTS = 4097)
    this.transforms = createTransformBuffer();
    this.physics = createPhysicsBuffer();
    this.health = createHealthBuffer();
    this.combatStats = createCombatStatsBuffer();
    this.physiology = createPhysiologyBuffer();
    this.morale = createMoraleBuffer();
    this.statusFlags = createStatusFlagsBuffer();
    this.identities = createIdentitiesBuffer();

    // 2. 稠密栈与稀疏映射表 (用于 Swap-and-Pop 零空洞迭代)
    this.denseEntities = new Uint16Array(TOTAL_SLOTS);
    this.sparseIndices = new Uint16Array(TOTAL_SLOTS);
    this.freeStack = new Uint16Array(TOTAL_SLOTS);

    this.activeCount = 0;
    this.freeCount = 0;

    this._initFreeStack();
  }

  /**
   * 初始化空闲实体栈 (ID 范围: 1 ~ 4096，倒序压栈使分配从 1 递增)
   * 0 索引被严格隔离为全局 NULL_ENTITY 墓碑
   * @private
   */
  _initFreeStack() {
    this.freeCount = MAX_ENTITIES;
    for (let i = 0; i < MAX_ENTITIES; i++) {
      this.freeStack[i] = MAX_ENTITIES - i; // [4096, 4095, ..., 1]
    }
  }

  /**
   * 分配一个新实体
   * @returns {number} 实体 ID (1 ~ 4096)，若内存池已满则返回 NULL_ENTITY (0)
   */
  allocateEntity() {
    if (this.freeCount <= 0 || this.activeCount >= MAX_ENTITIES) {
      return NULL_ENTITY;
    }

    // 弹栈获取空闲 ID
    const entityId = this.freeStack[--this.freeCount];

    // 加入稠密活跃数组末尾
    const denseIndex = this.activeCount++;
    this.denseEntities[denseIndex] = entityId;
    this.sparseIndices[entityId] = denseIndex;

    // 原子标记存活状态
    this.statusFlags[entityId] = IS_ALIVE;

    // 初始化默认槽位数据 (scale=1.0)
    this._clearEntityComponents(entityId);
    this.transforms[entityId * TRANSFORM_STRIDE + TF_OFFSET_SCALE] = 1.0;

    return entityId;
  }

  /**
   * 释放并回收实体 (Swap-and-Pop 机制，绝对零 GC)
   * @param {number} entityId - 欲释放的实体 ID
   * @returns {boolean} 是否成功释放 (若已销毁或非法 ID 则防御性拦截并返回 false)
   */
  freeEntity(entityId) {
    // 0 号墓碑与越界防御
    if (entityId <= NULL_ENTITY || entityId > MAX_ENTITIES) {
      return false;
    }

    // 存活性前置断言 (消灭 Double Free)
    if ((this.statusFlags[entityId] & IS_ALIVE) === 0) {
      return false;
    }

    // 1. 原子清除所有状态掩码 (包括 IS_ALIVE)
    this.statusFlags[entityId] = 0;

    // 2. 稠密栈 Swap-and-Pop 维护
    const denseIdx = this.sparseIndices[entityId];
    const lastDenseIdx = --this.activeCount;
    const lastEntityId = this.denseEntities[lastDenseIdx];

    if (denseIdx !== lastDenseIdx) {
      // 将尾部实体移至被删除的槽位
      this.denseEntities[denseIdx] = lastEntityId;
      this.sparseIndices[lastEntityId] = denseIdx;
    }

    this.denseEntities[lastDenseIdx] = 0;
    this.sparseIndices[entityId] = 0;

    // 3. 擦除该实体的所有组件内存槽 (全部抹零)
    this._clearEntityComponents(entityId);

    // 4. 将 ID 压回空闲栈
    this.freeStack[this.freeCount++] = entityId;

    return true;
  }

  /**
   * 检查实体当前是否存活且有效
   * @param {number} entityId 
   * @returns {boolean}
   */
  isAlive(entityId) {
    if (entityId <= NULL_ENTITY || entityId > MAX_ENTITIES) {
      return false;
    }
    return ((this.statusFlags[entityId] & IS_ALIVE) >>> 0) !== 0;
  }

  /**
   * 获取稠密活跃实体数组引用
   * @returns {Uint16Array}
   */
  getActiveEntities() {
    return this.denseEntities;
  }

  /**
   * 获取当前活跃实体总数
   * @returns {number}
   */
  getActiveCount() {
    return this.activeCount;
  }

  /**
   * 按状态位掩码高效筛选活跃实体 (零分配出参缓冲区)
   * @param {number} includeMask 必须包含的标志
   * @param {number} excludeMask 必须不包含的标志
   * @param {Int32Array|Uint16Array} outResults 外部接收缓冲区
   * @param {number} [maxCapacity=512] 最大容量限制
   * @returns {number} 匹配写入的实体数量
   */
  filterActiveByMask(includeMask, excludeMask, outResults, maxCapacity = 512) {
    const cap = Math.min(maxCapacity, outResults.length);
    let count = 0;
    const total = this.activeCount;
    const dense = this.denseEntities;
    const flags = this.statusFlags;

    for (let i = 0; i < total; i++) {
      const id = dense[i];
      const flag = flags[id];
      if ((flag & includeMask) === includeMask && (flag & excludeMask) === 0) {
        outResults[count++] = id;
        if (count >= cap) break;
      }
    }

    return count;
  }

  /**
   * 将实体的所有组件连续数据全部清零抹除
   * @private
   * @param {number} entityId 
   */
  _clearEntityComponents(entityId) {
    const tfOff = entityId * TRANSFORM_STRIDE;
    this.transforms[tfOff] = 0.0;
    this.transforms[tfOff + 1] = 0.0;
    this.transforms[tfOff + 2] = 0.0;
    this.transforms[tfOff + 3] = 0.0;

    const phyOff = entityId * PHYSICS_STRIDE;
    this.physics[phyOff] = 0.0;
    this.physics[phyOff + 1] = 0.0;
    this.physics[phyOff + 2] = 0.0;
    this.physics[phyOff + 3] = 0.0;

    const hpOff = entityId * HEALTH_STRIDE;
    this.health[hpOff] = 0.0;
    this.health[hpOff + 1] = 0.0;
    this.health[hpOff + 2] = 0.0;
    this.health[hpOff + 3] = 0.0;

    const csOff = entityId * COMBAT_STRIDE;
    this.combatStats[csOff] = 0.0;
    this.combatStats[csOff + 1] = 0.0;
    this.combatStats[csOff + 2] = 0.0;
    this.combatStats[csOff + 3] = 0.0;

    const physOff = entityId * PHYSIOLOGY_STRIDE;
    this.physiology[physOff] = 0.0;
    this.physiology[physOff + 1] = 0.0;
    this.physiology[physOff + 2] = 0.0;
    this.physiology[physOff + 3] = 0.0;

    const morOff = entityId * MORALE_STRIDE;
    this.morale[morOff] = 0.0;
    this.morale[morOff + 1] = 0.0;

    const idOff = entityId * IDENTITY_STRIDE;
    this.identities[idOff] = 0;
    this.identities[idOff + 1] = 0;
    this.identities[idOff + 2] = 0;
  }

  /**
   * 重置整个 ECS 世界回初始状态
   */
  reset() {
    this.activeCount = 0;
    this.freeCount = 0;
    this.denseEntities.fill(0);
    this.sparseIndices.fill(0);
    this.freeStack.fill(0);
    this.statusFlags.fill(0);

    // 重置所有组件数据
    for (let id = 0; id < TOTAL_SLOTS; id++) {
      this._clearEntityComponents(id);
    }

    this._initFreeStack();
  }

  /**
   * 测算当前 ECS 静态常驻连续内存字节总数
   * @returns {number} 字节总数 (用于断言常驻内存 <= 0.52MB)
   */
  calculateMemoryUsageBytes() {
    return (
      this.transforms.byteLength +
      this.physics.byteLength +
      this.health.byteLength +
      this.combatStats.byteLength +
      this.physiology.byteLength +
      this.morale.byteLength +
      this.statusFlags.byteLength +
      this.identities.byteLength +
      this.denseEntities.byteLength +
      this.sparseIndices.byteLength +
      this.freeStack.byteLength
    );
  }
}
