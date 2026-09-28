import { describe, it, expect } from 'vitest';
import {
  TOTAL_SLOTS,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  TF_OFFSET_ROTATION,
  TF_OFFSET_SCALE,
  createTransformBuffer,
  initTransform,
  resetTransform
} from '../../src/components/TransformComponent.js';

import {
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  PHY_OFFSET_MASS,
  PHY_OFFSET_INVMASS,
  createPhysicsBuffer,
  initPhysics,
  resetPhysics
} from '../../src/components/PhysicsComponent.js';

import {
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  HP_OFFSET_LAST_SRC,
  HP_OFFSET_LAST_TICK,
  createHealthBuffer,
  initHealth,
  resetHealth
} from '../../src/components/HealthComponent.js';

import {
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  CS_OFFSET_BLUNT_RESIST,
  CS_OFFSET_PIERCE_RESIST,
  CS_OFFSET_REFLECT_RATIO,
  createCombatStatsBuffer,
  initCombatStats,
  resetCombatStats
} from '../../src/components/CombatStatsComponent.js';

import {
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER,
  PHY_OFFSET_EMERGENCY_LOCK,
  PHY_OFFSET_HOLD_TIMER,
  PHY_OFFSET_SACRED_BODY,
  createPhysiologyBuffer,
  initPhysiology,
  resetPhysiology
} from '../../src/components/PhysiologyComponent.js';

import {
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  MORALE_OFFSET_TIMER,
  createMoraleBuffer,
  initMorale,
  resetMorale
} from '../../src/components/MoraleComponent.js';

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
  createStatusFlagsBuffer,
  hasStatus,
  setStatus,
  clearStatus,
  toggleStatus
} from '../../src/components/UnitStatusFlags.js';

import {
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  ID_OFFSET_PROD_JOB,
  ID_OFFSET_COMBAT_JOB,
  createIdentitiesBuffer,
  initIdentities,
  resetIdentities
} from '../../src/components/Identities.js';

describe('ECS Components 内存平铺组件规范与位掩码测试', () => {
  it('TransformComponent: 4-Stride 连续 Float32Array 与槽位重置', () => {
    expect(TRANSFORM_STRIDE).toBe(4);
    const buf = createTransformBuffer();
    expect(buf.length).toBe(TOTAL_SLOTS * 4);

    initTransform(buf, 10, 100, 200, 1.57, 2.0);
    expect(buf[10 * 4 + TF_OFFSET_X]).toBe(100);
    expect(buf[10 * 4 + TF_OFFSET_Y]).toBe(200);
    expect(buf[10 * 4 + TF_OFFSET_ROTATION]).toBeCloseTo(1.57);
    expect(buf[10 * 4 + TF_OFFSET_SCALE]).toBe(2.0);

    resetTransform(buf, 10);
    expect(buf[10 * 4 + TF_OFFSET_X]).toBe(0);
    expect(buf[10 * 4 + TF_OFFSET_SCALE]).toBe(1.0);
  });

  it('PhysicsComponent: 4-Stride 连续 Float32Array [vx, vy, mass, invMass]', () => {
    expect(PHYSICS_STRIDE).toBe(4);
    const buf = createPhysicsBuffer();
    initPhysics(buf, 5, 10, -20, 2.0);
    expect(buf[5 * 4 + PHY_OFFSET_VX]).toBe(10);
    expect(buf[5 * 4 + PHY_OFFSET_VY]).toBe(-20);
    expect(buf[5 * 4 + PHY_OFFSET_MASS]).toBe(2.0);
    expect(buf[5 * 4 + PHY_OFFSET_INVMASS]).toBeCloseTo(0.5);

    resetPhysics(buf, 5);
    expect(buf[5 * 4 + PHY_OFFSET_MASS]).toBe(1.0);
    expect(buf[5 * 4 + PHY_OFFSET_INVMASS]).toBe(1.0);
  });

  it('HealthComponent: 4-Stride 连续 Float32Array [hp, maxHp, lastSrcId, lastDamageTick]', () => {
    expect(HEALTH_STRIDE).toBe(4);
    const buf = createHealthBuffer();
    initHealth(buf, 3, 80, 120, 42, 1000);
    expect(buf[3 * 4 + HP_OFFSET_CURRENT]).toBe(80);
    expect(buf[3 * 4 + HP_OFFSET_MAX]).toBe(120);
    expect(buf[3 * 4 + HP_OFFSET_LAST_SRC]).toBe(42);
    expect(buf[3 * 4 + HP_OFFSET_LAST_TICK]).toBe(1000);

    resetHealth(buf, 3);
    expect(buf[3 * 4 + HP_OFFSET_CURRENT]).toBe(0);
  });

  it('CombatStatsComponent: 4-Stride 连续 Float32Array [armor, bluntResist, pierceResist, reflectRatio]', () => {
    expect(COMBAT_STRIDE).toBe(4);
    const buf = createCombatStatsBuffer();
    initCombatStats(buf, 8, 25.0, 0.2, 0.3, 0.15);
    expect(buf[8 * 4 + CS_OFFSET_ARMOR]).toBe(25.0);
    expect(buf[8 * 4 + CS_OFFSET_BLUNT_RESIST]).toBeCloseTo(0.2);
    expect(buf[8 * 4 + CS_OFFSET_PIERCE_RESIST]).toBeCloseTo(0.3);
    expect(buf[8 * 4 + CS_OFFSET_REFLECT_RATIO]).toBeCloseTo(0.15);

    resetCombatStats(buf, 8);
    expect(buf[8 * 4 + CS_OFFSET_ARMOR]).toBe(0);
  });

  it('PhysiologyComponent: 4-Stride 连续 Float32Array [hunger, emergencyLockTimer, holdTimer, sacredBodyTimer]', () => {
    expect(PHYSIOLOGY_STRIDE).toBe(4);
    const buf = createPhysiologyBuffer();
    initPhysiology(buf, 1, 85.0, 10.0, 3.5, 1.5);
    expect(buf[1 * 4 + PHY_OFFSET_HUNGER]).toBe(85.0);
    expect(buf[1 * 4 + PHY_OFFSET_EMERGENCY_LOCK]).toBe(10.0);
    expect(buf[1 * 4 + PHY_OFFSET_HOLD_TIMER]).toBe(3.5);
    expect(buf[1 * 4 + PHY_OFFSET_SACRED_BODY]).toBe(1.5);

    resetPhysiology(buf, 1);
    expect(buf[1 * 4 + PHY_OFFSET_HUNGER]).toBe(0);
  });

  it('MoraleComponent: 2-Stride 连续 Float32Array [morale, panicTimer]', () => {
    expect(MORALE_STRIDE).toBe(2);
    const buf = createMoraleBuffer();
    initMorale(buf, 4, 30.0, 5.0);
    expect(buf[4 * 2 + MORALE_OFFSET_VAL]).toBe(30.0);
    expect(buf[4 * 2 + MORALE_OFFSET_TIMER]).toBe(5.0);

    resetMorale(buf, 4);
    expect(buf[4 * 2 + MORALE_OFFSET_VAL]).toBe(0);
  });

  it('Identities: 3-Stride 连续 Uint32Array [factionId, prodJobId, combatJobId]', () => {
    expect(IDENTITY_STRIDE).toBe(3);
    const buf = createIdentitiesBuffer();
    initIdentities(buf, 7, 2, 5, 8);
    expect(buf[7 * 3 + ID_OFFSET_FACTION]).toBe(2);
    expect(buf[7 * 3 + ID_OFFSET_PROD_JOB]).toBe(5);
    expect(buf[7 * 3 + ID_OFFSET_COMBAT_JOB]).toBe(8);

    resetIdentities(buf, 7);
    expect(buf[7 * 3 + ID_OFFSET_FACTION]).toBe(0);
  });

  it('UnitStatusFlags: 32位无符号安全掩码及操作工具测试', () => {
    const flags = createStatusFlagsBuffer();
    const entityId = 12;

    expect(IS_ALIVE).toBe(1);
    expect(IS_HELD).toBe(2);
    expect(IS_AIRBORNE).toBe(4);
    expect(IS_STUNNED).toBe(8);
    expect(IS_SLAVE).toBe(16);
    expect(IS_LEADER).toBe(32);
    expect(IS_MUTANT).toBe(64);
    expect(HAS_WRATH_OF_LIBERTY).toBe(128);
    expect(IS_LAST_STAND).toBe(256);
    expect(IS_STATIC_ANCHOR).toBe(512);
    expect(IS_PETRIFIED).toBe(1024);
    expect(IS_EMERGENCY_LOCK).toBe(2048);
    expect(IS_AVENGED).toBe(4096);
    expect(IS_CORPSE_DEGRADING).toBe(8192);
    expect(IS_SACRED_BODY).toBe(16384);
    expect(IS_REGENT).toBe(32768);
    expect(IN_COMBAT).toBe(65536);
    expect(IS_PANICKED).toBe(131072);

    // 所有掩码均为无符号安全正整数
    for (const [key, mask] of Object.entries(StatusFlags)) {
      expect(mask).toBeGreaterThan(0);
      expect((mask >>> 0)).toBe(mask);
    }

    // 工具函数测试
    setStatus(flags, entityId, IS_ALIVE | IS_LEADER);
    expect(hasStatus(flags, entityId, IS_ALIVE)).toBe(true);
    expect(hasStatus(flags, entityId, IS_LEADER)).toBe(true);
    expect(hasStatus(flags, entityId, IS_MUTANT)).toBe(false);

    toggleStatus(flags, entityId, IS_MUTANT);
    expect(hasStatus(flags, entityId, IS_MUTANT)).toBe(true);

    clearStatus(flags, entityId, IS_LEADER);
    expect(hasStatus(flags, entityId, IS_LEADER)).toBe(false);
    expect(hasStatus(flags, entityId, IS_ALIVE)).toBe(true);
  });
});
