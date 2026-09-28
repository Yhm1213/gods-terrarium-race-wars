/**
 * @file SeedCodec.js
 * @description 16 位分歧点基因种子码编解码器 (SeedCodec)
 * 严格遵循 SRS REQ-NAR-005、08_chronicle_and_narrative.md 5.1 节与 WP-8.4.1 规范：
 * 将生物实体的全部生理基因组、世界分歧点参数打包为 16 位十六进制符文码 (如 E8A2-F04C-99B1-D330)，
 * 直通 URL Query 参数秒开，支持 100% 可逆解码与二创传播踢馆。
 */

import { RaceList, Races } from './RaceData.js';

/**
 * 材质类型枚举字典
 */
export const MaterialTypes = Object.freeze({
  FLESH:    0, // 普通血肉
  CHITIN:   1, // 几丁质甲壳
  GRANITE:  2, // 花岗岩石肤
  IRON:     3, // 生铁重甲
  BARK:     4, // 古树坚皮
  BONE:     5, // 苍白枯骨
  CRYSTAL:  6, // 灵能晶石
  SLIME:    7  // 粘滑软泥
});

/**
 * 体液类型枚举字典
 */
export const FluidTypes = Object.freeze({
  RED_BLOOD: 0, // 普通鲜红热血
  SAP:       1, // 绿色古树汁液
  MERCURY:   2, // 银色液态水银
  LAVA:      3, // 炽热熔岩火血
  ACID:      4, // 剧毒酸液
  ECTOPLASM: 5, // 幽蓝灵质死气
  ICHOR:     6  // 虚空魔眼黑血
});

/**
 * 种子码格式正则表达式 (匹配 16 位 Hex，可选连字符与前导 #)
 * 例: E8A2-F04C-99B1-D330, #A7F2B09C33D1E884
 */
const SEED_REGEX = /^#?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})$/;

/**
 * 校验输入字符串是否为合法的 16 位基因种子码
 * @param {string} seedStr - 待校验的种子码
 * @returns {boolean}
 */
export function isValidSeed(seedStr) {
  if (typeof seedStr !== 'string') return false;
  return SEED_REGEX.test(seedStr.trim());
}

/**
 * 规范化格式为标准连字符格式 (XXXX-XXXX-XXXX-XXXX)
 * @param {string} seedStr - 种子码
 * @returns {string} 标准大写连字符格式
 */
export function normalizeSeed(seedStr) {
  if (!isValidSeed(seedStr)) {
    throw new Error(`[SeedCodec] Invalid seed format: "${seedStr}"`);
  }
  const match = seedStr.trim().match(SEED_REGEX);
  return `${match[1]}-${match[2]}-${match[3]}-${match[4]}`.toUpperCase();
}

/**
 * 将物种基因参数对象编码为 16 位十六进制种子码
 * @param {object} params
 * @param {string|number} [params.raceId] - 种族 ID (如 'ORC') 或 索引 (0~11)
 * @param {number} [params.mass=1.0] - 骨骼质量 (0.2 ~ 3.35 kg)
 * @param {number} [params.speedMultiplier=1.0] - 移速因子 (0.4 ~ 1.975)
 * @param {number} [params.materialType=0] - 材质类型 (0~15)
 * @param {number} [params.fluidType=0] - 体液类型 (0~15)
 * @param {number} [params.armorBonus=0] - 护甲加成 (0~15)
 * @param {number} [params.metabolicType=0] - 代谢范式 (0~15)
 * @param {number} [params.organMask=0] - 变异器官位掩码 (0x0000 ~ 0xFFFF)
 * @param {number} [params.skillIndex=0] - 行为树/分歧索引 (0x0000 ~ 0xFFFF)
 * @returns {string} 16 位十六进制符文码 (如 E8A2-F04C-99B1-D330)
 */
export function encodeSeed({
  raceId = 'HUMAN',
  mass = 1.0,
  speedMultiplier = 1.0,
  materialType = 0,
  fluidType = 0,
  armorBonus = 0,
  metabolicType = 0,
  organMask = 0,
  skillIndex = 0
} = {}) {
  // 1. 解析 raceIndex (4 bits: 0~15)
  let raceIndex = 0;
  if (typeof raceId === 'number') {
    raceIndex = Math.max(0, Math.min(15, raceId));
  } else if (typeof raceId === 'string') {
    const idx = RaceList.findIndex(r => r.id === raceId.toUpperCase());
    raceIndex = idx >= 0 ? idx : 2; // 默认人类 (2)
  }

  // 2. 骨骼质量编码 (6 bits: 0~63, 映射 [0.2, 3.35], 步长 0.05)
  const clampedMass = Math.max(0.2, Math.min(3.35, mass));
  const massVal = Math.round((clampedMass - 0.2) / 0.05) & 0x3F;

  // 3. 移速因子编码 (6 bits: 0~63, 映射 [0.4, 1.975], 步长 0.025)
  const clampedSpeed = Math.max(0.4, Math.min(1.975, speedMultiplier));
  const speedVal = Math.round((clampedSpeed - 0.4) / 0.025) & 0x3F;

  // Part 1 (16 bits): raceIndex(4) | massVal(6) | speedVal(6)
  const part1 = ((raceIndex & 0x0F) << 12) | ((massVal & 0x3F) << 6) | (speedVal & 0x3F);

  // Part 2 (16 bits): material(4) | fluid(4) | armor(4) | metabolic(4)
  const matVal = Math.max(0, Math.min(15, materialType)) & 0x0F;
  const fluVal = Math.max(0, Math.min(15, fluidType)) & 0x0F;
  const armVal = Math.max(0, Math.min(15, armorBonus)) & 0x0F;
  const metVal = Math.max(0, Math.min(15, metabolicType)) & 0x0F;
  const part2 = (matVal << 12) | (fluVal << 8) | (armVal << 4) | metVal;

  // Part 3 (16 bits): 变异外挂器官位掩码
  const part3 = organMask & 0xFFFF;

  // Part 4 (16 bits): CFG 技能/分歧行为树索引
  const part4 = skillIndex & 0xFFFF;

  const hex1 = part1.toString(16).padStart(4, '0').toUpperCase();
  const hex2 = part2.toString(16).padStart(4, '0').toUpperCase();
  const hex3 = part3.toString(16).padStart(4, '0').toUpperCase();
  const hex4 = part4.toString(16).padStart(4, '0').toUpperCase();

  return `${hex1}-${hex2}-${hex3}-${hex4}`;
}

/**
 * 将 16 位十六进制种子码逆向解码还原为物种基因参数对象
 * @param {string} seedStr - 16 位十六进制符文码
 * @returns {{
 *   raceIndex: number,
 *   raceId: string,
 *   mass: number,
 *   speedMultiplier: number,
 *   materialType: number,
 *   fluidType: number,
 *   armorBonus: number,
 *   metabolicType: number,
 *   organMask: number,
 *   skillIndex: number,
 *   rawHex: string
 * }}
 */
export function decodeSeed(seedStr) {
  const normalized = normalizeSeed(seedStr);
  const parts = normalized.split('-');

  const part1 = parseInt(parts[0], 16);
  const part2 = parseInt(parts[1], 16);
  const part3 = parseInt(parts[2], 16);
  const part4 = parseInt(parts[3], 16);

  // 解构 Part 1
  const raceIndex = (part1 >> 12) & 0x0F;
  const massVal = (part1 >> 6) & 0x3F;
  const speedVal = part1 & 0x3F;

  const raceConfig = RaceList[raceIndex];
  const raceId = raceConfig ? raceConfig.id : 'HUMAN';
  const mass = Number((0.2 + massVal * 0.05).toFixed(2));
  const speedMultiplier = Number((0.4 + speedVal * 0.025).toFixed(3));

  // 解构 Part 2
  const materialType = (part2 >> 12) & 0x0F;
  const fluidType = (part2 >> 8) & 0x0F;
  const armorBonus = (part2 >> 4) & 0x0F;
  const metabolicType = part2 & 0x0F;

  // 解构 Part 3 & 4
  const organMask = part3 & 0xFFFF;
  const skillIndex = part4 & 0xFFFF;

  return {
    raceIndex,
    raceId,
    mass,
    speedMultiplier,
    materialType,
    fluidType,
    armorBonus,
    metabolicType,
    organMask,
    skillIndex,
    rawHex: normalized
  };
}

/**
 * 从 URL 地址或 Query 字符串中检索提取基因种子码
 * 例: "http://localhost:3000/?seed=E8A2-F04C-99B1-D330&zoom=1.5"
 * @param {string} urlOrQuery - 完整 URL 或 search 字符串
 * @returns {string|null} 解码出的种子码字符串，若不存在或非法返回 null
 */
export function extractSeedFromUrl(urlOrQuery) {
  if (typeof urlOrQuery !== 'string') return null;

  try {
    let queryString = urlOrQuery;
    if (urlOrQuery.includes('?')) {
      queryString = urlOrQuery.slice(urlOrQuery.indexOf('?'));
    }
    const params = new URLSearchParams(queryString);
    const seedVal = params.get('seed');
    if (seedVal && isValidSeed(seedVal)) {
      return normalizeSeed(seedVal);
    }
  } catch {
    // 兼容非标 URL 格式，降级正则检索
  }

  // 正则降级扫描
  const match = urlOrQuery.match(/[?&]seed=([#0-9a-fA-F-]+)/);
  if (match && isValidSeed(match[1])) {
    return normalizeSeed(match[1]);
  }

  return null;
}

/**
 * 构造携带基因种子码的 URL 链接
 * @param {string} baseUrl - 基础 URL (如 "http://localhost:3000/index.html")
 * @param {string} seedStr - 基因种子码
 * @returns {string} 构造好的分享 URL
 */
export function generateSeedUrl(baseUrl, seedStr) {
  const norm = normalizeSeed(seedStr);
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}seed=${norm}`;
}
