/**
 * @file FactionData.js
 * @description 宏观政权数据规格与 16 个初始政权基础配表 (FactionData)
 * 严格遵循 TDS 2.5 节与 WBS 6.0 规范：
 * 全图最多 16 个政权，其宏观状态物化为连续类型化数组 FactionRuntimeBuffer，
 * 杜绝任何虚构虚空属性，纯微观小人普查汇总驱动。
 */

/**
 * 全陆地活跃政权容量硬锁 (TDS 2.5 / SRS REQ-POL-006)
 */
export const MAX_FACTIONS = 16;

/**
 * 阵营运行时数据步长 (单阵营 8 个 32 位整型字，16 阵营仅 512 字节连续内存)
 */
export const FACTION_STRIDE = 8;

/**
 * 阵营运行时缓冲区内部字段偏移量 (FAC_OFFSET_*)
 */
export const FAC_OFFSET_TOTEM_ID     = 0; // 图腾实体 ID (TotemEntityId)
export const FAC_OFFSET_CIVIC_ID     = 1; // 当前市政意识形态路线 ID (CivicRouteId)
export const FAC_OFFSET_TENSION      = 2; // 政治张力 (0 ~ 100, 蓄满 100 爆发大分裂或宫廷流血政变)
export const FAC_OFFSET_POP_COUNT    = 3; // 当前存活总人口 (普查汇总)
export const FAC_OFFSET_FOOD         = 4; // 部族大粮仓物资储备
export const FAC_OFFSET_ORE          = 5; // 矿石建材工业储备
export const FAC_OFFSET_WAR_COOLDOWN = 6; // 停战 300s / 分裂 180s 凝聚保护期倒计时 (秒)
export const FAC_OFFSET_FLAGS        = 7; // 阵营状态位掩码 (如 ACTIVE, DESTROYED, SCHISMED)

/**
 * 阵营状态位掩码 (FactionFlags)
 */
export const FactionFlags = Object.freeze({
  NONE:       0,
  ACTIVE:     1 << 0, // 0x01: 活跃运作合法政权
  DESTROYED:  1 << 1, // 0x02: 图腾已被摧毁灭国
  SCHISMED:   1 << 2, // 0x04: 经历过领地大分裂
  IS_REBEL:   1 << 3, // 0x08: 裂变叛乱军政权
  IS_OUTLAW:  1 << 4, // 0x10: 边境残余流寇盗匪
  IS_RUINS:   1 << 5  // 0x20: 中立古代魔像遗迹
});

/**
 * 16 个初始政权静态基础配置
 * 覆盖 12 始祖种族文明政权 + 4 大分裂/流寇/古代遗迹预留政权
 * @type {ReadonlyArray<Readonly<{
 *   id: number,
 *   key: string,
 *   name: string,
 *   raceId: string,
 *   initialCivic: number,
 *   primaryColor: string,
 *   secondaryColor: string,
 *   initialFood: number,
 *   initialOre: number,
 *   flags: number,
 *   description: string
 * }>>}
 */
export const InitialFactions = Object.freeze([
  // 0: 绿皮菌兽战帮 (Orc Horde)
  Object.freeze({
    id: 0,
    key: 'ORC_HORDE',
    name: '绿皮掠夺战帮',
    raceId: 'ORC',
    initialCivic: 1, // 军阀强权独裁
    primaryColor: '#38761d',
    secondaryColor: '#274e13',
    initialFood: 120,
    initialOre: 40,
    flags: FactionFlags.ACTIVE,
    description: '以武力与掠夺为核心驱动力的好战菌兽部族。'
  }),

  // 1: 森灵树民圣林 (Elven Enclave)
  Object.freeze({
    id: 1,
    key: 'ELF_SANCTUARY',
    name: '森灵圣树氏族',
    raceId: 'ELF',
    initialCivic: 2, // 长者议会共和
    primaryColor: '#2e7d32',
    secondaryColor: '#81c784',
    initialFood: 160,
    initialOre: 20,
    flags: FactionFlags.ACTIVE,
    description: '与巨木古树共生的避世林地氏族，注重农耕与草药。'
  }),

  // 2: 人类神圣帝国 (Human Empire)
  Object.freeze({
    id: 2,
    key: 'HUMAN_EMPIRE',
    name: '白银人类帝国',
    raceId: 'HUMAN',
    initialCivic: 0, // 血统世袭皇权
    primaryColor: '#1976d2',
    secondaryColor: '#ffd700',
    initialFood: 150,
    initialOre: 60,
    flags: FactionFlags.ACTIVE,
    description: '法统森严的封建王朝，依靠血脉世袭与全能适应性立足。'
  }),

  // 3: 高山矮人氏族 (Dwarven Clan)
  Object.freeze({
    id: 3,
    key: 'DWARF_CLAN',
    name: '铁砧高山矮人',
    raceId: 'DWARF',
    initialCivic: 0, // 血统世袭皇权
    primaryColor: '#d84315',
    secondaryColor: '#4e342e',
    initialFood: 100,
    initialOre: 150,
    flags: FactionFlags.ACTIVE,
    description: '深居地穴与高山的锻造大师，视麦酒与矿石如生命。'
  }),

  // 4: 墓园亡灵聚落 (Undead Necropolis)
  Object.freeze({
    id: 4,
    key: 'UNDEAD_NECROPOLIS',
    name: '永夜枯骨墓园',
    raceId: 'UNDEAD',
    initialCivic: 3, // 狂信神权国度 (侍奉死神与命匣)
    primaryColor: '#4a148c',
    secondaryColor: '#00e5ff',
    initialFood: 0,   // 无机死灵免饥饿
    initialOre: 80,
    flags: FactionFlags.ACTIVE,
    description: '依附于核心命匣的无尽骷髅大军，免除有机饥饿。'
  }),

  // 5: 狂躁地精工会 (Goblin Tinkers)
  Object.freeze({
    id: 5,
    key: 'GOBLIN_WARBAND',
    name: '爆破地精工会',
    raceId: 'GOBLIN',
    initialCivic: 1, // 军阀强权独裁
    primaryColor: '#558b2f',
    secondaryColor: '#fbc02d',
    initialFood: 90,
    initialOre: 100,
    flags: FactionFlags.ACTIVE,
    description: '沉迷危险火药与工程发明的敏捷掠夺者。'
  }),

  // 6: 深渊角魔军团 (Abyssal Legion)
  Object.freeze({
    id: 6,
    key: 'DEMON_LEGION',
    name: '深渊焦土恶魔',
    raceId: 'DEMON',
    initialCivic: 1, // 军阀强权独裁
    primaryColor: '#b71c1c',
    secondaryColor: '#ff6f00',
    initialFood: 110,
    initialOre: 50,
    flags: FactionFlags.ACTIVE,
    description: '自熔岩裂隙中诞生的残暴军团，所过之处化为焦土。'
  }),

  // 7: 沼泽蜥蜴人部落 (Lizardfolk Tribe)
  Object.freeze({
    id: 7,
    key: 'LIZARD_TRIBE',
    name: '泥潭蜥蜴氏族',
    raceId: 'LIZARD',
    initialCivic: 2, // 长者议会共和
    primaryColor: '#00695c',
    secondaryColor: '#80cbc4',
    initialFood: 140,
    initialOre: 30,
    flags: FactionFlags.ACTIVE,
    description: '盘踞于剧毒泥淖的狩猎隐者，捕鱼制干。'
  }),

  // 8: 荒原兽人氏族 (Beastfolk Pack)
  Object.freeze({
    id: 8,
    key: 'BEAST_PACK',
    name: '狂野兽化氏族',
    raceId: 'BEAST',
    initialCivic: 1, // 军阀强权独裁
    primaryColor: '#e65100',
    secondaryColor: '#bf360c',
    initialFood: 130,
    initialOre: 20,
    flags: FactionFlags.ACTIVE,
    description: '追逐水草与兽群的长途迁徙猎人，体魄强韧。'
  }),

  // 9: 孢子菌丝网络 (Sporeling Colony)
  Object.freeze({
    id: 9,
    key: 'SPORE_COLONY',
    name: '孢子共生母网',
    raceId: 'SPORE',
    initialCivic: 2, // 长者议会共和
    primaryColor: '#00838f',
    secondaryColor: '#80deea',
    initialFood: 160,
    initialOre: 10,
    flags: FactionFlags.ACTIVE,
    description: '生长于潮湿阴暗处的菌丝聚落，催生荧光菌菇。'
  }),

  // 10: 晶石先驱枢纽 (Golem Construct)
  Object.freeze({
    id: 10,
    key: 'GOLEM_CONSTRUCT',
    name: '晶石先驱方尖碑',
    raceId: 'GOLEM',
    initialCivic: 2, // 逻辑主脑共治 (议会型)
    primaryColor: '#0d47a1',
    secondaryColor: '#90caf9',
    initialFood: 0,   // 硅基充能
    initialOre: 200,
    flags: FactionFlags.ACTIVE,
    description: '依附方尖碑吸纳地脉晶矿的硅基机械集群。'
  }),

  // 11: 拟态魔眼心智 (Aberration Hive)
  Object.freeze({
    id: 11,
    key: 'ABERR_HIVE',
    name: '深空拟态心智',
    raceId: 'ABERR',
    initialCivic: 3, // 狂信神权国度
    primaryColor: '#4a148c',
    secondaryColor: '#ea80fc',
    initialFood: 0,   // 灵能吞噬
    initialOre: 50,
    flags: FactionFlags.ACTIVE,
    description: '漂浮在阴影中的灵能异怪聚合体，吞噬精神心智。'
  }),

  // 12: 皇权大裂变分裂军 (Royalist Schism Rebels - 裂变预留)
  Object.freeze({
    id: 12,
    key: 'REBEL_ROYALISTS',
    name: '自由之矛叛军',
    raceId: 'HUMAN',
    initialCivic: 1, // 军阀割据
    primaryColor: '#c2185b',
    secondaryColor: '#ad1457',
    initialFood: 80,
    initialOre: 40,
    flags: FactionFlags.IS_REBEL,
    description: '国家政治裂变中举起战旗的少壮派起义者。'
  }),

  // 13: 荒原流寇盗匪团 (Wasteland Outlaws - 流寇预留)
  Object.freeze({
    id: 13,
    key: 'OUTLAW_RAIDERS',
    name: '荒野流寇马匪',
    raceId: 'GOBLIN',
    initialCivic: 1, // 强权独裁
    primaryColor: '#795548',
    secondaryColor: '#3e2723',
    initialFood: 50,
    initialOre: 30,
    flags: FactionFlags.IS_OUTLAW,
    description: '亡国残兵逃入深山沦落的流寇，收取过路保护费。'
  }),

  // 14: 异端圣约分裂国 (Heretic Schismatics - 裂变预留)
  Object.freeze({
    id: 14,
    key: 'HERETIC_COVENANT',
    name: '猩红异端圣会',
    raceId: 'DEMON',
    initialCivic: 3, // 狂信神权
    primaryColor: '#880e4f',
    secondaryColor: '#ff4081',
    initialFood: 60,
    initialOre: 40,
    flags: FactionFlags.IS_REBEL,
    description: '因信仰分歧脱离母国的宗教狂信反叛派系。'
  }),

  // 15: 古代魔像风化遗迹 (Ancient Ruin Golems - 中立解耦预留)
  Object.freeze({
    id: 15,
    key: 'ANCIENT_RUINS',
    name: '古代方尖碑遗迹',
    raceId: 'GOLEM',
    initialCivic: 2,
    primaryColor: '#616161',
    secondaryColor: '#9e9e9e',
    initialFood: 0,
    initialOre: 100,
    flags: FactionFlags.IS_RUINS,
    description: '断能石化脱离活跃争霸的中立古代机械遗迹。'
  })
]);

/**
 * 快速根据 ID 或 Key 索引阵营基础配置
 */
export const Factions = Object.freeze(
  Object.fromEntries(InitialFactions.map(f => [f.key, f]))
);

/**
 * 创建全量连续政权运行时数据缓冲区 (TypedArray)
 * @returns {Int32Array} 长度为 MAX_FACTIONS * FACTION_STRIDE (128个32位整型，512字节)
 */
export function createFactionRuntimeBuffer() {
  const buffer = new Int32Array(MAX_FACTIONS * FACTION_STRIDE);
  // 按初始配置初始化缓冲区
  for (let i = 0; i < MAX_FACTIONS; i++) {
    const baseOffset = i * FACTION_STRIDE;
    const cfg = InitialFactions[i];
    buffer[baseOffset + FAC_OFFSET_TOTEM_ID]     = 0;
    buffer[baseOffset + FAC_OFFSET_CIVIC_ID]     = cfg ? cfg.initialCivic : 0;
    buffer[baseOffset + FAC_OFFSET_TENSION]      = 0;
    buffer[baseOffset + FAC_OFFSET_POP_COUNT]    = 0;
    buffer[baseOffset + FAC_OFFSET_FOOD]         = cfg ? cfg.initialFood : 0;
    buffer[baseOffset + FAC_OFFSET_ORE]          = cfg ? cfg.initialOre : 0;
    buffer[baseOffset + FAC_OFFSET_WAR_COOLDOWN] = 0;
    buffer[baseOffset + FAC_OFFSET_FLAGS]        = cfg ? cfg.flags : FactionFlags.NONE;
  }
  return buffer;
}
