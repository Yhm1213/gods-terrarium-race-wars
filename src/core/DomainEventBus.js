/**
 * DomainEventBus.js
 * 零 GC 预分配双轨双缓冲环形领域事件总线
 * 严格遵循 TDS v1.1 第 5.1/5.2 节与 WBS WP-1.1.3 规范
 * 
 * 关键事务通道 (0x8000 起始): 容量 512，100% 绝对不丢包
 * 瞬态表现通道 (0x0001 起始): 容量 3584，FIFO 覆盖降频
 * 定长平铺连续内存: Int32Array(4096 * 5)，单事件由 5 个整型字构成 [Type, Src, Dst, P1, P2]
 */

export const CRITICAL_CAPACITY = 512;
export const EPHEMERAL_CAPACITY = 3584;
export const TOTAL_CAPACITY = CRITICAL_CAPACITY + EPHEMERAL_CAPACITY; // 4096
export const EVENT_STRIDE = 5;
export const BUFFER_INTS = TOTAL_CAPACITY * EVENT_STRIDE; // 20480
export const CRITICAL_OFFSET = CRITICAL_CAPACITY * EVENT_STRIDE; // 2560
export const REENTRANT_INTS = CRITICAL_CAPACITY * EVENT_STRIDE; // 2560

export const CRITICAL_MASK = 0x8000;

// 事件字段偏移量
export const EVT_OFFSET_TYPE = 0;
export const EVT_OFFSET_SRC = 1;
export const EVT_OFFSET_TARGET = 2;
export const EVT_OFFSET_P1 = 3;
export const EVT_OFFSET_P2 = 4;

export class DomainEventBus {
  constructor() {
    // 主事件通道平铺连续 TypedArray (4096 * 5 * 4 = 80KB，常驻零 GC)
    this.bufferA = new Int32Array(BUFFER_INTS);
    // 重入安全隔离缓冲区 (512 * 5 * 4 = 10KB，仅供 flush 消费期间重入暂存)
    this.bufferB = new Int32Array(REENTRANT_INTS);
    this.activeBuffer = this.bufferA;

    // 当前写缓冲区的通道水位与环形游标
    this.critCount = 0;
    this.ephemCount = 0;
    this._ephemOffset = CRITICAL_OFFSET; // 字节级整型偏移 (2560 起始)

    // 重入暂存计数
    this.reentrantCount = 0;
    this.isFlushing = false;

    // 订阅回调映射表
    this.listeners = new Map();
    this.globalListeners = new Set();
  }

  get ephemHead() {
    return ((this._ephemOffset - CRITICAL_OFFSET) / EVENT_STRIDE) | 0;
  }

  set ephemHead(val) {
    this._ephemOffset = CRITICAL_OFFSET + val * EVENT_STRIDE;
  }

  /**
   * 测算 DomainEventBus 静态常驻连续内存字节总数
   * @returns {number} 字节总数 (80KB 主缓冲 + 10KB 重入缓冲 = 90KB)
   */
  calculateMemoryUsageBytes() {
    return this.bufferA.byteLength + this.bufferB.byteLength;
  }

  /**
   * 派发一个领域事件 (绝对零 GC)
   * @param {number} eventType - 16位事件类型枚举
   * @param {number} [srcId=0] - 触发源实体 ID
   * @param {number} [targetId=0] - 目标实体 ID
   * @param {number} [p1=0] - 核心整型参数 1
   * @param {number} [p2=0] - 核心整型参数 2
   * @returns {void}
   */
  emit(eventType, srcId = 0, targetId = 0, p1 = 0, p2 = 0) {
    // flush 期间重入保护：安全排入二级缓冲区，绝不引发同步重入
    if (this.isFlushing) {
      if (this.reentrantCount >= CRITICAL_CAPACITY) {
        if ((eventType & CRITICAL_MASK) !== 0) {
          throw new Error(`[DomainEventBus] Reentrant critical event buffer overflow (cap: ${CRITICAL_CAPACITY})`);
        }
        return;
      }
      const off = this.reentrantCount * EVENT_STRIDE;
      const b = this.bufferB;
      b[off] = eventType;
      b[off + 1] = srcId;
      b[off + 2] = targetId;
      b[off + 3] = p1;
      b[off + 4] = p2;
      this.reentrantCount++;
      return;
    }

    if ((eventType & CRITICAL_MASK) === 0) {
      // 瞬态表现通道热路径
      const off = this._ephemOffset;
      const b = this.activeBuffer;

      b[off] = eventType;
      b[off + 1] = srcId;
      b[off + 2] = targetId;
      b[off + 3] = p1;
      b[off + 4] = p2;

      let next = off + EVENT_STRIDE;
      if (next === BUFFER_INTS) {
        next = CRITICAL_OFFSET;
      }
      this._ephemOffset = next;

      if (this.ephemCount < EPHEMERAL_CAPACITY) {
        this.ephemCount++;
      }
    } else {
      // 关键事务通道冷路径 (512 容量，绝对不丢包)
      const crit = this.critCount;
      if (crit >= CRITICAL_CAPACITY) {
        throw new Error(
          `Critical transaction channel overflow! Maximum capacity is ${CRITICAL_CAPACITY}. Event: 0x${eventType.toString(16)}`
        );
      }

      const off = crit * EVENT_STRIDE;
      const b = this.activeBuffer;

      b[off] = eventType;
      b[off + 1] = srcId;
      b[off + 2] = targetId;
      b[off + 3] = p1;
      b[off + 4] = p2;

      this.critCount = crit + 1;
    }
  }

  /**
   * 注册事件订阅者
   * @param {number} eventType - 目标事件类型，传入 0 表示订阅全量事件
   * @param {Function} callback - 回调函数 (type, src, dst, p1, p2)
   */
  subscribe(eventType, callback) {
    if (eventType === 0) {
      this.globalListeners.add(callback);
      return;
    }
    let set = this.listeners.get(eventType);
    if (!set) {
      set = new Set();
      this.listeners.set(eventType, set);
    }
    set.add(callback);
  }

  /**
   * 取消事件订阅
   * @param {number} eventType 
   * @param {Function} callback 
   */
  unsubscribe(eventType, callback) {
    if (eventType === 0) {
      this.globalListeners.delete(callback);
      return;
    }
    const set = this.listeners.get(eventType);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(eventType);
      }
    }
  }

  /**
   * 刷新并分发当前批次事件给消费者 (双缓冲原子切换与重入隔离)
   * @param {function(number, number, number, number, number): void} [consumerCallback] 可选批量消费回调
   * @returns {number} 本次分发处理的总事件数
   */
  flush(consumerCallback = null) {
    const critCount = this.critCount;
    const ephemCount = this.ephemCount;

    if (critCount === 0 && ephemCount === 0) {
      return 0;
    }

    const readBuf = this.activeBuffer;
    const ephemHead = this.ephemHead;

    this.isFlushing = true;
    this.critCount = 0;
    this.ephemCount = 0;
    this._ephemOffset = CRITICAL_OFFSET;

    // 1. 消费关键事务通道事件 (100% 完整交付)
    for (let i = 0; i < critCount; i++) {
      const offset = i * EVENT_STRIDE;
      const type = readBuf[offset];
      const src = readBuf[offset + 1];
      const dst = readBuf[offset + 2];
      const p1 = readBuf[offset + 3];
      const p2 = readBuf[offset + 4];

      if (consumerCallback) {
        consumerCallback(type, src, dst, p1, p2);
      } else {
        this._dispatch(type, src, dst, p1, p2);
      }
    }

    // 2. 消费瞬态表现通道事件 (按 FIFO 环形时序交付)
    const startSlot = (ephemCount >= EPHEMERAL_CAPACITY) ? ephemHead : 0;
    for (let j = 0; j < ephemCount; j++) {
      let slot = startSlot + j;
      if (slot >= EPHEMERAL_CAPACITY) {
        slot -= EPHEMERAL_CAPACITY;
      }
      const offset = CRITICAL_OFFSET + slot * EVENT_STRIDE;
      const type = readBuf[offset];
      const src = readBuf[offset + 1];
      const dst = readBuf[offset + 2];
      const p1 = readBuf[offset + 3];
      const p2 = readBuf[offset + 4];

      if (consumerCallback) {
        consumerCallback(type, src, dst, p1, p2);
      } else {
        this._dispatch(type, src, dst, p1, p2);
      }
    }

    this.isFlushing = false;

    // 3. 将 flush 期间重入产生的事件平移至主写缓冲，安全排入下一批次
    if (this.reentrantCount > 0) {
      const rCount = this.reentrantCount;
      const bReentrant = this.bufferB;
      for (let k = 0; k < rCount; k++) {
        const off = k * EVENT_STRIDE;
        this.emit(
          bReentrant[off],
          bReentrant[off + 1],
          bReentrant[off + 2],
          bReentrant[off + 3],
          bReentrant[off + 4]
        );
      }
      this.reentrantCount = 0;
    }

    return critCount + ephemCount;
  }

  /**
   * 内部事件广播分发
   * @private
   */
  _dispatch(type, src, dst, p1, p2) {
    const specificListeners = this.listeners.get(type);
    if (specificListeners && specificListeners.size > 0) {
      for (const cb of specificListeners) {
        try {
          cb(type, src, dst, p1, p2);
        } catch (err) {
          console.error('[DomainEventBus] Dispatch error in listener:', err);
        }
      }
    }
    if (this.globalListeners.size > 0) {
      for (const cb of this.globalListeners) {
        try {
          cb(type, src, dst, p1, p2);
        } catch (err) {
          console.error('[DomainEventBus] Dispatch error in listener:', err);
        }
      }
    }
  }

  /**
   * 当前写缓冲中待消费的关键事件数
   * @returns {number}
   */
  getCriticalCount() {
    return this.critCount;
  }

  /**
   * 当前写缓冲中待消费的瞬态事件数
   * @returns {number}
   */
  getEphemeralCount() {
    return this.ephemCount;
  }

  /**
   * 当前写缓冲中待消费的全部事件数
   * @returns {number}
   */
  getTotalPendingCount() {
    return this.critCount + this.ephemCount;
  }

  /**
   * 清空所有通道与双缓冲
   */
  clear() {
    this.critCount = 0;
    this.ephemCount = 0;
    this._ephemOffset = CRITICAL_OFFSET;
    this.reentrantCount = 0;
  }
}
