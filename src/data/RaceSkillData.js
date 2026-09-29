/**
 * RaceSkillData.js
 * 12 始祖种族特异技能矩阵 (RaceSkillData)
 * 严格对齐 Milestone 2 技术契约 1.1 节与动作经济学控制 (ICD >= 1.5s)
 */

import {
  CHANNEL_NONE,
  CHANNEL_LOCOMOTION,
  CHANNEL_STANCE,
  CHANNEL_EMISSION
} from '../components/RaceSkillComponent.js';
import { OrganFlags } from './MutationFlags.js';

export const MIN_SKILL_ICD = 1.5; // 动作经济学铁律: 主动技能强制 ICD >= 1.5s

/**
 * 技能数字 ID 映射 (用于领域事件 Param2 载荷与查表)
 */
export const SkillIds = Object.freeze({
  ORC_WAAAGH_ROAR:       1,
  ORC_MYCELIUM_REGEN:    2,
  ELF_NATURE_MENDING:    3,
  ELF_FLORA_AFFINITY:    4,
  HUMAN_PHALANX_FORM:    5,
  HUMAN_VERSATILITY:     6,
  DWARF_ALE_FRENZY:      7,
  DWARF_STONE_BULWARK:   8,
  UNDEAD_BONE_ANIMATION: 9,
  UNDEAD_TERROR_IMMUNITY: 10,
  GOBLIN_DISARM_TRICK:   11,
  GOBLIN_CUNNING_ESCAPE: 12,
  DEMON_INFERNAL_BREATH: 13,
  DEMON_SCORCHED_FLESH:  14,
  LIZARD_POISON_DART:    15,
  LIZARD_SLICK_SCALE:    16,
  BEAST_FERAL_POUNCE:    17,
  BEAST_MUSCLE_IMPACT:   18,
  SPORE_SPORE_BURST:     19,
  SPORE_FUNGAL_SYMBIOSIS: 20,
  GOLEM_EARTH_SHATTER:   21,
  GOLEM_SILICON_SUPERMASS: 22,
  ABERR_PSIONIC_BLAST:   23,
  ABERR_VOID_LEVITATION: 24
});

/**
 * 12 始祖种族技能全量静态数据配置
 */
export const RaceSkills = Object.freeze({
  ORC: Object.freeze({
    raceId: 'ORC',
    name: '绿皮菌兽',
    active: Object.freeze({
      id: SkillIds.ORC_WAAAGH_ROAR,
      name: 'WAAAGH_ROAR',
      displayName: '战吼狂化',
      icd: 10.0,
      duration: 4.0,
      channelMask: CHANNEL_EMISSION,
      speedBonus: 0.40,
      attackBonus: 0.30,
      hpThreshold: 0.50
    }),
    passive: Object.freeze({
      id: SkillIds.ORC_MYCELIUM_REGEN,
      name: 'MYCELIUM_REGEN',
      displayName: '菌丝再生',
      lockHp: 1.0,
      regenRate: 2.5,
      duration: 3.0,
      maxPerBattle: 1
    })
  }),

  ELF: Object.freeze({
    raceId: 'ELF',
    name: '森灵树民',
    active: Object.freeze({
      id: SkillIds.ELF_NATURE_MENDING,
      name: 'NATURE_MENDING',
      displayName: '自然愈合',
      icd: 8.0,
      duration: 0.0,
      channelMask: CHANNEL_EMISSION,
      healAmount: 25.0,
      radiusTiles: 3,
      hpRatioThreshold: 0.60
    }),
    passive: Object.freeze({
      id: SkillIds.ELF_FLORA_AFFINITY,
      name: 'FLORA_AFFINITY',
      displayName: '草木亲和',
      plainsSpeedBonus: 0.25,
      fireDamageVulnerability: 0.40
    })
  }),

  HUMAN: Object.freeze({
    raceId: 'HUMAN',
    name: '人类帝国',
    active: Object.freeze({
      id: SkillIds.HUMAN_PHALANX_FORM,
      name: 'PHALANX_FORM',
      displayName: '军纪战阵',
      icd: 12.0,
      duration: 6.0,
      channelMask: (CHANNEL_EMISSION | CHANNEL_STANCE) >>> 0,
      armorBonus: 10.0,
      moraleLock: 100.0,
      radiusTiles: 2
    }),
    passive: Object.freeze({
      id: SkillIds.HUMAN_VERSATILITY,
      name: 'VERSATILITY',
      displayName: '万金油适应',
      tabooMask: 0,
      promotionThresholdDiscount: 0.30
    })
  }),

  DWARF: Object.freeze({
    raceId: 'DWARF',
    name: '高山矮人',
    active: Object.freeze({
      id: SkillIds.DWARF_ALE_FRENZY,
      name: 'ALE_FRENZY',
      displayName: '麦酒狂暴',
      icd: 10.0,
      duration: 5.0,
      channelMask: (CHANNEL_EMISSION | CHANNEL_STANCE) >>> 0,
      reflectBonus: 0.30,
      superArmor: true
    }),
    passive: Object.freeze({
      id: SkillIds.DWARF_STONE_BULWARK,
      name: 'STONE_BULWARK',
      displayName: '顽石重甲',
      armorBonus: 8.0,
      bluntResist: 0.30,
      tabooMask: OrganFlags.WING
    })
  }),

  UNDEAD: Object.freeze({
    raceId: 'UNDEAD',
    name: '墓园亡灵',
    active: Object.freeze({
      id: SkillIds.UNDEAD_BONE_ANIMATION,
      name: 'BONE_ANIMATION',
      displayName: '骸骨苏生',
      icd: 15.0,
      duration: 0.0,
      channelMask: CHANNEL_EMISSION,
      radiusTiles: 2,
      corpseRequired: 1
    }),
    passive: Object.freeze({
      id: SkillIds.UNDEAD_TERROR_IMMUNITY,
      name: 'TERROR_IMMUNITY',
      displayName: '枯骨无畏',
      hungerImmunity: true,
      moraleLock: Infinity,
      holyVulnerability: 0.50
    })
  }),

  GOBLIN: Object.freeze({
    raceId: 'GOBLIN',
    name: '狂躁地精',
    active: Object.freeze({
      id: SkillIds.GOBLIN_DISARM_TRICK,
      name: 'DISARM_TRICK',
      displayName: '顺手打落',
      icd: 10.0,
      duration: 6.0,
      channelMask: CHANNEL_EMISSION,
      disarmChance: 0.40
    }),
    passive: Object.freeze({
      id: SkillIds.GOBLIN_CUNNING_ESCAPE,
      name: 'CUNNING_ESCAPE',
      displayName: '狡黠逃逸',
      mass: 26.0,
      rollChance: 0.35
    })
  }),

  DEMON: Object.freeze({
    raceId: 'DEMON',
    name: '深渊角魔',
    active: Object.freeze({
      id: SkillIds.DEMON_INFERNAL_BREATH,
      name: 'INFERNAL_BREATH',
      displayName: '地狱烈焰',
      icd: 8.0,
      duration: 1.2,
      channelMask: CHANNEL_EMISSION,
      damage: 30.0,
      igniteTiles: true,
      rangeTiles: 3
    }),
    passive: Object.freeze({
      id: SkillIds.DEMON_SCORCHED_FLESH,
      name: 'SCORCHED_FLESH',
      displayName: '焦土强躯',
      fireResistBonus: 0.50,
      waterSpeedPenalty: 0.30
    })
  }),

  LIZARD: Object.freeze({
    raceId: 'LIZARD',
    name: '沼泽蜥蜴人',
    active: Object.freeze({
      id: SkillIds.LIZARD_POISON_DART,
      name: 'POISON_DART',
      displayName: '毒镖飞刺',
      icd: 6.0,
      duration: 0.0,
      channelMask: CHANNEL_EMISSION,
      pierceDamage: 15.0,
      slowRatio: 0.50,
      slowDuration: 4.0,
      minRangeTiles: 3,
      maxRangeTiles: 5
    }),
    passive: Object.freeze({
      id: SkillIds.LIZARD_SLICK_SCALE,
      name: 'SLICK_SCALE',
      displayName: '湿滑冷血',
      waterSpeedBonus: 0.40,
      acidResistBonus: 0.60
    })
  }),

  BEAST: Object.freeze({
    raceId: 'BEAST',
    name: '荒原兽化人',
    active: Object.freeze({
      id: SkillIds.BEAST_FERAL_POUNCE,
      name: 'FERAL_POUNCE',
      displayName: '巨兽飞扑',
      icd: 8.0,
      duration: 0.5,
      channelMask: (CHANNEL_LOCOMOTION | CHANNEL_EMISSION) >>> 0,
      impactDamage: 35.0,
      knockbackTiles: 2,
      minRangeTiles: 2,
      maxRangeTiles: 4
    }),
    passive: Object.freeze({
      id: SkillIds.BEAST_MUSCLE_IMPACT,
      name: 'MUSCLE_IMPACT',
      displayName: '兽肌强袭',
      mass: 85.0,
      lowHungerThreshold: 0.20,
      lowHungerAttackBonus: 0.20
    })
  }),

  SPORE: Object.freeze({
    raceId: 'SPORE',
    name: '孢子真菌人',
    active: Object.freeze({
      id: SkillIds.SPORE_SPORE_BURST,
      name: 'SPORE_BURST',
      displayName: '致幻毒孢',
      icd: 12.0,
      duration: 3.0,
      channelMask: CHANNEL_EMISSION,
      stunDuration: 3.0
    }),
    passive: Object.freeze({
      id: SkillIds.SPORE_FUNGAL_SYMBIOSIS,
      name: 'FUNGAL_SYMBIOSIS',
      displayName: '腐殖反哺',
      deathNutrientBonus: 20.0
    })
  }),

  GOLEM: Object.freeze({
    raceId: 'GOLEM',
    name: '晶石魔像',
    active: Object.freeze({
      id: SkillIds.GOLEM_EARTH_SHATTER,
      name: 'EARTH_SHATTER',
      displayName: '地脉震击',
      icd: 14.0,
      duration: 1.0, // 蓄力读条 1.0s
      channelMask: (CHANNEL_EMISSION | CHANNEL_LOCOMOTION) >>> 0,
      bluntDamage: 40.0,
      stunDuration: 1.5,
      radiusTiles: 2
    }),
    passive: Object.freeze({
      id: SkillIds.GOLEM_SILICON_SUPERMASS,
      name: 'SILICON_SUPERMASS',
      displayName: '硅基超重',
      mass: 180.0,
      immuneKnockback: true,
      immuneBleedAcidGas: true,
      petrifyTimeout: 180.0
    })
  }),

  ABERR: Object.freeze({
    raceId: 'ABERR',
    name: '拟态魔眼',
    active: Object.freeze({
      id: SkillIds.ABERR_PSIONIC_BLAST,
      name: 'PSIONIC_BLAST',
      displayName: '灵能震爆',
      icd: 9.0,
      duration: 0.0,
      channelMask: CHANNEL_EMISSION,
      moraleDamage: 40.0,
      immobilizeDuration: 2.0
    }),
    passive: Object.freeze({
      id: SkillIds.ABERR_VOID_LEVITATION,
      name: 'VOID_LEVITATION',
      displayName: '虚空浮游',
      ignoreMudResistance: true,
      bluntResistPenalty: -0.30,
      pierceResistPenalty: -0.30
    })
  })
});

/**
 * 依据种族 ID 获取技能数据
 * @param {string} raceId 
 * @returns {Readonly<object>|null}
 */
export function getRaceSkill(raceId) {
  return RaceSkills[raceId] || null;
}

/**
 * 依据数字技能 ID 查找技能配置
 * @param {number} skillId 
 * @returns {Readonly<object>|null}
 */
export function getSkillById(skillId) {
  for (const raceKey of Object.keys(RaceSkills)) {
    const race = RaceSkills[raceKey];
    if (race.active.id === skillId) return race.active;
    if (race.passive.id === skillId) return race.passive;
  }
  return null;
}
