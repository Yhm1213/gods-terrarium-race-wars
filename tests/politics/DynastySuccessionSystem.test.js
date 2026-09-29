/**
 * DynastySuccessionSystem.test.js
 * 世袭五大意外大转盘、3.0s 原子事务锁与战后处置条约测试套件 (WP-3.4)
 * 验证 SPEC-M3-CONTRACT §5.1, §5.2, §5.3, §5.4 (TC-EDGE-05, TC-EDGE-07)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  GENETICS_STRIDE,
  GEN_OFFSET_PATERNAL,
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
import { TileGrid } from '../../src/world/TileGrid.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { PRNG } from '../../src/core/PRNG.js';
import {
  MAX_FACTIONS,
  FACTION_STRIDE,
  FAC_OFFSET_CIVIC_ID,
  FAC_OFFSET_FOOD,
  FAC_OFFSET_ORE,
  FAC_OFFSET_POP_COUNT,
  FAC_OFFSET_FLAGS,
  FactionFlags,
  createFactionRuntimeBuffer
} from '../../src/data/FactionData.js';
import {
  DynastySuccessionSystem,
  SuccessionRouletteType
} from '../../src/politics/DynastySuccessionSystem.js';
import {
  PostWarTreatySystem,
  TreatyType
} from '../../src/politics/PostWarTreatySystem.js';

describe('DynastySuccessionSystem & PostWarTreaty Specification Suite (WP-3.4)', () => {
  let ecs;
  let tileGrid;
  let factionBuffer;
  let eventBus;
  let successionSys;
  let treatySys;

  const myFac = 1;

  beforeEach(() => {
    ecs = new ECS();
    ecs.genetics = createGeneticsBuffer();
    tileGrid = new TileGrid();
    factionBuffer = createFactionRuntimeBuffer();
    eventBus = new DomainEventBus();
    successionSys = new DynastySuccessionSystem(ecs, factionBuffer, eventBus, null, ecs.genetics);
    treatySys = new PostWarTreatySystem(ecs, tileGrid, factionBuffer, eventBus);
  });

  describe('1. 世袭五大意外驾崩大转盘与基因防伪', () => {
    it('正常顺位与基因防伪认亲: 仅合法父系等位基因子嗣能顺位加冕', () => {
      const kingGene = 0b101010;

      // 老王
      const king = ecs.allocateEntity();
      ecs.identities[king * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;
      successionSys.setLeader(myFac, king);

      // 敌国冒充者 (基因不匹配 0b000001)
      const impostor = ecs.allocateEntity();
      ecs.identities[impostor * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;
      ecs.genetics[impostor * GENETICS_STRIDE + GEN_OFFSET_PATERNAL] = 0b000001;

      // 正统合法长子 (基因匹配 0b101010)
      const trueHeir = ecs.allocateEntity();
      ecs.identities[trueHeir * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;
      ecs.genetics[trueHeir * GENETICS_STRIDE + GEN_OFFSET_PATERNAL] = kingGene;

      // 强制 PRNG 抽取 0.1 (正常顺位大转盘)
      successionSys.prng = { nextFloat: () => 0.10 };

      // 老王驾崩，触发加冕
      const newKing = successionSys.triggerSuccession(myFac, king, kingGene);

      // 断言: 合法长子加冕，冒充者被基因防伪断言过滤
      expect(newKing).toBe(trueHeir);
      expect(hasStatus(ecs.statusFlags, trueHeir, IS_LEADER)).toBe(true);
      expect(hasStatus(ecs.statusFlags, impostor, IS_LEADER)).toBe(false);
    });

    it('权臣摄政大转盘: 抽中幼主时，由第一猛士加冕摄政王 (IS_REGENT)', () => {
      const king = ecs.allocateEntity();
      ecs.identities[king * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;
      successionSys.setLeader(myFac, king);

      // 勇士 A (HP 100)
      const warriorA = ecs.allocateEntity();
      ecs.identities[warriorA * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;
      ecs.health[warriorA * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 100.0;

      // 第一猛士 B (HP 300)
      const warriorB = ecs.allocateEntity();
      ecs.identities[warriorB * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;
      ecs.health[warriorB * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 300.0;

      // 强制 PRNG 抽取 0.60 (权臣摄政大转盘 [0.55 ~ 0.70))
      successionSys.prng = { nextFloat: () => 0.60 };

      const regent = successionSys.triggerSuccession(myFac, king, 0);

      // 断言: 第一猛士加冕并被置位 IS_REGENT
      expect(regent).toBe(warriorB);
      expect(hasStatus(ecs.statusFlags, warriorB, IS_LEADER)).toBe(true);
      expect(hasStatus(ecs.statusFlags, warriorB, IS_REGENT)).toBe(true);
    });
  });

  describe('2. 3.0 秒继承原子事务锁 (TC-EDGE-07)', () => {
    it('老王咽气后 3.0s 内锁定王位指针，杜绝并发双王死锁', () => {
      const king = ecs.allocateEntity();
      ecs.identities[king * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;

      const heirA = ecs.allocateEntity();
      ecs.identities[heirA * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;

      const heirB = ecs.allocateEntity();
      ecs.identities[heirB * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;

      // 触发老王驾崩加冕
      const king1 = successionSys.triggerSuccession(myFac, king, 0);
      expect(successionSys.isSuccessionLocked(myFac)).toBe(true);

      // 立即在同帧注入第二起刺杀/篡位企图
      const king2 = successionSys.triggerSuccession(myFac, king1, 0);

      // 断言: 原子事务锁生效，第二次篡位被直接阻断驳回
      expect(king2).toBe(king1);

      // 推进 3.1 秒原子锁解开
      successionSys.update(3.1);
      expect(successionSys.isSuccessionLocked(myFac)).toBe(false);
    });
  });

  describe('3. 绝嗣角斗空安全重铸 (Extinction Failsafe)', () => {
    it('子嗣死绝时过滤奴隶，全族仅剩 1 人时推选平民即位并坍塌为军阀强权独裁，绝不抛出空数组异常', () => {
      const king = ecs.allocateEntity();
      ecs.identities[king * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;

      // 战俘奴隶 (绝嗣角斗必须过滤)
      const slave = ecs.allocateEntity();
      ecs.identities[slave * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;
      setStatus(ecs.statusFlags, slave, IS_SLAVE);

      // 仅存的 1 名普通平民
      const commoner = ecs.allocateEntity();
      ecs.identities[commoner * IDENTITY_STRIDE + ID_OFFSET_FACTION] = myFac;

      // 初始政体为共和政体 (civic = 2)
      factionBuffer[(myFac - 1) * FACTION_STRIDE + FAC_OFFSET_CIVIC_ID] = 2;

      // 触发绝嗣继承
      let crowned = NULL_ENTITY;
      expect(() => {
        crowned = successionSys.triggerSuccession(myFac, king, 0);
      }).not.toThrow();

      // 断言: 独苗平民成功加冕，奴隶未被推选
      expect(crowned).toBe(commoner);
      expect(hasStatus(ecs.statusFlags, commoner, IS_LEADER)).toBe(true);
      expect(hasStatus(ecs.statusFlags, slave, IS_LEADER)).toBe(false);

      // 政体自然坍塌为军阀强权独裁 (1)
      expect(factionBuffer[(myFac - 1) * FACTION_STRIDE + FAC_OFFSET_CIVIC_ID]).toBe(1);
    });
  });

  describe('4. 战后处置条约与飞行箭矢空安全守卫 (PostWarTreatySystem & TC-EDGE-05)', () => {
    it('屠城抢掠将战败国仓储完全掠夺归战胜国', () => {
      const enemyFac = 2;
      const baseV = (myFac - 1) * FACTION_STRIDE;
      const baseE = (enemyFac - 1) * FACTION_STRIDE;

      factionBuffer[baseV + FAC_OFFSET_FOOD] = 50;
      factionBuffer[baseV + FAC_OFFSET_ORE] = 20;

      factionBuffer[baseE + FAC_OFFSET_FOOD] = 100;
      factionBuffer[baseE + FAC_OFFSET_ORE] = 80;

      treatySys.enactTreaty(myFac, enemyFac, TreatyType.SACK_CITY);

      // 断言: 掠夺一空
      expect(factionBuffer[baseE + FAC_OFFSET_FOOD]).toBe(0);
      expect(factionBuffer[baseE + FAC_OFFSET_ORE]).toBe(0);
      expect(factionBuffer[baseV + FAC_OFFSET_FOOD]).toBe(150);
      expect(factionBuffer[baseV + FAC_OFFSET_ORE]).toBe(100);
    });

    it('奴役战俘将全员士兵置位 IS_SLAVE', () => {
      const enemyFac = 2;
      const enemySoldier = ecs.allocateEntity();
      ecs.identities[enemySoldier * IDENTITY_STRIDE + ID_OFFSET_FACTION] = enemyFac;

      treatySys.enactTreaty(myFac, enemyFac, TreatyType.ENSLAVE_PRISONERS);

      expect(hasStatus(ecs.statusFlags, enemySoldier, IS_SLAVE)).toBe(true);
    });

    it('飞行投射物空指针守卫 (TC-EDGE-05): 敌方灭绝瞬间命中空实体安全消解伤害，杜绝崩溃', () => {
      const deadTargetId = 9999; // 已经释放或不存在的空指针
      const damage = treatySys.guardInFlightProjectile(deadTargetId, 85.0);

      // 伤害安全消解为 0.0
      expect(damage).toBe(0.0);
    });

    it('流寇残兵乞讨生态位: 残兵 < 5 时向邻国乞讨粮食并获得 120s 免袭和平锁', () => {
      const outlawFac = 3;
      const neighborFac = 1;

      factionBuffer[(outlawFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 3; // 残兵 3 人
      factionBuffer[(outlawFac - 1) * FACTION_STRIDE + FAC_OFFSET_FOOD] = 0;      // 断粮
      factionBuffer[(neighborFac - 1) * FACTION_STRIDE + FAC_OFFSET_FOOD] = 20;

      const agreed = treatySys.handleOutlawBegging(outlawFac, neighborFac);

      expect(agreed).toBe(true);
      // 干粮转移
      expect(factionBuffer[(neighborFac - 1) * FACTION_STRIDE + FAC_OFFSET_FOOD]).toBe(18);
      expect(factionBuffer[(outlawFac - 1) * FACTION_STRIDE + FAC_OFFSET_FOOD]).toBe(2);
    });
  });
});
