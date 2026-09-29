/**
 * MiniRenderer.js
 * 
 * Milestone 1 (M1) 极简 60 FPS Canvas 渲染管线
 * 遵循《研发管理宪法》与《技术设计规格书 TDS v1.1》：
 * 
 * 性能铁律:
 * 1. 严格零 GC：主渲染循环内 0 次 new Object/Array，0 次字符串拼接，0 次临时闭包；
 * 2. 严格零上下文保存恢复陷阱：主循环内 0 次 ctx.save() / 0 次 ctx.restore()；
 * 3. 逻辑画布尺寸 1344 x 864，56 x 36 瓦片网格 (24x24 px)；
 * 4. 离屏预烘焙底模 (Terrain Cache)：静态地形极速单次 drawImage 贴图；
 * 5. 瓦片养分地脉热力图微弱绿光叠合 (LUT 预量化查表)；
 * 6. 4096 连续平铺内存实体小人 (12 种族主色 6x6 像素点阵、血条浮标、饥饿预警点、10s互斥锁指示器)；
 * 7. 2x2 农田四阶演替像素可视化 (绿芽 -> 金黄麦浪 -> 褐色秸秆 -> 翻耕黑土)。
 */

import {
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
} from '../core/ECS.js';

import {
  IS_ALIVE,
  IS_LEADER,
  IS_EMERGENCY_LOCK,
  IN_COMBAT,
  IS_CASTING,
  IS_DISARMED,
  IS_SKILL_ACTIVE,
  IS_IMMOBILIZED,
  IS_LAST_STAND,
  IS_PANICKED,
  IS_SACRED_BODY,
  IS_STATIC_ANCHOR
} from '../components/UnitStatusFlags.js';

import {
  CASTE_STRIDE,
  CASTE_OFFSET_TYPE,
  CasteType
} from '../components/SocialCasteComponent.js';

import {
  GENETICS_STRIDE,
  GEN_OFFSET_PHENOTYPE
} from '../components/GeneticsComponent.js';

import {
  OrganFlags
} from '../data/MutationFlags.js';

import {
  SKILL_STRIDE,
  SKILL_OFFSET_COOLDOWN,
  SKILL_OFFSET_DURATION
} from '../components/RaceSkillComponent.js';

// ==========================================
// 世界规格与常量
// ==========================================
export const WORLD_WIDTH = 1344;
export const WORLD_HEIGHT = 864;
export const GRID_WIDTH = 56;
export const GRID_HEIGHT = 36;
export const TILE_SIZE = 24;
export const TOTAL_TILES = GRID_WIDTH * GRID_HEIGHT; // 2016

// 瓦片地貌枚举
export const BiomeTypes = Object.freeze({
  PLAINS: 0,        // 平原绿
  MOUNTAINS: 1,     // 高山灰
  SHALLOW_WATER: 2, // 浅水蓝
  DEEP_WATER: 3,    // 深水深蓝
  SWAMP: 4,         // 沼泽紫
  VOLCANO: 5,       // 熔岩红
  HOLY_SPRING: 6    // 神泉金
});

// 瓦片物理基准调色板 (色彩金字塔: 保持舞台安静)
export const BIOME_COLOR_PALETTE = Object.freeze([
  '#4a8505', // 0: 平原绿 (Plains)
  '#736d71', // 1: 高山灰 (Mountains)
  '#3a7b9c', // 2: 浅水蓝 (Shallow Water)
  '#163854', // 3: 深水深蓝 (Deep Water)
  '#6a327a', // 4: 沼泽紫 (Swamp)
  '#c62828', // 5: 熔岩红 (Volcano)
  '#ffd700'  // 6: 神泉金 (Holy Spring)
]);

// 12 始祖种族主色调点阵调色板 (高辨识度 7:2:1 面积律)
export const RACE_COLORS = Object.freeze([
  '#4ade80', // 0: ORC (绿皮菌兽)
  '#60a5fa', // 1: ELF (森灵树民)
  '#38bdf8', // 2: HUMAN (人类帝国)
  '#fb923c', // 3: DWARF (高山矮人)
  '#c084fc', // 4: UNDEAD (墓园亡灵)
  '#a3e635', // 5: GOBLIN (狂躁地精)
  '#f87171', // 6: DEMON (深渊角魔)
  '#2dd4bf', // 7: LIZARD (沼泽蜥蜴人)
  '#fbbf24', // 8: BEAST (荒原兽化人)
  '#22d3ee', // 9: SPORE (孢子真菌人)
  '#818cf8', // 10: GOLEM (晶石魔像)
  '#e879f9'  // 11: ABERR (拟态魔眼)
]);

// 种族次级轮廓边框色
export const RACE_ACCENT_COLORS = Object.freeze([
  '#166534', // 0: ORC
  '#1e40af', // 1: ELF
  '#0369a1', // 2: HUMAN
  '#9a3412', // 3: DWARF
  '#6b21a8', // 4: UNDEAD
  '#4d7c0f', // 5: GOBLIN
  '#991b1b', // 6: DEMON
  '#0f766e', // 7: LIZARD
  '#b45309', // 8: BEAST
  '#0e7490', // 9: SPORE
  '#3730a3', // 10: GOLEM
  '#86198f'  // 11: ABERR
]);

// 农田四阶演替枚举与颜色
export const FarmStages = Object.freeze({
  SPROUT: 0,    // 幼苗绿芽
  MATURE: 1,    // 金黄麦浪
  HARVESTED: 2, // 褐色秸秆
  FALLOW: 3     // 翻耕黑土
});

export const FARMLAND_BG_COLORS = Object.freeze([
  '#4d6b2f', // 0: 幼苗底土
  '#c68a18', // 1: 金黄麦地
  '#6b5443', // 2: 秸秆残茬
  '#2a1d17'  // 3: 翻耕黑土
]);

export const FARMLAND_ACCENT_COLORS = Object.freeze([
  '#a3e635', // 0: 翠绿新芽
  '#fde047', // 1: 耀眼金浪
  '#a89078', // 2: 干燥麦秆
  '#19100d'  // 3: 翻耕垄沟
]);

// 预量化 32 级养分地脉微弱绿光光晕 LUT 表 (消除热路径字符串拼接)
const NUTRIENT_ALPHA_STEPS = 32;
const NUTRIENT_COLOR_LUT = new Array(NUTRIENT_ALPHA_STEPS);
for (let i = 0; i < NUTRIENT_ALPHA_STEPS; i++) {
  const alpha = (i / (NUTRIENT_ALPHA_STEPS - 1)) * 0.42; // 最大透明度 0.42，微弱护眼光晕
  NUTRIENT_COLOR_LUT[i] = `rgba(52, 211, 153, ${alpha.toFixed(3)})`;
}

// 静态 UI/状态颜色常量 (零分配)
const COLOR_HEALTH_HIGH = '#22c55e';
const COLOR_HEALTH_MID  = '#eab308';
const COLOR_HEALTH_LOW  = '#ef4444';
const COLOR_BAR_BG      = '#0f172a';
const COLOR_HUNGER_WARN = '#f97316';
const COLOR_HUNGER_CRIT = '#ef4444';
const COLOR_MUTEX_LOCK  = '#f59e0b';
const COLOR_LEADER      = '#ffd700';
const COLOR_COMBAT      = '#dc2626';
const COLOR_EYE         = '#0f172a';
const COLOR_GRID_LINE   = 'rgba(255, 255, 255, 0.05)';
const COLOR_FARM_BORDER = 'rgba(0, 0, 0, 0.45)';

// M2 阶级标牌调色板 (契约 5.2 节)
export const COLOR_CASTE_CIVILIAN = '#a88d75'; // 平民浅褐色微点
export const COLOR_CASTE_ARTISAN  = '#8a8a8a'; // 工匠铁灰色方块
export const COLOR_CASTE_SOLDIER  = '#b22222'; // 士兵暗红色三角
export const COLOR_CASTE_LEADER   = '#ffd700'; // 领袖亮金外圈王冠

// M2 突变器官点缀色 (契约 5.2 节)
export const COLOR_ORGAN_HOLY     = '#fef08a'; // 圣灵淡金圣环
export const COLOR_ORGAN_FLAME    = '#ff4500'; // 烈焰橙红微光
export const COLOR_ORGAN_WING     = '#93c5fd'; // 薄翼轻盈浅蓝
export const COLOR_ORGAN_GRANITE  = '#78716c'; // 花岗岩灰色斑块

// M2 技能与施法反馈颜色
export const COLOR_CASTING        = '#38bdf8'; // 施法读条青蓝光晕
export const COLOR_DISARMED       = '#94a3b8'; // 缴械断刃灰钢
export const COLOR_SKILL_ACTIVE   = '#a855f7'; // 特技激活炫紫微光

// ==========================================
// M3 战争、政体与流场预量化调色板 (热路径零 GC)
// ==========================================
// 16 阵营领地半透明底色 LUT (0 号为中立透明)
export const FACTION_TERRITORY_COLORS = Object.freeze([
  'rgba(0, 0, 0, 0)',               // 0: 中立荒漠
  'rgba(56, 118, 29, 0.22)',        // 1: ORC
  'rgba(46, 125, 50, 0.22)',        // 2: ELF
  'rgba(25, 118, 210, 0.22)',       // 3: HUMAN
  'rgba(216, 67, 21, 0.22)',        // 4: DWARF
  'rgba(106, 27, 154, 0.22)',       // 5: UNDEAD
  'rgba(104, 159, 56, 0.22)',       // 6: GOBLIN
  'rgba(194, 24, 91, 0.22)',        // 7: DEMON
  'rgba(0, 137, 123, 0.22)',        // 8: LIZARD
  'rgba(245, 124, 0, 0.22)',        // 9: BEAST
  'rgba(0, 172, 193, 0.22)',        // 10: SPORE
  'rgba(92, 107, 192, 0.22)',       // 11: GOLEM
  'rgba(142, 36, 170, 0.22)',       // 12: ABERR
  'rgba(225, 29, 72, 0.22)',        // 13: 裂变叛乱军
  'rgba(249, 115, 22, 0.22)',       // 14: 自由战阵
  'rgba(139, 92, 246, 0.22)',       // 15: 宗族分裂军
  'rgba(6, 182, 212, 0.22)'         // 16: 边境流寇
]);

// 16 阵营国界明亮边框高光色 (用于 2px 国界描边)
export const FACTION_BORDER_COLORS = Object.freeze([
  '#000000',
  '#4ade80', // 1: ORC
  '#86efac', // 2: ELF
  '#60a5fa', // 3: HUMAN
  '#fb923c', // 4: DWARF
  '#c084fc', // 5: UNDEAD
  '#bef264', // 6: GOBLIN
  '#f43f5e', // 7: DEMON
  '#2dd4bf', // 8: LIZARD
  '#fde047', // 9: BEAST
  '#38bdf8', // 10: SPORE
  '#a5b4fc', // 11: GOLEM
  '#f472b6', // 12: ABERR
  '#fb7185', // 13
  '#fdba74', // 14
  '#c4b5fd', // 15
  '#67e8f9'  // 16
]);

// 流场向量与目标点颜色
export const COLOR_FLOW_VECTOR = 'rgba(56, 189, 248, 0.75)';
export const COLOR_FLOW_TARGET = '#ffd700';

// M3 士气微表情与死战光环颜色
export const COLOR_MORALE_SWEAT = '#38bdf8';     // 动摇冒汗浅蓝小水滴
export const COLOR_MORALE_PANIC = '#67e8f9';     // 溃逃慌张急汗浅青蓝
export const COLOR_LAST_STAND_AURA = '#b91c1c';  // 破釜沉舟暗红死战气焰
export const COLOR_LAST_STAND_CORE = '#ef4444';  // 气焰亮红焰芯

// M3 图腾 25% 圣盾与冲击波
export const COLOR_TOTEM_SHIELD    = '#ffd700';  // 金身圣盾亮金
export const COLOR_TOTEM_SHOCKWAVE = 'rgba(255, 215, 0, 0.85)'; // 金色环形冲击波

/**
 * MiniRenderer 类
 * 纯原生 Canvas 2D 渲染引擎，热路径零 GC
 */
export class MiniRenderer {
  /**
   * @param {HTMLCanvasElement} canvas 目标 HTML5 Canvas 画布
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

    // 强制画布分辨率为 1344 x 864
    this.width = WORLD_WIDTH;
    this.height = WORLD_HEIGHT;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    // 离屏预烘焙地形 Canvas (极其关键的 60 FPS 性能保障)
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
    this.isTerrainDirty = true;
    this._initOffscreenBuffer();

    // 渲染开关与调试视图状态
    this.showNutrients = true;   // 是否叠加地脉养分热力图
    this.showFarmlands = true;   // 是否绘制 2x2 农田演替
    this.showHealthBars = true;  // 是否悬浮小人血条
    this.showStatusPips = true;  // 是否悬浮饥饿/互斥锁状态小点
    this.showGrid = false;       // 是否显示 24x24 瓦片网格线
    this.showCastes = true;      // 是否绘制四大阶级标牌
    this.showMutations = true;   // 是否绘制突变器官视觉点缀
    this.showSkills = true;      // 是否绘制技能与施法反馈

    // M3 战争、政体与寻路可视化开关
    this.showTerritories = true; // 是否绘制领地国界半透明光晕与边框
    this.showFlowField = false;   // 是否绘制大军团向量流场与集结靶心 (按 F 键切换)
    this.showMorale = true;      // 是否绘制士气微表情与破釜沉舟死战气焰
    this.showTotemShield = true; // 是否绘制图腾 25% 金身圣盾与环形冲击波

    // 预分配图腾圣火涅槃冲击波定长环形缓冲池 (容量 16，绝对零 GC)
    this.maxShockwaves = 16;
    this.shockwaveX = new Float32Array(16);
    this.shockwaveY = new Float32Array(16);
    this.shockwaveRadius = new Float32Array(16);
    this.shockwaveMaxRadius = new Float32Array(16);
    this.shockwaveSpeed = new Float32Array(16);
    this.shockwaveActive = new Uint8Array(16);
  }

  /**
   * 初始化离屏地形双缓冲 Canvas
   * @private
   */
  _initOffscreenBuffer() {
    if (typeof document !== 'undefined') {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = this.width;
      this.offscreenCanvas.height = this.height;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d', { alpha: false });
    }
  }

  /**
   * 标记地形已脏，需要在下一帧主渲染时重新烘焙离屏瓦片底模
   */
  invalidateTerrain() {
    this.isTerrainDirty = true;
  }

  /**
   * 烘焙静态瓦片底图至离屏 Canvas
   * @param {object} world 地图世界对象 (含 tiles 连续数组)
   * @private
   */
  _bakeTerrain(world) {
    if (!this.offscreenCtx || !world) return;

    const ctx = this.offscreenCtx;
    const tiles = world.tileTypes || world.tiles;
    const tSize = TILE_SIZE;

    // 默认全画布底色
    ctx.fillStyle = BIOME_COLOR_PALETTE[0];
    ctx.fillRect(0, 0, this.width, this.height);

    if (!tiles) return;

    for (let ty = 0; ty < GRID_HEIGHT; ty++) {
      const rowOffset = ty * GRID_WIDTH;
      const py = ty * tSize;

      for (let tx = 0; tx < GRID_WIDTH; tx++) {
        const biomeId = tiles[rowOffset + tx];
        const color = BIOME_COLOR_PALETTE[biomeId] || BIOME_COLOR_PALETTE[0];
        const px = tx * tSize;

        ctx.fillStyle = color;
        ctx.fillRect(px, py, tSize, tSize);

        // 为深水/高山/熔岩增添细腻像素纹理 (预烘焙零实时开销)
        if (biomeId === BiomeTypes.DEEP_WATER) {
          ctx.fillStyle = '#10273c';
          ctx.fillRect(px + 4, py + 4, 16, 4);
        } else if (biomeId === BiomeTypes.MOUNTAINS) {
          ctx.fillStyle = '#5c575a';
          ctx.fillRect(px + 6, py + 3, 12, 6);
        } else if (biomeId === BiomeTypes.VOLCANO) {
          ctx.fillStyle = '#ff5722';
          ctx.fillRect(px + 8, py + 8, 8, 8);
        } else if (biomeId === BiomeTypes.HOLY_SPRING) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(px + 9, py + 9, 6, 6);
        }
      }
    }

    this.isTerrainDirty = false;
  }

  /**
   * 完整主渲染管线 (主循环热路径，严格零 GC)
   * 
   * @param {object} world 世界地图实例 (包含 tiles/tileTypes, nutrients/nutrientFloor, territoryFaction)
   * @param {ECS} ecs ECS 实体管理器实例
   * @param {Array<object>|import('../ecosystem/FarmlandSystem.js').FarmlandSystem|null} [farmlands=null] 2x2 农田列表或系统
   * @param {import('../ecosystem/NutrientField.js').NutrientField|Float32Array|null} [nutrientField=null] 养分扩散场实例
   * @param {Float32Array|object|null} [casteBuffer=null] 阶级数据缓冲或 SocialCasteSystem 实例
   * @param {Uint32Array|object|null} [geneticsBuffer=null] 遗传基因缓冲或 MendelianGeneticsSystem 实例
   * @param {Float32Array|object|null} [skillBuffer=null] 技能数据缓冲或 RaceSkillSystem 实例
   * @param {import('../pathfinding/VectorFlowFieldSystem.js').VectorFlowFieldSystem|null} [flowField=null] 大军团反向 BFS 流场
   * @param {import('../warfare/MoraleSystem.js').MoraleSystem|null} [moraleSystem=null] 四级士气状态机系统
   * @param {import('../warfare/TotemDefenseSystem.js').TotemDefenseSystem|null} [totemDefense=null] 图腾防卫与圣盾系统
   */
  render(
    world,
    ecs,
    farmlands = null,
    nutrientField = null,
    casteBuffer = null,
    geneticsBuffer = null,
    skillBuffer = null,
    flowField = null,
    moraleSystem = null,
    totemDefense = null
  ) {
    const ctx = this.ctx;

    // 1. 绘制静态地形瓦片底图 (若脏则重新烘焙，否则单次 blit 极速贴图)
    if (this.isTerrainDirty) {
      this._bakeTerrain(world);
    }

    if (this.offscreenCanvas) {
      ctx.drawImage(this.offscreenCanvas, 0, 0);
    } else {
      // 无 DOM 环境降级直绘 (如 Node/Vitest)
      this._drawTerrainDirect(ctx, world);
    }

    // 2. 绘制领地国界半透明光晕与边界高光线
    if (this.showTerritories && world) {
      const territoryFaction = world.territoryFaction || null;
      if (territoryFaction) {
        this._renderTerritoryBorders(ctx, territoryFaction);
      }
    }

    // 3. 瓦片养分地脉热力图微弱光晕叠合 (LUT 查表，零分配，安全 fallback)
    let nutrients = null;
    if (nutrientField) {
      nutrients = nutrientField.current || (nutrientField instanceof Float32Array ? nutrientField : null);
    }
    if (!nutrients && world) {
      nutrients = world.nutrients || world.nutrientFloor || null;
    }

    if (this.showNutrients && nutrients) {
      this._renderNutrientHeatmap(ctx, nutrients);
    }

    // 4. 绘制 2x2 农田四阶演替
    if (this.showFarmlands && farmlands) {
      this._renderFarmlands(ctx, farmlands);
    }

    // 5. 绘制网格线 (若开启调试)
    if (this.showGrid) {
      this._renderGridLines(ctx);
    }

    // 6. 绘制战线向量流场与集结靶心 (若开启调试)
    if (this.showFlowField && flowField) {
      this._renderFlowField(ctx, flowField);
    }

    // 7. 绘制图腾金身圣盾护罩
    if (this.showTotemShield && totemDefense && ecs) {
      this._renderTotemDefenseEffects(ctx, ecs, totemDefense);
    }

    // 8. 绘制 4096 连续内存小人实体群 (解析 M2/M3 状态)
    if (ecs && ecs.activeCount > 0) {
      let castes = null;
      if (casteBuffer) {
        castes = casteBuffer.castes || (casteBuffer instanceof Float32Array ? casteBuffer : null);
      }
      let genetics = null;
      if (geneticsBuffer) {
        genetics = geneticsBuffer.genetics || (geneticsBuffer instanceof Uint32Array ? geneticsBuffer : null);
      }
      let skills = null;
      if (skillBuffer) {
        skills = skillBuffer.skills || (skillBuffer instanceof Float32Array ? skillBuffer : null);
      }

      this._renderEntities(ctx, ecs, castes, genetics, skills, moraleSystem);
    }

    // 9. 绘制图腾圣火涅槃环形冲击波
    if (this.showTotemShield) {
      this._renderShockwaves(ctx);
    }
  }

  /**
   * 直绘瓦片地形 (降级或测试环境使用)
   * @private
   */
  _drawTerrainDirect(ctx, world) {
    const tiles = world ? (world.tileTypes || world.tiles) : null;
    if (!tiles) {
      ctx.fillStyle = BIOME_COLOR_PALETTE[0];
      ctx.fillRect(0, 0, this.width, this.height);
      return;
    }

    const tSize = TILE_SIZE;

    for (let ty = 0; ty < GRID_HEIGHT; ty++) {
      const rowOffset = ty * GRID_WIDTH;
      const py = ty * tSize;

      for (let tx = 0; tx < GRID_WIDTH; tx++) {
        const biomeId = tiles[rowOffset + tx];
        ctx.fillStyle = BIOME_COLOR_PALETTE[biomeId] || BIOME_COLOR_PALETTE[0];
        ctx.fillRect(tx * tSize, py, tSize, tSize);
      }
    }
  }

  /**
   * 绘制瓦片养分地脉热力图叠加 (零 GC)
   * @private
   * @param {CanvasRenderingContext2D} ctx 
   * @param {Float32Array} nutrients 
   */
  _renderNutrientHeatmap(ctx, nutrients) {
    const tSize = TILE_SIZE;
    const total = TOTAL_TILES;

    for (let i = 0; i < total; i++) {
      let nutrient = nutrients[i];
      if (nutrient <= 0.05) continue; // 贫瘠瓦片无光晕，减少填充

      // 归一化并保护量纲 (若为 0~100 则缩放至 0~1)
      if (nutrient > 1.0) nutrient = nutrient * 0.01;
      if (nutrient > 1.0) nutrient = 1.0;

      // 映射至 32 级预计算 LUT 索引
      const lutIdx = (nutrient * (NUTRIENT_ALPHA_STEPS - 1)) | 0;
      const tx = (i % GRID_WIDTH) * tSize;
      const ty = ((i / GRID_WIDTH) | 0) * tSize;

      ctx.fillStyle = NUTRIENT_COLOR_LUT[lutIdx];
      // 微弱光晕向内缩进 1px，形成地脉晶格感
      ctx.fillRect(tx + 1, ty + 1, tSize - 2, tSize - 2);
    }
  }

  /**
   * 绘制单片 2x2 农田瓦片复合体
   * @private
   */
  _drawSingleFarm(ctx, px, py, farmPx, stage) {
    // 1. 底土与耕垄背景
    ctx.fillStyle = FARMLAND_BG_COLORS[stage];
    ctx.fillRect(px, py, farmPx, farmPx);

    // 2. 阶段特色像素细节
    const accent = FARMLAND_ACCENT_COLORS[stage];
    ctx.fillStyle = accent;

    if (stage === FarmStages.SPROUT) {
      // 幼苗期: 萌芽点阵 (4x4 点阵网格)
      for (let dy = 6; dy < farmPx; dy += 12) {
        for (let dx = 6; dx < farmPx; dx += 12) {
          ctx.fillRect(px + dx, py + dy, 4, 4);
        }
      }
    } else if (stage === FarmStages.MATURE) {
      // 成熟期: 4 条波浪麦穗条纹与光斑
      for (let dy = 5; dy < farmPx; dy += 11) {
        ctx.fillRect(px + 4, py + dy, farmPx - 8, 5);
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(px + 12, py + 8, 3, 3);
      ctx.fillRect(px + 28, py + 24, 3, 3);
    } else if (stage === FarmStages.HARVESTED) {
      // 枯黄秸秆期: 错落稀疏残茬短线
      for (let dy = 8; dy < farmPx; dy += 14) {
        for (let dx = 8; dx < farmPx; dx += 14) {
          ctx.fillRect(px + dx, py + dy, 3, 6);
        }
      }
    } else {
      // 翻耕黑土期: 3 条粗深垄沟
      for (let dy = 9; dy < farmPx; dy += 13) {
        ctx.fillRect(px + 3, py + dy, farmPx - 6, 4);
      }
    }

    // 3. 农田 1px 深色边框
    ctx.strokeStyle = COLOR_FARM_BORDER;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, farmPx - 1, farmPx - 1);
  }

  /**
   * 绘制 2x2 农田四阶演替 (48x48 像素复合建筑)
   * 支持 FarmlandSystem TypedArray 实例与传统 Array 结构
   * @private
   * @param {CanvasRenderingContext2D} ctx 
   * @param {import('../ecosystem/FarmlandSystem.js').FarmlandSystem|Array<object>} farmlands 
   */
  _renderFarmlands(ctx, farmlands) {
    if (!farmlands) return;
    const farmPx = TILE_SIZE * 2; // 48px

    // 1. FarmlandSystem 纯 SoA TypedArray 模式 (零 GC)
    if (farmlands.farmActive && farmlands.maxCapacity !== undefined) {
      const count = farmlands.maxCapacity;
      const active = farmlands.farmActive;
      const farmX = farmlands.farmX;
      const farmY = farmlands.farmY;
      const farmStage = farmlands.farmStage;

      for (let i = 0; i < count; i++) {
        if (active[i] === 0) continue;
        const px = farmX[i] * TILE_SIZE;
        const py = farmY[i] * TILE_SIZE;
        const stage = farmStage[i] & 3;
        this._drawSingleFarm(ctx, px, py, farmPx, stage);
      }
      return;
    }

    // 2. 普通 Array 模式 (向下兼容)
    if (Array.isArray(farmlands)) {
      const count = farmlands.length;
      for (let i = 0; i < count; i++) {
        const farm = farmlands[i];
        const px = farm.tileX !== undefined ? farm.tileX * TILE_SIZE : farm.x;
        const py = farm.tileY !== undefined ? farm.tileY * TILE_SIZE : farm.y;
        const stage = (farm.stage !== undefined ? farm.stage : FarmStages.SPROUT) & 3;
        this._drawSingleFarm(ctx, px, py, farmPx, stage);
      }
    }
  }

  /**
   * 绘制瓦片网格参考线 (24x24 px)
   * @private
   */
  _renderGridLines(ctx) {
    ctx.strokeStyle = COLOR_GRID_LINE;
    ctx.lineWidth = 1;

    // 垂直网格线
    for (let x = TILE_SIZE; x < this.width; x += TILE_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, this.height);
      ctx.stroke();
    }

    // 水平网格线
    for (let y = TILE_SIZE; y < this.height; y += TILE_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(this.width, y + 0.5);
      ctx.stroke();
    }
  }

  /**
   * 绘制领地国界半透明光晕与边界明亮高光线 (绝对零 GC)
   * @private
   * @param {CanvasRenderingContext2D} ctx 
   * @param {Uint8Array} territoryFaction 
   */
  _renderTerritoryBorders(ctx, territoryFaction) {
    const tSize = TILE_SIZE;
    const w = GRID_WIDTH;
    const h = GRID_HEIGHT;

    for (let ty = 0; ty < h; ty++) {
      const rowOff = ty * w;
      const py = ty * tSize;

      for (let tx = 0; tx < w; tx++) {
        const idx = rowOff + tx;
        const fac = territoryFaction[idx];
        if (fac === 0) continue;

        const px = tx * tSize;

        // 1. 领地半透明底色
        ctx.fillStyle = FACTION_TERRITORY_COLORS[fac] || FACTION_TERRITORY_COLORS[1];
        ctx.fillRect(px, py, tSize, tSize);

        // 2. 边缘光晕边线检测
        const leftFac   = tx > 0     ? territoryFaction[idx - 1] : 0;
        const rightFac  = tx < w - 1 ? territoryFaction[idx + 1] : 0;
        const topFac    = ty > 0     ? territoryFaction[idx - w] : 0;
        const bottomFac = ty < h - 1 ? territoryFaction[idx + w] : 0;

        const borderCol = FACTION_BORDER_COLORS[fac] || FACTION_BORDER_COLORS[1];
        ctx.fillStyle = borderCol;

        if (topFac !== fac) {
          ctx.fillRect(px, py, tSize, 2);
        }
        if (bottomFac !== fac) {
          ctx.fillRect(px, py + tSize - 2, tSize, 2);
        }
        if (leftFac !== fac) {
          ctx.fillRect(px, py, 2, tSize);
        }
        if (rightFac !== fac) {
          ctx.fillRect(px + tSize - 2, py, 2, tSize);
        }
      }
    }
  }

  /**
   * 绘制战线大军团向量流场指引线与目标点靶心 (绝对零 GC)
   * @private
   * @param {CanvasRenderingContext2D} ctx 
   * @param {import('../pathfinding/VectorFlowFieldSystem.js').VectorFlowFieldSystem} flowField 
   */
  _renderFlowField(ctx, flowField) {
    if (!flowField) return;

    const targetX = flowField.targetTileX;
    const targetY = flowField.targetTileY;
    const vxArr = flowField.vectorFieldX;
    const vyArr = flowField.vectorFieldY;
    if (!vxArr || !vyArr) return;

    const tSize = TILE_SIZE;
    const half = tSize * 0.5;
    const w = GRID_WIDTH;
    const h = GRID_HEIGHT;
    const arrowLen = 7.0;

    // 1. 绘制向量引导小线段 (单次 beginPath 与单次 stroke)
    ctx.strokeStyle = COLOR_FLOW_VECTOR;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let ty = 0; ty < h; ty++) {
      const rowOff = ty * w;
      const cy = ty * tSize + half;
      for (let tx = 0; tx < w; tx++) {
        const idx = rowOff + tx;
        const vx = vxArr[idx];
        const vy = vyArr[idx];
        if (vx === 0.0 && vy === 0.0) continue;

        const cx = tx * tSize + half;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + vx * arrowLen, cy + vy * arrowLen);
      }
    }
    ctx.stroke();

    // 2. 绘制集结目标瓦片靶心
    if (targetX >= 0 && targetY >= 0 && targetX < w && targetY < h) {
      const gx = targetX * tSize;
      const gy = targetY * tSize;

      ctx.strokeStyle = COLOR_FLOW_TARGET;
      ctx.lineWidth = 2;
      ctx.strokeRect(gx + 1.5, gy + 1.5, tSize - 3, tSize - 3);

      ctx.fillStyle = COLOR_FLOW_TARGET;
      ctx.fillRect(gx + 10, gy + 10, 4, 4);
    }
  }

  /**
   * 绘制图腾防卫 12s 金身圣盾光环
   * @private
   * @param {CanvasRenderingContext2D} ctx 
   * @param {ECS} ecs 
   * @param {import('../warfare/TotemDefenseSystem.js').TotemDefenseSystem} totemDefense 
   */
  _renderTotemDefenseEffects(ctx, ecs, totemDefense) {
    if (!totemDefense || !ecs) return;

    const durationArr = totemDefense.aegisDuration;
    const totemIds = totemDefense.totemEntityIds;
    if (!durationArr || !totemIds) return;

    const tf = ecs.transforms;
    if (!tf) return;

    for (let f = 1; f <= 16; f++) {
      if (durationArr[f] > 0.0) {
        const tid = totemIds[f];
        if (tid > 0 && ecs.isAlive(tid)) {
          const off = tid * TRANSFORM_STRIDE;
          const tx = tf[off + TF_OFFSET_X];
          const ty = tf[off + TF_OFFSET_Y];
          const rx = (tx - 12.0) | 0;
          const ry = (ty - 12.0) | 0;

          ctx.strokeStyle = COLOR_TOTEM_SHIELD;
          ctx.lineWidth = 2;
          ctx.strokeRect(rx + 0.5, ry + 0.5, 23, 23);

          ctx.fillStyle = COLOR_TOTEM_SHIELD;
          ctx.fillRect(rx - 2, ry - 2, 4, 4);
          ctx.fillRect(rx + 22, ry - 2, 4, 4);
          ctx.fillRect(rx - 2, ry + 22, 4, 4);
          ctx.fillRect(rx + 22, ry + 22, 4, 4);
        }
      }
    }
  }

  /**
   * 触发图腾圣火涅槃环形冲击波
   * @param {number} x 世界像素坐标 X
   * @param {number} y 世界像素坐标 Y
   * @param {number} [maxRadius=144.0] 最大扩散半径 (px)
   * @param {number} [speed=180.0] 扩散速度 (px/s)
   */
  addShockwave(x, y, maxRadius = 144.0, speed = 180.0) {
    let idx = -1;
    for (let i = 0; i < this.maxShockwaves; i++) {
      if (this.shockwaveActive[i] === 0) {
        idx = i;
        break;
      }
    }
    if (idx === -1) {
      idx = 0; // 环形缓冲覆盖
    }

    this.shockwaveActive[idx] = 1;
    this.shockwaveX[idx] = x;
    this.shockwaveY[idx] = y;
    this.shockwaveRadius[idx] = 4.0;
    this.shockwaveMaxRadius[idx] = maxRadius;
    this.shockwaveSpeed[idx] = speed;
  }

  /**
   * 绘制定长缓冲池中的图腾冲击波动画 (绝对零 GC)
   * @private
   * @param {CanvasRenderingContext2D} ctx 
   */
  _renderShockwaves(ctx) {
    const active = this.shockwaveActive;
    const xs = this.shockwaveX;
    const ys = this.shockwaveY;
    const rads = this.shockwaveRadius;
    const maxRads = this.shockwaveMaxRadius;
    const speeds = this.shockwaveSpeed;

    for (let i = 0; i < this.maxShockwaves; i++) {
      if (active[i] === 0) continue;

      ctx.strokeStyle = COLOR_TOTEM_SHOCKWAVE;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (typeof ctx.arc === 'function') {
        ctx.arc(xs[i], ys[i], rads[i], 0, 6.2831853);
      }
      ctx.stroke();

      rads[i] += speeds[i] * 0.016;
      if (rads[i] >= maxRads[i]) {
        active[i] = 0;
      }
    }
  }

  /**
   * 绘制 4096 连续内存中的实体小人 (热路径绝对零 GC)
   * @private
   * @param {CanvasRenderingContext2D} ctx 
   * @param {ECS} ecs 
   * @param {Float32Array|null} [castes=null]
   * @param {Uint32Array|null} [genetics=null]
   * @param {Float32Array|null} [skills=null]
   * @param {import('../warfare/MoraleSystem.js').MoraleSystem|null} [moraleSystem=null]
   */
  _renderEntities(ctx, ecs, castes = null, genetics = null, skills = null, moraleSystem = null) {
    const activeCount = ecs.activeCount;
    const dense = ecs.denseEntities;
    const transforms = ecs.transforms;
    const health = ecs.health;
    const physiology = ecs.physiology;
    const statusFlags = ecs.statusFlags;
    const identities = ecs.identities;

    const showHp = this.showHealthBars;
    const showPips = this.showStatusPips;
    const showCastes = this.showCastes;
    const showMutations = this.showMutations;
    const showSkills = this.showSkills;

    for (let i = 0; i < activeCount; i++) {
      const eid = dense[i];
      const flag = statusFlags[eid];

      // 过滤未存活墓碑
      if ((flag & IS_ALIVE) === 0) continue;

      // 读取坐标 (Float32Array)
      const tfOffset = eid * TRANSFORM_STRIDE;
      const worldX = transforms[tfOffset + TF_OFFSET_X];
      const worldY = transforms[tfOffset + TF_OFFSET_Y];

      // 6x6 像素点阵中心对齐 (rx = x - 3, ry = y - 3)
      const rx = (worldX - 3.0) | 0;
      const ry = (worldY - 3.0) | 0;

      // 确定种族调色板索引 (factionId 1~12 映射至 12 种族，0 作为容错)
      const idOffset = eid * IDENTITY_STRIDE;
      const factionId = identities[idOffset + ID_OFFSET_FACTION];
      const raceIdx = (factionId > 0 ? (factionId - 1) : 0) % 12;

      // 读取突变表型掩码并绘制突变器官底层或外轮廓点缀
      let phenotype = 0;
      if (genetics && showMutations) {
        phenotype = genetics[eid * GENETICS_STRIDE + GEN_OFFSET_PHENOTYPE];

        // 1. OrganFlags.WING: 背部两侧 2 像素薄翼 (各 2x1 像素)
        if ((phenotype & OrganFlags.WING) !== 0) {
          ctx.fillStyle = COLOR_ORGAN_WING;
          ctx.fillRect(rx - 2, ry + 2, 2, 1);
          ctx.fillRect(rx + 6, ry + 2, 2, 1);
        }

        // 2. OrganFlags.FLAME: 身体边缘带橙红微光 (左右外侧 1x4 像素)
        if ((phenotype & OrganFlags.FLAME) !== 0) {
          ctx.fillStyle = COLOR_ORGAN_FLAME;
          ctx.fillRect(rx - 1, ry + 1, 1, 4);
          ctx.fillRect(rx + 6, ry + 1, 1, 4);
        }
      }

      // 3. 绘制小人主体 (6x6 像素方块)
      ctx.fillStyle = RACE_COLORS[raceIdx];
      ctx.fillRect(rx, ry, 6, 6);

      // 4. 突变器官本体表面斑块与头顶圣环
      if (phenotype !== 0 && showMutations) {
        // OrganFlags.GRANITE: 灰色岩石斑块 (身体中心 2x2 斑块)
        if ((phenotype & OrganFlags.GRANITE) !== 0) {
          ctx.fillStyle = COLOR_ORGAN_GRANITE;
          ctx.fillRect(rx + 2, ry + 2, 2, 2);
        }
        // OrganFlags.HOLY: 头顶淡金圣环 (4x1 像素)
        if ((phenotype & OrganFlags.HOLY) !== 0) {
          ctx.fillStyle = COLOR_ORGAN_HOLY;
          ctx.fillRect(rx + 1, ry - 5, 4, 1);
        }
      }

      // 5. 绘制 1px 眼睛面部像素点 (增添复古像素灵动感)
      ctx.fillStyle = COLOR_EYE;
      ctx.fillRect(rx + 1, ry + 1, 1, 1);
      ctx.fillRect(rx + 4, ry + 1, 1, 1);

      // 6. 领袖外圈与王冠标志 (严格由 statusFlags[id] & IS_LEADER 驱动)
      const isLeader = (flag & IS_LEADER) !== 0;
      if (isLeader) {
        // 亮金色 24px 外发光圈描边与四角发光晶格 (rx - 9, ry - 9, 24x24)
        ctx.strokeStyle = COLOR_LEADER;
        ctx.lineWidth = 1;
        ctx.strokeRect(rx - 9 + 0.5, ry - 9 + 0.5, 23, 23);

        ctx.fillStyle = COLOR_LEADER;
        ctx.fillRect(rx - 9, ry - 9, 2, 2);
        ctx.fillRect(rx + 13, ry - 9, 2, 2);
        ctx.fillRect(rx - 9, ry + 13, 2, 2);
        ctx.fillRect(rx + 13, ry + 13, 2, 2);

        // 金色王冠 (4x2 像素)
        ctx.fillRect(rx + 1, ry - 3, 4, 2);
      }

      // 7. 四大阶级标牌 (Caste Badge, 3x3 像素)
      if (showCastes) {
        let caste = CasteType.CIVILIAN;
        if (castes) {
          caste = castes[eid * CASTE_STRIDE + CASTE_OFFSET_TYPE] | 0;
        } else if (isLeader) {
          caste = CasteType.LEADER;
        }

        if (caste === CasteType.ARTISAN) {
          // ARTISAN: 铁灰色方块 (3x3 像素, #8a8a8a)
          ctx.fillStyle = COLOR_CASTE_ARTISAN;
          ctx.fillRect(rx - 4, ry, 3, 3);
        } else if (caste === CasteType.SOLDIER) {
          // SOLDIER: 暗红色三角 (3x3 像素, #b22222)
          ctx.fillStyle = COLOR_CASTE_SOLDIER;
          ctx.fillRect(rx - 3, ry - 1, 1, 1);
          ctx.fillRect(rx - 4, ry, 3, 2);
        } else if (caste === CasteType.CIVILIAN) {
          // CIVILIAN: 浅褐色微点 (1x1 像素, #a88d75)
          ctx.fillStyle = COLOR_CASTE_CIVILIAN;
          ctx.fillRect(rx - 3, ry + 1, 1, 1);
        }
      }

      // 8. 技能与施法反馈 (IS_CASTING 施法光晕, IS_DISARMED 缴械匕首状态)
      if (showSkills) {
        // IS_CASTING: 施法光晕 (青蓝 10x2 像素脚底光圈)
        if ((flag & IS_CASTING) !== 0) {
          ctx.fillStyle = COLOR_CASTING;
          ctx.fillRect(rx - 2, ry + 7, 10, 2);
        }
        // IS_DISARMED: 处于缴械状态 (拔出备用短刀, 灰红色掉落匕首标记)
        if ((flag & IS_DISARMED) !== 0) {
          ctx.fillStyle = COLOR_DISARMED;
          ctx.fillRect(rx + 7, ry + 2, 2, 3);
          ctx.fillStyle = COLOR_COMBAT;
          ctx.fillRect(rx + 8, ry + 1, 1, 1);
        }
        // IS_SKILL_ACTIVE: 主动技能生效中紫光小点
        if ((flag & IS_SKILL_ACTIVE) !== 0) {
          ctx.fillStyle = COLOR_SKILL_ACTIVE;
          ctx.fillRect(rx + 2, ry - 2, 2, 1);
        }
      }

      // 9. 血条浮标 (8x2 像素条)
      if (showHp) {
        const hpOffset = eid * HEALTH_STRIDE;
        const curHp = health[hpOffset + HP_OFFSET_CURRENT];
        const maxHp = health[hpOffset + HP_OFFSET_MAX];

        if (maxHp > 0.0) {
          const hpRatio = curHp > 0.0 ? (curHp / maxHp) : 0.0;
          const barW = (hpRatio * 8.0) | 0;

          // 黑色血条背景 (8x2)
          ctx.fillStyle = COLOR_BAR_BG;
          ctx.fillRect(rx - 1, ry - 4, 8, 2);

          // 动态三色生命条
          if (barW > 0) {
            ctx.fillStyle = hpRatio > 0.5 ? COLOR_HEALTH_HIGH : (hpRatio > 0.2 ? COLOR_HEALTH_MID : COLOR_HEALTH_LOW);
            ctx.fillRect(rx - 1, ry - 4, barW, 2);
          }
        }
      }

      // 10. 饥饿状态与 10s 通道互斥锁浮标小点
      if (showPips) {
        const physOffset = eid * PHYSIOLOGY_STRIDE;
        const hunger = physiology[physOffset + PHY_OFFSET_HUNGER];
        const lockTimer = physiology[physOffset + PHY_OFFSET_EMERGENCY_LOCK];
        const isMutexLocked = (flag & IS_EMERGENCY_LOCK) !== 0 || lockTimer > 0.0;

        // 饥饿警报浮标 (右上方 2x2 悬浮点：>80 橙色，>90 猩红暴怒)
        if (hunger >= 80.0) {
          ctx.fillStyle = hunger >= 90.0 ? COLOR_HUNGER_CRIT : COLOR_HUNGER_WARN;
          ctx.fillRect(rx + 7, ry - 3, 2, 2);
        }

        // 应急啃食 10s 互斥锁生效指示 (左上方 2x2 亮黄指示灯)
        if (isMutexLocked) {
          ctx.fillStyle = COLOR_MUTEX_LOCK;
          ctx.fillRect(rx - 3, ry - 3, 2, 2);
        }

        // 战斗交火状态红点
        if ((flag & IN_COMBAT) !== 0) {
          ctx.fillStyle = COLOR_COMBAT;
          ctx.fillRect(rx + 2, ry + 7, 2, 2);
        }
      }

      // 11. M3 士气微表情与破釜沉舟死战气焰 (热路径零 GC)
      if (this.showMorale) {
        let moraleState = 0; // 默认 SOLID
        if (moraleSystem && typeof moraleSystem.getMoraleState === 'function') {
          moraleState = moraleSystem.getMoraleState(eid);
        } else if ((flag & IS_PANICKED) !== 0) {
          moraleState = 2; // DISORGANIZED
        }

        // 动摇 (Morale 59~30): 头部右上侧 1 滴微汗小水滴 (1x2 像素)
        if (moraleState === 1) {
          ctx.fillStyle = COLOR_MORALE_SWEAT;
          ctx.fillRect(rx + 5, ry - 3, 1, 2);
        } else if (moraleState >= 2 || (flag & IS_PANICKED) !== 0) {
          // 溃逃 (Morale < 30 或 IS_PANICKED): 头部两侧 2 滴慌张急汗 (各 1x2 像素)
          ctx.fillStyle = COLOR_MORALE_PANIC;
          ctx.fillRect(rx - 2, ry - 3, 1, 2);
          ctx.fillRect(rx + 6, ry - 3, 1, 2);
        }

        // 破釜沉舟死战光环: (flag & IS_LAST_STAND) 燃起暗红死战气焰
        if ((flag & IS_LAST_STAND) !== 0) {
          ctx.fillStyle = COLOR_LAST_STAND_AURA;
          ctx.fillRect(rx - 2, ry + 1, 1, 4);
          ctx.fillRect(rx + 7, ry + 1, 1, 4);
          ctx.fillRect(rx + 1, ry - 2, 4, 1);
          ctx.fillRect(rx + 1, ry + 7, 4, 1);
          ctx.fillStyle = COLOR_LAST_STAND_CORE;
          ctx.fillRect(rx + 2, ry - 1, 2, 1);
        }
      }

      // 12. M3 金身圣盾霸体状态 (IS_SACRED_BODY)
      if (this.showTotemShield && (flag & IS_SACRED_BODY) !== 0) {
        ctx.strokeStyle = COLOR_TOTEM_SHIELD;
        ctx.lineWidth = 1;
        ctx.strokeRect(rx - 3 + 0.5, ry - 3 + 0.5, 11, 11);
        ctx.fillStyle = COLOR_TOTEM_SHIELD;
        ctx.fillRect(rx - 3, ry - 3, 2, 2);
        ctx.fillRect(rx + 7, ry - 3, 2, 2);
        ctx.fillRect(rx - 3, ry + 7, 2, 2);
        ctx.fillRect(rx + 7, ry + 7, 2, 2);
      }
    }
  }
}
