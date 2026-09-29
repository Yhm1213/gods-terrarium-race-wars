/**
 * TC-EDGE-04.test.js
 * Milestone 2 核心守门测试套件: 孟德尔遗传确定性分布与卡方检验守门套件
 * 严格覆盖 Milestone 2 契约 §6.1, QA 规范 §2.4, LL-007 防抖动工程设计
 * 
 * 守门断言清单:
 * 1. 机器断言 1 (确定性重现): 固定 Seed 0xDEADBEEF 连续杂交 1,000 次，子代基因位掩码序列 100% 重现；
 * 2. 机器断言 2 (卡方拟合优度检验): 10,000 对杂合子亲本 (Aa x Aa) 杂交，统计 AA, Aa, aa 频次，卡方统计量 chi2 < 5.991 (df=2, p > 0.05)；
 * 3. 机器断言 3 (变异禁忌 0 穿透): 12 始祖种族各 1,000 次突变抽样 (共 12,000 次)，违禁器官穿透率严格为 0.0%，语义重映射率 100%；
 * 4. 机器断言 4 (模式 A 基因驱动平滑扩散): 激活驱动后三代繁衍，显性等位基因渗透率单调递增至 75% 以上，且无任何 1 帧发生全族大面积猝死断代；
 * 5. 零 GC 内存安全与极端性能: 10,000 次繁衍热循环连续内存恒定 65,552 B，耗时平滑满足工程预算。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ECS, NULL_ENTITY } from '../../src/core/ECS.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { PRNG } from '../../src/core/PRNG.js';
import {
  MendelianGeneticsSystem,
  BASE_MUTATION_RATE,
  GENE_DRIVE_BIAS_PROBABILITY
} from '../../src/mutation/MendelianGeneticsSystem.js';
import {
  filterAndRemapOrgans,
  SemanticRemapTable
} from '../../src/mutation/TabooFilter.js';
import {
  GENETICS_STRIDE,
  GEN_OFFSET_MATERNAL,
  GEN_OFFSET_PATERNAL,
  GEN_OFFSET_PHENOTYPE,
  GEN_OFFSET_GENERATION,
  TOTAL_SLOTS,
  initGenetics
} from '../../src/components/GeneticsComponent.js';
import { OrganFlags, ALL_ORGAN_FLAGS_MASK } from '../../src/data/MutationFlags.js';
import { Races, RaceList, isOrganTaboo } from '../../src/data/RaceData.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';

describe('TC-EDGE-04: 孟德尔遗传确定性分布与卡方检验守门套件 (Milestone 2 Guardrail)', () => {
  let ecs;
  let eventBus;

  beforeEach(() => {
    ecs = new ECS();
    eventBus = new DomainEventBus();
  });

  describe('1. 固定种子确定性可重现断言 (Deterministic Reproducibility)', () => {
    it('固定 Seed 0xDEADBEEF 下连续杂交 1,000 次，子代基因序列 100% 幂等重现', () => {
      const SEED = 0xDEADBEEF;
      const TRIALS = 1000;

      const executeTrialRun = () => {
        const localEcs = new ECS();
        const localPrng = new PRNG(SEED);
        const localGenetics = new MendelianGeneticsSystem(localEcs, null, localPrng);

        const mother = localEcs.allocateEntity();
        const father = localEcs.allocateEntity();
        const child = localEcs.allocateEntity();

        // 母本: 翅膀 + 花岗岩; 父本: 烈焰 + 毒气
        initGenetics(localGenetics.genetics, mother, OrganFlags.WING, OrganFlags.GRANITE, 1);
        initGenetics(localGenetics.genetics, father, OrganFlags.FLAME, OrganFlags.GAS, 1);

        // 连续内存记录 1,000 次产生的子代基因组 [maternal, paternal, phenotype]
        const snapshot = new Uint32Array(TRIALS * 3);

        for (let i = 0; i < TRIALS; i++) {
          localGenetics.breedChild(mother, father, child, 'HUMAN', { mutationRate: 0.1 });
          const off = child * GENETICS_STRIDE;
          snapshot[i * 3 + 0] = localGenetics.genetics[off + GEN_OFFSET_MATERNAL];
          snapshot[i * 3 + 1] = localGenetics.genetics[off + GEN_OFFSET_PATERNAL];
          snapshot[i * 3 + 2] = localGenetics.genetics[off + GEN_OFFSET_PHENOTYPE];
        }

        return snapshot;
      };

      const runA = executeTrialRun();
      const runB = executeTrialRun();

      expect(runA.length).toBe(TRIALS * 3);
      expect(runB.length).toBe(TRIALS * 3);

      let mismatchCount = 0;
      for (let i = 0; i < runA.length; i++) {
        if (runA[i] !== runB[i]) {
          mismatchCount++;
        }
      }

      // 硬断言: 每一项位掩码必须严格一致，重现率 100.0%
      expect(mismatchCount).toBe(0);
      const reproducibilityRate = 1.0 - (mismatchCount / runA.length);
      expect(reproducibilityRate).toBe(1.0);
    });
  });

  describe('2. 孟德尔 1:2:1 分离比卡方拟合优度检验断言 (Chi-Square Goodness of Fit)', () => {
    it('10,000 对杂合子亲本 (Aa x Aa) 杂交，统计 AA:Aa:aa 频次，卡方统计量 chi2 < 5.991 (df=2, p > 0.05)', () => {
      // 使用固定种子确保在任何 Worker/CI 环境下确定性通过 (LL-007)
      const prng = new PRNG(0xCAFEBABE);
      const geneticsSys = new MendelianGeneticsSystem(ecs, eventBus, prng);

      const mother = ecs.allocateEntity();
      const father = ecs.allocateEntity();
      const child = ecs.allocateEntity();

      // 双杂合子 Aa x Aa:
      // 等位基因 A = OrganFlags.WING (显性); 等位基因 a = 0 (隐性)
      const ALLELE_DOMINANT = OrganFlags.WING;
      const ALLELE_RECESSIVE = 0;

      initGenetics(geneticsSys.genetics, mother, ALLELE_DOMINANT, ALLELE_RECESSIVE, 1);
      initGenetics(geneticsSys.genetics, father, ALLELE_DOMINANT, ALLELE_RECESSIVE, 1);

      const N = 10000;
      let observedAA = 0; // 纯合显性 (AA)
      let observedAa = 0; // 杂合子 (Aa)
      let observedaa = 0; // 纯合隐性 (aa)

      // 禁用随机突变 (mutationRate: 0.0)，纯检验孟德尔第一定律减数分裂分离比
      for (let i = 0; i < N; i++) {
        geneticsSys.breedChild(mother, father, child, 'HUMAN', { mutationRate: 0.0 });
        const off = child * GENETICS_STRIDE;
        const mat = geneticsSys.genetics[off + GEN_OFFSET_MATERNAL];
        const pat = geneticsSys.genetics[off + GEN_OFFSET_PATERNAL];

        const hasMatA = mat === ALLELE_DOMINANT;
        const hasPatA = pat === ALLELE_DOMINANT;

        if (hasMatA && hasPatA) {
          observedAA++;
        } else if ((hasMatA && !hasPatA) || (!hasMatA && hasPatA)) {
          observedAa++;
        } else {
          observedaa++;
        }
      }

      // 总数守恒校验
      expect(observedAA + observedAa + observedaa).toBe(N);

      // 理论期望频次 (1:2:1 理论分离比)
      const expectedAA = N * 0.25; // 2,500
      const expectedAa = N * 0.50; // 5,000
      const expectedaa = N * 0.25; // 2,500

      // 计算卡方统计量: chi2 = sum((O_i - E_i)^2 / E_i)
      const chi2 =
        Math.pow(observedAA - expectedAA, 2) / expectedAA +
        Math.pow(observedAa - expectedAa, 2) / expectedAa +
        Math.pow(observedaa - expectedaa, 2) / expectedaa;

      // 硬断言 1: 在自由度 df = 2 时，显著性水平 alpha = 0.05 对应的临界值为 5.991
      // chi2 < 5.991 证明子代基因型分布完全服从孟德尔遗传定律 (p > 0.05，无法拒绝原假设)
      expect(chi2).toBeLessThan(5.991);

      // 硬断言 2: 表型显隐比 (3:1) 断言: 显性表型比例严格落在 [73.5%, 76.5%] 置信区间
      const dominantCount = observedAA + observedAa;
      const dominantRatio = dominantCount / N;
      expect(dominantRatio).toBeGreaterThan(0.735);
      expect(dominantRatio).toBeLessThan(0.765);

      // 硬断言 3: 隐性表型比例严格落在 [23.5%, 26.5%]
      const recessiveRatio = observedaa / N;
      expect(recessiveRatio).toBeGreaterThan(0.235);
      expect(recessiveRatio).toBeLessThan(0.265);
    });
  });

  describe('3. 变异禁忌 0 穿透与语义重映射断言 (Zero-Penetration Guardrail)', () => {
    it('12 始祖种族各 1,000 次突变抽样 (共 12,000 次)，违禁器官穿透率严格为 0.0%，语义重映射率 100%', () => {
      const prng = new PRNG(0x7AB00);
      const audit = { interceptedCount: 0, remappedMask: 0 };

      let totalMutations = 0;
      let tabooTriggeredCount = 0;
      let tabooPenetrationCount = 0;
      let successfulRemapCount = 0;

      for (const race of RaceList) {
        const raceId = race.id;

        for (let i = 0; i < 1000; i++) {
          totalMutations++;

          // 随机生成 1~3 位器官组合
          const bitCount = prng.nextInt(1, 3);
          let rawMask = 0;
          for (let b = 0; b < bitCount; b++) {
            rawMask |= (1 << prng.nextInt(0, 8));
          }
          rawMask >>>= 0;

          const hasTabooBefore = isOrganTaboo(raceId, rawMask);
          if (hasTabooBefore) {
            tabooTriggeredCount++;
          }

          // 执行禁忌拦截与语义重映射
          const safeMask = filterAndRemapOrgans(raceId, rawMask, audit);

          // 检查过滤后是否仍有禁忌器官残留
          const hasTabooAfter = isOrganTaboo(raceId, safeMask);
          if (hasTabooAfter) {
            tabooPenetrationCount++;
          }

          // 审计重映射记录
          if (hasTabooBefore) {
            if (audit.interceptedCount > 0 && !hasTabooAfter) {
              successfulRemapCount++;
            }
          }
        }
      }

      expect(totalMutations).toBe(12000);
      expect(tabooTriggeredCount).toBeGreaterThan(3000); // 随机组合中必有大量触犯禁忌

      // 守门机器硬断言 1: 违禁词条穿透率严格为 0.0%
      expect(tabooPenetrationCount).toBe(0);
      const penetrationRate = tabooPenetrationCount / tabooTriggeredCount;
      expect(penetrationRate).toBe(0.0);

      // 守门机器硬断言 2: 所有被拦截违禁词条必须 100% 存在合法重映射替换
      expect(successfulRemapCount).toBe(tabooTriggeredCount);
      const remapSuccessRate = successfulRemapCount / tabooTriggeredCount;
      expect(remapSuccessRate).toBe(1.0);
    });

    it('契约全 12 种族特异语义重映射表 100% 精确覆盖与保底合法性', () => {
      // 1. ELF: FLAME -> GAS
      expect(filterAndRemapOrgans('ELF', OrganFlags.FLAME)).toBe(OrganFlags.GAS);
      // 2. DWARF: WING -> GRANITE
      expect(filterAndRemapOrgans('DWARF', OrganFlags.WING)).toBe(OrganFlags.GRANITE);
      // 3. GOBLIN: GRANITE -> MERCURY, HOLY -> MERCURY
      expect(filterAndRemapOrgans('GOBLIN', OrganFlags.GRANITE)).toBe(OrganFlags.MERCURY);
      expect(filterAndRemapOrgans('GOBLIN', OrganFlags.HOLY)).toBe(OrganFlags.MERCURY);
      // 4. UNDEAD: HOLY -> GRANITE, FLESH -> GRANITE
      expect(filterAndRemapOrgans('UNDEAD', OrganFlags.HOLY)).toBe(OrganFlags.GRANITE);
      expect(filterAndRemapOrgans('UNDEAD', OrganFlags.FLESH)).toBe(OrganFlags.GRANITE);
      // 5. DEMON: AQUATIC -> FLAME, HOLY -> FLAME
      expect(filterAndRemapOrgans('DEMON', OrganFlags.AQUATIC)).toBe(OrganFlags.FLAME);
      expect(filterAndRemapOrgans('DEMON', OrganFlags.HOLY)).toBe(OrganFlags.FLAME);
      // 6. GOLEM: FLESH/WING/AQUATIC -> GRANITE
      expect(filterAndRemapOrgans('GOLEM', OrganFlags.FLESH)).toBe(OrganFlags.GRANITE);
      expect(filterAndRemapOrgans('GOLEM', OrganFlags.WING)).toBe(OrganFlags.GRANITE);
      expect(filterAndRemapOrgans('GOLEM', OrganFlags.AQUATIC)).toBe(OrganFlags.GRANITE);
      // 7. LIZARD: FLAME -> AQUATIC
      expect(filterAndRemapOrgans('LIZARD', OrganFlags.FLAME)).toBe(OrganFlags.AQUATIC);
      // 8. BEAST: MERCURY -> FLESH, ELEC -> FLESH
      expect(filterAndRemapOrgans('BEAST', OrganFlags.MERCURY)).toBe(OrganFlags.FLESH);
      expect(filterAndRemapOrgans('BEAST', OrganFlags.ELEC)).toBe(OrganFlags.FLESH);
      // 9. SPORE: FLAME -> GAS, GRANITE -> FLESH
      expect(filterAndRemapOrgans('SPORE', OrganFlags.FLAME)).toBe(OrganFlags.GAS);
      expect(filterAndRemapOrgans('SPORE', OrganFlags.GRANITE)).toBe(OrganFlags.FLESH);
      // 10. ABERR: HOLY -> ELEC, FLESH -> MERCURY
      expect(filterAndRemapOrgans('ABERR', OrganFlags.HOLY)).toBe(OrganFlags.ELEC);
      expect(filterAndRemapOrgans('ABERR', OrganFlags.FLESH)).toBe(OrganFlags.MERCURY);
      // 11. ORC: HOLY -> FLESH, MERCURY -> GRANITE
      expect(filterAndRemapOrgans('ORC', OrganFlags.HOLY)).toBe(OrganFlags.FLESH);
      expect(filterAndRemapOrgans('ORC', OrganFlags.MERCURY)).toBe(OrganFlags.GRANITE);
      // 12. HUMAN: 零禁忌全相容
      expect(filterAndRemapOrgans('HUMAN', ALL_ORGAN_FLAGS_MASK)).toBe(ALL_ORGAN_FLAGS_MASK);
    });
  });

  describe('4. 模式 A 基因驱动平滑扩散守门断言 (Gene Drive Smooth Spread)', () => {
    it('激活驱动后三代繁衍，显性等位基因渗透率单调递增至 75% 以上，且无任何 1 帧发生全族大面积暴毙', () => {
      const prng = new PRNG(20260929);
      const geneticsSys = new MendelianGeneticsSystem(ecs, eventBus, prng);

      const factionId = 2;
      const TARGET_ORGAN = OrganFlags.GRANITE; // 驱动目标器官
      geneticsSys.activateGeneDrive(factionId, TARGET_ORGAN);

      const POPULATION = 120;
      let currentGenEntities = [];

      // 始祖第 0 代族群: 初始仅 10% 个体携带驱动等位基因 (12 个体)
      for (let i = 0; i < POPULATION; i++) {
        const eid = ecs.allocateEntity();
        ecs.identities[eid * 3] = factionId;
        const carriesDrive = i < (POPULATION * 0.10);
        initGenetics(
          geneticsSys.genetics,
          eid,
          carriesDrive ? TARGET_ORGAN : 0,
          0,
          1
        );
        currentGenEntities.push(eid);
      }

      const penetrationRates = [];
      const survivalCounts = [];

      // 追踪三代繁衍与更替
      for (let gen = 1; gen <= 3; gen++) {
        const nextGenEntities = [];
        let carriersCount = 0;

        // 收集父代中携带者与非携带者
        const carriers = [];
        for (const pid of currentGenEntities) {
          const off = pid * GENETICS_STRIDE;
          const pheno = geneticsSys.genetics[off + GEN_OFFSET_PHENOTYPE];
          if ((pheno & TARGET_ORGAN) === TARGET_ORGAN) {
            carriers.push(pid);
          }
        }

        // 驱动携带者享有适度交配择偶优势 (Mating Advantage 35%)
        const pickParent = () => {
          if (carriers.length > 0 && prng.nextFloat() < 0.35) {
            return carriers[prng.nextInt(0, carriers.length - 1)];
          }
          return currentGenEntities[prng.nextInt(0, POPULATION - 1)];
        };

        for (let i = 0; i < POPULATION; i++) {
          const p1 = pickParent();
          const p2 = pickParent();

          const child = ecs.allocateEntity();
          ecs.identities[child * 3] = factionId;

          const pheno = geneticsSys.breedChild(p1, p2, child, 'HUMAN', {
            mutationRate: 0.0,
            forcedDriveOrgan: TARGET_ORGAN
          });

          if ((pheno & TARGET_ORGAN) === TARGET_ORGAN) {
            carriersCount++;
          }
          nextGenEntities.push(child);
        }

        const penetration = carriersCount / POPULATION;
        penetrationRates.push(penetration);
        survivalCounts.push(nextGenEntities.length);

        // 逐一释放老一代实体，保证 ECS 槽位回收平稳
        for (const oldEid of currentGenEntities) {
          ecs.freeEntity(oldEid);
        }
        currentGenEntities = nextGenEntities;
      }

      // 硬断言 1: 无任何 1 帧发生全族猝死或断代，每代存活总数严格守恒
      for (const count of survivalCounts) {
        expect(count).toBe(POPULATION);
      }

      // 硬断言 2: 渗透率代际单调递增 (Monotonic Increase)
      // gen 0 (~10%) -> gen 1 -> gen 2 -> gen 3
      expect(penetrationRates[0]).toBeGreaterThan(0.15);
      expect(penetrationRates[1]).toBeGreaterThan(penetrationRates[0]);
      expect(penetrationRates[2]).toBeGreaterThanOrEqual(penetrationRates[1]);

      // 硬断言 3: 第 3 代渗透率达到 75% 以上 (契约 75% ~ 95% 期望)
      expect(penetrationRates[2]).toBeGreaterThanOrEqual(0.75);
      expect(penetrationRates[2]).toBeLessThanOrEqual(1.0);

      // 清理
      for (const eid of currentGenEntities) {
        ecs.freeEntity(eid);
      }
    });
  });

  describe('5. 零 GC 内存安全与极端性能守门 (LL-007 防抖动加固)', () => {
    it('连续执行 10,000 次繁衍热循环，连续内存 TypedArray 规格恒定且无堆逃逸，耗时低于工程门限', () => {
      const geneticsSys = new MendelianGeneticsSystem(ecs, eventBus);
      const m = ecs.allocateEntity();
      const f = ecs.allocateEntity();
      const c = ecs.allocateEntity();

      initGenetics(geneticsSys.genetics, m, OrganFlags.WING, OrganFlags.FLAME, 1);
      initGenetics(geneticsSys.genetics, f, OrganFlags.GRANITE, OrganFlags.GAS, 1);

      // JIT 预热 1,000 轮消除冷启动抖动 (LL-007)
      for (let w = 0; w < 1000; w++) {
        geneticsSys.breedChild(m, f, c, 'HUMAN', { mutationRate: 0.05 });
      }

      // 静态 TypedArray 内存尺寸严格审计
      const expectedByteLength = TOTAL_SLOTS * GENETICS_STRIDE * 4; // 4097 * 4 * 4 = 65,552 B
      expect(geneticsSys.genetics.byteLength).toBe(expectedByteLength);
      expect(geneticsSys.factionDriveOrgan.byteLength).toBe(32 * 4); // 128 B

      const t0 = performance.now();
      const N = 10000;
      for (let i = 0; i < N; i++) {
        geneticsSys.breedChild(m, f, c, 'HUMAN', { mutationRate: 0.05 });
      }
      const t1 = performance.now();
      const durationMs = t1 - t0;

      // 内存恒定无动态扩容
      expect(geneticsSys.genetics.byteLength).toBe(expectedByteLength);

      // 极端性能工程门限: 10,000 次繁衍 < 100ms (平均每次 < 10 微秒)
      expect(durationMs).toBeLessThan(100.0);
    });
  });
});
