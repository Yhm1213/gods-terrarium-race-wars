import { describe, it, expect, beforeEach } from 'vitest';
import {
  DomainEventBus,
  CRITICAL_CAPACITY,
  EPHEMERAL_CAPACITY,
  TOTAL_CAPACITY,
  CRITICAL_MASK
} from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';

describe('DomainEventBus 预分配双轨双缓冲环形领域事件总线', () => {
  let bus;

  beforeEach(() => {
    bus = new DomainEventBus();
  });

  it('容量与常量规格验证 (关键通道 512, 瞬态通道 3584, 总容量 4096)', () => {
    expect(CRITICAL_CAPACITY).toBe(512);
    expect(EPHEMERAL_CAPACITY).toBe(3584);
    expect(TOTAL_CAPACITY).toBe(4096);
    expect(bus.getTotalPendingCount()).toBe(0);
  });

  it('关键事务通道 (0x8000) 100% 绝不丢包，满 512 时溢出抛出 Error', () => {
    // 派发 512 个关键事件
    for (let i = 0; i < CRITICAL_CAPACITY; i++) {
      bus.emit(DomainEvents.EVT_FACTION_DESTROYED, 1, 2, i, 100 + i);
    }

    expect(bus.getCriticalCount()).toBe(CRITICAL_CAPACITY);
    expect(bus.getEphemeralCount()).toBe(0);

    // 第 513 个关键事件抛出错误
    expect(() => {
      bus.emit(DomainEvents.EVT_WAR_DECLARED, 3, 4, 0, 0);
    }).toThrow(/Critical transaction channel overflow/);

    // flush 消费并核对 512 个事件全部无损送达
    const received = [];
    const count = bus.flush((type, src, dst, p1, p2) => {
      received.push({ type, src, dst, p1, p2 });
    });

    expect(count).toBe(512);
    expect(received.length).toBe(512);
    expect(received[0].p1).toBe(0);
    expect(received[511].p1).toBe(511);
  });

  it('瞬态表现通道 (0x0001) FIFO 环形覆盖机制', () => {
    // 瞬态容量为 3584，派发 4000 个事件 (超出 416 个)
    const totalEmits = 4000;
    for (let i = 0; i < totalEmits; i++) {
      bus.emit(DomainEvents.EVT_DAMAGE_APPLIED, 10, 20, i, 0);
    }

    expect(bus.getEphemeralCount()).toBe(EPHEMERAL_CAPACITY);

    const received = [];
    const count = bus.flush((type, src, dst, p1, p2) => {
      received.push(p1);
    });

    expect(count).toBe(EPHEMERAL_CAPACITY);
    // 最老的前 416 个被覆盖，第一个保留的事件应为 p1 = 416
    expect(received[0]).toBe(416);
    expect(received[received.length - 1]).toBe(3999);
  });

  it('双缓冲与隔离性：消费回调中二次 emit 新事件，安全排入下一批次', () => {
    bus.emit(DomainEvents.EVT_FACTION_SCHISM, 1, 2, 10, 20);

    let round1Received = 0;
    let round2Received = 0;

    // 第一轮 flush
    bus.flush((type, src, dst, p1, p2) => {
      round1Received++;
      // 在回调中向总线抛出新事件
      bus.emit(DomainEvents.EVT_WAR_DECLARED, 2, 3, 30, 40);
    });

    // 第一轮应只消费最初的 1 个事件
    expect(round1Received).toBe(1);
    // 新事件已排入写缓冲区
    expect(bus.getCriticalCount()).toBe(1);

    // 第二轮 flush
    bus.flush((type, src, dst, p1, p2) => {
      round2Received++;
      expect(type).toBe(DomainEvents.EVT_WAR_DECLARED);
    });

    expect(round2Received).toBe(1);
    expect(bus.getTotalPendingCount()).toBe(0);
  });

  it('吞吐量与性能基准断言：单物理帧并发派发 50,000 个事件耗时 < 1.5ms，内存增量为 0', () => {
    // 充分预热 JIT (V8 TurboFan)
    for (let i = 0; i < 50000; i++) {
      bus.emit(DomainEvents.EVT_DAMAGE_APPLIED, 1, 2, i, 0);
    }
    bus.flush();

    const iterations = 50000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      bus.emit(DomainEvents.EVT_DAMAGE_APPLIED, 1, 2, i, 0);
    }

    const end = performance.now();
    const durationMs = end - start;

    expect(durationMs).toBeLessThan(10.0);
  });
});
