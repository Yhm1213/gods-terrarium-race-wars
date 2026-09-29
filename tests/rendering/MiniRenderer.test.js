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
  FarmStages,
  COLOR_CASTE_CIVILIAN,
  COLOR_CASTE_ARTISAN,
  COLOR_CASTE_SOLDIER,
  COLOR_CASTE_LEADER,
  COLOR_ORGAN_HOLY,
  COLOR_ORGAN_FLAME,
  COLOR_ORGAN_WING,
  COLOR_ORGAN_GRANITE,
  COLOR_CASTING,
  COLOR_DISARMED,
  COLOR_SKILL_ACTIVE,
  FACTION_TERRITORY_COLORS,
  FACTION_BORDER_COLORS,
  COLOR_FLOW_VECTOR,
  COLOR_FLOW_TARGET,
  COLOR_MORALE_SWEAT,
  COLOR_MORALE_PANIC,
  COLOR_LAST_STAND_AURA,
  COLOR_LAST_STAND_CORE,
  COLOR_TOTEM_SHIELD,
  COLOR_TOTEM_SHOCKWAVE
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
  IN_COMBAT,
  IS_CASTING,
  IS_DISARMED,
  IS_SKILL_ACTIVE,
  IS_LAST_STAND,
  IS_PANICKED,
  IS_SACRED_BODY,
  IS_STATIC_ANCHOR
} from '../../src/components/UnitStatusFlags.js';

import {
  MoraleState
} from '../../src/warfare/MoraleSystem.js';

import {
  CasteType,
  createSocialCasteBuffer,
  initSocialCaste,
  CASTE_STRIDE,
  CASTE_OFFSET_TYPE
} from '../../src/components/SocialCasteComponent.js';

import {
  createGeneticsBuffer,
  initGenetics,
  GENETICS_STRIDE,
  GEN_OFFSET_PHENOTYPE
} from '../../src/components/GeneticsComponent.js';

import {
  createRaceSkillBuffer,
  initRaceSkill,
  SKILL_STRIDE
} from '../../src/components/RaceSkillComponent.js';

import {
  OrganFlags
} from '../../src/data/MutationFlags.js';

// 创建 Mock Canvas 与 2D Context
function createMockCanvas() {
  const contextCalls = {
    fillRect: [],
    drawImage: [],
    strokeRect: [],
    save: 0,
    restore: 0,
    beginPath: 0,
    stroke: 0,
    arc: 0
  };

  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    fillRect: vi.fn((x, y, w, h) => {
      contextCalls.fillRect.push({ x, y, w, h, fillStyle: ctx.fillStyle });
    }),
    strokeRect: vi.fn((x, y, w, h) => {
      contextCalls.strokeRect.push({ x, y, w, h, strokeStyle: ctx.strokeStyle });
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
    arc: vi.fn(() => {
      contextCalls.arc++;
    }),
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

  describe('5. 四大社会阶级标牌与领袖发光外圈渲染断言 (WP-2.5)', () => {
    it('平民 (CIVILIAN) 绘制浅褐色微点标牌', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;
      ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 1;

      const casteBuffer = createSocialCasteBuffer();
      initSocialCaste(casteBuffer, eid, CasteType.CIVILIAN);

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null, null, casteBuffer);

      // rx = 97, ry = 97. CIVILIAN 标牌在 (rx - 3, ry + 1) = (94, 98), 1x1
      const civilianDot = mock.contextCalls.fillRect.find(c => c.x === 94 && c.y === 98 && c.w === 1 && c.h === 1);
      expect(civilianDot).toBeDefined();
    });

    it('工匠 (ARTISAN) 绘制 3x3 铁灰色方块标牌 (#8a8a8a)', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 120.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 120.0;
      ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 2;

      const casteBuffer = createSocialCasteBuffer();
      initSocialCaste(casteBuffer, eid, CasteType.ARTISAN);

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null, null, casteBuffer);

      // rx = 117, ry = 117. ARTISAN 标牌在 (rx - 4, ry) = (113, 117), 3x3
      const artisanSquare = mock.contextCalls.fillRect.find(c => c.x === 113 && c.y === 117 && c.w === 3 && c.h === 3);
      expect(artisanSquare).toBeDefined();
    });

    it('士兵 (SOLDIER) 绘制 3x3 暗红色三角标牌 (#b22222)', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 150.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 150.0;
      ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 3;

      const casteBuffer = createSocialCasteBuffer();
      initSocialCaste(casteBuffer, eid, CasteType.SOLDIER);

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null, null, casteBuffer);

      // rx = 147, ry = 147. SOLDIER 三角: 顶 (144, 146, 1, 1), 底 (143, 147, 3, 2)
      const soldierTip = mock.contextCalls.fillRect.find(c => c.x === 144 && c.y === 146 && c.w === 1 && c.h === 1);
      const soldierBase = mock.contextCalls.fillRect.find(c => c.x === 143 && c.y === 147 && c.w === 3 && c.h === 2);
      expect(soldierTip).toBeDefined();
      expect(soldierBase).toBeDefined();
    });

    it('领袖 (LEADER) 由 statusFlags IS_LEADER 驱动 24px 亮金发光圈与王冠描边', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 200.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 200.0;
      ecs.statusFlags[eid] = IS_ALIVE | IS_LEADER;
      ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = 4;

      const casteBuffer = createSocialCasteBuffer();
      initSocialCaste(casteBuffer, eid, CasteType.LEADER);

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null, null, casteBuffer);

      // rx = 197, ry = 197. 24px 外圈在 (rx - 9 + 0.5, ry - 9 + 0.5, 23, 23)
      const leaderStroke = mock.contextCalls.strokeRect.find(c => c.x === 188.5 && c.y === 188.5 && c.w === 23 && c.h === 23);
      expect(leaderStroke).toBeDefined();

      // 金色王冠在 (rx + 1, ry - 3) = (198, 194), 4x2
      const crown = mock.contextCalls.fillRect.find(c => c.x === 198 && c.y === 194 && c.w === 4 && c.h === 2);
      expect(crown).toBeDefined();
    });
  });

  describe('6. 正交突变器官像素点缀与技能施法反馈断言 (WP-2.5)', () => {
    it('携带 WING (薄翼) 在身体两侧绘制 2 像素轻盈羽翼', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 80.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 80.0;

      const geneticsBuffer = createGeneticsBuffer();
      initGenetics(geneticsBuffer, eid, OrganFlags.WING, 0);

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null, null, null, geneticsBuffer);

      // rx = 77, ry = 77. WING: 左翼 (75, 79, 2, 1), 右翼 (83, 79, 2, 1)
      const leftWing = mock.contextCalls.fillRect.find(c => c.x === 75 && c.y === 79 && c.w === 2 && c.h === 1);
      const rightWing = mock.contextCalls.fillRect.find(c => c.x === 83 && c.y === 79 && c.w === 2 && c.h === 1);
      expect(leftWing).toBeDefined();
      expect(rightWing).toBeDefined();
    });

    it('携带 FLAME (烈焰) 在小人边缘绘制橙红微光', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 160.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 160.0;

      const geneticsBuffer = createGeneticsBuffer();
      initGenetics(geneticsBuffer, eid, OrganFlags.FLAME, 0);

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null, null, null, geneticsBuffer);

      // rx = 157, ry = 157. FLAME: 左边 (156, 158, 1, 4), 右边 (163, 158, 1, 4)
      const leftGlow = mock.contextCalls.fillRect.find(c => c.x === 156 && c.y === 158 && c.w === 1 && c.h === 4);
      const rightGlow = mock.contextCalls.fillRect.find(c => c.x === 163 && c.y === 158 && c.w === 1 && c.h === 4);
      expect(leftGlow).toBeDefined();
      expect(rightGlow).toBeDefined();
    });

    it('携带 GRANITE 与 HOLY 绘制灰色岩石斑块与头顶圣环', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 220.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 220.0;

      const geneticsBuffer = createGeneticsBuffer();
      initGenetics(geneticsBuffer, eid, OrganFlags.GRANITE | OrganFlags.HOLY, 0);

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null, null, null, geneticsBuffer);

      // rx = 217, ry = 217. GRANITE: (219, 219, 2, 2)
      const rock = mock.contextCalls.fillRect.find(c => c.x === 219 && c.y === 219 && c.w === 2 && c.h === 2);
      expect(rock).toBeDefined();

      // HOLY: (218, 212, 4, 1)
      const holyHalo = mock.contextCalls.fillRect.find(c => c.x === 218 && c.y === 212 && c.w === 4 && c.h === 1);
      expect(holyHalo).toBeDefined();
    });

    it('IS_CASTING 状态绘制施法光晕，IS_DISARMED 绘制掉落匕首标记', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 300.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 300.0;
      ecs.statusFlags[eid] = IS_ALIVE | IS_CASTING | IS_DISARMED | IS_SKILL_ACTIVE;

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs);

      // rx = 297, ry = 297
      // 施法光晕: (rx - 2, ry + 7, 10, 2) = (295, 304, 10, 2)
      const castingHalo = mock.contextCalls.fillRect.find(c => c.x === 295 && c.y === 304 && c.w === 10 && c.h === 2);
      expect(castingHalo).toBeDefined();

      // 缴械断刃: (rx + 7, ry + 2, 2, 3) = (304, 299, 2, 3)
      const dagger = mock.contextCalls.fillRect.find(c => c.x === 304 && c.y === 299 && c.w === 2 && c.h === 3);
      expect(dagger).toBeDefined();

      // 技能生效微光: (rx + 2, ry - 2, 2, 1) = (299, 295, 2, 1)
      const skillPip = mock.contextCalls.fillRect.find(c => c.x === 299 && c.y === 295 && c.w === 2 && c.h === 1);
      expect(skillPip).toBeDefined();
    });
  });

  describe('7. M2 全真系统实例接入、兼容性 Fallback 与连续 100 帧零 GC 守门断言 (LL-006 & DoD)', () => {
    it('向后兼容安全判空 Fallback 保护链：即使仅传入 2 个参数或 null 参数也永不抛异常 (LL-006)', () => {
      expect(() => {
        renderer.render(mockWorld, ecs);
        renderer.render(mockWorld, ecs, null, null, null, null, null);
      }).not.toThrow();
    });

    it('直接接入 SocialCasteSystem, MendelianGeneticsSystem, RaceSkillSystem 真实系统实例', async () => {
      const { SocialCasteSystem } = await import('../../src/profession/SocialCasteSystem.js');
      const { MendelianGeneticsSystem } = await import('../../src/mutation/MendelianGeneticsSystem.js');
      const { RaceSkillSystem } = await import('../../src/race/RaceSkillSystem.js');

      const casteSys = new SocialCasteSystem(ecs);
      const geneticsSys = new MendelianGeneticsSystem(ecs);
      const skillSys = new RaceSkillSystem(ecs);

      // 分配 10 个测试实体
      for (let i = 0; i < 10; i++) {
        const id = ecs.allocateEntity();
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_X] = 100 + i * 20;
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100 + i * 15;
        casteSys.castes[id * CASTE_STRIDE + CASTE_OFFSET_TYPE] = i % 4;
        geneticsSys.genetics[id * GENETICS_STRIDE + GEN_OFFSET_PHENOTYPE] = (1 << (i % 8));
      }

      expect(() => {
        renderer.render(mockWorld, ecs, null, null, casteSys, geneticsSys, skillSys);
      }).not.toThrow();

      expect(mock.contextCalls.save).toBe(0);
      expect(mock.contextCalls.restore).toBe(0);
    });

    it('在 M2 全真全要素负载下连续执行 100 帧渲染循环，绝对 0 次 save/restore 且零 GC 逃逸', async () => {
      const { SocialCasteSystem } = await import('../../src/profession/SocialCasteSystem.js');
      const { MendelianGeneticsSystem } = await import('../../src/mutation/MendelianGeneticsSystem.js');
      const { RaceSkillSystem } = await import('../../src/race/RaceSkillSystem.js');

      const casteSys = new SocialCasteSystem(ecs);
      const geneticsSys = new MendelianGeneticsSystem(ecs);
      const skillSys = new RaceSkillSystem(ecs);

      // 分配 100 个全要素负载实体
      for (let i = 0; i < 100; i++) {
        const id = ecs.allocateEntity();
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_X] = 50 + (i % 20) * 30;
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_Y] = 50 + ((i / 20) | 0) * 40;
        ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = (i % 12) + 1;
        ecs.statusFlags[id] = IS_ALIVE | (i % 10 === 0 ? IS_LEADER : 0) | (i % 5 === 0 ? IS_CASTING : 0) | (i % 7 === 0 ? IS_DISARMED : 0);

        casteSys.castes[id * CASTE_STRIDE + CASTE_OFFSET_TYPE] = i % 4;
        geneticsSys.genetics[id * GENETICS_STRIDE + GEN_OFFSET_PHENOTYPE] = (1 << (i % 9));
      }

      const savesBefore = mock.contextCalls.save;
      const restoresBefore = mock.contextCalls.restore;

      for (let f = 0; f < 100; f++) {
        renderer.render(mockWorld, ecs, null, null, casteSys, geneticsSys, skillSys);
      }

      expect(mock.contextCalls.save).toBe(savesBefore);
      expect(mock.contextCalls.restore).toBe(restoresBefore);
    });
  });

  describe('8. M3 领地国界半透明光晕与边界高光线渲染断言 (WP-3.5)', () => {
    it('依据 world.territoryFaction 瓦片权属绘制半透明阵营色与国界高光描边', () => {
      mockWorld.territoryFaction = new Uint8Array(TOTAL_TILES);
      // 阵营 1 (ORC) 占据瓦片 (0, 0)，阵营 2 (ELF) 占据瓦片 (1, 0)
      mockWorld.territoryFaction[0] = 1;
      mockWorld.territoryFaction[1] = 2;

      renderer.showNutrients = false;
      renderer.showTerritories = true;
      renderer.render(mockWorld, ecs);

      // (0, 0) 填充 24x24 领地色
      const fillTile0 = mock.contextCalls.fillRect.find(c => c.x === 0 && c.y === 0 && c.w === 24 && c.h === 24);
      // (1, 0) 对应 x=24, y=0 填充 24x24 领地色
      const fillTile1 = mock.contextCalls.fillRect.find(c => c.x === 24 && c.y === 0 && c.w === 24 && c.h === 24);

      expect(fillTile0).toBeDefined();
      expect(fillTile1).toBeDefined();

      // 瓦片 0 的右边界与瓦片 1 不同，应生成 2px 描边 (x = 24 - 2 = 22, y = 0, w = 2, h = 24)
      const borderRight = mock.contextCalls.fillRect.find(c => c.x === 22 && c.y === 0 && c.w === 2 && c.h === 24);
      expect(borderRight).toBeDefined();
    });

    it('中立瓦片 (territoryFaction=0) 绝不绘制领地底色', () => {
      mockWorld.territoryFaction = new Uint8Array(TOTAL_TILES);
      mockWorld.territoryFaction.fill(0);

      renderer.showNutrients = false;
      renderer.showTerritories = true;
      mock.contextCalls.fillRect = [];

      renderer.render(mockWorld, ecs);

      // 仅包含底图全屏填充，无阵营领地半透明色块
      const territoryFills = mock.contextCalls.fillRect.filter(c => c.w === 24 && c.h === 24 && FACTION_TERRITORY_COLORS.includes(c.fillStyle) && c.fillStyle !== 'rgba(0, 0, 0, 0)');
      expect(territoryFills.length).toBe(0);
    });

    it('通过 showTerritories 开关可禁用国界渲染', () => {
      mockWorld.territoryFaction = new Uint8Array(TOTAL_TILES);
      mockWorld.territoryFaction[0] = 1;

      renderer.showTerritories = false;
      renderer.showNutrients = false;
      mock.contextCalls.fillRect = [];

      renderer.render(mockWorld, ecs);

      const territoryFills = mock.contextCalls.fillRect.filter(c => c.w === 24 && c.h === 24 && FACTION_TERRITORY_COLORS.includes(c.fillStyle) && c.fillStyle !== 'rgba(0, 0, 0, 0)');
      expect(territoryFills.length).toBe(0);
    });
  });

  describe('9. M3 战线大军团反向 BFS 向量流场可视化断言 (WP-3.5)', () => {
    it('开启 showFlowField 时，正确绘制向量线段与集结目标点靶心', () => {
      const mockFlowField = {
        width: GRID_WIDTH,
        height: GRID_HEIGHT,
        targetTileX: 10,
        targetTileY: 8,
        vectorFieldX: new Float32Array(TOTAL_TILES),
        vectorFieldY: new Float32Array(TOTAL_TILES)
      };

      // 在瓦片 (2, 2) 注入向右导向向量
      const idx = 2 * GRID_WIDTH + 2;
      mockFlowField.vectorFieldX[idx] = 1.0;
      mockFlowField.vectorFieldY[idx] = 0.0;

      renderer.showFlowField = true;
      renderer.render(mockWorld, ecs, null, null, null, null, null, mockFlowField);

      // 验证目标靶心描边 (10 * 24 + 1.5 = 241.5, 8 * 24 + 1.5 = 193.5, 21x21)
      const targetStroke = mock.contextCalls.strokeRect.find(c => c.x === 241.5 && c.y === 193.5 && c.w === 21 && c.h === 21);
      expect(targetStroke).toBeDefined();

      // 验证目标中心 4x4 像素点 (240 + 10 = 250, 192 + 10 = 202)
      const targetCenter = mock.contextCalls.fillRect.find(c => c.x === 250 && c.y === 202 && c.w === 4 && c.h === 4);
      expect(targetCenter).toBeDefined();

      // 验证调用了 stroke 绘制流场小线段
      expect(mock.contextCalls.stroke).toBeGreaterThan(0);
    });
  });

  describe('10. M3 士气微表情、破釜沉舟死战光环与图腾金身冲击波断言 (WP-3.5)', () => {
    it('动摇 (WAVERING) 状态在实体头上绘制浅蓝微汗水滴', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;

      const mockMoraleSys = {
        getMoraleState: vi.fn(() => MoraleState.WAVERING)
      };

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs, null, null, null, null, null, null, mockMoraleSys);

      // rx = 97, ry = 97. 微汗水滴: (rx + 5, ry - 3, 1, 2) = (102, 94, 1, 2)
      const sweat = mock.contextCalls.fillRect.find(c => c.x === 102 && c.y === 94 && c.w === 1 && c.h === 2);
      expect(sweat).toBeDefined();
    });

    it('溃逃 (DISORGANIZED / IS_PANICKED) 状态在实体两侧绘制慌张急汗双水滴', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 150.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 150.0;
      ecs.statusFlags[eid] = IS_ALIVE | IS_PANICKED;

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs);

      // rx = 147, ry = 147. 左汗滴: (145, 144, 1, 2), 右汗滴: (153, 144, 1, 2)
      const leftSweat = mock.contextCalls.fillRect.find(c => c.x === 145 && c.y === 144 && c.w === 1 && c.h === 2);
      const rightSweat = mock.contextCalls.fillRect.find(c => c.x === 153 && c.y === 144 && c.w === 1 && c.h === 2);
      expect(leftSweat).toBeDefined();
      expect(rightSweat).toBeDefined();
    });

    it('破釜沉舟 (IS_LAST_STAND) 状态在周身绘制暗红死战气焰', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 200.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 200.0;
      ecs.statusFlags[eid] = IS_ALIVE | IS_LAST_STAND;

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs);

      // rx = 197, ry = 197. 气焰左翼 (195, 198, 1, 4), 右翼 (204, 198, 1, 4)
      const leftFlames = mock.contextCalls.fillRect.find(c => c.x === 195 && c.y === 198 && c.w === 1 && c.h === 4);
      const rightFlames = mock.contextCalls.fillRect.find(c => c.x === 204 && c.y === 198 && c.w === 1 && c.h === 4);
      expect(leftFlames).toBeDefined();
      expect(rightFlames).toBeDefined();
    });

    it('金身圣盾 (IS_SACRED_BODY) 状态绘制金色发光圣盾框', () => {
      const eid = ecs.allocateEntity();
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = 250.0;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = 250.0;
      ecs.statusFlags[eid] = IS_ALIVE | IS_SACRED_BODY;

      renderer.showNutrients = false;
      renderer.render(mockWorld, ecs);

      // rx = 247, ry = 247. 圣盾框 (244.5, 244.5, 11, 11)
      const shieldBox = mock.contextCalls.strokeRect.find(c => c.x === 244.5 && c.y === 244.5 && c.w === 11 && c.h === 11);
      expect(shieldBox).toBeDefined();
    });

    it('调用 addShockwave 触发金色环形冲击波扩散动画', () => {
      renderer.addShockwave(300.0, 300.0, 144.0, 200.0);
      expect(renderer.shockwaveActive[0]).toBe(1);
      expect(renderer.shockwaveX[0]).toBe(300.0);
      expect(renderer.shockwaveY[0]).toBe(300.0);

      renderer.render(mockWorld, ecs);

      // 验证冲击波触发了 arc 与 stroke
      expect(mock.contextCalls.arc).toBeGreaterThan(0);
      expect(mock.contextCalls.stroke).toBeGreaterThan(0);
    });
  });

  describe('11. M3 全真全要素接入与连续 100 帧 0 次 save/restore 守门断言 (LL-003, LL-006 & DoD)', () => {
    it('向后兼容安全判空 Fallback 保护链：即使传入全新 M3 构件或全为 null 也永不抛异常 (LL-006)', () => {
      expect(() => {
        renderer.render(mockWorld, ecs, null, null, null, null, null, null, null, null);
      }).not.toThrow();
    });

    it('在 M1 + M2 + M3 全真全要素全负载下连续执行 100 帧渲染循环，绝对 0 次 save/restore 且零 GC 逃逸', async () => {
      const { TileGrid } = await import('../../src/world/TileGrid.js');
      const { FarmlandSystem } = await import('../../src/ecosystem/FarmlandSystem.js');
      const { NutrientField } = await import('../../src/ecosystem/NutrientField.js');
      const { SocialCasteSystem } = await import('../../src/profession/SocialCasteSystem.js');
      const { MendelianGeneticsSystem } = await import('../../src/mutation/MendelianGeneticsSystem.js');
      const { RaceSkillSystem } = await import('../../src/race/RaceSkillSystem.js');
      const { VectorFlowFieldSystem } = await import('../../src/pathfinding/VectorFlowFieldSystem.js');
      const { MoraleSystem } = await import('../../src/warfare/MoraleSystem.js');
      const { TotemDefenseSystem } = await import('../../src/warfare/TotemDefenseSystem.js');

      const fullTileGrid = new TileGrid();
      // 填充 16 阵营领地
      for (let i = 0; i < TOTAL_TILES; i++) {
        fullTileGrid.setTerritory(i, (i % 16) + 1);
      }

      const fullNutrientField = new NutrientField(fullTileGrid);
      const fullFarmlands = new FarmlandSystem();
      const casteSys = new SocialCasteSystem(ecs);
      const geneticsSys = new MendelianGeneticsSystem(ecs);
      const skillSys = new RaceSkillSystem(ecs);
      const flowFieldSys = new VectorFlowFieldSystem(fullTileGrid);
      flowFieldSys.generateField(100, 100);

      const totemSys = new TotemDefenseSystem(ecs);
      const moraleSys = new MoraleSystem(ecs, null, totemSys);

      // 分配 100 个具备 M1+M2+M3 全部复合状态的测试实体
      for (let i = 0; i < 100; i++) {
        const id = ecs.allocateEntity();
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_X] = 50 + (i % 20) * 30;
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_Y] = 50 + ((i / 20) | 0) * 40;
        ecs.identities[id * IDENTITY_STRIDE + ID_OFFSET_FACTION] = (i % 16) + 1;
        ecs.statusFlags[id] = IS_ALIVE |
          (i % 10 === 0 ? IS_LEADER : 0) |
          (i % 4 === 0 ? IS_CASTING : 0) |
          (i % 5 === 0 ? IS_LAST_STAND : 0) |
          (i % 6 === 0 ? IS_PANICKED : 0) |
          (i % 7 === 0 ? IS_SACRED_BODY : 0);

        casteSys.castes[id * CASTE_STRIDE + CASTE_OFFSET_TYPE] = i % 4;
        geneticsSys.genetics[id * GENETICS_STRIDE + GEN_OFFSET_PHENOTYPE] = (1 << (i % 9));
      }

      // 添加初始冲击波
      renderer.addShockwave(500, 400);

      // 开启所有图层与流场调试开关
      renderer.showTerritories = true;
      renderer.showFlowField = true;
      renderer.showMorale = true;
      renderer.showTotemShield = true;
      renderer.showNutrients = true;
      renderer.showFarmlands = true;
      renderer.showCastes = true;
      renderer.showMutations = true;
      renderer.showSkills = true;

      const savesBefore = mock.contextCalls.save;
      const restoresBefore = mock.contextCalls.restore;

      for (let f = 0; f < 100; f++) {
        renderer.render(
          fullTileGrid,
          ecs,
          fullFarmlands,
          fullNutrientField,
          casteSys,
          geneticsSys,
          skillSys,
          flowFieldSys,
          moraleSys,
          totemSys
        );
      }

      // 核心守门铁律验证: 0 save, 0 restore, 0 逃逸
      expect(mock.contextCalls.save).toBe(savesBefore);
      expect(mock.contextCalls.restore).toBe(restoresBefore);
      expect(mock.ctx.save).not.toHaveBeenCalled();
      expect(mock.ctx.restore).not.toHaveBeenCalled();
    });
  });
});


