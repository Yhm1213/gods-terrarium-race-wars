/**
 * MiniRenderer.test.js
 * Milestone 1 极简 Canvas 渲染管线单元测试套件
 * 严格遵照 TDS v1.1 与 QA 规范：断言 60 FPS 渲染管线、零 GC 铁律与 0 次 save/restore
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MiniRenderer,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_SIZE,
  TOTAL_TILES,
  BiomeTypes,
  BIOME_COLOR_PALETTE,
  RACE_COLORS,
  FarmStages
} from '../../src/rendering/MiniRenderer.js';

import {
  ECS,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER,
  PHY_OFFSET_EMERGENCY_LOCK,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../../src/core/ECS.js';

import {
  IS_ALIVE,
  IS_LEADER,
  IS_EMERGENCY_LOCK,
  IN_COMBAT
} from '../../src/components/UnitStatusFlags.js';

// 创建 Mock Canvas 与 2D Context
function createMockCanvas() {
  const contextCalls = {
    fillRect: [],
    drawImage: [],
    strokeRect: [],
    save: 0,
    restore: 0,
    beginPath: 0,
    stroke: 0
  };

  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    fillRect: vi.fn((x, y, w, h) => {
      contextCalls.fillRect.push({ x, y, w, h });
    }),
    strokeRect: vi.fn((x, y, w, h) => {
      contextCalls.strokeRect.push({ x, y, w, h });
    }),
    drawImage: vi.fn(() => {
      contextCalls.drawImage.push(true);
    }),
    save: vi.fn(() => {
      contextCalls.save++;
    }),
    restore: vi.fn(() => {
      contextCalls.restore++;
    }),
    beginPath: vi.fn(() => {
      contextCalls.beginPath++;
    }),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(() => {
      contextCalls.stroke++;
    })
  };

  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx)
  };

  return { canvas, ctx, contextCalls };
}

describe('MiniRenderer Pipeline & Zero-GC Specification Suite', () => {
  let mock;
  let renderer;
  let ecs;
  let mockWorld;

  beforeEach(() => {
    mock = createMockCanvas();
    renderer = new MiniRenderer(mock.canvas);
    ecs = new ECS();

    // 构造 56x36 瓦片模拟世界
    mockWorld = {
      tiles: new Uint8Array(TOTAL_TILES),
      nutrients: new Float32Array(TOTAL_TILES)
    };

    // 填充平原与山地
    mockWorld.tiles.fill(BiomeTypes.PLAINS);
    for (let i = 0; i < 56; i++) {
      mockWorld.tiles[i] = BiomeTypes.MOUNTAINS; // 第一排山脉
    }
    // 养分分布
    mockWorld.nutrients.fill(0.35);
  });

  describe('1. 画布物理分辨率与基础调色板规格断言', () => {
    it('画布分辨率严格对齐 1344 x 864，瓦片规格 56 x 36 x 24px', () => {
      expect(renderer.width).toBe(1344);
      expect(renderer.height).toBe(864);
      expect(mock.canvas.width).toBe(1344);
      expect(mock.canvas.height).toBe(864);
      expect(WORLD_WIDTH).toBe(1344);
      expect(WORLD_HEIGHT).toBe(864);
      expect(GRID_WIDTH * TILE_SIZE).toBe(1344);
      expect(GRID_HEIGHT * TILE_SIZE).toBe(864);
      expect(TOTAL_TILES).toBe(2016);
    });

    it('生物群系调色板完整覆盖 7 种指定颜色', () => {
      expect(BIOME_COLOR_PALETTE.length).toBeGreaterThanOrEqual(7);
      expect(BIOME_COLOR_PALETTE[BiomeTypes.PLAINS]).toBe('#4a8505');      // 平原绿
      expect(BIOME_COLOR_PALETTE[BiomeTypes.MOUNTAINS]).toBe('#736d71');   // 高山灰
      expect(BIOME_COLOR_PALETTE[BiomeTypes.SHALLOW_WATER]).toBe('#3a7b9c'); // 浅水蓝
      expect(BIOME_COLOR_PALETTE[BiomeTypes.DEEP_WATER]).toBe('#163854');  // 深水深蓝
      expect(BIOME_COLOR_PALETTE[BiomeTypes.SWAMP]).toBe('#6a327a');       // 沼泽紫
      expect(BIOME_COLOR_PALETTE[BiomeTypes.VOLCANO]).toBe('#c62828');     // 熔岩红
      expect(BIOME_COLOR_PALETTE[BiomeTypes.HOLY_SPRING]).toBe('#ffd700'); // 神泉金
    });

    it('12 始祖种族主色调点阵调色板完备且各不相同', () => {
      expect(RACE_COLORS.length).toBe(12);
      const uniqueColors = new Set(RACE_COLORS);
      expect(uniqueColors.size).toBe(12);
      expect(RACE_COLORS[0]).toBe('#4ade80'); // ORC 绿皮菌兽
      expect(RACE_COLORS[1]).toBe('#60a5fa'); // ELF 森灵树民
      expect(RACE_COLORS[2]).toBe('#38bdf8'); // HUMAN 人类帝国
    });
  });

  describe('2. 零 GC 性能铁律与 0 次 save/restore 守门断言', () => {
    it('主渲染循环 render() 期间绝对 0 次调用 ctx.save() 与 ctx.restore()', () => {
      // 分配 50 个活跃实体
      for (let i = 0; i < 50; i++) {
        const eid = ecs.allocateEntity();
        ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 100 + i * 10;
        ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 200 + i * 5;
        ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = (i % 12) + 1;
        ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 80;
        ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_MAX] = 100;
      }

      const farmlands = [
        { tileX: 5, tileY: 5, stage: FarmStages.SPROUT },
        { tileX: 10, tileY: 5, stage: FarmStages.MATURE }
      ];

      // 执行渲染
      renderer.render(mockWorld, ecs, farmlands);

      // 验证守门铁律: 0 save, 0 restore
      expect(mock.contextCalls.save).toBe(0);
      expect(mock.contextCalls.restore).toBe(0);
      expect(mock.ctx.save).not.toHaveBeenCalled();
      expect(mock.ctx.restore).not.toHaveBeenCalled();
    });

    it('连续执行 100 帧渲染循环，内存无逃逸泄漏', () => {
      // 生成 100 个实体
      for (let i = 0; i < 100; i++) {
        const eid = ecs.allocateEntity();
        ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 150 + i * 5;
        ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 150 + i * 3;
        ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = (i % 12) + 1;
      }

      const farmlands = [
        { tileX: 12, tileY: 10, stage: FarmStages.MATURE }
      ];

      for (let f = 0; f < 100; f++) {
        renderer.render(mockWorld, ecs, farmlands);
      }

      expect(mock.contextCalls.save).toBe(0);
      expect(mock.contextCalls.restore).toBe(0);
    });
  });

  describe('3. 4096 连续内存实体小人多态状态可视化断言', () => {
    it('小人主体以 6x6 像素点阵居中渲染，并呈现 1px 面部像素', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 200.0;
      ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 1; // ORC
      ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 100.0;
      ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_MAX] = 100.0;

      renderer.showNutrients = false; // 降低背景填充干扰
      renderer.render(mockWorld, ecs, null);

      // (100 - 3, 200 - 3) = (97, 197), 大小 6x6
      const bodyCall = mock.contextCalls.fillRect.find(c => c.x === 97 && c.y === 197 && c.w === 6 && c.h === 6);
      expect(bodyCall).toBeDefined();

      // 面部像素 (97+1, 197+1) = (98, 198) 1x1
      const eyeCall = mock.contextCalls.fillRect.find(c => c.x === 98 && c.y === 198 && c.w === 1 && c.h === 1);
      expect(eyeCall).toBeDefined();
    });

    it('领袖具备金色王冠，血条随生命损耗动态变色', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 50.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 50.0;
      ecs.statusFlags[eid] = IS_ALIVE | IS_LEADER;
      ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 40.0;
      ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_MAX] = 100.0; // 40% 残血

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null);

      // 王冠 (50-3+1, 50-3-3) = (48, 44), 4x2
      const crownCall = mock.contextCalls.fillRect.find(c => c.x === 48 && c.y === 44 && c.w === 4 && c.h === 2);
      expect(crownCall).toBeDefined();

      // 血条底板 (50-3-1, 50-3-4) = (46, 43), 8x2
      const barBg = mock.contextCalls.fillRect.find(c => c.x === 46 && c.y === 43 && c.w === 8 && c.h === 2);
      expect(barBg).toBeDefined();

      // 40% 生命值血条条长为 (0.4 * 8) = 3px
      const barFill = mock.contextCalls.fillRect.find(c => c.x === 46 && c.y === 43 && c.w === 3 && c.h === 2);
      expect(barFill).toBeDefined();
    });

    it('饥饿 >=80 产生橙红警报浮标，互斥锁产生亮黄状态指示器', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 80.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 80.0;
      ecs.statusFlags[eid] = IS_ALIVE | IS_EMERGENCY_LOCK;
      ecs.physiology[eid * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 85.0; // 饥饿
      ecs.physiology[eid * PHYSIOLOGY_STRIDE + PHY_OFFSET_EMERGENCY_LOCK] = 8.5; // 互斥锁锁定中

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null);

      // rx = 77, ry = 77
      // 饥饿浮标在 (rx + 7, ry - 3) = (84, 74), 2x2
      const hungerPip = mock.contextCalls.fillRect.find(c => c.x === 84 && c.y === 74 && c.w === 2 && c.h === 2);
      expect(hungerPip).toBeDefined();

      // 互斥锁指示灯在 (rx - 3, ry - 3) = (74, 74), 2x2
      const mutexPip = mock.contextCalls.fillRect.find(c => c.x === 74 && c.y === 74 && c.w === 2 && c.h === 2);
      expect(mutexPip).toBeDefined();
    });
  });

  describe('4. 2x2 农田四阶演替渲染断言', () => {
    it('正确绘制 48x48 像素复合农田与外边框', () => {
      const farmlands = [
        { tileX: 4, tileY: 4, stage: FarmStages.SPROUT },
        { tileX: 8, tileY: 4, stage: FarmStages.MATURE },
        { tileX: 12, tileY: 4, stage: FarmStages.HARVESTED },
        { tileX: 16, tileY: 4, stage: FarmStages.FALLOW }
      ];

      renderer.render(mockWorld, ecs, farmlands);

      // 每个农田为 48x48 px
      const farm0 = mock.contextCalls.fillRect.find(c => c.x === 4 * 24 && c.y === 4 * 24 && c.w === 48 && c.h === 48);
      const farm1 = mock.contextCalls.fillRect.find(c => c.x === 8 * 24 && c.y === 4 * 24 && c.w === 48 && c.h === 48);
      const farm2 = mock.contextCalls.fillRect.find(c => c.x === 12 * 24 && c.y === 4 * 24 && c.w === 48 && c.h === 48);
      const farm3 = mock.contextCalls.fillRect.find(c => c.x === 16 * 24 && c.y === 4 * 24 && c.w === 48 && c.h === 48);

      expect(farm0).toBeDefined();
      expect(farm1).toBeDefined();
      expect(farm2).toBeDefined();
      expect(farm3).toBeDefined();

      // 4 个外边框 strokeRect
      expect(mock.contextCalls.strokeRect.length).toBeGreaterThanOrEqual(4);
    });

    it('支持直接传入 NutrientField 实例与 FarmlandSystem 实例进行零 GC 渲染', async () => {
      const { FarmlandSystem } = await import('../../src/ecosystem/FarmlandSystem.js');
      const { NutrientField } = await import('../../src/ecosystem/NutrientField.js');

      const farmSys = new FarmlandSystem();
      farmSys.createFarmland(6, 6);
      farmSys.createFarmland(10, 10);

      const nutrientField = new NutrientField();
      nutrientField.current.fill(0.5);

      expect(() => {
        renderer.render(mockWorld, ecs, farmSys, nutrientField);
      }).not.toThrow();

      expect(mock.contextCalls.save).toBe(0);
      expect(mock.contextCalls.restore).toBe(0);
    });
  });
});
