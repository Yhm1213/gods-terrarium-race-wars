/**
 * MegaAtlasDollCache.test.js
 * 1024x1024 离屏图集享元签名缓存单元测试套件
 * 严格遵照 SPEC-M4-CONTRACT §5.1 与 QA 规范
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MegaAtlasDollCache,
  ATLAS_SIZE,
  SLOT_SIZE,
  SLOTS_PER_ROW,
  MAX_SLOTS,
  COLOR_EYE,
  COLOR_CASTE_ARTISAN_MARK,
  COLOR_CASTE_SOLDIER_MARK,
  COLOR_CASTE_LEADER_CROWN,
  COLOR_ORGAN_WING_STAMP,
  COLOR_ORGAN_FLAME_STAMP,
  COLOR_ORGAN_GRANITE_STAMP,
  COLOR_ORGAN_HOLY_STAMP
} from '../../src/rendering/MegaAtlasDollCache.js';

import { OrganFlags } from '../../src/data/MutationFlags.js';
import { CasteType } from '../../src/components/SocialCasteComponent.js';

// 创建 Mock Canvas 与 2D 上下文
function createMockCanvas() {
  const calls = {
    fillRect: [],
    drawImage: [],
    clearRect: []
  };

  const ctx = {
    fillStyle: '#000000',
    fillRect: vi.fn((x, y, w, h) => {
      calls.fillRect.push({ x, y, w, h, fillStyle: ctx.fillStyle });
    }),
    drawImage: vi.fn((img, sx, sy, sw, sh, dx, dy, dw, dh) => {
      calls.drawImage.push({ sx, sy, sw, sh, dx, dy, dw, dh });
    }),
    clearRect: vi.fn((x, y, w, h) => {
      calls.clearRect.push({ x, y, w, h });
    })
  };

  const canvas = {
    width: ATLAS_SIZE,
    height: ATLAS_SIZE,
    getContext: vi.fn(() => ctx)
  };

  return { canvas, ctx, calls };
}

describe('MegaAtlasDollCache 享元图集规格与烘焙测试套件', () => {
  let mockAtlas;
  let cache;

  beforeEach(() => {
    mockAtlas = createMockCanvas();
    cache = new MegaAtlasDollCache(mockAtlas.canvas);
  });

  describe('1. 图集分辨率、网格尺寸与槽位预分配断言', () => {
    it('图集规格严格对齐 1024x1024 与 24x24 槽位', () => {
      expect(ATLAS_SIZE).toBe(1024);
      expect(SLOT_SIZE).toBe(24);
      expect(SLOTS_PER_ROW).toBe(42);
      expect(MAX_SLOTS).toBe(1764);
      expect(cache.canvas.width).toBe(1024);
      expect(cache.canvas.height).toBe(1024);
    });

    it('1764 槽位坐标完全预计算，无实时计算开销', () => {
      expect(cache.slotCoordsX.length).toBe(MAX_SLOTS);
      expect(cache.slotCoordsY.length).toBe(MAX_SLOTS);

      // 第 0 槽位
      expect(cache.slotCoordsX[0]).toBe(0);
      expect(cache.slotCoordsY[0]).toBe(0);

      // 第 1 槽位
      expect(cache.slotCoordsX[1]).toBe(24);
      expect(cache.slotCoordsY[1]).toBe(0);

      // 第 42 槽位 (第 2 行第 0 列)
      expect(cache.slotCoordsX[42]).toBe(0);
      expect(cache.slotCoordsY[42]).toBe(24);

      // 最后一槽位 (41, 41)
      expect(cache.slotCoordsX[MAX_SLOTS - 1]).toBe(41 * 24);
      expect(cache.slotCoordsY[MAX_SLOTS - 1]).toBe(41 * 24);
    });
  });

  describe('2. 外观签名哈希与享元复用断言', () => {
    it('相同外观生成唯一签名，并完全复用同一图集槽位', () => {
      const key1 = cache.getAppearanceKey(1, 2, 0);
      const key2 = cache.getAppearanceKey(1, 2, 0);
      expect(key1).toBe(key2);

      const doll1 = cache.getOrBake(1, 2, 0);
      expect(cache.getBakedCount()).toBe(1);
      expect(doll1.slotIndex).toBe(0);

      // 再次获取同一外观，不占用新槽位
      const doll2 = cache.getOrBake(1, 2, 0);
      expect(cache.getBakedCount()).toBe(1);
      expect(doll2.slotIndex).toBe(0);
      expect(doll2.sx).toBe(0);
      expect(doll2.sy).toBe(0);
    });

    it('不同种族、阶级或突变器官分别分配不同槽位', () => {
      const dollA = cache.getOrBake(0, 0, 0, {}); // 种族0 平民 野生型
      const dollB = cache.getOrBake(1, 0, 0, {}); // 种族1 平民 野生型
      const dollC = cache.getOrBake(0, 1, 0, {}); // 种族0 工匠 野生型
      const dollD = cache.getOrBake(0, 0, OrganFlags.WING, {}); // 种族0 平民 带翅膀

      expect(cache.getBakedCount()).toBe(4);
      expect(dollA.slotIndex).toBe(0);
      expect(dollB.slotIndex).toBe(1);
      expect(dollC.slotIndex).toBe(2);
      expect(dollD.slotIndex).toBe(3);
    });
  });

  describe('3. 4 层离屏烘焙像素细节断言', () => {
    it('烘焙执行 4 层拼绘：骨骼、种族主色与眼睛、阶级、突变', () => {
      mockAtlas.calls.fillRect = [];

      // 烘焙一个士兵 (Caste 2) 带 WING + FLAME 突变
      cache.getOrBake(3, 2, OrganFlags.WING | OrganFlags.FLAME);

      const fills = mockAtlas.calls.fillRect;
      expect(fills.length).toBeGreaterThanOrEqual(5);

      // Layer 1: 骨骼暗部
      const boneFill = fills.find(f => f.fillStyle === 'rgba(0, 0, 0, 0.25)');
      expect(boneFill).toBeDefined();

      // Layer 2: 眼睛像素
      const eyeFill = fills.find(f => f.fillStyle === COLOR_EYE);
      expect(eyeFill).toBeDefined();

      // Layer 3: 士兵装备
      const soldierFill = fills.find(f => f.fillStyle === COLOR_CASTE_SOLDIER_MARK);
      expect(soldierFill).toBeDefined();

      // Layer 4: 羽翼与烈焰
      const wingFill = fills.find(f => f.fillStyle === COLOR_ORGAN_WING_STAMP);
      const flameFill = fills.find(f => f.fillStyle === COLOR_ORGAN_FLAME_STAMP);
      expect(wingFill).toBeDefined();
      expect(flameFill).toBeDefined();
    });

    it('领袖烘焙金色王冠，工匠烘焙铁灰色装备', () => {
      mockAtlas.calls.fillRect = [];
      cache.getOrBake(0, CasteType.LEADER, 0);
      const leaderCrown = mockAtlas.calls.fillRect.find(f => f.fillStyle === COLOR_CASTE_LEADER_CROWN);
      expect(leaderCrown).toBeDefined();

      mockAtlas.calls.fillRect = [];
      cache.getOrBake(0, CasteType.ARTISAN, 0);
      const artisanMark = mockAtlas.calls.fillRect.find(f => f.fillStyle === COLOR_CASTE_ARTISAN_MARK);
      expect(artisanMark).toBeDefined();
    });
  });

  describe('4. 单次 drawImage 贴图与千人极速性能断言', () => {
    it('drawDoll 仅调用一次 ctx.drawImage，中心精准对齐目标点', () => {
      const targetCtx = createMockCanvas().ctx;
      const targetCalls = [];
      targetCtx.drawImage = vi.fn((img, sx, sy, sw, sh, dx, dy, dw, dh) => {
        targetCalls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
      });

      // 在 (100, 200) 处绘制
      cache.drawDoll(targetCtx, 100, 200, 1, 2, OrganFlags.GRANITE);

      expect(targetCalls.length).toBe(1);
      const call = targetCalls[0];
      expect(call.sw).toBe(24);
      expect(call.sh).toBe(24);
      expect(call.dx).toBe(100 - 12);
      expect(call.dy).toBe(200 - 12);
      expect(call.dw).toBe(24);
      expect(call.dh).toBe(24);
    });

    it('千人连续贴图渲染耗时稳健 < 1.8ms (LL-007 防抖动)', () => {
      const targetCtx = {
        drawImage: () => {}
      };

      // 预先向缓存注入 150 种高频外观
      for (let i = 0; i < 150; i++) {
        cache.getOrBake(i % 12, i % 4, (i * 7) & 0x3F);
      }

      // JIT 预热 50 轮
      for (let w = 0; w < 50; w++) {
        for (let i = 0; i < 1000; i++) {
          cache.drawDoll(targetCtx, (i * 3) % 1344, (i * 5) % 864, i % 12, i % 4, (i * 7) & 0x3F);
        }
      }

      // 采样 100 轮
      const t0 = performance.now();
      const samples = 100;
      for (let s = 0; s < samples; s++) {
        for (let i = 0; i < 1000; i++) {
          cache.drawDoll(targetCtx, (i * 3) % 1344, (i * 5) % 864, i % 12, i % 4, (i * 7) & 0x3F);
        }
      }
      const avgMs = (performance.now() - t0) / samples;

      // 断言单次千人贴图平均耗时 < 1.8ms (设定 CI 容错上限 1.8ms，通常在 0.2ms~0.5ms)
      expect(avgMs).toBeLessThan(1.8);
    });
  });
});
