/**
 * @file TechCivicData.js
 * @description 生产军事实用科技树与四大市政意识形态属性修正 (TechCivicData)
 * 严格遵循 06_post_war_and_internal_politics.md 与 WBS 6.0 规范：
 * 绝无虚空属性，所有科技与市政修正直接作用于实体战斗、物理、仓储与神恩参数。
 */

/**
 * 四大市政意识形态路线枚举 (Civic Pillars)
 */
export const CivicRoutes = Object.freeze({
  HEREDITARY_DYNASTY: Object.freeze({
    id: 0,
    key: 'HEREDITARY_DYNASTY',
    name: '血统世袭皇权',
    description: '王冠唯神圣血脉可戴。阶层稳定，圣火坚固，充满未知的继承大随机性。',
    modifiers: Object.freeze({
      stabilityBonus: 0.40,          // 平民抗动乱能力 +40%
      totemDurabilityBonus: 0.30     // 图腾圣火坚固度 +30%
    }),
    potentialRisk: '皇子体质盲盒、离奇意外横死与夺嫡暴乱'
  }),

  MILITARY_AUTOCRACY: Object.freeze({
    id: 1,
    key: 'MILITARY_AUTOCRACY',
    name: '军阀强权独裁',
    description: '弱者退位，强者为尊！全族决斗决出统治者，崇尚军国铁血。',
    modifiers: Object.freeze({
      attackPowerBonus: 0.25,        // 全体士兵攻击力 +25%
      moraleBreakThreshold: 15       // 士气崩溃阈值降低至 15 (极坚韧)
    }),
    potentialRisk: '首领一旦受重伤或衰老，麾下军阀极易趁虚而入发起弑君篡位'
  }),

  ELDERS_COUNCIL: Object.freeze({
    id: 2,
    key: 'ELDERS_COUNCIL',
    name: '长者议会共和',
    description: '由首席工匠、大萨满、商会长等各行业宗师共同投票治理，轮流执政。',
    modifiers: Object.freeze({
      researchSpeedBonus: 0.50,      // 科研顿悟提速 +50%
      economyYieldBonus: 0.30        // 经济与资源收益 +30%
    }),
    potentialRisk: '遭遇外敌入侵时战时动员迟缓，易因政见不合分裂为两党'
  }),

  THEOCRATIC_ORTHODOXY: Object.freeze({
    id: 3,
    key: 'THEOCRATIC_ORTHODOXY',
    name: '狂信神权国度',
    description: '视造物主为至高真神，神谕即是唯一律法，神力威能倍增。',
    modifiers: Object.freeze({
      faithYieldBonus: 1.00,         // 祈祷神恩产出翻倍 (+100%)
      godPowerCostReduction: 0.50,   // 上帝技能在该国领地释放消耗减半 (-50%)
      unbreakableMorale: true        // 士兵狂热死战不退
    }),
    potentialRisk: '对异教徒种族好感度锁定为宿敌，外交几乎必然走向圣战'
  })
});

/**
 * 生产与军事科技三阶梯实用科技表 (Tech Tree)
 */
export const Technologies = Object.freeze({
  // 阶梯 I：初民工具 (约 3 分钟)
  TECH_AGRICULTURE: Object.freeze({
    id: 1,
    tier: 1,
    key: 'TECH_AGRICULTURE',
    name: '水渠与腐殖开垦',
    branch: 'AGRARIAN',
    researchCost: 100,
    description: '农耕技术革新，农田收割提速 50%。',
    effects: Object.freeze({
      harvestSpeedBonus: 0.50
    })
  }),

  TECH_HUNTING: Object.freeze({
    id: 2,
    tier: 1,
    key: 'TECH_HUNTING',
    name: '利齿骨矛与陷阱',
    branch: 'HUNTER',
    researchCost: 100,
    description: '捕猎武器改良，近战穿刺伤害提升且捕获成功率增加。',
    effects: Object.freeze({
      meleeDamageBonus: 3.0,
      huntSuccessBonus: 0.30
    })
  }),

  TECH_MARAUDING: Object.freeze({
    id: 3,
    tier: 1,
    key: 'TECH_MARAUDING',
    name: '铁皮开锁撬棍',
    branch: 'MARAUDER',
    researchCost: 100,
    description: '强盗利器，潜入敌营窃取敌方仓库速度翻倍。',
    effects: Object.freeze({
      raidSpeedBonus: 1.00
    })
  }),

  // 阶梯 II：城邦基建 (约 8 分钟)
  TECH_SHIELD_WALL: Object.freeze({
    id: 4,
    tier: 2,
    key: 'TECH_SHIELD_WALL',
    name: '精铁盾墙铸造',
    branch: 'MILITARY',
    researchCost: 300,
    description: '前排步兵激活方阵盾击，提供基础护甲提升与减伤。',
    effects: Object.freeze({
      armorBonus: 20.0,
      shieldBashUnlocked: true
    })
  }),

  TECH_GRANARY: Object.freeze({
    id: 5,
    tier: 2,
    key: 'TECH_GRANARY',
    name: '地底恒温粮仓',
    branch: 'PRODUCTION',
    researchCost: 300,
    description: '部族大粮仓储量上限翻倍，且具备耐火防燃特性。',
    effects: Object.freeze({
      foodCapMultiplier: 2.0,
      isFireproof: true
    })
  }),

  TECH_SHRINE: Object.freeze({
    id: 6,
    tier: 2,
    key: 'TECH_SHRINE',
    name: '神迹共鸣祭坛',
    branch: 'CIVIC',
    researchCost: 300,
    description: '在领地内筑起祭坛，神恩累积速度提升 60%。',
    effects: Object.freeze({
      faithAccumulationBonus: 0.60
    })
  }),

  // 阶梯 III：奇迹工程 (约 15 分钟)
  TECH_SUPER_WEAPON: Object.freeze({
    id: 7,
    tier: 3,
    key: 'TECH_SUPER_WEAPON',
    name: '超级战略奇迹工程',
    branch: 'WONDER',
    researchCost: 800,
    description: '解锁建造工坊，开始装配本种族专属超级兵器（巨炮/飞艇/比蒙/古树）。',
    effects: Object.freeze({
      unlockSuperWeapon: true
    })
  })
});

/**
 * 统治者个性词条库 (Ruler Traits)
 */
export const RulerTraits = Object.freeze({
  TYRANT: Object.freeze({
    id: 0,
    key: 'TYRANT',
    name: '残暴暴君',
    description: '崇尚铁血杀戮，强制剥夺民权，偏好军国扩张。',
    tensionBias: Object.freeze({
      [CivicRoutes.HEREDITARY_DYNASTY.id]: 0.1,
      [CivicRoutes.MILITARY_AUTOCRACY.id]: -0.3,
      [CivicRoutes.ELDERS_COUNCIL.id]: 0.8, // 与共和剧烈冲突！
      [CivicRoutes.THEOCRATIC_ORTHODOXY.id]: 0.2
    })
  }),

  LEGITIMATE_HEIR: Object.freeze({
    id: 1,
    key: 'LEGITIMATE_HEIR',
    name: '正统皇子',
    description: '誓死维护家族血脉特权，排斥外姓平民晋升。',
    tensionBias: Object.freeze({
      [CivicRoutes.HEREDITARY_DYNASTY.id]: -0.4,
      [CivicRoutes.MILITARY_AUTOCRACY.id]: 0.6,
      [CivicRoutes.ELDERS_COUNCIL.id]: 0.4,
      [CivicRoutes.THEOCRATIC_ORTHODOXY.id]: -0.1
    })
  }),

  RADICAL_REFORMER: Object.freeze({
    id: 2,
    key: 'RADICAL_REFORMER',
    name: '激进改革家',
    description: '不顾阻力强行推行新科技与新制度，厌恶守旧。',
    tensionBias: Object.freeze({
      [CivicRoutes.HEREDITARY_DYNASTY.id]: 0.5,
      [CivicRoutes.MILITARY_AUTOCRACY.id]: 0.2,
      [CivicRoutes.ELDERS_COUNCIL.id]: -0.5,
      [CivicRoutes.THEOCRATIC_ORTHODOXY.id]: 0.7
    })
  }),

  CONSERVATIVE: Object.freeze({
    id: 3,
    key: 'CONSERVATIVE',
    name: '守旧石顽派',
    description: '视一切新科技为异端，坚持老祖宗古法治国。',
    tensionBias: Object.freeze({
      [CivicRoutes.HEREDITARY_DYNASTY.id]: -0.2,
      [CivicRoutes.MILITARY_AUTOCRACY.id]: 0.1,
      [CivicRoutes.ELDERS_COUNCIL.id]: 0.4,
      [CivicRoutes.THEOCRATIC_ORTHODOXY.id]: -0.3
    })
  }),

  COWARD: Object.freeze({
    id: 4,
    key: 'COWARD',
    name: '懦弱平庸者',
    description: '容易受宠臣左右，遇事畏缩逃避。',
    tensionBias: Object.freeze({
      [CivicRoutes.HEREDITARY_DYNASTY.id]: 0.2,
      [CivicRoutes.MILITARY_AUTOCRACY.id]: 0.7, // 军阀极其鄙视懦夫
      [CivicRoutes.ELDERS_COUNCIL.id]: -0.1,
      [CivicRoutes.THEOCRATIC_ORTHODOXY.id]: 0.1
    })
  }),

  AMBITIOUS_WARLORD: Object.freeze({
    id: 5,
    key: 'AMBITIOUS_WARLORD',
    name: '野心军功将',
    description: '战功赫赫，手握重兵，自视甚高，觊觎王位。',
    tensionBias: Object.freeze({
      [CivicRoutes.HEREDITARY_DYNASTY.id]: 0.6,
      [CivicRoutes.MILITARY_AUTOCRACY.id]: -0.4,
      [CivicRoutes.ELDERS_COUNCIL.id]: 0.5,
      [CivicRoutes.THEOCRATIC_ORTHODOXY.id]: 0.2
    })
  })
});

/**
 * 战后处置五重收束和谈条约类型 (Post-War Treaty Types)
 */
export const TreatyTypes = Object.freeze({
  ENSLAVE:    0, // 残酷奴役 (带枷锁采矿)
  ALLIANCE:   1, // 和平同盟 (领地合并，平权公民)
  VASSAL:     2, // 二等附庸 (保留自治，上缴贡赋)
  EXILE:      3, // 驱逐流放 (沦落深山流寇盗匪)
  ANNIHILATE: 4  // 吞噬灭绝 (尸骸吞噬，基因同化)
});

/**
 * 继承大转盘类型代码 (Succession Types)
 */
export const SuccessionTypes = Object.freeze({
  NORMAL_SUCCESSION:  0, // 40%: 正常顺位长子即位
  ACCIDENTAL_DEATH:   1, // 15%: 离奇横死意外 (野猪拱死/溺水)
  REGENCY_COUNCIL:    2, // 15%: 幼主登基权臣摄政
  DUEL_LOTTERY:       3, // 15%: 遗嘱不清兄弟抓阄掷骰死斗
  BASTARD_USURPATION: 4, // 15%: 荒野私生子带兵夺门
  EXTINCTION_DUEL:    5  // 兜底: 绝嗣硬汉角斗自然坍塌
});
