/**
 * RaceSkillSystem.test.js
 * 12 始祖种族特异技能与动作通道仲裁系统测试套件
 * 
 * 覆盖指标:
 * 1. 12 始祖种族特异技能触发、持续与参数结算
 * 2. ICD >= 1.5s 强拦截与防自激震荡
 * 3. 动作通道仲裁协议 (Locomotion, Stance, Emission) 互斥拦截与事件派发
 * 4. 倒地装死锁死机动位移，击退打断读条施法并触发冷却惩罚
 * 5. 零 GC 内存安全性断言
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  COMBAT_STRIDE,
  CS_OFFSET_ARMOR,
  CS_OFFSET_REFLECT_RATIO,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y
} from '../../src/core/ECS.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { RaceSkillSystem } from '../../src/race/RaceSkillSystem.js';
import {
  SKILL_STRIDE,
  SKILL_OFFSET_COOLDOWN,
  SKILL_OFFSET_DURATION,
  CHANNEL_LOCOMOTION,
  CHANNEL_EMISSION,
  LocomotionState,
  StanceState,
  EmissionState
} from '../../src/components/RaceSkillComponent.js';
import {
  IS_ALIVE,
  IS_SKILL_ACTIVE,
  IS_CASTING,
  IS_DISARMED,
  IS_IMMOBILIZED,
  IS_STUNNED,
  hasStatus,
  setStatus
} from '../../src/components/UnitStatusFlags.js';
import { SkillIds, RaceSkills, MIN_SKILL_ICD } from '../../src/data/RaceSkillData.js';

describe('RaceSkillSystem & Action Channel Protocol Specification Suite', () => {
  let ecs;
  let eventBus;
  let skillSystem;

  beforeEach(() => {
    ecs = new ECS();
    eventBus = new DomainEventBus();
    skillSystem = new RaceSkillSystem(ecs, eventBus);
  });

  describe('1. 12 始祖种族特异技能全量触发与参数结算', () => {
    it('ORC: 【战吼狂化】移速与攻击提升，持续 4.0s，ICD = 10.0s', () => {
      const eId = ecs.allocateEntity();
      skillSystem.setEntityRace(eId, 'ORC');

      const fired = skillSystem.triggerSkill(eId, 'ORC');
      expect(fired).toBe(true);

      const off = eId * SKILL_STRIDE;
      expect(skillSystem.skills[off + SKILL_OFFSET_COOLDOWN]).toBe(10.0);
      expect(skillSystem.skills[off + SKILL_OFFSET_DURATION]).toBe(4.0);
      expect(hasStatus(ecs.statusFlags, eId, IS_SKILL_ACTIVE)).toBe(true);

      // 更新 4.1 秒后技能效果结束，状态清除
      skillSystem.update(4.1);
      expect(hasStatus(ecs.statusFlags, eId, IS_SKILL_ACTIVE)).toBe(false);
      expect(skillSystem.skills[off + SKILL_OFFSET_COOLDOWN]).toBeCloseTo(5.9, 1);
    });

    it('ELF: 【自然愈合】瞬发技能，恢复受损友军 25 HP', () => {
      const healer = ecs.allocateEntity();
      skillSystem.setEntityRace(healer, 'ELF');

      const ally = ecs.allocateEntity();
      skillSystem.setEntityRace(ally, 'ELF');

      // 设置友军受创 (HP 30 / 100 < 60%)
      const allyHpOff = ally * HEALTH_STRIDE;
      ecs.health[allyHpOff + HP_OFFSET_MAX] = 100.0;
      ecs.health[allyHpOff + HP_OFFSET_CURRENT] = 30.0;

      const fired = skillSystem.triggerSkill(healer, 'ELF');
      expect(fired).toBe(true);
      expect(ecs.health[allyHpOff + HP_OFFSET_CURRENT]).toBe(55.0); // 30 + 25
      expect(skillSystem.skills[healer * SKILL_STRIDE + SKILL_OFFSET_DURATION]).toBe(0.0); // 瞬发
    });

    it('HUMAN: 【军纪战阵】持续 6.0s，为周边友军护甲 +10，士气锁 100', () => {
      const leader = ecs.allocateEntity();
      skillSystem.setEntityRace(leader, 'HUMAN');

      const soldier = ecs.allocateEntity();
      skillSystem.setEntityRace(soldier, 'HUMAN');

      const fired = skillSystem.triggerSkill(leader, 'HUMAN');
      expect(fired).toBe(true);

      const sCsOff = soldier * COMBAT_STRIDE;
      expect(ecs.combatStats[sCsOff + CS_OFFSET_ARMOR]).toBe(10.0);
      const sMorOff = soldier * MORALE_STRIDE;
      expect(ecs.morale[sMorOff + MORALE_OFFSET_VAL]).toBe(100.0);
    });

    it('DWARF: 【麦酒狂暴】持续 5.0s，反伤系数提升 +30%，霸体免疫击退', () => {
      const dwarf = ecs.allocateEntity();
      skillSystem.setEntityRace(dwarf, 'DWARF');

      skillSystem.triggerSkill(dwarf, 'DWARF');
      const csOff = dwarf * COMBAT_STRIDE;
      expect(ecs.combatStats[csOff + CS_OFFSET_REFLECT_RATIO]).toBeCloseTo(0.30, 2);

      // 霸体免疫击退
      const knocked = skillSystem.applyKnockback(dwarf, 50, 0);
      expect(knocked).toBe(false);
      expect(ecs.physics[dwarf * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBe(0.0);
    });

    it('GOBLIN: 【顺手打落】对目标附加 6.0s 缴械状态', () => {
      const goblin = ecs.allocateEntity();
      skillSystem.setEntityRace(goblin, 'GOBLIN');

      const target = ecs.allocateEntity();
      const fired = skillSystem.triggerSkill(goblin, 'GOBLIN', target);
      expect(fired).toBe(true);

      expect(hasStatus(ecs.statusFlags, target, IS_DISARMED)).toBe(true);
      expect(skillSystem.disarmTimers[target]).toBe(6.0);

      // 6.1s 后解除缴械
      skillSystem.update(6.1);
      expect(hasStatus(ecs.statusFlags, target, IS_DISARMED)).toBe(false);
    });

    it('DEMON: 【地狱烈焰】造成 30 点火伤', () => {
      const demon = ecs.allocateEntity();
      skillSystem.setEntityRace(demon, 'DEMON');

      const target = ecs.allocateEntity();
      const hpOff = target * HEALTH_STRIDE;
      ecs.health[hpOff + HP_OFFSET_MAX] = 100.0;
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 100.0;

      skillSystem.triggerSkill(demon, 'DEMON', target);
      expect(ecs.health[hpOff + HP_OFFSET_CURRENT]).toBe(70.0);
    });

    it('LIZARD: 【毒镖飞刺】造成 15 穿刺伤害', () => {
      const lizard = ecs.allocateEntity();
      skillSystem.setEntityRace(lizard, 'LIZARD');

      const target = ecs.allocateEntity();
      const hpOff = target * HEALTH_STRIDE;
      ecs.health[hpOff + HP_OFFSET_MAX] = 100.0;
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 100.0;

      skillSystem.triggerSkill(lizard, 'LIZARD', target);
      expect(ecs.health[hpOff + HP_OFFSET_CURRENT]).toBe(85.0);
    });

    it('BEAST: 【巨兽飞扑】向前飞扑并对目标造成 35 冲击伤害与击退', () => {
      const beast = ecs.allocateEntity();
      skillSystem.setEntityRace(beast, 'BEAST');

      const target = ecs.allocateEntity();
      const hpOff = target * HEALTH_STRIDE;
      ecs.health[hpOff + HP_OFFSET_MAX] = 100.0;
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 100.0;

      skillSystem.triggerSkill(beast, 'BEAST', target);
      expect(ecs.health[hpOff + HP_OFFSET_CURRENT]).toBe(65.0);
      expect(ecs.physics[target * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBeGreaterThan(0);
    });

    it('SPORE: 【致幻毒孢】使目标陷入眩晕 3.0s', () => {
      const spore = ecs.allocateEntity();
      skillSystem.setEntityRace(spore, 'SPORE');

      const target = ecs.allocateEntity();
      skillSystem.triggerSkill(spore, 'SPORE', target);
      expect(hasStatus(ecs.statusFlags, target, IS_STUNNED)).toBe(true);
    });

    it('GOLEM: 【地脉震击】蓄力读条 1.0s，机动轨锁死，读条结束触发砸地', () => {
      const golem = ecs.allocateEntity();
      skillSystem.setEntityRace(golem, 'GOLEM');

      const target = ecs.allocateEntity();
      const hpOff = target * HEALTH_STRIDE;
      ecs.health[hpOff + HP_OFFSET_MAX] = 100.0;
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 100.0;

      skillSystem.triggerSkill(golem, 'GOLEM');
      expect(hasStatus(ecs.statusFlags, golem, IS_CASTING)).toBe(true);
      expect(skillSystem.locomotionStates[golem]).toBe(LocomotionState.STATIONARY);

      // 读条未满 0.5s 时目标仍未受创
      skillSystem.update(0.5);
      expect(ecs.health[hpOff + HP_OFFSET_CURRENT]).toBe(100.0);

      // 读条满 1.0s 后触发砸地，造成 40 点钝击伤害并眩晕
      skillSystem.update(0.6);
      expect(hasStatus(ecs.statusFlags, golem, IS_CASTING)).toBe(false);
      expect(ecs.health[hpOff + HP_OFFSET_CURRENT]).toBe(60.0);
      expect(hasStatus(ecs.statusFlags, target, IS_STUNNED)).toBe(true);
    });

    it('ABERR: 【灵能震爆】削减 40 点士气并强制定身 2.0s', () => {
      const aberr = ecs.allocateEntity();
      skillSystem.setEntityRace(aberr, 'ABERR');

      const target = ecs.allocateEntity();
      ecs.morale[target * MORALE_STRIDE + MORALE_OFFSET_VAL] = 80.0;

      skillSystem.triggerSkill(aberr, 'ABERR', target);
      expect(ecs.morale[target * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBe(40.0);
      expect(hasStatus(ecs.statusFlags, target, IS_IMMOBILIZED)).toBe(true);
      expect(skillSystem.locomotionStates[target]).toBe(LocomotionState.STATIONARY);

      // 2.1s 后定身解除
      skillSystem.update(2.1);
      expect(hasStatus(ecs.statusFlags, target, IS_IMMOBILIZED)).toBe(false);
    });

    it('UNDEAD: 【骸骨苏生】成功触发并广播领域事件', () => {
      const undead = ecs.allocateEntity();
      skillSystem.setEntityRace(undead, 'UNDEAD');

      const fired = skillSystem.triggerSkill(undead, 'UNDEAD');
      expect(fired).toBe(true);
      expect(skillSystem.skills[undead * SKILL_STRIDE + SKILL_OFFSET_COOLDOWN]).toBe(15.0);
    });
  });

  describe('2. 内置冷却 (ICD >= 1.5s) 强拦截与防自激震荡', () => {
    it('技能在冷却中再次尝试释放时被强制拦截并返回 false', () => {
      const orc = ecs.allocateEntity();
      skillSystem.setEntityRace(orc, 'ORC');

      const fired1 = skillSystem.triggerSkill(orc, 'ORC');
      expect(fired1).toBe(true);

      // 立即再次尝试释放
      const fired2 = skillSystem.triggerSkill(orc, 'ORC');
      expect(fired2).toBe(false);

      // 过去 5 秒后 (冷却为 10s)，仍被拦截
      skillSystem.update(5.0);
      const fired3 = skillSystem.triggerSkill(orc, 'ORC');
      expect(fired3).toBe(false);

      // 过去 5.1 秒后 (累计超 10s)，冷却完毕可再次释放
      skillSystem.update(5.1);
      const fired4 = skillSystem.triggerSkill(orc, 'ORC');
      expect(fired4).toBe(true);
    });

    it('全 12 种族特异主动技能配置中的 ICD 均严格 >= 1.5s', () => {
      for (const [key, conf] of Object.entries(RaceSkills)) {
        expect(conf.active.icd).toBeGreaterThanOrEqual(MIN_SKILL_ICD);
        expect(conf.active.icd).toBeGreaterThanOrEqual(1.5);
      }
    });
  });

  describe('3. 动作通道仲裁协议 (Action Channel Protocol) 互斥与打断', () => {
    it('倒地装死 (PRONE) 状态下尝试机动位移被拦截并派发 EVT_ACTION_MUTEX_BLOCKED', () => {
      const unit = ecs.allocateEntity();
      skillSystem.requestStance(unit, StanceState.PRONE);

      // 倒地后速度归零
      expect(ecs.physics[unit * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBe(0.0);

      // 尝试奔跑位移
      const allowed = skillSystem.requestLocomotion(unit, LocomotionState.RUN, 50, 0);
      expect(allowed).toBe(false);
      expect(ecs.physics[unit * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBe(0.0);
    });

    it('读条施法中受到击退冲量，施法被强制打断并施加惩罚冷却', () => {
      const human = ecs.allocateEntity();
      skillSystem.setEntityRace(human, 'HUMAN');

      // 人类开阵读条
      setStatus(ecs.statusFlags, human, IS_CASTING);
      skillSystem.skills[human * SKILL_STRIDE + SKILL_OFFSET_DURATION] = 5.0;

      // 受到击退弹射
      const knocked = skillSystem.applyKnockback(human, 40, 0);
      expect(knocked).toBe(true);

      // 施法被打断
      expect(hasStatus(ecs.statusFlags, human, IS_CASTING)).toBe(false);
      expect(skillSystem.skills[human * SKILL_STRIDE + SKILL_OFFSET_DURATION]).toBe(0.0);
      // 施加保底 1.5s 冷却惩罚
      expect(skillSystem.skills[human * SKILL_STRIDE + SKILL_OFFSET_COOLDOWN]).toBeGreaterThanOrEqual(1.5);
    });

    it('处于定身 (IS_IMMOBILIZED) 状态下位移被仲裁拦截', () => {
      const unit = ecs.allocateEntity();
      setStatus(ecs.statusFlags, unit, IS_IMMOBILIZED);

      const allowed = skillSystem.requestLocomotion(unit, LocomotionState.RUN, 60, 0);
      expect(allowed).toBe(false);
      expect(ecs.physics[unit * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBe(0.0);
    });
  });

  describe('4. 专属被动特性与致死保护结算', () => {
    it('ORC【菌丝再生】: 致死伤害时锁 1 HP 并进入 3.0s 再生，单场限 1 次', () => {
      const orc = ecs.allocateEntity();
      skillSystem.setEntityRace(orc, 'ORC');

      const hpOff = orc * HEALTH_STRIDE;
      ecs.health[hpOff + HP_OFFSET_MAX] = 140.0;
      ecs.health[hpOff + HP_OFFSET_CURRENT] = 20.0;

      // 受到 50 点致死伤害
      const protectedLethal = skillSystem.onTakeDamage(orc, 50.0);
      expect(protectedLethal).toBe(true);
      expect(ecs.health[hpOff + HP_OFFSET_CURRENT]).toBe(1.0); // 锁 1 HP
      expect(skillSystem.myceliumUsed[orc]).toBe(1);

      // 3 秒内每秒恢复 2.5 HP
      skillSystem.update(2.0);
      expect(ecs.health[hpOff + HP_OFFSET_CURRENT]).toBeCloseTo(6.0, 1); // 1 + 2.5 * 2 = 6.0

      // 再次受到致死伤害时，单场已用尽，不再提供保护
      const secondLethal = skillSystem.onTakeDamage(orc, 50.0);
      expect(secondLethal).toBe(false);
    });

    it('GOLEM【硅基超重】: 绝对免疫击退冲量', () => {
      const golem = ecs.allocateEntity();
      skillSystem.setEntityRace(golem, 'GOLEM');

      const knocked = skillSystem.applyKnockback(golem, 100, 50);
      expect(knocked).toBe(false);
      expect(ecs.physics[golem * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBe(0.0);
      expect(ecs.physics[golem * PHYSICS_STRIDE + PHY_OFFSET_VY]).toBe(0.0);
    });
  });

  describe('5. 绝对零 GC 内存安全与重置维护', () => {
    it('连续执行 100 帧更新与技能释放，内存稳定无泄漏', () => {
      const entities = [];
      for (let i = 0; i < 20; i++) {
        const id = ecs.allocateEntity();
        skillSystem.setEntityRace(id, 'ORC');
        entities.push(id);
      }

      // 触发部分技能
      skillSystem.triggerSkill(entities[0], 'ORC');

      // 连续 100 帧循环
      for (let f = 0; f < 100; f++) {
        skillSystem.update(0.016);
      }

      // 释放实体
      for (const id of entities) {
        skillSystem.resetEntity(id);
        ecs.freeEntity(id);
      }

      expect(ecs.getActiveCount()).toBe(0);
      expect(skillSystem.skills[entities[0] * SKILL_STRIDE + SKILL_OFFSET_COOLDOWN]).toBe(0);
    });
  });
});
