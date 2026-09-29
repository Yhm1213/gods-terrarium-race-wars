/**
 * TC-EDGE-05.test.js
 * Milestone 2 核心守门测试套件: 阶级晋升无环有限状态机 (FSM) 守门套件
 * 严格覆盖 Milestone 2 契约 §6.2, QA 规范 §2.4, LL-007 防抖动工程设计
 * 
 * 守门断言清单:
 * 1. 机器断言 1 (拓扑无环与防振荡): 1,000 实体高频混合刺激模拟 10,000 Tick，任意实体在 15.0s 窗口内阶级跃迁次数严格 <= 1 (防抖冷却锁硬生效)；
 * 2. 机器断言 2 (领袖唯一性排他约束): 16 阵营混战压力测试 10,000 帧，各阵营同时处于 IS_LEADER 状态的实体在任意时刻严格 <= 1；老领袖阵亡后，新领袖在 3.0s~5.0s 内完成选举加冕，无永久无主死锁；
 * 3. 机器断言 3 (战俘奴隶绝嗣与晋升熔断): 标记 IS_SLAVE 实体阶级锁死在 CIVILIAN，晋升率恒为 0，经验注入绝对熔断拦截；
 * 4. 压力稳定性与零 GC 内存安全: 10,000 Tick 极限运行 0 未捕获异常，连续内存 TypedArray 规格恒定 65,552 B。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  TOTAL_SLOTS,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../../src/core/ECS.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { PRNG } from '../../src/core/PRNG.js';
import {
  SocialCasteSystem,
  FACTION_CAPACITY,
  DEFAULT_HEIR_INTERREGNUM
} from '../../src/profession/SocialCasteSystem.js';
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

describe('TC-EDGE-05: 阶级晋升无环有限状态机 (FSM) 守门套件 (Milestone 2 Guardrail)', () => {
  let ecs;
  let eventBus;
  let casteSystem;

  beforeEach(() => {
    ecs = new ECS();
    eventBus = new DomainEventBus();
    casteSystem = new SocialCasteSystem(ecs, eventBus, { heirInterregnumSeconds: 3.0 });
  });

  describe('1. FSM 拓扑无死循环震荡守门断言 (Anti-Oscillation Guardrail)', () => {
    it('1,000 实体高频混合刺激模拟 10,000 Tick，任意实体在 15.0s 窗口内阶级跃迁次数严格 <= 1', () => {
      const prng = new PRNG(0x15F53);
      const dt = 1.0 / 60.0; // 60 FPS 物理单帧
      const TOTAL_TICKS = 10000;
      const POP_COUNT = 1000;
      const targetFaction = 1;

      // 预先指派 1 名永久稳定领袖，避免该阵营触发继承选举影响平民
      const permanentLeader = ecs.allocateEntity();
      ecs.identities[permanentLeader * IDENTITY_STRIDE + ID_OFFSET_FACTION] = targetFaction;
      casteSystem._promote(permanentLeader, CasteType.LEADER);

      // 分配 1,000 个平民实体
      const entities = new Uint16Array(POP_COUNT);
      for (let i = 0; i < POP_COUNT; i++) {
        const id = ecs.allocateEntity();
        ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = targetFaction;
        entities[i] = id;
      }

      // 跟踪每个实体上一次发生阶级跃迁的时间戳 (秒)
      const lastTransitionTimes = new Float32Array(TOTAL_SLOTS).fill(-9999.0);
      let totalTransitions = 0;
      let oscillationViolations = 0;

      // 订阅领域事件总线，捕获每次阶级跃迁 (DomainEventBus 回调签名: type, srcId, targetId, p1, p2)
      eventBus.subscribe(DomainEvents.EVT_CASTE_PROMOTED, (type, eid, targetId, newCaste) => {
        if (eid === permanentLeader) return;
        const currentSimTime = currentTickIndex * dt;
        const lastTime = lastTransitionTimes[eid];

        if (lastTime >= 0.0) {
          const deltaSeconds = currentSimTime - lastTime;
          // 契约硬断言: 任意 15.0s (900 Tick) 窗口内阶级跃迁次数严格 <= 1
          // 相邻两次跃迁时间差必须 >= 15.0s (允许浮点计算容差 1e-4)
          if (deltaSeconds < (PROMOTION_COOLDOWN_SECONDS - 0.0001)) {
            oscillationViolations++;
          }
        }

        lastTransitionTimes[eid] = currentSimTime;
        totalTransitions++;
      });

      let currentTickIndex = 0;

      // 模拟 10,000 个物理 Tick (虚拟运行 166.67 秒)
      for (let tick = 0; tick < TOTAL_TICKS; tick++) {
        currentTickIndex = tick;

        // 每隔 600 Tick (10秒) 周期性翻转战争与动员状态，施加宏观张力震荡
        if (tick % 600 === 0) {
          const inWar = (tick % 1200 === 0);
          casteSystem.setFactionWarState(targetFaction, inWar, inWar);
        }

        // 高频随机抽取 10 个实体注入高强度刺激 (劳作 / 战斗伤害，10,000 Tick 累计 100,000 次刺激)
        for (let s = 0; s < 10; s++) {
          const targetId = entities[prng.nextInt(0, POP_COUNT - 1)];
          if (prng.nextFloat() < 0.5) {
            casteSystem.recordLabor(targetId, 2.0);
          } else {
            casteSystem.recordCombat(targetId, 20.0, 1);
          }
        }

        // 推进 FSM 系统步进
        casteSystem.update(dt);
        eventBus.flush();
      }

      // 硬断言 1: 外部高烈度刺激确实促成了阶级流转
      expect(totalTransitions).toBeGreaterThan(50);

      // 硬断言 2: 15.0s 防振荡滞后冷却锁绝对生效，违规次数严格为 0！
      expect(oscillationViolations).toBe(0);
      const violationRate = oscillationViolations / totalTransitions;
      expect(violationRate).toBe(0.0);
    });
  });

  describe('2. 领袖唯一性排他约束与继承时钟守门断言 (Leader Exclusivity & Succession)', () => {
    it('16 阵营混战压力测试 10,000 帧，各阵营同时处于 IS_LEADER 状态严格 <= 1，老领袖阵亡后在 3.0s~5.0s 内完成选举加冕', () => {
      const prng = new PRNG(0x4EAD);
      const dt = 1.0 / 60.0;
      const TOTAL_FRAMES = 10000;
      const FACTION_COUNT = 16;
      const UNITS_PER_FACTION = 25;

      // 为 16 个阵营初始化实体与第一代领袖
      const factionMembers = Array.from({ length: FACTION_COUNT }, () => []);

      for (let f = 0; f < FACTION_COUNT; f++) {
        for (let u = 0; u < UNITS_PER_FACTION; u++) {
          const id = ecs.allocateEntity();
          ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = f;
          factionMembers[f].push(id);
        }

        // 每个阵营加冕第 1 位初始领袖
        const firstLeader = factionMembers[f][0];
        casteSystem._promote(firstLeader, CasteType.LEADER);
      }

      // 刺杀历史跟踪记录与断言统计
      let doubleKingViolations = 0;
      let regicideEventCount = 0;
      let successionSuccessCount = 0;
      let prematureSuccessionCount = 0; // 提前即位违规 (< 3.0s)
      let overdueSuccessionCount = 0;   // 超时死锁违规 (> 5.0s)

      // 记录每个阵营最近一次领袖阵亡的虚拟时间 (秒)，以及被斩首的阵营索引
      const regicideTimestamps = new Float32Array(FACTION_COUNT).fill(-1.0);

      // 订阅新王加冕事件 (DomainEventBus 回调签名: type, srcId, targetId, p1, p2)
      // emit 参数: (DomainEvents.EVT_HEIR_CROWNED, bestCandidateId, 0, factionId, 0)
      eventBus.subscribe(DomainEvents.EVT_HEIR_CROWNED, (type, newLeaderId, targetId, factionId) => {
        const coronationTime = currentFrameIndex * dt;
        const deathTime = regicideTimestamps[factionId];

        if (deathTime >= 0.0) {
          const interregnumDuration = coronationTime - deathTime;
          // 契约断言: 新领袖必须在 3.0s ~ 5.0s 内完成选举加冕
          if (interregnumDuration < (3.0 - 0.05)) {
            prematureSuccessionCount++;
          }
          if (interregnumDuration > (5.0 + 0.05)) {
            overdueSuccessionCount++;
          }
          successionSuccessCount++;
          regicideTimestamps[factionId] = -1.0; // 成功加冕，关闭监控
        }
      });

      let currentFrameIndex = 0;

      // 运行 10,000 帧极限混战
      for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
        currentFrameIndex = frame;
        const currentSimTime = frame * dt;

        // 极端压力注入: 每 600 帧 (10.0秒) 随机刺杀 1 个阵营的现任领袖
        if (frame % 600 === 0 && frame > 0) {
          const targetFaction = prng.nextInt(0, FACTION_COUNT - 1);
          const currentLeaderId = casteSystem.factionLeaderEntityId[targetFaction];

          // 仅在当前确实有合法领袖存活时执行斩首
          if (currentLeaderId > NULL_ENTITY && ecs.isAlive(currentLeaderId)) {
            regicideTimestamps[targetFaction] = currentSimTime;
            regicideEventCount++;

            // 处决领袖并释放实体
            casteSystem.killLeader(targetFaction, currentLeaderId);
            ecs.freeEntity(currentLeaderId);

            // 从阵营名册中剔除该阵营阵亡领袖
            const idx = factionMembers[targetFaction].indexOf(currentLeaderId);
            if (idx >= 0) factionMembers[targetFaction].splice(idx, 1);
          }
        }

        // 持续对 16 阵营成员注入战斗与劳作背景履历
        for (let f = 0; f < FACTION_COUNT; f++) {
          const members = factionMembers[f];
          if (members.length > 0) {
            const randomMember = members[prng.nextInt(0, members.length - 1)];
            if (ecs.isAlive(randomMember)) {
              casteSystem.recordCombat(randomMember, 5.0, 0);
              casteSystem.recordLabor(randomMember, 0.5);
            }
          }
        }

        // 步进阶级 FSM 系统
        casteSystem.update(dt);
        eventBus.flush();

        // 守门核心校验: 每一帧普查 16 个阵营的领袖排他唯一性 (Strictly <= 1)
        for (let f = 0; f < FACTION_COUNT; f++) {
          let aliveLeadersCount = 0;
          for (let m = 0; m < factionMembers[f].length; m++) {
            const memId = factionMembers[f][m];
            if (ecs.isAlive(memId) && hasStatus(ecs.statusFlags, memId, IS_LEADER)) {
              aliveLeadersCount++;
            }
          }

          if (aliveLeadersCount > 1) {
            doubleKingViolations++;
          }
          if (casteSystem.factionLeaderCount[f] > 1) {
            doubleKingViolations++;
          }

          // 检查是否存在永久无主死锁: 若领袖阵亡超过 5.0s 且阵营有存活人口，仍未即位则记为死锁
          const deathTime = regicideTimestamps[f];
          if (deathTime >= 0.0 && (currentSimTime - deathTime) > 5.1) {
            if (factionMembers[f].length > 0) {
              overdueSuccessionCount++;
              regicideTimestamps[f] = -1.0; // 避免重复累加
            }
          }
        }
      }

      // 硬断言 1: 斩首压力测试确实多次触发
      expect(regicideEventCount).toBeGreaterThanOrEqual(14);

      // 硬断言 2: 10,000 帧期间绝对无并发双王，领袖唯一性约束违规恒为 0
      expect(doubleKingViolations).toBe(0);

      // 硬断言 3: 老领袖阵亡后，继承加冕全部在 3.0s~5.0s 内完成，无提前即位，无永久死锁
      expect(successionSuccessCount).toBeGreaterThanOrEqual(regicideEventCount - 1); // 允许最后一轮可能在结尾
      expect(prematureSuccessionCount).toBe(0);
      expect(overdueSuccessionCount).toBe(0);
    });
  });

  describe('3. 战俘奴隶绝嗣与晋升熔断守门断言 (Slave Circuit Breaker)', () => {
    it('标记 IS_SLAVE 实体阶级锁死在 CIVILIAN，晋升率恒为 0，经验注入绝对拦截', () => {
      const SLAVE_COUNT = 80;
      const targetFaction = 5;

      const slaves = new Uint16Array(SLAVE_COUNT);
      for (let i = 0; i < SLAVE_COUNT; i++) {
        const id = ecs.allocateEntity();
        ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = targetFaction;
        // 标记 IS_SLAVE 掩码
        setStatus(ecs.statusFlags, id, IS_SLAVE);
        slaves[i] = id;
      }

      let slavePromotedCount = 0;
      eventBus.subscribe(DomainEvents.EVT_CASTE_PROMOTED, (type, eid) => {
        if (hasStatus(ecs.statusFlags, eid, IS_SLAVE)) {
          slavePromotedCount++;
        }
      });

      // 处于全员战时动员与无领袖真空极限诱导状态
      casteSystem.setFactionWarState(targetFaction, true, true);

      // 模拟 1,000 帧持续灌入天量经验
      for (let tick = 0; tick < 1000; tick++) {
        for (let i = 0; i < SLAVE_COUNT; i++) {
          const sid = slaves[i];
          casteSystem.recordLabor(sid, 100.0);
          casteSystem.recordCombat(sid, 500.0, 10);
        }

        casteSystem.update(1.0 / 60.0);
        eventBus.flush();
      }

      // 硬断言 1: 奴隶实体阶级 100% 锁死在 CIVILIAN
      for (let i = 0; i < SLAVE_COUNT; i++) {
        const sid = slaves[i];
        expect(casteSystem.getCaste(sid)).toBe(CasteType.CIVILIAN);
        expect(hasStatus(ecs.statusFlags, sid, IS_LEADER)).toBe(false);

        // 硬断言 2: 劳作与战斗履历在底层被硬熔断，保持为 0.0
        const off = sid * CASTE_STRIDE;
        expect(casteSystem.castes[off + CASTE_OFFSET_EXP_LABOR]).toBe(0.0);
        expect(casteSystem.castes[off + CASTE_OFFSET_EXP_COMBAT]).toBe(0.0);
      }

      // 硬断言 3: 晋升事件触发次数严格为 0
      expect(slavePromotedCount).toBe(0);
    });
  });

  describe('4. 压力稳定性与零 GC 内存安全 (LL-007 防抖动加固)', () => {
    it('10,000 Tick 极限运行 0 未捕获异常，连续内存规格恒定为 65,552 字节', () => {
      let caughtErrors = 0;

      // JIT 预热 500 轮消除冷启动抖动 (LL-007)
      for (let w = 0; w < 500; w++) {
        casteSystem.update(1.0 / 60.0);
      }

      const expectedByteLength = TOTAL_SLOTS * CASTE_STRIDE * 4; // 4097 * 4 * 4 = 65,552 B
      expect(casteSystem.castes.byteLength).toBe(expectedByteLength);

      const t0 = performance.now();

      try {
        for (let tick = 0; tick < 10000; tick++) {
          casteSystem.update(1.0 / 60.0);
        }
      } catch (err) {
        caughtErrors++;
      }

      const t1 = performance.now();
      const durationMs = t1 - t0;

      // 硬断言 1: 10,000 Tick 运行 0 未捕获异常
      expect(caughtErrors).toBe(0);

      // 硬断言 2: 内存池严格恒定，无动态数组扩容与逃逸
      expect(casteSystem.castes.byteLength).toBe(expectedByteLength);
      expect(casteSystem.factionTotalPop.byteLength).toBe(FACTION_CAPACITY * 2);

      // 硬断言 3: 性能门禁: 10,000 Tick 更新耗时 < 150ms (LL-007 工程宽容门限)
      expect(durationMs).toBeLessThan(150.0);
    });
  });
});
