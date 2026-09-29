/**
 * MindCabinet.test.js
 * 极乐迪斯科风濒死思维阁测试套件 (WP-4.3 §4.3)
 */

import { describe, it, expect } from 'vitest';
import { MindCabinet, MindVoiceType } from '../../src/narrative/MindCabinet.js';

describe('MindCabinet Specification Suite (WP-4.3 §4.3)', () => {
  it('正确触发领袖濒死思维阁，生成四大潜意识声部结构化 DTO', () => {
    const cabinet = new MindCabinet();
    const dto = cabinet.triggerCabinet(1, 99, 120.5, {
      raceName: 'DWARF',
      factionName: '铁砧帝国'
    });

    expect(dto).not.toBeNull();
    expect(dto.leaderEntityId).toBe(1);
    expect(dto.killerEntityId).toBe(99);
    expect(dto.dialogue.length).toBe(4);

    const [vA, vB, vC, vD] = dto.dialogue;
    expect(vA.voice).toBe(MindVoiceType.REPTILIAN_BRAIN);
    expect(vA.speaker).toBe('古老爬行脑');
    expect(vA.text).toContain('烂泥');

    expect(vB.voice).toBe(MindVoiceType.AMBITIOUS_WILL);
    expect(vB.text).toContain('战斧');

    expect(vC.voice).toBe(MindVoiceType.APPETITE);
    expect(vC.text).toContain('蓝莓甜酒');

    expect(vD.voice).toBe(MindVoiceType.PHYSICAL_INSTRUMENT);
    expect(vD.text).toContain('第四颈椎');
  });

  it('打字机游标计算器按设定速率推进字符长度', () => {
    const textLen = 50;
    // 0 秒时为 0
    expect(MindCabinet.calculateTypewriterCursor(0, 20, textLen)).toBe(0);
    // 1 秒时为 20 字
    expect(MindCabinet.calculateTypewriterCursor(1.0, 20, textLen)).toBe(20);
    // 3 秒时 60 字超出 50，截断为 50
    expect(MindCabinet.calculateTypewriterCursor(3.0, 20, textLen)).toBe(50);
  });
});
