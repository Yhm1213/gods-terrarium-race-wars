/**
 * TabooFilter.js
 * 12 始祖种族变异器官禁忌过滤与保底语义重映射系统
 * 
 * 核心指标 (Milestone 2 契约 3.3 节):
 * 1. 杜绝违规突变器官穿透导致自残、自杀或穿模；
 * 2. 严格按照契约【语义重映射表】执行确定性替换；
 * 3. 保证触犯种族禁忌的违禁词条穿透率严格为 0.0%；
 * 4. 100% 物理零 GC: 支持出参对象复用与纯位运算。
 */

import { OrganFlags, ALL_ORGAN_FLAGS_MASK } from '../data/MutationFlags.js';
import { Races, isOrganTaboo } from '../data/RaceData.js';

/**
 * 语义重映射字典表 (Semantic Remapping Table)
 * 对齐 Milestone 2 契约 3.3 节与种族生态相容性
 */
export const SemanticRemapTable = Object.freeze({
  ELF: Object.freeze({
    [OrganFlags.FLAME]:   OrganFlags.GAS,     // 森灵怕火自焚 -> 剧毒孢子囊
    [OrganFlags.GAS]:     OrganFlags.GAS
  }),

  DWARF: Object.freeze({
    [OrganFlags.WING]:    OrganFlags.GRANITE  // 90kg矮人薄翼违和穿模 -> 花岗岩厚重骨刺
  }),

  GOBLIN: Object.freeze({
    [OrganFlags.GRANITE]: OrganFlags.MERCURY, // 26kg地精背负沉重岩石移速归零 -> 水银轻盈流体
    [OrganFlags.HOLY]:    OrganFlags.MERCURY
  }),

  UNDEAD: Object.freeze({
    [OrganFlags.HOLY]:    OrganFlags.GRANITE, // 亡灵遇圣灵自灼自毁 -> 白骨钙化坚壳
    [OrganFlags.FLESH]:   OrganFlags.GRANITE
  }),

  DEMON: Object.freeze({
    [OrganFlags.AQUATIC]: OrganFlags.FLAME,   // 深渊角魔无法长出水生鱼鳃 -> 地狱熔火核心
    [OrganFlags.HOLY]:    OrganFlags.FLAME
  }),

  GOLEM: Object.freeze({
    [OrganFlags.FLESH]:   OrganFlags.GRANITE, // 硅基魔像拒绝一切血肉组织 -> 晶石外骨骼
    [OrganFlags.WING]:    OrganFlags.GRANITE,
    [OrganFlags.AQUATIC]: OrganFlags.GRANITE
  }),

  LIZARD: Object.freeze({
    [OrganFlags.FLAME]:   OrganFlags.AQUATIC  // 沼泽冷血怕烈焰 -> 湿滑水栖鳃
  }),

  BEAST: Object.freeze({
    [OrganFlags.MERCURY]: OrganFlags.FLESH,   // 野性兽化人拒绝水银液态 -> 兽肌强躯
    [OrganFlags.ELEC]:    OrganFlags.FLESH
  }),

  SPORE: Object.freeze({
    [OrganFlags.FLAME]:   OrganFlags.GAS,     // 孢子人怕火 -> 易燃瓦斯/毒孢囊
    [OrganFlags.GRANITE]: OrganFlags.FLESH
  }),

  ABERR: Object.freeze({
    [OrganFlags.HOLY]:    OrganFlags.ELEC,    // 心智魔眼怕圣灵 -> 灵能闪电
    [OrganFlags.FLESH]:   OrganFlags.MERCURY
  }),

  ORC: Object.freeze({
    [OrganFlags.HOLY]:    OrganFlags.FLESH,   // 菌兽排斥圣灵 -> 菌丝强韧血肉
    [OrganFlags.MERCURY]: OrganFlags.GRANITE
  }),

  HUMAN: Object.freeze({}) // 人类帝国无任何变异禁忌，全相容
});

/**
 * 校验并重映射突变器官位掩码
 * 保证重映射后的掩码 100% 消除种族禁忌 (0 违禁词条穿透)
 * 
 * @param {string} raceId - 种族键 (如 'ELF', 'DWARF')
 * @param {number} organMask - 待校验的器官位掩码
 * @param {object|null} [outAuditRecord=null] - 可选的复用审计记录对象 { interceptedCount, remappedMask }
 * @returns {number} 经过禁忌过滤与语义重映射后的合法器官掩码
 */
export function filterAndRemapOrgans(raceId, organMask, outAuditRecord = null) {
  if (outAuditRecord) {
    outAuditRecord.interceptedCount = 0;
    outAuditRecord.remappedMask = 0;
  }

  // 1. 无禁忌快速直通
  const race = Races[raceId];
  if (!race || race.tabooMask === 0) {
    if (outAuditRecord) outAuditRecord.remappedMask = organMask;
    return organMask;
  }

  // 2. 若未触犯种族禁忌，直接返回
  if ((organMask & race.tabooMask) === 0) {
    if (outAuditRecord) outAuditRecord.remappedMask = organMask;
    return organMask;
  }

  // 3. 逐位审查并执行语义重映射
  let resultMask = organMask;
  const remapRules = SemanticRemapTable[raceId] || null;

  for (let bitIdx = 0; bitIdx < 9; bitIdx++) {
    const singleFlag = 1 << bitIdx;
    if ((resultMask & singleFlag) !== 0) {
      if ((race.tabooMask & singleFlag) !== 0) {
        // 命中违规器官，清除该标志位
        resultMask = ((resultMask & (~singleFlag)) >>> 0);

        // 查找确定性重映射目标
        let mappedFlag = 0;
        if (remapRules && remapRules[singleFlag] !== undefined) {
          mappedFlag = remapRules[singleFlag];
        } else {
          // 保底防御: 查找第一个该种族不违禁的器官
          mappedFlag = _findFirstAllowedOrgan(race.tabooMask);
        }

        // 置位重映射目标
        resultMask = ((resultMask | mappedFlag) >>> 0);

        if (outAuditRecord) {
          outAuditRecord.interceptedCount++;
        }
      }
    }
  }

  // 4. 二次防御校验: 绝对确保 0 穿透
  if ((resultMask & race.tabooMask) !== 0) {
    resultMask = ((resultMask & (~race.tabooMask)) >>> 0);
  }

  if (outAuditRecord) {
    outAuditRecord.remappedMask = resultMask;
  }

  return resultMask;
}

/**
 * 查找第一个不属于 tabooMask 的保底合法器官
 * @private
 * @param {number} tabooMask 
 * @returns {number}
 */
function _findFirstAllowedOrgan(tabooMask) {
  for (let bitIdx = 0; bitIdx < 9; bitIdx++) {
    const flag = 1 << bitIdx;
    if ((tabooMask & flag) === 0) {
      return flag;
    }
  }
  return 0;
}
