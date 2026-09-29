/**
 * RaceSkillComponent.js
 * 12 始祖种族特异技能与动作通道连续平铺内存池组件
 * 
 * 内存规格 (TDS & Milestone 2 契约 1.3 节):
 * TOTAL_SLOTS = 4097, SKILL_STRIDE = 4
 * 内存布局: Float32Array(TOTAL_SLOTS * SKILL_STRIDE) ≈ 65.5 KB
 * 
 * 动作通道掩码与状态枚举 (Milestone 2 契约 1.2 节):
 * - Locomotion: RUN (0), DASH (1), KNOCKBACK (2), STATIONARY (3)
 * - Stance: STAND (0), PRONE (1), BURROW (2), FLOAT (3)
 * - Emission: IDLE (0), CAST (1), SPIT (2), SHOUT (3)
 */

export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = 4097;

export const SKILL_STRIDE = 4;
export const SKILL_OFFSET_COOLDOWN = 0; // 技能内置冷却倒计时 (秒, <= 0 可再次释放)
export const SKILL_OFFSET_DURATION = 1; // 当前主动技能持续生效倒计时 (秒)
export const SKILL_OFFSET_CHANNEL = 2;  // 当前占用的动作轨道位掩码 (bit0: Locomotion, bit1: Stance, bit2: Emission)
export const SKILL_OFFSET_PARAM = 3;    // 技能特异参数缓冲 (如蓄力时间、充能计数)

// 动作通道位掩码 (Action Channel Bits)
export const CHANNEL_NONE       = 0;
export const CHANNEL_LOCOMOTION = ((1 << 0) >>> 0); // 1: 机动位移轨
export const CHANNEL_STANCE     = ((1 << 1) >>> 0); // 2: 姿势姿态轨
export const CHANNEL_EMISSION   = ((1 << 2) >>> 0); // 4: 释放喷射轨
export const CHANNEL_ALL        = ((CHANNEL_LOCOMOTION | CHANNEL_STANCE | CHANNEL_EMISSION) >>> 0);

// 各轨道状态枚举
export const LocomotionState = Object.freeze({
  RUN: 0,        // 正常奔跑
  DASH: 1,       // 冲刺飞扑
  KNOCKBACK: 2,  // 击退硬直
  STATIONARY: 3  // 强制静止
});

export const StanceState = Object.freeze({
  STAND: 0,      // 直立作战
  PRONE: 1,      // 倒地装死
  BURROW: 2,     // 钻入地底
  FLOAT: 3       // 滞空悬浮
});

export const EmissionState = Object.freeze({
  IDLE: 0,       // 静默无动作
  CAST: 1,       // 技能施法
  SPIT: 2,       // 体液喷洒
  SHOUT: 3       // 战吼叫喊
});

/**
 * 创建 RaceSkillComponent 连续内存 TypedArray
 * @returns {Float32Array}
 */
export function createRaceSkillBuffer() {
  return new Float32Array(TOTAL_SLOTS * SKILL_STRIDE);
}

/**
 * 初始化实体的技能槽位
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 * @param {number} [cooldown=0] 
 * @param {number} [duration=0] 
 * @param {number} [channel=0] 
 * @param {number} [param=0] 
 */
export function initRaceSkill(buffer, entityId, cooldown = 0, duration = 0, channel = 0, param = 0) {
  const off = entityId * SKILL_STRIDE;
  buffer[off + SKILL_OFFSET_COOLDOWN] = cooldown;
  buffer[off + SKILL_OFFSET_DURATION] = duration;
  buffer[off + SKILL_OFFSET_CHANNEL] = channel;
  buffer[off + SKILL_OFFSET_PARAM] = param;
}

/**
 * 重置实体的技能槽位
 * @param {Float32Array} buffer 
 * @param {number} entityId 
 */
export function resetRaceSkill(buffer, entityId) {
  const off = entityId * SKILL_STRIDE;
  buffer[off + SKILL_OFFSET_COOLDOWN] = 0.0;
  buffer[off + SKILL_OFFSET_DURATION] = 0.0;
  buffer[off + SKILL_OFFSET_CHANNEL] = 0.0;
  buffer[off + SKILL_OFFSET_PARAM] = 0.0;
}

/**
 * 重置整个技能内存池
 * @param {Float32Array} buffer 
 */
export function resetAllRaceSkills(buffer) {
  buffer.fill(0);
}
