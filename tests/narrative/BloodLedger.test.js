/**
 * BloodLedger.test.js
 * 宿怨账本图谱与血仇追踪测试套件 (WP-4.3 §4.2)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { BloodLedger, GRUDGES_PER_ENTITY } from '../../src/narrative/BloodLedger.js';

describe('BloodLedger Specification Suite (WP-4.3 §4.2)', () => {
  let eventBus;
  let ledger;

  beforeEach(() => {
    eventBus = new DomainEventBus();
    ledger = new BloodLedger(eventBus);
  });

  it('正确添加仇怨记录并支持 hasGrudgeAgainst 查询', () => {
    ledger.addGrudge(10, 20, 0x8001, 15.5);
    expect(ledger.hasGrudgeAgainst(10, 20)).toBe(true);
    expect(ledger.hasGrudgeAgainst(10, 99)).toBe(false);
  });

  it('每个实体维持固定 3 条环形队列，超过 3 条时 FIFO 覆盖最旧条目', () => {
    const eid = 5;
    ledger.addGrudge(eid, 101, 1, 10.0);
    ledger.addGrudge(eid, 102, 2, 20.0);
    ledger.addGrudge(eid, 103, 3, 30.0);

    expect(ledger.counts[eid]).toBe(3);
    expect(ledger.hasGrudgeAgainst(eid, 101)).toBe(true);
    expect(ledger.hasGrudgeAgainst(eid, 102)).toBe(true);
    expect(ledger.hasGrudgeAgainst(eid, 103)).toBe(true);

    // 添加第 4 条，应覆盖最旧的 101
    ledger.addGrudge(eid, 104, 4, 40.0);
    expect(ledger.counts[eid]).toBe(3);
    expect(ledger.hasGrudgeAgainst(eid, 101)).toBe(false);
    expect(ledger.hasGrudgeAgainst(eid, 104)).toBe(true);
  });

  it('感知范围内发现仇敌时触发宿仇狂暴，派发 EVT_VENDETTA_TRIGGERED', () => {
    const eid = 7;
    const enemyId = 88;
    ledger.addGrudge(eid, enemyId, 0x8005, 5.0);

    let triggered = false;
    eventBus.subscribe(DomainEvents.EVT_VENDETTA_TRIGGERED, (type, src, dst, tick) => {
      triggered = true;
      expect(src).toBe(eid);
      expect(dst).toBe(enemyId);
      expect(tick).toBe(120);
    });

    const nearby = new Int32Array([12, 34, enemyId, 90]);
    const detected = ledger.checkVendetta(eid, nearby, nearby.length, 120);
    eventBus.flush();

    expect(detected).toBe(enemyId);
    expect(triggered).toBe(true);

    const narrative = ledger.generateVendettaNarrative(eid, enemyId);
    expect(narrative).toContain('【宿怨对账】');
  });

  it('clear 能够重置该实体的所有仇恨记录', () => {
    ledger.addGrudge(3, 4, 1, 10.0);
    expect(ledger.hasGrudgeAgainst(3, 4)).toBe(true);

    ledger.clear(3);
    expect(ledger.hasGrudgeAgainst(3, 4)).toBe(false);
    expect(ledger.counts[3]).toBe(0);
  });
});
