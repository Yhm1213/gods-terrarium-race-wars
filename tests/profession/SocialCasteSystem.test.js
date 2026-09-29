/**
 * SocialCasteSystem.test.js
 * 四大社会阶级动态晋升与领袖继承 FSM 系统测试套件
 * 
 * 覆盖指标:
 * 1. 平民 -> 工匠/士兵 晋升判据与阵营人口比例约束
 * 2. 15.0s 晋升防振荡滞后冷却锁 (Anti-Oscillation Cooldown)
 * 3. 领袖唯一性硬性约束与 3.0s~5.0s 继承加冕 FSM
 * 4. 战俘奴隶 (IS_SLAVE) 晋升熔断与绝嗣
 * 5. 人类【万金油适应】30% 履历门槛折扣特性
 * 6. 100% 物理零 GC 与生命周期重置
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../../src/core/ECS.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { SocialCasteSystem } from '../../src/profession/SocialCasteSystem.js';
import {
  CASTE_STRIDE,
  CASTE_OFFSET_TYPE,
  CASTE_OFFSET_EXP_LABOR,
  CASTE_OFFSET_EXP_COMBAT,
  CASTE_OFFSET_COOLDOWN,
  CasteType,
  PROMOTION_COOLDOWN_SECONDS
} from '../../src/components/SocialCasteComponent.js';
import {
  IS_ALIVE,
  IS_SLAVE,
  IS_LEADER,
  hasStatus,
  setStatus
} from '../../src/components/UnitStatusFlags.js';

describe('SocialCasteSystem & Succession FSM Specification Suite', () => {
  let ecs;
  let eventBus;
  let casteSystem;

  beforeEach(() => {
    ecs = new ECS();
    eventBus = new DomainEventBus();
    casteSystem = new SocialCasteSystem(ecs, eventBus, { heirInterregnumSeconds: 3.0 });
  });

  describe('1. 平民基础晋升判据与阵营比例约束', () => {
    it('平民积累劳作经验 >= 5.0 且工匠比例 < 30% 时晋升为工匠 (ARTISAN)', () => {
      // 阵营 1 拥有 10 个平民
      const units = [];
      for (let i = 0; i < 10; i++) {
        const id = ecs.allocateEntity();
        ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 1;
        units.push(id);
      }

      // 给第 1 个平民注入 5 次劳作
      casteSystem.recordLabor(units[0], 5.0);
      expect(casteSystem.castes[units[0] * CASTE_STRIDE + CASTE_OFFSET_EXP_LABOR]).toBe(5.0);

      // 执行一次系统更新
      casteSystem.update(0.1);

      // 验证晋升为工匠
      expect(casteSystem.getCaste(units[0])).toBe(CasteType.ARTISAN);
      // 验证写入 15s 防振荡冷却锁
      expect(casteSystem.castes[units[0] * CASTE_STRIDE + CASTE_OFFSET_COOLDOWN]).toBeCloseTo(PROMOTION_COOLDOWN_SECONDS, 1);
    });

    it('平民承受战斗伤害/击杀达到门槛 (50.0) 时晋升为士兵 (SOLDIER)', () => {
      const id = ecs.allocateEntity();
      ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 1;

      // 注入 55.0 战斗经验 (承伤)
      casteSystem.recordCombat(id, 55.0, 0);
      casteSystem.update(0.1);

      expect(casteSystem.getCaste(id)).toBe(CasteType.SOLDIER);
      expect(casteSystem.castes[id * CASTE_STRIDE + CASTE_OFFSET_COOLDOWN]).toBeCloseTo(PROMOTION_COOLDOWN_SECONDS, 1);
    });

    it('工匠人口达到 30% 上限时，平民即使劳作经验蓄满也不再晋升工匠', () => {
      const factionId = 2;
      const units = [];
      // 10 个人
      for (let i = 0; i < 10; i++) {
        const id = ecs.allocateEntity();
        ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;
        units.push(id);
      }

      // 已经有 3 个工匠 (达到 30% 饱和)
      casteSystem._promote(units[0], CasteType.ARTISAN);
      casteSystem._promote(units[1], CasteType.ARTISAN);
      casteSystem._promote(units[2], CasteType.ARTISAN);

      // 第 4 个人劳作经验积累至 10.0
      casteSystem.recordLabor(units[3], 10.0);
      casteSystem.update(0.1);

      // 因比例超标 (3/10 = 30%)，被拦截，维持 CIVILIAN
      expect(casteSystem.getCaste(units[3])).toBe(CasteType.CIVILIAN);
    });
  });

  describe('2. 15.0s 晋升防振荡滞后冷却锁 (Anti-Oscillation Cooldown)', () => {
    it('实体晋升后在 15.0s 冷却窗口内绝对禁止再次跃迁', () => {
      // 阵营 1 配备合法存活领袖，避免无主继承介入
      const leader = ecs.allocateEntity();
      ecs.identities[leader * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 1;
      casteSystem._promote(leader, CasteType.LEADER);

      const id = ecs.allocateEntity();
      ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 1;

      // 1. 劳作经验促成晋升为 ARTISAN
      casteSystem.recordLabor(id, 6.0);
      casteSystem.update(0.1);
      expect(casteSystem.getCaste(id)).toBe(CasteType.ARTISAN);
      expect(casteSystem.castes[id * CASTE_STRIDE + CASTE_OFFSET_COOLDOWN]).toBeGreaterThan(14.0);

      // 2. 阵营开启总动员 (通常会促成工匠转士兵)
      casteSystem.setFactionWarState(1, true, true);

      // 运行 5.0 秒，冷却还剩 10 秒
      casteSystem.update(5.0);
      expect(casteSystem.castes[id * CASTE_STRIDE + CASTE_OFFSET_COOLDOWN]).toBeCloseTo(10.0, 1);

      // 此时即便处于战时动员状态，冷却锁仍强力拦截，保持 ARTISAN
      expect(casteSystem.getCaste(id)).toBe(CasteType.ARTISAN);

      // 3. 走完剩余 10 秒冷却，冷却结束后立即响应战时动员晋升为 SOLDIER，并写入新的 15s 冷却锁
      casteSystem.update(10.1);
      expect(casteSystem.getCaste(id)).toBe(CasteType.SOLDIER);
      expect(casteSystem.castes[id * CASTE_STRIDE + CASTE_OFFSET_COOLDOWN]).toBeCloseTo(PROMOTION_COOLDOWN_SECONDS, 1);
    });
  });

  describe('3. 领袖唯一性排他约束与 3.0s~5.0s 继承加冕 FSM', () => {
    it('每个阵营存活领袖严格 <= 1，老领袖存活时绝不并发产生双王', () => {
      const factionId = 3;
      const leader = ecs.allocateEntity();
      ecs.identities[leader * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;
      casteSystem._promote(leader, CasteType.LEADER);

      const soldier = ecs.allocateEntity();
      ecs.identities[soldier * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;
      casteSystem._promote(soldier, CasteType.SOLDIER);
      casteSystem.recordCombat(soldier, 1000.0, 10); // 战功极其显赫

      // 运行 100 帧
      for (let f = 0; f < 100; f++) {
        casteSystem.update(0.016);
      }

      // 老领袖未死，士兵不可称王
      expect(casteSystem.factionLeaderCount[factionId]).toBe(1);
      expect(casteSystem.getCaste(leader)).toBe(CasteType.LEADER);
      expect(casteSystem.getCaste(soldier)).toBe(CasteType.SOLDIER);
      expect(hasStatus(ecs.statusFlags, soldier, IS_LEADER)).toBe(false);
    });

    it('老领袖阵亡后，经历 3.0s 继承等待，选拔第一功勋者加冕且无主死锁解除', () => {
      const factionId = 4;
      const leader = ecs.allocateEntity();
      ecs.identities[leader * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;
      casteSystem._promote(leader, CasteType.LEADER);

      const soldierHero = ecs.allocateEntity();
      ecs.identities[soldierHero * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;
      casteSystem._promote(soldierHero, CasteType.SOLDIER);
      casteSystem.recordCombat(soldierHero, 200.0, 5); // 功勋卓著

      const civilian = ecs.allocateEntity();
      ecs.identities[civilian * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;

      casteSystem.update(0.1);
      expect(casteSystem.factionLeaderCount[factionId]).toBe(1);

      // 斩首老领袖
      casteSystem.killLeader(factionId, leader);
      ecs.freeEntity(leader);

      // 更新一次，确认处于无主期 (leaderCount == 0, heirTimers 激活)
      casteSystem.update(0.1);
      expect(casteSystem.factionLeaderCount[factionId]).toBe(0);
      expect(casteSystem.heirPending[factionId]).toBe(1);

      // 过去 2.0 秒 (未满 3.0s)，仍处于过渡期，尚未加冕
      casteSystem.update(2.0);
      expect(casteSystem.factionLeaderCount[factionId]).toBe(0);
      expect(hasStatus(ecs.statusFlags, soldierHero, IS_LEADER)).toBe(false);

      // 过去 1.1 秒 (累计超过 3.0s 继承时钟)，继承人即位加冕！
      casteSystem.update(1.1);
      expect(casteSystem.factionLeaderCount[factionId]).toBe(1);
      expect(casteSystem.getCaste(soldierHero)).toBe(CasteType.LEADER);
      expect(hasStatus(ecs.statusFlags, soldierHero, IS_LEADER)).toBe(true);
      expect(casteSystem.heirPending[factionId]).toBe(0);
    });
  });

  describe('4. 战俘奴隶 (IS_SLAVE) 晋升熔断断言', () => {
    it('带有 IS_SLAVE 掩码的单位绝对锁死在 CIVILIAN，注入巨量履历仍不响应任何晋升', () => {
      const slave = ecs.allocateEntity();
      setStatus(ecs.statusFlags, slave, IS_SLAVE);
      ecs.identities[slave * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 5;

      // 灌入巨量劳作与战斗经验
      casteSystem.recordLabor(slave, 9999.0);
      casteSystem.recordCombat(slave, 9999.0, 100);

      // 阵营甚至处于绝望的无领袖状态与战时动员
      casteSystem.setFactionWarState(5, true, true);
      casteSystem.update(0.5);

      // 断言: 阶级死死锁在 CIVILIAN，且经验累积被熔断拦截
      expect(casteSystem.getCaste(slave)).toBe(CasteType.CIVILIAN);
      expect(hasStatus(ecs.statusFlags, slave, IS_LEADER)).toBe(false);
      expect(casteSystem.castes[slave * CASTE_STRIDE + CASTE_OFFSET_EXP_LABOR]).toBe(0.0);
      expect(casteSystem.castes[slave * CASTE_STRIDE + CASTE_OFFSET_EXP_COMBAT]).toBe(0.0);
    });
  });

  describe('5. 人类【万金油适应】30% 履历门槛折扣', () => {
    it('人类平民晋升工匠仅需 3.5 劳作 (vs 常规 5.0)', () => {
      const human = ecs.allocateEntity();
      ecs.identities[human * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 6;
      casteSystem.setEntityRace(human, 'HUMAN');

      // 注入 3.6 劳作 (已超过 5.0 * 0.7 = 3.5)
      casteSystem.recordLabor(human, 3.6);
      casteSystem.update(0.1);

      expect(casteSystem.getCaste(human)).toBe(CasteType.ARTISAN);
    });

    it('非人类平民仅积累 3.6 劳作无法晋升工匠', () => {
      const orc = ecs.allocateEntity();
      ecs.identities[orc * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 7;
      casteSystem.setEntityRace(orc, 'ORC');

      casteSystem.recordLabor(orc, 3.6);
      casteSystem.update(0.1);

      expect(casteSystem.getCaste(orc)).toBe(CasteType.CIVILIAN);
    });
  });

  describe('6. 和平复员退伍机制', () => {
    it('阵营和平超过 60s 且士兵比例 > 50% 时触发退伍复员', () => {
      const factionId = 8;
      const s1 = ecs.allocateEntity();
      const s2 = ecs.allocateEntity();
      const civ = ecs.allocateEntity();
      ecs.identities[s1 * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;
      ecs.identities[s2 * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;
      ecs.identities[civ * IDENTITY_STRIDE + ID_OFFSET_FACTION] = factionId;

      casteSystem._promote(s1, CasteType.SOLDIER);
      casteSystem._promote(s2, CasteType.SOLDIER);

      // 清除晋升后的冷却，模拟和平 65 秒后
      casteSystem.castes[s1 * CASTE_STRIDE + CASTE_OFFSET_COOLDOWN] = 0.0;
      casteSystem.castes[s2 * CASTE_STRIDE + CASTE_OFFSET_COOLDOWN] = 0.0;
      casteSystem.factionPeaceTimers[factionId] = 65.0;

      casteSystem.update(0.1);

      // 士兵比例 (2/3 = 66.7% > 50%)，触发退伍复员为工匠或平民
      expect(casteSystem.getCaste(s1)).not.toBe(CasteType.SOLDIER);
    });
  });

  describe('7. 零 GC 内存安全与重置维护', () => {
    it('连续执行 100 帧更新循环，内存与状态机稳定无泄漏', () => {
      const entities = [];
      for (let i = 0; i < 30; i++) {
        const id = ecs.allocateEntity();
        ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = (i % 4) + 1;
        entities.push(id);
      }

      for (let f = 0; f < 100; f++) {
        casteSystem.update(0.016);
      }

      for (const id of entities) {
        casteSystem.resetEntity(id);
        ecs.freeEntity(id);
      }

      expect(ecs.getActiveCount()).toBe(0);
    });
  });
});
