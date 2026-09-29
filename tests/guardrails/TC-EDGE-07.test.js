/**
 * TC-EDGE-07.test.js
 * Milestone 3 核心守门测试套件: 继承权 3.0s 原子事务锁、两阶段健康自检与绝嗣空安全重铸
 * 严格覆盖 SPEC-M3-CONTRACT §5.1, §5.2, §8 TC-EDGE-07, QA 规范 §2.4, LL-007 防抖动设计
 * 
 * 守门硬断言清单:
 * 1. 机器断言 1 (3.0s 原子事务锁与无双王并发):
 *    老皇帝驾崩瞬间启动 3.0s 原子事务锁，在此过渡期间对王位施加 1,000 次高频并发刺杀或篡位，
 *    王位读写指针严格锁定，全阵营处于 IS_LEADER 的领袖实体数严格 <= 1，双王并发率恒为 0.0%；
 * 2. 机器断言 2 (双等位基因防伪认亲掩码排他性):
 *    依据 isValidHeir = isAlive && !isUndead && (paternalGene & kingGene === kingGene)，
 *    对敌国刺客、骷髅兵与假冒私生子进行全覆盖测试，违规穿透率恒为 0.0%，正统皇室血脉顺位加冕率 100%；
 * 3. 机器断言 3 (绝嗣角斗空安全重铸 Extinction Failsafe):
 *    子嗣死绝时严格过滤奴隶 (IS_SLAVE)，按战力遴选全族第一猛士；全族仅存 1 人时推选该平民即位，
 *    政体自然坍塌为【军阀强权独裁】(1)，0 人存活时安全返回 NULL_ENTITY，绝不抛出空数组异常；
 * 4. 压力测试断言 (长程 16 阵营更替稳定性):
 *    长程 500 次继承轮替模拟，双王发生率恒为 0.0%，异常抛出率为 0.0%。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  GENETICS_STRIDE,
  GEN_OFFSET_PATERNAL,
  GEN_OFFSET_PHENOTYPE,
  createGeneticsBuffer,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX
} from '../../src/core/ECS.js';
import {
  IS_ALIVE,
  IS_LEADER,
  IS_REGENT,
  IS_SLAVE,
  hasStatus,
  setStatus,
  clearStatus
} from '../../src/components/UnitStatusFlags.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { PRNG } from '../../src/core/PRNG.js';
import {
  MAX_FACTIONS,
  FACTION_STRIDE,
  FAC_OFFSET_CIVIC_ID,
  FAC_OFFSET_POP_COUNT,
  FAC_OFFSET_FLAGS,
  FactionFlags,
  createFactionRuntimeBuffer
} from '../../src/data/FactionData.js';
import {
  DynastySuccessionSystem,
  SUCCESSION_LOCK_SECONDS,
  SuccessionRouletteType
} from '../../src/politics/DynastySuccessionSystem.js';

describe('TC-EDGE-07: 继承权 3.0s 原子事务锁与两阶段健康自检守门套件 (Milestone 3 Guardrail)', () => {
  let ecs;
  let factionBuffer;
  let eventBus;
  let successionSys;

  const testFac = 1;

  beforeEach(() => {
    ecs = new ECS();
    ecs.genetics = createGeneticsBuffer();
    factionBuffer = createFactionRuntimeBuffer();
    eventBus = new DomainEventBus();
    successionSys = new DynastySuccessionSystem(ecs, factionBuffer, eventBus, null, ecs.genetics);

    // 激活测试阵营
    const baseOff = (testFac - 1) * FACTION_STRIDE;
    factionBuffer[baseOff + FAC_OFFSET_FLAGS] = FactionFlags.ACTIVE;
  });

  describe('1. 3.0s 继承原子事务锁与无双王并发硬断言 (TC-EDGE-07)', () => {
    it('机器断言 1.1: 老皇帝咽气启动 3.0s 原子事务锁，过渡期内高频并发刺杀，王位指针锁定，绝无双王并发', () => {
      // 1. 创立老皇帝
      const oldKing = ecs.allocateEntity();
      ecs.identities[oldKing * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
      successionSys.setLeader(testFac, oldKing);

      // 创立多名继承人与刺客
      const heirA = ecs.allocateEntity();
      ecs.identities[heirA * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;

      const heirB = ecs.allocateEntity();
      ecs.identities[heirB * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;

      const assassinC = ecs.allocateEntity();
      ecs.identities[assassinC * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;

      // 2. 老皇帝咽气，触发合法加冕
      const newKing = successionSys.triggerSuccession(testFac, oldKing, 0);
      expect(newKing).toBeGreaterThan(NULL_ENTITY);

      // 断言: 3.0s 原子事务锁已启动
      expect(successionSys.isSuccessionLocked(testFac)).toBe(true);
      expect(successionSys.getLeader(testFac)).toBe(newKing);

      // 3. 在 3.0s 保护期内，密集注入 1,000 次并发刺杀与政变企图
      let doubleKingOccurred = false;
      const PARALLEL_ATTEMPTS = 1000;

      for (let i = 0; i < PARALLEL_ATTEMPTS; i++) {
        // 尝试推举刺客或二皇子登基
        const attemptResult = successionSys.triggerSuccession(testFac, newKing, 0);

        // 硬断言: 篡位被事务锁直接阻断，返回的始终是已锁定的合法新王
        if (attemptResult !== newKing) {
          doubleKingOccurred = true;
        }

        // 扫描全 ECS 实体，核实当前处于 IS_LEADER 的领袖总数严格等于 1
        let leaderCount = 0;
        const total = ecs.activeCount;
        const dense = ecs.denseEntities;
        for (let j = 0; j < total; j++) {
          const eid = dense[j];
          if (hasStatus(ecs.statusFlags, eid, IS_LEADER)) {
            leaderCount++;
          }
        }
        if (leaderCount !== 1) {
          doubleKingOccurred = true;
        }
      }

      // 硬断言: 并发双王发生率恒为 0.0%
      expect(doubleKingOccurred).toBe(false);

      // 4. 推进 3.0s 过渡时钟，验证原子锁自然解开
      successionSys.update(SUCCESSION_LOCK_SECONDS + 0.1);
      expect(successionSys.isSuccessionLocked(testFac)).toBe(false);

      // 解锁后，新王遇刺方可合法移交王位
      const nextKing = successionSys.triggerSuccession(testFac, newKing, 0);
      expect(nextKing).not.toBe(newKing);
    });
  });

  describe('2. 双等位基因防伪认亲掩码断言 (Paternal Gene Anti-Counterfeit)', () => {
    it('机器断言 2.1: 严格过滤敌国刺客伪装与基因不全私生子，正统血脉 100% 顺位继承', () => {
      const KING_GENE = 0b10110011; // 皇家父系特征位掩码

      // 1. 老皇帝
      const king = ecs.allocateEntity();
      ecs.identities[king * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
      ecs.genetics[king * GENETICS_STRIDE + GEN_OFFSET_PATERNAL] = KING_GENE;
      successionSys.setLeader(testFac, king);

      // 2. 候选人池构建:
      // (1) 敌国潜伏刺客: 基因完全无关
      const assassin = ecs.allocateEntity();
      ecs.identities[assassin * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
      ecs.genetics[assassin * GENETICS_STRIDE + GEN_OFFSET_PATERNAL] = 0b01001100;

      // (2) 基因残缺的伪冒私生子: 仅包含部分位，缺少显性特征位
      const fakeBastard = ecs.allocateEntity();
      ecs.identities[fakeBastard * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
      ecs.genetics[fakeBastard * GENETICS_STRIDE + GEN_OFFSET_PATERNAL] = 0b10110000; // 缺少末位 0b11

      // (3) 不死族骷髅兵伪装: 死亡实体
      const undead = ecs.allocateEntity();
      ecs.identities[undead * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
      ecs.genetics[undead * GENETICS_STRIDE + GEN_OFFSET_PATERNAL] = KING_GENE;
      clearStatus(ecs.statusFlags, undead, IS_ALIVE); // 已死/非活体

      // (4) 正统嫡长子: 显性包含老皇帝全量父系位掩码
      const trueHeir = ecs.allocateEntity();
      ecs.identities[trueHeir * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
      ecs.genetics[trueHeir * GENETICS_STRIDE + GEN_OFFSET_PATERNAL] = KING_GENE | 0b01000000;

      // 3. 逐一运行父系基因防伪认亲校验 (verifyPaternalGene)
      expect(successionSys.verifyPaternalGene(assassin, KING_GENE)).toBe(false);
      expect(successionSys.verifyPaternalGene(fakeBastard, KING_GENE)).toBe(false);
      expect(successionSys.verifyPaternalGene(undead, KING_GENE)).toBe(false);
      expect(successionSys.verifyPaternalGene(trueHeir, KING_GENE)).toBe(true);

      // 4. 强制抽取正常顺位大转盘 [40%]
      successionSys.prng = { nextFloat: () => 0.15 };

      // 老王驾崩，加冕执行
      const crowned = successionSys.triggerSuccession(testFac, king, KING_GENE);

      // 硬断言: 正统嫡长子加冕，冒充者与伪装骷髅兵穿透率为 0.0%
      expect(crowned).toBe(trueHeir);
      expect(hasStatus(ecs.statusFlags, trueHeir, IS_LEADER)).toBe(true);
      expect(hasStatus(ecs.statusFlags, assassin, IS_LEADER)).toBe(false);
      expect(hasStatus(ecs.statusFlags, fakeBastard, IS_LEADER)).toBe(false);
      expect(hasStatus(ecs.statusFlags, undead, IS_LEADER)).toBe(false);
    });
  });

  describe('3. 绝嗣角斗空安全重铸断言 (Extinction Failsafe)', () => {
    it('机器断言 3.1: 直系子嗣死绝时严格过滤战俘奴隶 (IS_SLAVE)，按战力遴选全族第一猛士', () => {
      const king = ecs.allocateEntity();
      ecs.identities[king * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;

      // 创建 3 名战俘奴隶 (必须被绝对过滤)
      const slaves = [];
      for (let i = 0; i < 3; i++) {
        const s = ecs.allocateEntity();
        ecs.identities[s * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
        setStatus(ecs.statusFlags, s, IS_SLAVE);
        // 赋予极高血量，测试是否会因血量高被误选
        ecs.health[s * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 9999.0;
        slaves.push(s);
      }

      // 创建两名部族战士
      const warriorWeak = ecs.allocateEntity();
      ecs.identities[warriorWeak * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
      ecs.health[warriorWeak * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 120.0;

      const warriorStrong = ecs.allocateEntity();
      ecs.identities[warriorStrong * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
      ecs.health[warriorStrong * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 380.0; // 第一猛士

      // 老皇帝驾崩，无子嗣匹配，进入幼主/猛士摄政大转盘 (0.60)
      successionSys.prng = { nextFloat: () => 0.60 };

      const crowned = successionSys.triggerSuccession(testFac, king, 0);

      // 硬断言: 奴隶绝对未被推选，第一猛士加冕
      expect(crowned).toBe(warriorStrong);
      expect(hasStatus(ecs.statusFlags, warriorStrong, IS_LEADER)).toBe(true);
      for (const s of slaves) {
        expect(hasStatus(ecs.statusFlags, s, IS_LEADER)).toBe(false);
      }
    });

    it('机器断言 3.2: 全族仅存 1 人时强制推选该平民即位，政体自然坍塌为军阀强权独裁，绝不抛出空数组异常', () => {
      const king = ecs.allocateEntity();
      ecs.identities[king * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;

      // 全族仅剩的 1 名普通平民
      const loneCivilian = ecs.allocateEntity();
      ecs.identities[loneCivilian * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;

      // 初始政体为长者议会共和 (civic = 2)
      factionBuffer[(testFac - 1) * FACTION_STRIDE + FAC_OFFSET_CIVIC_ID] = 2;

      let crowned = NULL_ENTITY;
      // 硬断言: 严禁抛出 Cannot read properties of undefined 或 RangeError
      expect(() => {
        crowned = successionSys.triggerSuccession(testFac, king, 0);
      }).not.toThrow();

      // 独苗即位
      expect(crowned).toBe(loneCivilian);
      expect(hasStatus(ecs.statusFlags, loneCivilian, IS_LEADER)).toBe(true);

      // 硬断言: 政体自然坍塌为【军阀强权独裁】(1)
      expect(factionBuffer[(testFac - 1) * FACTION_STRIDE + FAC_OFFSET_CIVIC_ID]).toBe(1);
    });

    it('机器断言 3.3: 全族人口 100% 灭绝 (0 人存活)，安全返回 NULL_ENTITY，零崩溃', () => {
      const king = ecs.allocateEntity();
      ecs.identities[king * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;

      // 阵营内没有任何其他存活单位
      let crowned = -999;
      expect(() => {
        crowned = successionSys.triggerSuccession(testFac, king, 0);
      }).not.toThrow();

      // 硬断言: 安全返回 NULL_ENTITY
      expect(crowned).toBe(NULL_ENTITY);
      expect(successionSys.getLeader(testFac)).toBe(NULL_ENTITY);
    });
  });

  describe('4. 长程 500 次继承轮替压力与双王防范断言 (LL-007)', () => {
    it('连续模拟 500 次王朝驾崩大转盘继承，双王发生率恒为 0.0%，异常率恒为 0.0%', () => {
      const prng = new PRNG(0x12345678);
      const successionPrng = new DynastySuccessionSystem(ecs, factionBuffer, eventBus, prng, ecs.genetics);

      const CYCLES = 500;
      let doubleKingCount = 0;
      let crashCount = 0;

      // 创建一个拥有 10 名人口的部族
      const popIds = [];
      for (let i = 0; i < 10; i++) {
        const u = ecs.allocateEntity();
        ecs.identities[u * IDENTITY_STRIDE + ID_OFFSET_FACTION] = testFac;
        ecs.health[u * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 100.0 + i * 20.0;
        ecs.genetics[u * GENETICS_STRIDE + GEN_OFFSET_PATERNAL] = 0b11001100;
        popIds.push(u);
      }

      let currentKing = popIds[0];
      successionPrng.setLeader(testFac, currentKing);

      for (let c = 0; c < CYCLES; c++) {
        // 解开前一轮的事务锁
        successionPrng.successionTimers[testFac] = 0.0;

        try {
          const nextKing = successionPrng.triggerSuccession(testFac, currentKing, 0b11001100);

          // 统计 IS_LEADER
          let leaderCount = 0;
          for (let p = 0; p < popIds.length; p++) {
            if (hasStatus(ecs.statusFlags, popIds[p], IS_LEADER)) {
              leaderCount++;
            }
          }

          if (leaderCount > 1) {
            doubleKingCount++;
          }

          currentKing = nextKing;
        } catch (err) {
          crashCount++;
        }
      }

      // 硬断言: 500 次轮替中，双王出现次数为 0，崩溃次数为 0
      expect(doubleKingCount).toBe(0);
      expect(crashCount).toBe(0);
      expect(doubleKingCount / CYCLES).toBe(0.0);
    });
  });
});
