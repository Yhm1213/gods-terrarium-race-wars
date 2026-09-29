/**
 * ContextSlabPool.test.js
 * 纯值快照 DTO 环形缓冲池测试套件 (WP-4.3 §4.5)
 */

import { describe, it, expect } from 'vitest';
import {
  ContextSlabPool,
  ContextSlab,
  SLAB_CAPACITY
} from '../../src/narrative/ContextSlabPool.js';

describe('ContextSlabPool Specification Suite (WP-4.3 §4.5)', () => {
  it('预分配固定容量 256 槽位，初始全部处于可用状态', () => {
    const pool = new ContextSlabPool();
    expect(pool.capacity).toBe(SLAB_CAPACITY);
    expect(pool.getAvailableCount()).toBe(SLAB_CAPACITY);
    expect(pool.getActiveCount()).toBe(0);
  });

  it('正确借出 Slab，标记 inUse 并扣减可用数', () => {
    const pool = new ContextSlabPool(4);
    const s1 = pool.borrow();
    const s2 = pool.borrow();

    expect(s1).not.toBeNull();
    expect(s2).not.toBeNull();
    expect(s1.inUse).toBe(true);
    expect(s2.inUse).toBe(true);
    expect(pool.getAvailableCount()).toBe(2);
    expect(pool.getActiveCount()).toBe(2);
  });

  it('归还 Slab 原地 reset 字段，并重新入栈复用', () => {
    const pool = new ContextSlabPool(2);
    const s = pool.borrow();
    s.eventType = 0x8001;
    s.isCritical = true;
    s.textA = 'Anatomist report';

    pool.release(s);
    expect(s.inUse).toBe(false);
    expect(s.eventType).toBe(0);
    expect(s.isCritical).toBe(false);
    expect(s.textA).toBe('');
    expect(pool.getAvailableCount()).toBe(2);

    // 重新借出应复用同一实例
    const reused = pool.borrow();
    expect(reused.poolIndex).toBe(s.poolIndex);
  });

  it('当池耗尽时 borrow 返回 null', () => {
    const pool = new ContextSlabPool(1);
    const s1 = pool.borrow();
    expect(s1).not.toBeNull();

    const s2 = pool.borrow();
    expect(s2).toBeNull();
  });
});
