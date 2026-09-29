/**
 * DeathAuditReceipt.test.js
 * 帝国官僚验尸小票系统测试套件 (WP-4.3 §4.4)
 */

import { describe, it, expect, vi } from 'vitest';
import { DeathAuditReceipt } from '../../src/narrative/DeathAuditReceipt.js';

describe('DeathAuditReceipt Specification Suite (WP-4.3 §4.4)', () => {
  it('正确生成验尸小票结构化数据，核算抚恤金、债务扣缴与净发金额', () => {
    const receiptSystem = new DeathAuditReceipt();
    const data = receiptSystem.generateReceipt({
      entityId: 101,
      deceasedName: '奥格瑞玛·碎颅者',
      title: '先锋督军',
      factionName: '黑石部落',
      raceName: 'ORC',
      timestamp: 45.2,
      causeOfDeath: '右胸锁骨遭重铁战锤粉碎性贯穿',
      killerName: '雷霆行者',
      salvageValue: 20,
      pensionBase: 60,
      debtFood: 10,
      taxArrears: 15,
      burialFee: 25
    });

    expect(data.receiptNumber).toContain('IMP-AUDIT-');
    expect(data.deceasedName).toBe('奥格瑞玛·碎颅者');
    // 60 + 20 - 10 - 15 - 25 = 30
    expect(data.financialAudit.netPayout).toBe(30);
    expect(data.hasBloodPrint).toBe(true);
    expect(data.auditorStamp).toContain('帝国总审计署');
  });

  it('renderToCanvas 能够在 Canvas 2D 上执行绘制，包含印章与血手印', () => {
    const receiptSystem = new DeathAuditReceipt();
    const data = receiptSystem.generateReceipt({
      deceasedName: '测试长官'
    });

    const mockCtx = {
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      ellipse: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      setLineDash: vi.fn()
    };

    const mockCanvas = {
      getContext: vi.fn().mockReturnValue(mockCtx),
      toDataURL: vi.fn().mockReturnValue('data:image/png;base64,VALID_BASE64_DATA')
    };

    const ok = receiptSystem.renderToCanvas(mockCanvas, data);
    expect(ok).toBe(true);
    expect(mockCtx.fillRect).toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalled();
    expect(mockCtx.arc).toHaveBeenCalled(); // 公章
    expect(mockCtx.ellipse).toHaveBeenCalled(); // 血手印

    const dataUrl = receiptSystem.exportAsPngDataUrl(mockCanvas);
    expect(dataUrl).toContain('data:image/png');
  });

  it('在无原生 Canvas 环境下 exportAsPngDataUrl 能够优雅降级返回规范 DataURL', () => {
    const receiptSystem = new DeathAuditReceipt();
    receiptSystem.generateReceipt({ entityId: 88 });

    const fallbackUrl = receiptSystem.exportAsPngDataUrl(null);
    expect(fallbackUrl).toContain('data:image/png;base64,');
  });
});
