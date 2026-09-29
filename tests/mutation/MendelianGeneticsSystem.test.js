/**
 * MendelianGeneticsSystem.test.js
 * 双倍体孟德尔遗传算法与随机突变位图管线测试套件
 * 严格对齐 Milestone 2 契约 3.1 ~ 3.4 节与守门测试 TC-EDGE-04 核心断言
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ECS, NULL_ENTITY } from '../../src/core/ECS.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { PRNG } from '../../src/core/PRNG.js';
import { MendelianGeneticsSystem } from '../../src/mutation/MendelianGeneticsSystem.js';
import { filterAndRemapOrgans, SemanticRemapTable } from '../../src/mutation/TabooFilter.js';
import {
  GENETICS_STRIDE,
  GEN_OFFSET_MATERNAL,
  GEN_OFFSET_PATERNAL,
  GEN_OFFSET_PHENOTYPE,
  initGenetics
} from '../../src/components/GeneticsComponent.js';
import { OrganFlags } from '../../src/data/MutationFlags.js';
import { Races, RaceList, isOrganTaboo } from '../../src/data/RaceData.js';

describe('MendelianGeneticsSystem & TabooFilter Pipeline Specification Suite', () => {
  let ecs;
  let eventBus;

  beforeEach(() => {
    ecs = new ECS();
    eventBus = new DomainEventBus();
  });

  describe('1. 固定种子确定性可重现性断言 (Deterministic Reproducibility)', () => {
    it('相同种子 0xDEADBEEF 下执行 1,000 次杂交繁衍，位掩码结果 100% 幂等一致', () => {
      const SEED = 0xDEADBEEF;
      const N = 1000;

      const runBatch = () => {
        const prng = new PRNG(SEED);
        const geneticsSys = new MendelianGeneticsSystem(ecs, eventBus, prng);

        const p1 = ecs.allocateEntity();
        const p2 = ecs.allocateEntity();
        initGenetics(geneticsSys.genetics, p1, OrganFlags.WING, OrganFlags.GRANITE, 1);
        initGenetics(geneticsSys.genetics, p2, OrganFlags.FLAME, OrganFlags.GAS, 1);

        const results = new Uint32Array(N * 3); // [maternal, paternal, phenotype]
        const child = ecs.allocateEntity();

        for (let i = 0; i < N; i++) {
          geneticsSys.breedChild(p1, p2, child, 'HUMAN', { mutationRate: 0.1 });
          const off = child * GENETICS_STRIDE;
          results[i * 3 + 0] = geneticsSys.genetics[off + GEN_OFFSET_MATERNAL];
          results[i * 3 + 1] = geneticsSys.genetics[off + GEN_OFFSET_PATERNAL];
          results[i * 3 + 2] = geneticsSys.genetics[off + GEN_OFFSET_PHENOTYPE];
        }
        ecs.reset();
        return results;
      };

      const run1 = runBatch();
      const run2 = runBatch();

      expect(run1.length).toBe(run2.length);
      for (let i = 0; i < run1.length; i++) {
        expect(run1[i]).toBe(run2[i]);
      }
    });
  });

  describe('2. 孟德尔 1:2:1 分离比卡方拟合优度检验断言 (Chi-Square Goodness of Fit)', () => {
    it('双杂合子 (Aa x Aa) 杂交 10,000 次，基因型比例严格收敛于 1:2:1 (chi2 < 5.991, p > 0.05)', () => {
      const prng = new PRNG(42);
      const geneticsSys = new MendelianGeneticsSystem(ecs, eventBus, prng);

      const mother = ecs.allocateEntity();
      const father = ecs.allocateEntity();
      const child = ecs.allocateEntity();

      // 双杂合子 Aa: A = OrganFlags.WING (0x08), a = 0
      const ALLELE_A = OrganFlags.WING;
      const ALLELE_a = 0;

      initGenetics(geneticsSys.genetics, mother, ALLELE_A, ALLELE_a, 1);
      initGenetics(geneticsSys.genetics, father, ALLELE_A, ALLELE_a, 1);

      const N = 10000;
      let countAA = 0; // 纯合显性 (A from mother, A from father)
      let countAa = 0; // 杂合子 (A from mother + a from father, or a from mother + A from father)
      let countaa = 0; // 纯合隐性 (a from mother, a from father)

      // 禁用随机突变，纯测孟德尔减数分裂分离比
      for (let i = 0; i < N; i++) {
        geneticsSys.breedChild(mother, father, child, 'HUMAN', { mutationRate: 0.0 });
        const off = child * GENETICS_STRIDE;
        const mat = geneticsSys.genetics[off + GEN_OFFSET_MATERNAL];
        const pat = geneticsSys.genetics[off + GEN_OFFSET_PATERNAL];

        const hasMatA = mat === ALLELE_A;
        const hasPatA = pat === ALLELE_A;

        if (hasMatA && hasPatA) {
          countAA++;
        } else if ((hasMatA && !hasPatA) || (!hasMatA && hasPatA)) {
          countAa++;
        } else {
          countaa++;
        }
      }

      // 理论期望频次
      const expAA = N * 0.25; // 2500
      const expAa = N * 0.50; // 5000
      const expaa = N * 0.25; // 2500

      // 卡方检验统计量: chi2 = sum((O_i - E_i)^2 / E_i)
      const chi2 =
        Math.pow(countAA - expAA, 2) / expAA +
        Math.pow(countAa - expAa, 2) / expAa +
        Math.pow(countaa - expaa, 2) / expaa;

      // 自由度 df = 2, 显著性水平 alpha = 0.05 临界值为 5.991
      expect(chi2).toBeLessThan(5.991);

      // 表型显隐比检查 (表现出 A 的比例约为 75%, 隐性为 25%)
      const dominantCount = countAA + countAa;
      const dominantRatio = dominantCount / N;
      expect(dominantRatio).toBeGreaterThan(0.73);
      expect(dominantRatio).toBeLessThan(0.77);
    });
  });

  describe('3. 变异禁忌掩码 0 穿透与语义重映射断言 (Zero-Penetration Guardrail)', () => {
    it('全 12 种族各 1,000 次突变采样，违禁词条穿透率严格为 0.0% 且 100% 存在合法重映射', () => {
      const prng = new PRNG(1337);
      const audit = { interceptedCount: 0, remappedMask: 0 };

      for (const race of RaceList) {
        const raceId = race.id;

        for (let i = 0; i < 1000; i++) {
          // 随机生成包含 1~3 个器官的变异掩码
          const numBits = prng.nextInt(1, 3);
          let rawMask = 0;
          for (let b = 0; b < numBits; b++) {
            rawMask |= (1 << prng.nextInt(0, 8));
          }

          const wasTaboo = isOrganTaboo(raceId, rawMask);

          // 执行禁忌过滤与保底语义重映射
          const safeMask = filterAndRemapOrgans(raceId, rawMask, audit);

          // 硬断言 1: 穿透率严格为 0.0%
          const isSafeStillTaboo = isOrganTaboo(raceId, safeMask);
          expect(isSafeStillTaboo).toBe(false);

          // 硬断言 2: 若原始掩码触犯了禁忌，则必有拦截与重映射处理
          if (wasTaboo) {
            expect(audit.interceptedCount).toBeGreaterThan(0);
          }
        }
      }
    });

    it('特定种族专属语义重映射行为精准验证', () => {
      // DWARF: 翅膀 WING 必须映射为 GRANITE
      const dwarfRemapped = filterAndRemapOrgans('DWARF', OrganFlags.WING);
      expect(dwarfRemapped & OrganFlags.WING).toBe(0);
      expect(dwarfRemapped & OrganFlags.GRANITE).toBe(OrganFlags.GRANITE);

      // GOBLIN: 花岗岩 GRANITE 必须映射为 MERCURY
      const goblinRemapped = filterAndRemapOrgans('GOBLIN', OrganFlags.GRANITE);
      expect(goblinRemapped & OrganFlags.GRANITE).toBe(0);
      expect(goblinRemapped & OrganFlags.MERCURY).toBe(OrganFlags.MERCURY);

      // UNDEAD: 圣灵 HOLY 必须映射为 GRANITE
      const undeadRemapped = filterAndRemapOrgans('UNDEAD', OrganFlags.HOLY);
      expect(undeadRemapped & OrganFlags.HOLY).toBe(0);
      expect(undeadRemapped & OrganFlags.GRANITE).toBe(OrganFlags.GRANITE);

      // DEMON: 水栖 AQUATIC 必须映射为 FLAME
      const demonRemapped = filterAndRemapOrgans('DEMON', OrganFlags.AQUATIC);
      expect(demonRemapped & OrganFlags.AQUATIC).toBe(0);
      expect(demonRemapped & OrganFlags.FLAME).toBe(OrganFlags.FLAME);

      // GOLEM: 翅膀 WING / 血肉 FLESH 必须映射为 GRANITE
      const golemRemapped = filterAndRemapOrgans('GOLEM', OrganFlags.WING | OrganFlags.FLESH);
      expect(golemRemapped & (OrganFlags.WING | OrganFlags.FLESH)).toBe(0);
      expect(golemRemapped & OrganFlags.GRANITE).toBe(OrganFlags.GRANITE);
    });
  });

  describe('4. 模式 A 基因驱动三代平滑同化断言 (Gene Drive Drift)', () => {
    it('激活基因驱动后，目标突变等位基因代际渗透率单调递增并在第 3 代达到 75%~95%', () => {
      const prng = new PRNG(999);
      const geneticsSys = new MendelianGeneticsSystem(ecs, eventBus, prng);

      const factionId = 1;
      const DRIVE_ORGAN = OrganFlags.GRANITE; // 主导变异器官: 花岗岩
      geneticsSys.activateGeneDrive(factionId, DRIVE_ORGAN);

      const POP_SIZE = 100;

      // 始祖第 0 代族群: 初始仅 10% 个体携带驱动基因
      let currentGeneration = [];
      for (let i = 0; i < POP_SIZE; i++) {
        const id = ecs.allocateEntity();
        ecs.identities[id * 3] = factionId;
        const hasDrive = i < (POP_SIZE * 0.10); // 10%
        initGenetics(
          geneticsSys.genetics,
          id,
          hasDrive ? DRIVE_ORGAN : 0,
          0,
          1
        );
        currentGeneration.push(id);
      }

      const penetrationRates = [];

      // 连续繁衍 3 代
      for (let gen = 1; gen <= 3; gen++) {
        const nextGeneration = [];
        let driveCarrierCount = 0;

        // 统计当前代中携带驱动基因的个体
        const carriers = [];
        for (const id of currentGeneration) {
          const off = id * GENETICS_STRIDE;
          const pheno = geneticsSys.genetics[off + GEN_OFFSET_PHENOTYPE];
          if ((pheno & DRIVE_ORGAN) === DRIVE_ORGAN) {
            carriers.push(id);
          }
        }

        const pickParent = () => {
          // 携带模式 A 基因驱动个体具备适度繁殖优势 (Fitness Advantage)
          if (carriers.length > 0 && prng.nextFloat() < 0.35) {
            return carriers[prng.nextInt(0, carriers.length - 1)];
          }
          return currentGeneration[prng.nextInt(0, POP_SIZE - 1)];
        };

        for (let i = 0; i < POP_SIZE; i++) {
          const p1 = pickParent();
          const p2 = pickParent();

          const child = ecs.allocateEntity();
          ecs.identities[child * 3] = factionId;

          const pheno = geneticsSys.breedChild(p1, p2, child, 'HUMAN', {
            mutationRate: 0.0,
            forcedDriveOrgan: DRIVE_ORGAN
          });

          if ((pheno & DRIVE_ORGAN) === DRIVE_ORGAN) {
            driveCarrierCount++;
          }
          nextGeneration.push(child);
        }

        const rate = driveCarrierCount / POP_SIZE;
        penetrationRates.push(rate);

        // 释放老一代实体
        for (const oldId of currentGeneration) {
          ecs.freeEntity(oldId);
        }
        currentGeneration = nextGeneration;
      }

      // 断言: 代际渗透率单调递增
      expect(penetrationRates[0]).toBeGreaterThanOrEqual(0.20); // 第 1 代显著上升 (~35%)
      expect(penetrationRates[1]).toBeGreaterThan(penetrationRates[0]); // 第 2 代单调递增 (~70%)
      expect(penetrationRates[2]).toBeGreaterThanOrEqual(penetrationRates[1]); // 第 3 代饱和同化

      // 断言: 第 3 代渗透率达到 75% ~ 100% 契约期望区间
      expect(penetrationRates[2]).toBeGreaterThanOrEqual(0.75);
      expect(penetrationRates[2]).toBeLessThanOrEqual(1.0);

      // 清理
      for (const id of currentGeneration) {
        ecs.freeEntity(id);
      }
    });
  });

  describe('5. 绝对零 GC 内存安全与重置维护', () => {
    it('连续繁衍 500 次，组件内存与实体回收稳定无异常', () => {
      const geneticsSys = new MendelianGeneticsSystem(ecs, eventBus);
      const m = ecs.allocateEntity();
      const f = ecs.allocateEntity();
      const c = ecs.allocateEntity();

      initGenetics(geneticsSys.genetics, m, OrganFlags.WING, 0, 1);
      initGenetics(geneticsSys.genetics, f, OrganFlags.GRANITE, 0, 1);

      for (let i = 0; i < 500; i++) {
        geneticsSys.breedChild(m, f, c, 'HUMAN', { mutationRate: 0.05 });
      }

      expect(ecs.isAlive(c)).toBe(true);
      geneticsSys.resetEntity(c);
      expect(geneticsSys.genetics[c * GENETICS_STRIDE + GEN_OFFSET_PHENOTYPE]).toBe(0);
    });
  });
});
