// ==========================================
// 《神之蛐蛐缸：万族争霸》核心系统配置
// (包含专家评审团优化规范: 边界安全、空间哈希粒度、双族生态参数)
// ==========================================

export const CONFIG = {
  // 世界物理网格规格 (56 x 36 瓦片, 24x24 px)
  GRID_WIDTH: 56,
  GRID_HEIGHT: 36,
  TILE_SIZE: 24,
  get WORLD_WIDTH() { return this.GRID_WIDTH * this.TILE_SIZE; },   // 1344 px
  get WORLD_HEIGHT() { return this.GRID_HEIGHT * this.TILE_SIZE; }, // 864 px

  // 空间哈希网格 (零 GC 48x48 像素网格，共 28 x 18 = 504 桶)
  SPATIAL_CELL_SIZE: 48,
  get SPATIAL_COLS() { return Math.ceil(this.WORLD_WIDTH / this.SPATIAL_CELL_SIZE); },
  get SPATIAL_ROWS() { return Math.ceil(this.WORLD_HEIGHT / this.SPATIAL_CELL_SIZE); },

  // 瓦片地貌枚举
  TILE_TYPES: {
    DEEP_WATER: 0,
    WATER: 1,
    SAND: 2,
    GRASS: 3,
    FOREST: 4,
    MOUNTAIN: 5,
    HOLY_SPRING: 6,
    LAVA: 7
  },

  // 基础瓦片物理调色板 (色彩金字塔: 背景灰度差 < 15%, 保持舞台安静)
  TILE_COLORS: {
    0: '#0277bd', // 深水 (非水生溺水)
    1: '#29b6f6', // 浅水 (涉水减速)
    2: '#d4b358', // 沙滩
    3: '#558b2f', // 肥沃草地
    4: '#2e7d32', // 繁茂森林 (可采集木料)
    5: '#455a64', // 高山岩石 (坚硬石料)
    6: '#26c6da', // 神圣泉眼 (治愈微光)
    7: '#d84315'  // 灼热熔岩 (每秒火伤)
  },

  // 生存代谢四大范式
  METABOLISM_TYPES: {
    AGRARIAN: 'AGRARIAN',   // 农耕开垦型 (人类、精灵、真菌人)
    HUNTER: 'HUNTER',       // 野性捕猎型 (兽化人、蜥蜴人、矮人)
    MARAUDER: 'MARAUDER',   // 掠夺拾荒型 (绿皮、地精、角魔)
    INORGANIC: 'INORGANIC'  // 无机死灵型 (亡灵、魔像、魔眼)
  },

  // 种族初始配置 (里程碑 1: 绿皮菌兽 vs 森灵树民)
  FACTIONS: {
    ORC: {
      id: 'ORC',
      name: '绿皮菌兽',
      metabolism: 'MARAUDER', // 🔥 掠夺拾荒型
      color: '#4ade80',
      bannerColor: '#16a34a',
      accentColor: '#14532d',
      baseHp: 140,
      baseSpeed: 1.05,
      mass: 1.4, // 质量较大，不易被击退
      hungerDepletionRate: 0.12,
      breedThreshold: 80,
      matureAge: 2,
      names: ['碎颅·古尔', '暴齿·格鲁克', '巨角·扎克', '狂暴·阿蛮', '独眼·莫戈', '铁皮·多克', '裂地·鲁尔', '野性·咕噜'],
      titles: ['部落先锋', '骨矛猎手', '摔跤好手', '粗野樵夫']
    },
    ELF: {
      id: 'ELF',
      name: '森灵树民',
      metabolism: 'AGRARIAN', // 🌾 农耕开垦型
      color: '#60a5fa',
      bannerColor: '#2563eb',
      accentColor: '#1e3a8a',
      baseHp: 85,
      baseSpeed: 1.4,
      mass: 0.8, // 质量轻巧，闪避灵活
      hungerDepletionRate: 0.08,
      breedThreshold: 75,
      matureAge: 3,
      names: ['星风·爱隆', '绿叶·莱戈', '月语·希尔', '晨露·艾薇', '苍藤·诺恩', '灵羽·瑟兰', '银枝·法利', '清泉·阿纳'],
      titles: ['月影祭司', '神木守卫', '草药织者', '穿林射手']
    }
  },

  // 四大市政意识形态路线 (国家治理树)
  CIVIC_TYPES: {
    HEREDITARY_DYNASTY: { id: 'DYNASTY', name: '血统世袭皇权', desc: '皇长子继承，阶层稳固，老皇帝驾崩极易诱发多皇子夺嫡大战' },
    MILITARY_AUTOCRACY: { id: 'AUTOCRACY', name: '军阀强权独裁', desc: '以战功决斗为尊，全军攻击力+25%，首领老迈极易引发弑君政变' },
    ELDERS_COUNCIL:     { id: 'COUNCIL', name: '长者议会共和', desc: '宗师共治，科研+50%，战时决断迟缓，容易政见不合分裂' },
    THEOCRATIC:         { id: 'THEOCRATIC', name: '狂信神权国度', desc: '视上帝为唯一至尊，神恩产出翻倍，将异教徒视为宿敌' }
  },

  // 统治者性格词条 (诱发政治张力与内战分裂)
  RULER_TRAITS: {
    TYRANT:     { id: 'TYRANT', name: '残暴暴君', prefCivic: 'AUTOCRACY' },
    PRINCE:     { id: 'PRINCE', name: '正统皇子', prefCivic: 'DYNASTY' },
    REFORMER:   { id: 'REFORMER', name: '激进改革家', prefCivic: 'COUNCIL' },
    ZEALOT:     { id: 'ZEALOT', name: '狂信主教', prefCivic: 'THEOCRATIC' },
    WARLORD:    { id: 'WARLORD', name: '野心军功将', prefCivic: 'AUTOCRACY' }
  },

  // 基础生活职业 (第一层)
  LIFE_PROFESSIONS: {
    LUMBERJACK: { name: '伐木工', tool: '阔斧', icon: '🪓' },
    STONEMASON: { name: '采矿石工', tool: '石镐', icon: '⛏️' },
    HERBALIST:  { name: '草药学徒', tool: '药锄', icon: '🌿' },
    SCAVENGER:  { name: '扒手拾荒', tool: '匕首', icon: '🗡️' },
    ACOLYTE:    { name: '学徒侍僧', tool: '法杖', icon: '🪄' },
    BUTCHER:    { name: '荒野屠夫', tool: '骨刀', icon: '🥩' }
  },

  // 生态与资源刷新参数 (地脉养分扩散模型)
  RESOURCES: {
    INITIAL_BERRY_BUSHES: 32,
    BERRY_REGROW_FRAMES: 300, // 约 5 秒
    BERRY_NUTRITION: 45,
    MAX_DROPPED_FOOD: 40
  },

  // QA 防御性参数 (五大致命断言红线)
  QA: {
    MAX_DAMAGE_RECURSION_DEPTH: 3,
    MAX_THROW_SPEED: 28, // 像素/帧
    MAX_DOM_LOG_LINES: 80, // 虚拟滚动环形队列上限
    WAR_TIMEOUT_TICKS: 18000 // 10分钟超时看门狗
  }
};
