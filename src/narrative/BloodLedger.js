/**
 * BloodLedger.js
 * 宿怨账本图谱与血仇追踪系统
 * 严格遵照 SPEC-M4-CONTRACT §4.2
 *
 * 核心特性:
 * 1. 连续平铺 TypedArray 内存池 (4097 * 3 条目)，100% 物理零 GC
 * 2. 每个实体最多记录 3 条宿仇记忆 (FIFO 环形队列替换)
 * 3. 战场感知检测仇敌，激活【宿仇狂暴 (VENDETTA_FRENZY)】
 * 4. 派发 EVT_VENDETTA_TRIGGERED 并输出黑幽默对账文本
 */

import { TOTAL_SLOTS, NULL_ENTITY } from '../core/ECS.js';
import { DomainEvents } from '../data/DomainEvents.js';

export const GRUDGES_PER_ENTITY = 3;
const TOTAL_GRUDGE_SLOTS = TOTAL_SLOTS * GRUDGES_PER_ENTITY;

export class BloodLedger {
  /**
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null] 
   */
  constructor(eventBus = null) {
    this.eventBus = eventBus;

    // 连续内存平铺：每个实体 3 条记录
    this.targetIds = new Int32Array(TOTAL_GRUDGE_SLOTS);
    this.eventTypes = new Int32Array(TOTAL_GRUDGE_SLOTS);
    this.timestamps = new Float32Array(TOTAL_GRUDGE_SLOTS);

    // 每个实体的有效记录数 (0~3) 与环形覆盖指针 (0~2)
    this.counts = new Uint8Array(TOTAL_SLOTS);
    this.heads = new Uint8Array(TOTAL_SLOTS);
  }

  /**
   * 记录一桩仇怨 (断肢、家园损毁、目睹血亲阵亡)
   * @param {number} entityId 受害/记仇实体 ID
   * @param {number} targetId 仇敌实体 ID
   * @param {number} eventType 诱发事件类型
   * @param {number} timestamp 发生时的时间戳 (秒)
   */
  addGrudge(entityId, targetId, eventType, timestamp) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return;
    if (targetId <= NULL_ENTITY || entityId === targetId) return;

    const base = entityId * GRUDGES_PER_ENTITY;
    const count = this.counts[entityId];

    // 检查是否已有该仇敌记录，若有则原地更新时间戳与事件
    for (let i = 0; i < count; i++) {
      const idx = base + i;
      if (this.targetIds[idx] === targetId) {
        this.eventTypes[idx] = eventType;
        this.timestamps[idx] = timestamp;
        return;
      }
    }

    // 新增记录
    if (count < GRUDGES_PER_ENTITY) {
      const idx = base + count;
      this.targetIds[idx] = targetId;
      this.eventTypes[idx] = eventType;
      this.timestamps[idx] = timestamp;
      this.counts[entityId] = count + 1;
    } else {
      // 队列已满 (3 条)，FIFO 环形覆盖最旧的一条
      const head = this.heads[entityId];
      const idx = base + head;
      this.targetIds[idx] = targetId;
      this.eventTypes[idx] = eventType;
      this.timestamps[idx] = timestamp;
      this.heads[entityId] = (head + 1) % GRUDGES_PER_ENTITY;
    }
  }

  /**
   * 检查 entityId 是否仇视 targetId
   * @param {number} entityId 
   * @param {number} targetId 
   * @returns {boolean}
   */
  hasGrudgeAgainst(entityId, targetId) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return false;
    const base = entityId * GRUDGES_PER_ENTITY;
    const count = this.counts[entityId];

    for (let i = 0; i < count; i++) {
      if (this.targetIds[base + i] === targetId) {
        return true;
      }
    }
    return false;
  }

  /**
   * 战场感知检测：在感知范围内寻找仇敌
   * @param {number} entityId 观察者实体 ID
   * @param {Int32Array|Array<number>} nearbyEntities 感知范围内的邻近实体 ID 列表
   * @param {number} nearbyCount 列表有效长度
   * @param {number} [currentTick=0] 当前时间刻
   * @returns {number} 发现的仇敌 ID (未发现则返回 NULL_ENTITY)
   */
  checkVendetta(entityId, nearbyEntities, nearbyCount, currentTick = 0) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return NULL_ENTITY;
    const base = entityId * GRUDGES_PER_ENTITY;
    const count = this.counts[entityId];
    if (count === 0) return NULL_ENTITY;

    for (let n = 0; n < nearbyCount; n++) {
      const neighborId = nearbyEntities[n];
      if (neighborId <= NULL_ENTITY) continue;

      for (let i = 0; i < count; i++) {
        if (this.targetIds[base + i] === neighborId) {
          // 锁定仇敌！派发宿仇触发事件
          if (this.eventBus) {
            this.eventBus.emit(
              DomainEvents.EVT_VENDETTA_TRIGGERED,
              entityId,
              neighborId,
              currentTick,
              this.eventTypes[base + i]
            );
          }
          return neighborId;
        }
      }
    }

    return NULL_ENTITY;
  }

  /**
   * 生成带金框的黑幽默对账文本 DTO (零 GC 纯逻辑或格式化)
   * @param {number} entityId 
   * @param {number} enemyId 
   * @returns {string}
   */
  generateVendettaNarrative(entityId, enemyId) {
    return `【宿怨对账】第 #${entityId} 号战士与死敌 #${enemyId} 狭路相逢！断骨泣血之恨涌上心头，激活宿仇狂暴！`;
  }

  /**
   * 清除某个实体的仇怨账本 (如该实体完成复仇或阵亡)
   * @param {number} entityId 
   */
  clear(entityId) {
    if (entityId <= NULL_ENTITY || entityId >= TOTAL_SLOTS) return;
    const base = entityId * GRUDGES_PER_ENTITY;
    for (let i = 0; i < GRUDGES_PER_ENTITY; i++) {
      this.targetIds[base + i] = NULL_ENTITY;
      this.eventTypes[base + i] = 0;
      this.timestamps[base + i] = 0.0;
    }
    this.counts[entityId] = 0;
    this.heads[entityId] = 0;
  }
}
