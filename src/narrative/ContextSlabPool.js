/**
 * ContextSlabPool.js
 * 纯值快照 DTO 环形缓冲池
 * 严格遵照 SPEC-M4-CONTRACT §4.5
 *
 * 核心机制:
 * 1. 预分配固定 256 槽位纯值对象池
 * 2. 借出 (borrow) 与归还 (release)，原地 reset()
 * 3. 严格物理零 GC，热路径严禁 new Object()
 */

export const SLAB_CAPACITY = 256;

export class ContextSlab {
  /**
   * @param {number} poolIndex 
   */
  constructor(poolIndex) {
    this.poolIndex = poolIndex;
    this.inUse = false;

    // 核心事件参数
    this.eventType = 0;
    this.srcEntityId = 0;
    this.dstEntityId = 0;
    this.param1 = 0;
    this.param2 = 0;
    this.timestamp = 0.0;

    // 关键上下文修饰标记
    this.isCritical = false;
    this.isMutilation = false;
    this.isRegicide = false;
    this.isMiracle = false;

    // 三声道文案缓存 (复用字符串引用)
    this.textA = ''; // 解剖学法医
    this.textB = ''; // 崇高虚无诗人
    this.textC = ''; // 冷酷官僚审计员
  }

  /**
   * 原地重置所有字段，零 GC 准备下一次借出
   */
  reset() {
    this.inUse = false;
    this.eventType = 0;
    this.srcEntityId = 0;
    this.dstEntityId = 0;
    this.param1 = 0;
    this.param2 = 0;
    this.timestamp = 0.0;
    this.isCritical = false;
    this.isMutilation = false;
    this.isRegicide = false;
    this.isMiracle = false;
    this.textA = '';
    this.textB = '';
    this.textC = '';
  }
}

export class ContextSlabPool {
  /**
   * @param {number} [capacity=SLAB_CAPACITY] 
   */
  constructor(capacity = SLAB_CAPACITY) {
    this.capacity = capacity;
    this.slabs = new Array(capacity);
    this.freeStack = new Int32Array(capacity);
    this.freeCount = capacity;

    for (let i = 0; i < capacity; i++) {
      this.slabs[i] = new ContextSlab(i);
      this.freeStack[i] = capacity - 1 - i;
    }
  }

  /**
   * 从池中租借一个空闲 Slab
   * @returns {ContextSlab|null} 若池耗尽则返回 null
   */
  borrow() {
    if (this.freeCount <= 0) {
      return null;
    }

    const index = this.freeStack[--this.freeCount];
    const slab = this.slabs[index];
    slab.inUse = true;
    return slab;
  }

  /**
   * 归还已借出的 Slab 回池
   * @param {ContextSlab} slab 
   */
  release(slab) {
    if (!slab || !slab.inUse) return;
    if (slab.poolIndex < 0 || slab.poolIndex >= this.capacity) return;

    slab.reset();
    this.freeStack[this.freeCount++] = slab.poolIndex;
  }

  /**
   * 当前可用空闲 Slab 数量
   * @returns {number}
   */
  getAvailableCount() {
    return this.freeCount;
  }

  /**
   * 当前正在使用中的 Slab 数量
   * @returns {number}
   */
  getActiveCount() {
    return this.capacity - this.freeCount;
  }
}
