/**
 * MendelianGeneticsSystem.js
 * 双倍体孟德尔遗传算法与随机突变位图管线
 * 
 * 核心指标 (Milestone 2 契约 3.1 ~ 3.4 节 & TC-EDGE-04):
 * 1. 双倍体等位基因建模: 每个实体携带 <Allele_maternal, Allele_paternal>；
 * 2. 减数分裂与配子分离: 正常 50% 确定性分离，双杂合子 Aa x Aa 严格收敛于 1:2:1 理论分离比；
 * 3. 模式 A 基因驱动 (Gene Drive): 激活后主导变异等位基因向后代传递概率跃升至 85%~95%，代际平滑更替，杜绝同帧暴力覆写；
 * 4. 随机突变扰动: 基础繁殖突变率 0.05，强制通过 TabooFilter 进行禁忌拦截与语义重映射 (0 穿透)；
 * 5. 绝对零 GC: 热路径无临时对象分配。
 */

import {
  TOTAL_SLOTS,
  NULL_ENTITY
} from '../core/ECS.js';

import {
  GENETICS_STRIDE,
  GEN_OFFSET_MATERNAL,
  GEN_OFFSET_PATERNAL,
  GEN_OFFSET_PHENOTYPE,
  GEN_OFFSET_GENERATION,
  createGeneticsBuffer,
  initGenetics,
  updatePhenotype,
  resetGenetics
} from '../components/GeneticsComponent.js';

import {
  IS_GENE_DRIVEN,
  hasStatus
} from '../components/UnitStatusFlags.js';

import { PRNG } from '../core/PRNG.js';
import { filterAndRemapOrgans } from './TabooFilter.js';
import { OrganFlags } from '../data/MutationFlags.js';
import { DomainEvents } from '../data/DomainEvents.js';

export const BASE_MUTATION_RATE = 0.05;         // 基础繁殖突变率 (5%)
export const GENE_DRIVE_BIAS_PROBABILITY = 0.90; // 模式 A 基因驱动传递概率 (90%, 85%~95%)

export class MendelianGeneticsSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null]
   * @param {PRNG|null} [prng=null]
   */
  constructor(ecs, eventBus = null, prng = null) {
    this.ecs = ecs;
    this.eventBus = eventBus;
    this.prng = prng || new PRNG(0xDEADBEEF);

    // 连续平铺遗传数据缓冲区 (Uint32Array: 4097 * 4)
    this.genetics = createGeneticsBuffer();

    // 模式 A 基因驱动阵营主导器官位掩码 (32 阵营连续数组)
    this.factionDriveOrgan = new Uint32Array(32);

    // 预分配出参工作对象 (复用，杜绝热路径 GC)
    this._outBreedResult = {
      maternal: 0,
      paternal: 0,
      phenotype: 0,
      generation: 1
    };

    this._auditRecord = {
      interceptedCount: 0,
      remappedMask: 0
    };
  }

  /**
   * 激活某阵营的模式 A 基因驱动
   * @param {number} factionId 
   * @param {number} driveOrganMask - 目标扩散器官位掩码 (如 OrganFlags.GRANITE)
   */
  activateGeneDrive(factionId, driveOrganMask) {
    if (factionId < 0 || factionId >= 32) return;
    this.factionDriveOrgan[factionId] = driveOrganMask >>> 0;
  }

  /**
   * 取消某阵营的基因驱动
   * @param {number} factionId 
   */
  deactivateGeneDrive(factionId) {
    if (factionId < 0 || factionId >= 32) return;
    this.factionDriveOrgan[factionId] = 0;
  }

  /**
   * 单亲配子分离 (减数分裂 Meiosis)
   * 考虑模式 A 基因驱动偏向 (85% ~ 95%) 与正常 50% 分离
   * 
   * @param {number} parentId - 亲本实体 ID
   * @param {number} [driveOrgan=0] - 驱动器官掩码 (若不为 0 则触发驱动偏向)
   * @returns {number} 传递出的单个配子等位基因掩码
   */
  separateGamete(parentId, driveOrgan = 0) {
    if (parentId <= NULL_ENTITY) return 0;

    const off = parentId * GENETICS_STRIDE;
    const maternal = this.genetics[off + GEN_OFFSET_MATERNAL];
    const paternal = this.genetics[off + GEN_OFFSET_PATERNAL];

    // 检查是否具备模式 A 基因驱动
    const isDriven = driveOrgan > 0 || hasStatus(this.ecs.statusFlags, parentId, IS_GENE_DRIVEN);
    const targetDrive = driveOrgan > 0 ? driveOrgan : this._getEntityFactionDrive(parentId);

    if (isDriven && targetDrive > 0) {
      const matHas = (maternal & targetDrive) === targetDrive;
      const patHas = (paternal & targetDrive) === targetDrive;

      if (matHas && !patHas) {
        // 母系携带驱动基因，以 90% 概率传递母系
        return (this.prng.nextFloat() < GENE_DRIVE_BIAS_PROBABILITY) ? maternal : paternal;
      } else if (!matHas && patHas) {
        // 父系携带驱动基因，以 90% 概率传递父系
        return (this.prng.nextFloat() < GENE_DRIVE_BIAS_PROBABILITY) ? paternal : maternal;
      }
    }

    // 孟德尔标准随机减数分裂: 严格 50% 对等分离
    return (this.prng.nextFloat() < 0.5) ? maternal : paternal;
  }

  /**
   * 亲本繁衍结合产生子代 (双倍体杂交)
   * 
   * @param {number} maternalParentId - 母本实体 ID
   * @param {number} paternalParentId - 父本实体 ID
   * @param {number} childId - 子代实体 ID
   * @param {string} raceId - 子代种族键 (如 'ORC', 'HUMAN')
   * @param {object} [options=null] - 可选调控参数 (mutationRate, forcedDriveOrgan)
   * @returns {number} 子代最终表型掩码 (PhenotypeMask)
   */
  breedChild(maternalParentId, paternalParentId, childId, raceId, options = null) {
    if (childId <= NULL_ENTITY) return 0;

    const mutationRate = options?.mutationRate ?? BASE_MUTATION_RATE;
    const driveOrgan = options?.forcedDriveOrgan ?? this._getEntityFactionDrive(maternalParentId);

    // 1. 减数分裂生成双亲配子
    let childMaternal = this.separateGamete(maternalParentId, driveOrgan);
    let childPaternal = this.separateGamete(paternalParentId, driveOrgan);

    // 2. 随机突变扰动 (按 mutationRate 概率产生新器官)
    if (this.prng.nextFloat() < mutationRate) {
      // 随机抽取 9 大器官之一 (0 ~ 8)
      const organIndex = this.prng.nextInt(0, 8);
      const rawMutatedOrgan = (1 << organIndex) >>> 0;

      // 突变器官必须强制通过 TabooFilter 进行种族禁忌过滤与语义重映射
      const safeMutatedOrgan = filterAndRemapOrgans(raceId, rawMutatedOrgan, this._auditRecord);

      // 50% 几率注入母系或父系等位基因
      if (this.prng.nextFloat() < 0.5) {
        childMaternal = ((childMaternal | safeMutatedOrgan) >>> 0);
      } else {
        childPaternal = ((childPaternal | safeMutatedOrgan) >>> 0);
      }

      if (this.eventBus) {
        this.eventBus.emit(DomainEvents.EVT_ORGAN_MUTATED, childId, 0, safeMutatedOrgan, 0);
      }
    }

    // 3. 禁忌再次过滤保障 (确保亲本传递的等位基因与子代种族相容，0 违禁穿透)
    childMaternal = filterAndRemapOrgans(raceId, childMaternal);
    childPaternal = filterAndRemapOrgans(raceId, childPaternal);

    // 4. 模式 A 基因驱动同源转换 (Gene Drive Homing):
    // 若子代获得驱动等位基因，以驱动偏向概率 (85%~95%) 诱导对侧染色体同化转换
    if (driveOrgan > 0) {
      const matHas = (childMaternal & driveOrgan) === driveOrgan;
      const patHas = (childPaternal & driveOrgan) === driveOrgan;
      if (matHas && !patHas) {
        if (this.prng.nextFloat() < GENE_DRIVE_BIAS_PROBABILITY) {
          childPaternal = ((childPaternal | driveOrgan) >>> 0);
        }
      } else if (!matHas && patHas) {
        if (this.prng.nextFloat() < GENE_DRIVE_BIAS_PROBABILITY) {
          childMaternal = ((childMaternal | driveOrgan) >>> 0);
        }
      }
    }

    // 5. 代数递增计算 (取双亲最大代数 + 1)
    const matGen = maternalParentId > NULL_ENTITY
      ? this.genetics[maternalParentId * GENETICS_STRIDE + GEN_OFFSET_GENERATION]
      : 1;
    const patGen = paternalParentId > NULL_ENTITY
      ? this.genetics[paternalParentId * GENETICS_STRIDE + GEN_OFFSET_GENERATION]
      : 1;
    const childGen = Math.max(matGen, patGen) + 1;

    // 6. 写入子代连续内存池
    initGenetics(this.genetics, childId, childMaternal, childPaternal, childGen);

    return this.genetics[childId * GENETICS_STRIDE + GEN_OFFSET_PHENOTYPE];
  }

  /**
   * 重置指定实体的遗传数据
   * @param {number} entityId 
   */
  resetEntity(entityId) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return;
    resetGenetics(this.genetics, entityId);
  }

  /**
   * 获取实体对应阵营的驱动器官掩码
   * @private
   */
  _getEntityFactionDrive(entityId) {
    if (entityId <= NULL_ENTITY) return 0;
    const facId = this.ecs.identities[entityId * 3]; // ID_OFFSET_FACTION
    if (facId >= 0 && facId < 32) {
      return this.factionDriveOrgan[facId];
    }
    return 0;
  }
}
