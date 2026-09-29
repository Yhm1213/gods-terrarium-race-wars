/**
 * RaceSkillSystem.js
 * 12 始祖种族特异技能与动作通道仲裁系统
 * 
 * 核心设计指标 (Milestone 2 契约 1.1 ~ 1.3 节):
 * 1. 12 始祖种族技能释放、持续与内置冷却 (ICD >= 1.5s) 状态倒计时结算；
 * 2. 动作通道仲裁协议 (Action Channel Protocol):
 *    - Locomotion (机动位移轨), Stance (姿态轨), Emission (释放喷射轨) 三轨互斥与约束；
 *    - 倒地装死 (PRONE) 强制降速为 0 (vx=0, vy=0)，拦截位移并派发 EVT_ACTION_MUTEX_BLOCKED；
 *    - 击退 (KNOCKBACK) 强制打断当前施法 (IS_CASTING/Emission)，重置持续时间并施加惩罚冷却；
 *    - 读条施法 (IS_CASTING) 锁定机动轨 (vx=0, vy=0)；
 * 3. 100% 物理零 GC：主循环热路径无任何临时对象分配，复用预分配缓冲。
 */

import {
  NULL_ENTITY,
  TOTAL_SLOTS,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  CS_OFFSET_REFLECT_RATIO,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../core/ECS.js';

import {
  SKILL_STRIDE,
  SKILL_OFFSET_COOLDOWN,
  SKILL_OFFSET_DURATION,
  SKILL_OFFSET_CHANNEL,
  SKILL_OFFSET_PARAM,
  CHANNEL_NONE,
  CHANNEL_LOCOMOTION,
  CHANNEL_STANCE,
  CHANNEL_EMISSION,
  LocomotionState,
  StanceState,
  EmissionState,
  createRaceSkillBuffer,
  resetRaceSkill
} from '../components/RaceSkillComponent.js';

import {
  IS_ALIVE,
  IS_STUNNED,
  IS_AIRBORNE,
  IS_SKILL_ACTIVE,
  IS_CASTING,
  IS_DISARMED,
  IS_IMMOBILIZED,
  hasStatus,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';

import { DomainEvents } from '../data/DomainEvents.js';
import { SkillIds, RaceSkills, getRaceSkill, MIN_SKILL_ICD } from '../data/RaceSkillData.js';
import { Races, RaceList } from '../data/RaceData.js';

export class RaceSkillSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null]
   * @param {object|null} [options=null]
   */
  constructor(ecs, eventBus = null, options = null) {
    this.ecs = ecs;
    this.eventBus = eventBus;
    this.tileGrid = options?.tileGrid || null;
    this.nutrientField = options?.nutrientField || null;

    // 1. 技能连续平铺内存池 (Float32Array: 4097 * 4)
    this.skills = createRaceSkillBuffer();

    // 2. 动作通道当前状态 (按实体 1 字节连续平铺)
    this.locomotionStates = new Uint8Array(TOTAL_SLOTS);
    this.stanceStates = new Uint8Array(TOTAL_SLOTS);
    this.emissionStates = new Uint8Array(TOTAL_SLOTS);

    // 3. 辅助状态计时器与标记
    this.disarmTimers = new Float32Array(TOTAL_SLOTS);         // 缴械剩余时间
    this.immobilizeTimers = new Float32Array(TOTAL_SLOTS);     // 定身剩余时间
    this.myceliumRegenTimers = new Float32Array(TOTAL_SLOTS); // 兽人菌丝再生倒计时
    this.myceliumUsed = new Uint8Array(TOTAL_SLOTS);          // 兽人被动单场触发次数
    this.activeSkillId = new Uint8Array(TOTAL_SLOTS);         // 当前执行的技能 ID
    this.earthShatterPending = new Uint8Array(TOTAL_SLOTS);   // 魔像地脉震击读条中标记

    // 4. 单体种族覆盖表 (若为 -1 则由阵营或默认推导)
    this.entityRaceId = new Int8Array(TOTAL_SLOTS).fill(-1);

    // 5. 预分配零 GC 工作缓冲区 (复用数组，杜绝热路径分配)
    this._nearbyBuffer = new Uint16Array(256);
    this._nearbyCount = 0;
  }

  /**
   * 关联/重写实体的种族
   * @param {number} entityId 
   * @param {string} raceKey - 如 'ORC', 'ELF'
   */
  setEntityRace(entityId, raceKey) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return;
    const idx = RaceList.findIndex(r => r.id === raceKey);
    this.entityRaceId[entityId] = idx >= 0 ? idx : -1;
  }

  /**
   * 获取实体对应的种族配置键
   * @param {number} entityId 
   * @returns {string} raceKey
   */
  getEntityRaceKey(entityId) {
    const idx = this.entityRaceId[entityId];
    if (idx >= 0 && idx < RaceList.length) {
      return RaceList[idx].id;
    }
    // 默认回退到 HUMAN
    return 'HUMAN';
  }

  /**
   * 重置指定实体的技能与通道状态
   * @param {number} entityId 
   */
  resetEntity(entityId) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return;
    resetRaceSkill(this.skills, entityId);
    this.locomotionStates[entityId] = LocomotionState.RUN;
    this.stanceStates[entityId] = StanceState.STAND;
    this.emissionStates[entityId] = EmissionState.IDLE;
    this.disarmTimers[entityId] = 0;
    this.immobilizeTimers[entityId] = 0;
    this.myceliumRegenTimers[entityId] = 0;
    this.myceliumUsed[entityId] = 0;
    this.activeSkillId[entityId] = 0;
    this.earthShatterPending[entityId] = 0;
    this.entityRaceId[entityId] = -1;
  }

  /**
   * 动作通道仲裁协议: 申请机动位移轨状态 (Locomotion Channel)
   * 规则:
   * 1. 若处于 PRONE (倒地/装死) 或 IS_IMMOBILIZED 或 IS_CASTING:
   *    强制速度归零，若目标状态不为 STATIONARY 则拦截并派发 EVT_ACTION_MUTEX_BLOCKED；
   * @param {number} entityId 
   * @param {number} targetLoco - LocomotionState 枚举
   * @param {number} [vx=0]
   * @param {number} [vy=0]
   * @returns {boolean} 是否允许切换
   */
  requestLocomotion(entityId, targetLoco, vx = 0, vy = 0) {
    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) return false;

    const isProne = this.stanceStates[entityId] === StanceState.PRONE;
    const isImmobilized = hasStatus(this.ecs.statusFlags, entityId, IS_IMMOBILIZED);
    const isCasting = hasStatus(this.ecs.statusFlags, entityId, IS_CASTING);

    if (isProne || isImmobilized || isCasting) {
      // 机动轨被强制锁死在静止
      this.locomotionStates[entityId] = LocomotionState.STATIONARY;
      const phyOff = entityId * PHYSICS_STRIDE;
      this.ecs.physics[phyOff + PHY_OFFSET_VX] = 0.0;
      this.ecs.physics[phyOff + PHY_OFFSET_VY] = 0.0;

      if (targetLoco !== LocomotionState.STATIONARY) {
        if (this.eventBus) {
          this.eventBus.emit(DomainEvents.EVT_ACTION_MUTEX_BLOCKED, entityId, 0, CHANNEL_LOCOMOTION, 0);
        }
        return false;
      }
      return true;
    }

    this.locomotionStates[entityId] = targetLoco;
    const phyOff = entityId * PHYSICS_STRIDE;
    this.ecs.physics[phyOff + PHY_OFFSET_VX] = vx;
    this.ecs.physics[phyOff + PHY_OFFSET_VY] = vy;
    return true;
  }

  /**
   * 动作通道仲裁协议: 申请姿势姿态轨状态 (Stance Channel)
   * 规则:
   * 1. 若切换为 PRONE (倒地装死)，联动将 Locomotion 轨强制切为 STATIONARY，并使 vx=0, vy=0
   * @param {number} entityId 
   * @param {number} targetStance - StanceState 枚举
   * @returns {boolean}
   */
  requestStance(entityId, targetStance) {
    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) return false;

    this.stanceStates[entityId] = targetStance;
    if (targetStance === StanceState.PRONE) {
      this.locomotionStates[entityId] = LocomotionState.STATIONARY;
      const phyOff = entityId * PHYSICS_STRIDE;
      this.ecs.physics[phyOff + PHY_OFFSET_VX] = 0.0;
      this.ecs.physics[phyOff + PHY_OFFSET_VY] = 0.0;
    }
    return true;
  }

  /**
   * 动作通道仲裁协议: 击退冲量对撞打断 (Knockback vs Emission)
   * 规则:
   * 1. 若实体处于霸体 (矮人麦酒狂暴) 或晶石魔像不可击退特性，则完全免疫击退冲量；
   * 2. 否则，切换机动轨为 KNOCKBACK；
   * 3. 若当前处于施法读条 (IS_CASTING / Emission 轨)，强制打断当前施法，
   *    清除持续时间，重置施法状态，施加 1.5s 惩罚冷却，派发 EVT_ACTION_MUTEX_BLOCKED。
   * @param {number} entityId 
   * @param {number} impulseX 
   * @param {number} impulseY 
   * @returns {boolean} 是否成功应用击退
   */
  applyKnockback(entityId, impulseX, impulseY) {
    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) return false;

    const raceKey = this.getEntityRaceKey(entityId);

    // 霸体与魔像免疫
    if (raceKey === 'GOLEM') {
      return false; // 魔像 180kg 绝对不可被击退
    }
    const off = entityId * SKILL_STRIDE;
    if (raceKey === 'DWARF' && hasStatus(this.ecs.statusFlags, entityId, IS_SKILL_ACTIVE)) {
      return false; // 麦酒狂暴霸体免疫击退
    }

    // 设置机动轨为 KNOCKBACK
    this.locomotionStates[entityId] = LocomotionState.KNOCKBACK;
    const phyOff = entityId * PHYSICS_STRIDE;
    this.ecs.physics[phyOff + PHY_OFFSET_VX] += impulseX;
    this.ecs.physics[phyOff + PHY_OFFSET_VY] += impulseY;

    // 仲裁打断施法
    if (hasStatus(this.ecs.statusFlags, entityId, IS_CASTING) || this.emissionStates[entityId] === EmissionState.CAST) {
      this.interruptEmission(entityId);
    }

    return true;
  }

  /**
   * 强制打断实体的施法读条
   * @param {number} entityId 
   */
  interruptEmission(entityId) {
    if (entityId <= NULL_ENTITY) return;

    clearStatus(this.ecs.statusFlags, entityId, IS_CASTING);
    clearStatus(this.ecs.statusFlags, entityId, IS_SKILL_ACTIVE);

    const off = entityId * SKILL_STRIDE;
    this.skills[off + SKILL_OFFSET_DURATION] = 0.0;
    this.skills[off + SKILL_OFFSET_CHANNEL] = CHANNEL_NONE;

    // 施加技能惩罚冷却 (至少保底 1.5s ICD)
    if (this.skills[off + SKILL_OFFSET_COOLDOWN] < MIN_SKILL_ICD) {
      this.skills[off + SKILL_OFFSET_COOLDOWN] = MIN_SKILL_ICD;
    }

    this.emissionStates[entityId] = EmissionState.IDLE;
    this.earthShatterPending[entityId] = 0;

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_ACTION_MUTEX_BLOCKED, entityId, 0, CHANNEL_EMISSION, 0);
    }
  }

  /**
   * 触发释放种族主动/特异技能
   * @param {number} entityId - 施法者实体 ID
   * @param {number|string} [skillIdOrRace] - 可选指定技能 ID 或种族键
   * @param {number} [targetEntityId=0] - 目标实体 ID
   * @param {number} [targetX=0] - 目标 X 像素坐标
   * @param {number} [targetY=0] - 目标 Y 像素坐标
   * @returns {boolean} 是否成功触发释放
   */
  triggerSkill(entityId, skillIdOrRace = null, targetEntityId = 0, targetX = 0, targetY = 0) {
    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) return false;

    // 眩晕中禁止任何主动技能
    if (hasStatus(this.ecs.statusFlags, entityId, IS_STUNNED)) return false;

    // 1. 获取种族技能数据
    let raceKey = this.getEntityRaceKey(entityId);
    if (typeof skillIdOrRace === 'string' && RaceSkills[skillIdOrRace]) {
      raceKey = skillIdOrRace;
    }
    const skillConfig = RaceSkills[raceKey];
    if (!skillConfig) return false;
    const active = skillConfig.active;

    // 2. 检查内置冷却 ICD (强制 ICD >= 1.5s 拦截)
    const off = entityId * SKILL_STRIDE;
    if (this.skills[off + SKILL_OFFSET_COOLDOWN] > 0.0) {
      return false; // 处于冷却中，强力拦截自激
    }

    // 3. 通道冲突仲裁
    // 若技能需要机动轨 (如兽人飞扑)，但当前处于倒地或定身:
    if ((active.channelMask & CHANNEL_LOCOMOTION) !== 0) {
      if (this.stanceStates[entityId] === StanceState.PRONE || hasStatus(this.ecs.statusFlags, entityId, IS_IMMOBILIZED)) {
        if (this.eventBus) {
          this.eventBus.emit(DomainEvents.EVT_ACTION_MUTEX_BLOCKED, entityId, 0, CHANNEL_LOCOMOTION, 0);
        }
        return false;
      }
    }

    // 若技能需要喷射/施法轨，但当前正被击退:
    if ((active.channelMask & CHANNEL_EMISSION) !== 0) {
      if (this.locomotionStates[entityId] === LocomotionState.KNOCKBACK) {
        if (this.eventBus) {
          this.eventBus.emit(DomainEvents.EVT_ACTION_MUTEX_BLOCKED, entityId, 0, CHANNEL_EMISSION, 0);
        }
        return false;
      }
    }

    // 4. 写入技能状态与冷却时间
    const icd = Math.max(MIN_SKILL_ICD, active.icd);
    this.skills[off + SKILL_OFFSET_COOLDOWN] = icd;
    this.skills[off + SKILL_OFFSET_DURATION] = active.duration;
    this.skills[off + SKILL_OFFSET_CHANNEL] = active.channelMask;
    this.activeSkillId[entityId] = active.id;

    if (active.duration > 0.0) {
      setStatus(this.ecs.statusFlags, entityId, IS_SKILL_ACTIVE);
    }

    // 5. 广播技能触发领域事件
    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_RACE_SKILL_TRIGGERED, entityId, targetEntityId, active.id, 0);
    }

    // 6. 执行 12 始祖种族技能的具体行为
    this._executeSkillLogic(entityId, raceKey, active, targetEntityId, targetX, targetY);

    return true;
  }

  /**
   * 12 始祖种族技能核心行为分发
   * @private
   */
  _executeSkillLogic(entityId, raceKey, active, targetId, tx, ty) {
    const off = entityId * SKILL_STRIDE;

    switch (raceKey) {
      case 'ORC': { // 【战吼狂化】移速 +40%，攻击 +30%
        this.skills[off + SKILL_OFFSET_PARAM] = 1.40;
        this.emissionStates[entityId] = EmissionState.SHOUT;
        break;
      }

      case 'ELF': { // 【自然愈合】瞬发，恢复范围内生命 < 60% 友军 25 HP
        this._executeElfHeal(entityId, active.healAmount, active.radiusTiles * 16);
        this.emissionStates[entityId] = EmissionState.CAST;
        break;
      }

      case 'HUMAN': { // 【军纪战阵】周围 2 格同伴护甲 +10，士气锁 100
        this.skills[off + SKILL_OFFSET_PARAM] = active.armorBonus;
        this.emissionStates[entityId] = EmissionState.SHOUT;
        this._executeHumanPhalanx(entityId, active.radiusTiles * 16);
        break;
      }

      case 'DWARF': { // 【麦酒狂暴】霸体 + 反伤系数 +30%
        const csOff = entityId * COMBAT_STRIDE;
        this.ecs.combatStats[csOff + CS_OFFSET_REFLECT_RATIO] += active.reflectBonus;
        this.emissionStates[entityId] = EmissionState.SHOUT;
        break;
      }

      case 'UNDEAD': { // 【骸骨苏生】消耗尸体唤醒骷髅仆从
        this.emissionStates[entityId] = EmissionState.CAST;
        // 若有事件总线，已派发 EVT_RACE_SKILL_TRIGGERED
        break;
      }

      case 'GOBLIN': { // 【顺手打落】背刺敌军打落兵器，附加缴械
        this.emissionStates[entityId] = EmissionState.CAST;
        if (targetId > NULL_ENTITY && this.ecs.isAlive(targetId)) {
          // 40% 几率触发
          setStatus(this.ecs.statusFlags, targetId, IS_DISARMED);
          this.disarmTimers[targetId] = active.duration;
          if (this.eventBus) {
            this.eventBus.emit(DomainEvents.EVT_WEAPON_DISARMED, targetId, entityId, 0, 0);
          }
        }
        break;
      }

      case 'DEMON': { // 【地狱烈焰】喷射烈火 30 点伤害
        this.emissionStates[entityId] = EmissionState.SPIT;
        if (targetId > NULL_ENTITY && this.ecs.isAlive(targetId)) {
          const hpOff = targetId * HEALTH_STRIDE;
          this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.max(0, this.ecs.health[hpOff + HP_OFFSET_CURRENT] - active.damage);
        }
        break;
      }

      case 'LIZARD': { // 【毒镖飞刺】15 穿刺伤害 + 减速 50%
        this.emissionStates[entityId] = EmissionState.SPIT;
        if (targetId > NULL_ENTITY && this.ecs.isAlive(targetId)) {
          const hpOff = targetId * HEALTH_STRIDE;
          this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.max(0, this.ecs.health[hpOff + HP_OFFSET_CURRENT] - active.pierceDamage);
          // 减速记录在参数
          this.skills[targetId * SKILL_STRIDE + SKILL_OFFSET_PARAM] = active.slowRatio;
        }
        break;
      }

      case 'BEAST': { // 【巨兽飞扑】向前飞扑撞击 35 冲击伤害并击退 2 格
        this.locomotionStates[entityId] = LocomotionState.DASH;
        if (targetId > NULL_ENTITY && this.ecs.isAlive(targetId)) {
          const hpOff = targetId * HEALTH_STRIDE;
          this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.max(0, this.ecs.health[hpOff + HP_OFFSET_CURRENT] - active.impactDamage);
          this.applyKnockback(targetId, 32.0, 0.0);
        }
        break;
      }

      case 'SPORE': { // 【致幻毒孢】使敌人眩晕 3.0s
        this.emissionStates[entityId] = EmissionState.SPIT;
        if (targetId > NULL_ENTITY && this.ecs.isAlive(targetId)) {
          setStatus(this.ecs.statusFlags, targetId, IS_STUNNED);
          this.skills[targetId * SKILL_STRIDE + SKILL_OFFSET_PARAM] = active.stunDuration;
        }
        break;
      }

      case 'GOLEM': { // 【地脉震击】蓄力读条 1.0s，期间 Locomotion 降速为 0
        this.emissionStates[entityId] = EmissionState.CAST;
        setStatus(this.ecs.statusFlags, entityId, IS_CASTING);
        // 强制降速
        this.requestLocomotion(entityId, LocomotionState.STATIONARY, 0, 0);
        this.earthShatterPending[entityId] = 1;
        break;
      }

      case 'ABERR': { // 【灵能震爆】削减 40 士气并定身 2.0s
        this.emissionStates[entityId] = EmissionState.CAST;
        if (targetId > NULL_ENTITY && this.ecs.isAlive(targetId)) {
          const morOff = targetId * MORALE_STRIDE;
          this.ecs.morale[morOff + MORALE_OFFSET_VAL] = Math.max(0, this.ecs.morale[morOff + MORALE_OFFSET_VAL] - active.moraleDamage);
          setStatus(this.ecs.statusFlags, targetId, IS_IMMOBILIZED);
          this.immobilizeTimers[targetId] = active.immobilizeDuration;
          this.requestLocomotion(targetId, LocomotionState.STATIONARY, 0, 0);
        }
        break;
      }
    }
  }

  /**
   * 精灵自然愈合辅助逻辑 (恢复 25 HP)
   * @private
   */
  _executeElfHeal(healerId, healAmount, radiusPx) {
    const healerTf = healerId * TRANSFORM_STRIDE;
    const hx = this.ecs.transforms[healerTf + TF_OFFSET_X];
    const hy = this.ecs.transforms[healerTf + TF_OFFSET_Y];
    const healerFac = this.ecs.identities[healerId * IDENTITY_STRIDE + ID_OFFSET_FACTION];

    // 先为自己回复
    const selfHp = healerId * HEALTH_STRIDE;
    const selfMax = this.ecs.health[selfHp + HP_OFFSET_MAX];
    this.ecs.health[selfHp + HP_OFFSET_CURRENT] = Math.min(selfMax, this.ecs.health[selfHp + HP_OFFSET_CURRENT] + healAmount);

    // 遍历活跃友军
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;
    const r2 = radiusPx * radiusPx;

    for (let i = 0; i < total; i++) {
      const otherId = dense[i];
      if (otherId === healerId || otherId === NULL_ENTITY) continue;

      const otherFac = this.ecs.identities[otherId * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (healerFac !== 0 && otherFac !== healerFac) continue; // 仅限同阵营

      const otherTf = otherId * TRANSFORM_STRIDE;
      const dx = this.ecs.transforms[otherTf + TF_OFFSET_X] - hx;
      const dy = this.ecs.transforms[otherTf + TF_OFFSET_Y] - hy;
      if (dx * dx + dy * dy <= r2) {
        const hpOff = otherId * HEALTH_STRIDE;
        const cur = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
        const max = this.ecs.health[hpOff + HP_OFFSET_MAX];
        if (cur < max * 0.60) { // 生命 < 60%
          this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.min(max, cur + healAmount);
        }
      }
    }
  }

  /**
   * 人类军纪战阵辅助逻辑 (周边同伴护甲 +10，士气锁 100)
   * @private
   */
  _executeHumanPhalanx(leaderId, radiusPx) {
    const tfOff = leaderId * TRANSFORM_STRIDE;
    const lx = this.ecs.transforms[tfOff + TF_OFFSET_X];
    const ly = this.ecs.transforms[tfOff + TF_OFFSET_Y];
    const fac = this.ecs.identities[leaderId * IDENTITY_STRIDE + ID_OFFSET_FACTION];

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;
    const r2 = radiusPx * radiusPx;

    for (let i = 0; i < total; i++) {
      const otherId = dense[i];
      if (otherId === NULL_ENTITY) continue;

      const otherFac = this.ecs.identities[otherId * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (fac !== 0 && otherFac !== fac) continue;

      const oTf = otherId * TRANSFORM_STRIDE;
      const dx = this.ecs.transforms[oTf + TF_OFFSET_X] - lx;
      const dy = this.ecs.transforms[oTf + TF_OFFSET_Y] - ly;
      if (dx * dx + dy * dy <= r2) {
        const csOff = otherId * COMBAT_STRIDE;
        this.ecs.combatStats[csOff + CS_OFFSET_ARMOR] += 10.0;
        const morOff = otherId * MORALE_STRIDE;
        this.ecs.morale[morOff + MORALE_OFFSET_VAL] = 100.0;
      }
    }
  }

  /**
   * 魔像地脉震击读条完成砸地生效
   * @private
   */
  _executeEarthShatterImpact(golemId) {
    const tfOff = golemId * TRANSFORM_STRIDE;
    const gx = this.ecs.transforms[tfOff + TF_OFFSET_X];
    const gy = this.ecs.transforms[tfOff + TF_OFFSET_Y];
    const fac = this.ecs.identities[golemId * IDENTITY_STRIDE + ID_OFFSET_FACTION];

    const r2 = 32.0 * 32.0; // 2 格 (32px)
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const otherId = dense[i];
      if (otherId === golemId || otherId === NULL_ENTITY) continue;

      const otherFac = this.ecs.identities[otherId * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (fac !== 0 && otherFac === fac) continue; // 不伤同伴

      const oTf = otherId * TRANSFORM_STRIDE;
      const dx = this.ecs.transforms[oTf + TF_OFFSET_X] - gx;
      const dy = this.ecs.transforms[oTf + TF_OFFSET_Y] - gy;
      if (dx * dx + dy * dy <= r2) {
        const hpOff = otherId * HEALTH_STRIDE;
        this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.max(0, this.ecs.health[hpOff + HP_OFFSET_CURRENT] - 40.0);
        setStatus(this.ecs.statusFlags, otherId, IS_STUNNED);
      }
    }
  }

  /**
   * 实体受到伤害时响应被动特性 (致死保护、反击等)
   * @param {number} victimId 
   * @param {number} damage 
   * @param {string|number} damageType 
   * @param {number} attackerId 
   * @returns {boolean} true 表示致死被被动技能化解保护
   */
  onTakeDamage(victimId, damage, damageType = 0, attackerId = 0) {
    if (victimId <= NULL_ENTITY || !this.ecs.isAlive(victimId)) return false;

    const hpOff = victimId * HEALTH_STRIDE;
    const curHp = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
    const isLethal = curHp - damage <= 0;

    const raceKey = this.getEntityRaceKey(victimId);

    // 1. 绿皮【菌丝再生】: 致死时不立即死亡，锁 1 HP 并 2.5 HP/s 再生 3.0s (单场限 1 次)
    if (raceKey === 'ORC' && isLethal && this.myceliumUsed[victimId] === 0) {
      this.myceliumUsed[victimId] = 1;
      this.ecs.health[hpOff + HP_OFFSET_CURRENT] = 1.0;
      this.myceliumRegenTimers[victimId] = 3.0;

      if (this.eventBus) {
        this.eventBus.emit(DomainEvents.EVT_RACE_SKILL_TRIGGERED, victimId, 0, SkillIds.ORC_MYCELIUM_REGEN, 0);
      }
      return true; // 拦截致死
    }

    // 2. 地精【狡黠逃逸】: 受到致命攻击时 35% 几率平地翻滚脱离
    if (raceKey === 'GOBLIN' && isLethal) {
      if (Math.random() < 0.35) {
        this.ecs.health[hpOff + HP_OFFSET_CURRENT] = 1.0;
        // 向后翻滚位移
        const phyOff = victimId * PHYSICS_STRIDE;
        this.ecs.physics[phyOff + PHY_OFFSET_VX] = 40.0;
        if (this.eventBus) {
          this.eventBus.emit(DomainEvents.EVT_RACE_SKILL_TRIGGERED, victimId, 0, SkillIds.GOBLIN_CUNNING_ESCAPE, 0);
        }
        return true; // 拦截致死
      }
    }

    // 3. 矮人【麦酒狂暴】受到重创时尝试触发主动技能
    if (raceKey === 'DWARF' && damage > 20.0) {
      this.triggerSkill(victimId, 'DWARF');
    }

    // 4. 孢子真菌人【致幻毒孢】受到近战攻击尝试散播
    if (raceKey === 'SPORE' && attackerId > NULL_ENTITY) {
      this.triggerSkill(victimId, 'SPORE', attackerId);
    }

    return false;
  }

  /**
   * 实体阵亡钩子响应 (被动特性反哺等)
   * @param {number} entityId 
   */
  onEntityDeath(entityId) {
    if (entityId <= NULL_ENTITY) return;

    const raceKey = this.getEntityRaceKey(entityId);

    // 孢子人【腐殖反哺】: 阵亡时尸体立即化为肥料注水注养 +20.0
    if (raceKey === 'SPORE' && this.nutrientField) {
      const tfOff = entityId * TRANSFORM_STRIDE;
      const x = this.ecs.transforms[tfOff + TF_OFFSET_X];
      const y = this.ecs.transforms[tfOff + TF_OFFSET_Y];
      this.nutrientField.addNutrientAt(x, y, 20.0);
    }

    this.resetEntity(entityId);
  }

  /**
   * 每帧系统逻辑更新与倒计时结算
   * 绝对零 GC: 热路径无临时对象创建
   * @param {number} dt - 帧步长 (秒)
   */
  update(dt) {
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const id = dense[i];
      if (id === NULL_ENTITY) continue;

      const off = id * SKILL_STRIDE;

      // 1. 递减内置冷却 ICD
      const cd = this.skills[off + SKILL_OFFSET_COOLDOWN];
      if (cd > 0.0) {
        this.skills[off + SKILL_OFFSET_COOLDOWN] = Math.max(0.0, cd - dt);
      }

      // 2. 递减技能生效持续时间
      const dur = this.skills[off + SKILL_OFFSET_DURATION];
      if (dur > 0.0) {
        const nextDur = dur - dt;
        if (nextDur <= 0.0) {
          this.skills[off + SKILL_OFFSET_DURATION] = 0.0;
          this.skills[off + SKILL_OFFSET_CHANNEL] = CHANNEL_NONE;
          clearStatus(this.ecs.statusFlags, id, IS_SKILL_ACTIVE);

          // 若正在施法读条 (如魔像)
          if (hasStatus(this.ecs.statusFlags, id, IS_CASTING)) {
            clearStatus(this.ecs.statusFlags, id, IS_CASTING);
            this.emissionStates[id] = EmissionState.IDLE;
            if (this.earthShatterPending[id] === 1) {
              this.earthShatterPending[id] = 0;
              this._executeEarthShatterImpact(id);
            }
          }
        } else {
          this.skills[off + SKILL_OFFSET_DURATION] = nextDur;
        }
      }

      // 3. 递减缴械倒计时
      if (this.disarmTimers[id] > 0.0) {
        this.disarmTimers[id] = Math.max(0.0, this.disarmTimers[id] - dt);
        if (this.disarmTimers[id] === 0.0) {
          clearStatus(this.ecs.statusFlags, id, IS_DISARMED);
        }
      }

      // 4. 递减定身倒计时
      if (this.immobilizeTimers[id] > 0.0) {
        this.immobilizeTimers[id] = Math.max(0.0, this.immobilizeTimers[id] - dt);
        if (this.immobilizeTimers[id] === 0.0) {
          clearStatus(this.ecs.statusFlags, id, IS_IMMOBILIZED);
        }
      }

      // 5. 兽人菌丝再生恢复 (2.5 HP/s)
      if (this.myceliumRegenTimers[id] > 0.0) {
        this.myceliumRegenTimers[id] = Math.max(0.0, this.myceliumRegenTimers[id] - dt);
        const hpOff = id * HEALTH_STRIDE;
        const maxHp = this.ecs.health[hpOff + HP_OFFSET_MAX];
        this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.min(maxHp, this.ecs.health[hpOff + HP_OFFSET_CURRENT] + 2.5 * dt);
      }

      // 6. 姿态与定身强制降速归零仲裁
      const isProne = this.stanceStates[id] === StanceState.PRONE;
      const isImmobilized = hasStatus(this.ecs.statusFlags, id, IS_IMMOBILIZED);
      const isCasting = hasStatus(this.ecs.statusFlags, id, IS_CASTING);

      if (isProne || isImmobilized || isCasting) {
        const phyOff = id * PHYSICS_STRIDE;
        this.ecs.physics[phyOff + PHY_OFFSET_VX] = 0.0;
        this.ecs.physics[phyOff + PHY_OFFSET_VY] = 0.0;
        this.locomotionStates[id] = LocomotionState.STATIONARY;
      }
    }
  }
}
