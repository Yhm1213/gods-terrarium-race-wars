/**
 * AntiFragmentationGuard.js
 * 四大防碎片化严苛协议综合守门系统
 * 严格遵照 SPEC-M3-CONTRACT §4.5
 *
 * 核心机制:
 * 1. 人口与地块门槛: 母国人口 >= 12, 领地 >= 16 瓦片方可分裂，否则直接驳回并转为内部处决 (张力回退 50)
 * 2. 300 秒分裂冷却锁: 发生一次分裂后进入 300s 国家凝聚期，张力清零且绝对免疫再次裂变
 * 3. 微型飞地秒级注销: 孤悬海外 < 3 瓦片的地块在 30 秒内自然消融归还荒野
 * 4. 全球 16 国硬锁: 活跃政权上限锁死为 16 个，达到 16 国时转为首领暗杀政变，绝不创生第 17 国
 */

import { MAX_FACTIONS } from '../data/FactionData.js';

export const SCHISM_MIN_POPULATION = 12;      // 裂变最低人口门槛
export const SCHISM_MIN_TERRITORY = 16;       // 裂变最低领地瓦片数
export const SCHISM_COOLDOWN_SECONDS = 300.0; // 分裂凝聚保护锁 (300 秒)
export const MINI_ENCLAVE_THRESHOLD = 3;      // 微型孤悬飞地门槛 (< 3 瓦片)
export const MINI_ENCLAVE_DISSOLVE_TIME = 30.0;// 微型飞地消融时限 (30 秒)

export const SchismBlockReason = Object.freeze({
  ALLOWED: 'ALLOWED',
  LOW_POP: 'LOW_POP',
  LOW_TERRITORY: 'LOW_TERRITORY',
  COOLDOWN_ACTIVE: 'COOLDOWN_ACTIVE',
  MAX_FACTIONS_REACHED: 'MAX_FACTIONS_REACHED'
});

export class AntiFragmentationGuard {
  /**
   * 综合评估指定阵营是否满足图腾大裂变前置门槛
   *
   * @param {number} factionId 欲分裂的母国 ID
   * @param {number} currentPop 当前存活人口数
   * @param {number} territoryCount 当前领地瓦片数
   * @param {number} warCooldown 阵营当前分裂/战争保护期倒计时
   * @param {number} activeFactionCount 全球当前活跃国家总数
   * @returns {{allowed: boolean, reason: string}}
   */
  evaluateSchismEligibility(factionId, currentPop, territoryCount, warCooldown, activeFactionCount) {
    // 1. 全球 16 国硬锁守门
    if (activeFactionCount >= MAX_FACTIONS) {
      return { allowed: false, reason: SchismBlockReason.MAX_FACTIONS_REACHED };
    }

    // 2. 300 秒分裂冷却保护期守门
    if (warCooldown > 0.0) {
      return { allowed: false, reason: SchismBlockReason.COOLDOWN_ACTIVE };
    }

    // 3. 基础人口规模门槛 (人口必须 >= 12)
    if (currentPop < SCHISM_MIN_POPULATION) {
      return { allowed: false, reason: SchismBlockReason.LOW_POP };
    }

    // 4. 基础领地规模门槛 (地块必须 >= 16)
    if (territoryCount < SCHISM_MIN_TERRITORY) {
      return { allowed: false, reason: SchismBlockReason.LOW_TERRITORY };
    }

    return { allowed: true, reason: SchismBlockReason.ALLOWED };
  }
}
