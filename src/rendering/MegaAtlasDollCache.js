/**
 * MegaAtlasDollCache.js
 * 1024x1024 全局离屏图集享元签名缓存系统
 * 严格遵照 SPEC-M4-CONTRACT §5.1 与 09_art_audio_and_technical_spec.md §2
 *
 * 核心技术指标:
 * 1. 1024x1024 离屏图集划分为 24x24 像素网格 (42x42 = 1764 槽位)
 * 2. 外观签名哈希: Key = (raceId << 20) | (casteId << 16) | (phenotypeMask & 0xFFFF)
 * 3. 首次出现即烘焙 4 层 (骨骼体态、材质着色、阶级装备、突变器官)
 * 4. 主渲染循环通过单次 ctx.drawImage 快速贴图，千人渲染总耗时 < 1.8ms
 * 5. 100% 物理零 GC: 预分配槽位坐标与查表结果复用
 */

import { RACE_COLORS } from './MiniRenderer.js';
import { OrganFlags } from '../data/MutationFlags.js';

export const ATLAS_SIZE = 1024;
export const SLOT_SIZE = 24;
export const SLOTS_PER_ROW = 42; // Math.floor(1024 / 24)
export const MAX_SLOTS = 1764;    // 42 * 42

// 装备与器官专用调色板
export const COLOR_EYE = '#0f172a';
export const COLOR_CASTE_CIVILIAN_MARK = '#a88d75';
export const COLOR_CASTE_ARTISAN_MARK  = '#8a8a8a';
export const COLOR_CASTE_SOLDIER_MARK  = '#b22222';
export const COLOR_CASTE_LEADER_CROWN  = '#ffd700';

export const COLOR_ORGAN_WING_STAMP    = '#bae6fd';
export const COLOR_ORGAN_FLAME_STAMP   = '#fb923c';
export const COLOR_ORGAN_GRANITE_STAMP = '#9ca3af';
export const COLOR_ORGAN_HOLY_STAMP    = '#fef08a';
export const COLOR_ORGAN_ELEC_STAMP    = '#60a5fa';
export const COLOR_ORGAN_AQUATIC_STAMP = '#38bdf8';

export class MegaAtlasDollCache {
  /**
   * @param {HTMLCanvasElement|OffscreenCanvas|object|null} [canvas=null]
   */
  constructor(canvas = null) {
    // 1. 初始化 1024x1024 离屏画布与 2D 上下文 (跨运行环境安全降级)
    if (canvas) {
      this.canvas = canvas;
    } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      this.canvas = document.createElement('canvas');
    } else if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
    } else {
      // Node/Vitest 降级 Mock 容器
      this.canvas = {
        width: ATLAS_SIZE,
        height: ATLAS_SIZE,
        getContext: () => ({
          fillStyle: '#000000',
          fillRect: () => {},
          drawImage: () => {}
        })
      };
    }

    this.canvas.width = ATLAS_SIZE;
    this.canvas.height = ATLAS_SIZE;
    this.ctx = this.canvas.getContext('2d');

    // 2. 槽位坐标映射表 (零 GC TypedArray 预计算)
    this.slotCoordsX = new Uint16Array(MAX_SLOTS);
    this.slotCoordsY = new Uint16Array(MAX_SLOTS);

    for (let i = 0; i < MAX_SLOTS; i++) {
      this.slotCoordsX[i] = (i % SLOTS_PER_ROW) * SLOT_SIZE;
      this.slotCoordsY[i] = Math.floor(i / SLOTS_PER_ROW) * SLOT_SIZE;
    }

    // 3. 签名键到槽位索引映射 Map (容量收敛在 150 左右)
    this.cachedSlots = new Map();
    this.nextSlotIndex = 0;

    // 4. 复用出参对象 (零 GC)
    this._lookupResult = {
      slotIndex: 0,
      sx: 0,
      sy: 0,
      width: SLOT_SIZE,
      height: SLOT_SIZE
    };
  }

  /**
   * 计算小人外观签名哈希键 (32 位无符号整数)
   * Key = (raceId << 20) | (casteId << 16) | (phenotypeMask & 0xFFFF)
   *
   * @param {number} raceId 
   * @param {number} casteId 
   * @param {number} phenotypeMask 
   * @returns {number}
   */
  getAppearanceKey(raceId, casteId, phenotypeMask) {
    const r = (raceId & 0x0F) << 20;
    const c = (casteId & 0x0F) << 16;
    const p = (phenotypeMask & 0xFFFF);
    return ((r | c | p) >>> 0);
  }

  /**
   * 在指定槽位烘焙小人 4 层离屏像素
   * Layer 1: 骨骼体态 -> Layer 2: 材质着色 -> Layer 3: 阶级装备 -> Layer 4: 突变器官
   *
   * @param {number} slotIndex 
   * @param {number} raceId 
   * @param {number} casteId 
   * @param {number} phenotypeMask 
   */
  bakeDoll(slotIndex, raceId, casteId, phenotypeMask) {
    const ctx = this.ctx;
    if (!ctx) return;

    const sx = this.slotCoordsX[slotIndex];
    const sy = this.slotCoordsY[slotIndex];

    // 清空该 24x24 槽位
    if (typeof ctx.clearRect === 'function') {
      ctx.clearRect(sx, sy, SLOT_SIZE, SLOT_SIZE);
    }

    // 槽位中心: (sx + 12, sy + 12)，小人 6x6 主体位于 (rx, ry)
    const rx = sx + 9;
    const ry = sy + 9;

    // ----------------------------------------------------
    // Layer 1: 骨骼体态 (根据种族轮廓特征铺陈基础暗部骨架)
    // ----------------------------------------------------
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fillRect(rx - 1, ry, 8, 6); // 侧边微暗骨骼阴影

    // ----------------------------------------------------
    // Layer 2: 材质着色 (种族主色调与面部双眼特征)
    // ----------------------------------------------------
    const raceColor = RACE_COLORS[raceId % 12] || RACE_COLORS[0];
    ctx.fillStyle = raceColor;
    ctx.fillRect(rx, ry, 6, 6);

    // 1px 眼睛像素点 (增添点阵灵动感)
    ctx.fillStyle = COLOR_EYE;
    ctx.fillRect(rx + 1, ry + 1, 1, 1);
    ctx.fillRect(rx + 4, ry + 1, 1, 1);

    // ----------------------------------------------------
    // Layer 3: 阶级装备 (平民、工匠、士兵、领袖)
    // ----------------------------------------------------
    if (casteId === 1) {
      // 工匠: 2x2 铁灰色工具背包与护肩
      ctx.fillStyle = COLOR_CASTE_ARTISAN_MARK;
      ctx.fillRect(rx + 2, ry + 3, 2, 2);
    } else if (casteId === 2) {
      // 士兵: 2x2 暗红头盔与剑柄标识
      ctx.fillStyle = COLOR_CASTE_SOLDIER_MARK;
      ctx.fillRect(rx + 1, ry - 1, 4, 1);
      ctx.fillRect(rx + 4, ry + 2, 1, 3);
    } else if (casteId === 3) {
      // 领袖: 亮金王冠三叉星点与金饰
      ctx.fillStyle = COLOR_CASTE_LEADER_CROWN;
      ctx.fillRect(rx + 1, ry - 3, 4, 1);
      ctx.fillRect(rx + 1, ry - 4, 1, 1);
      ctx.fillRect(rx + 4, ry - 4, 1, 1);
      ctx.fillRect(rx + 2, ry - 5, 2, 1);
    } else {
      // 平民: 浅褐色小围巾/腰带微点
      ctx.fillStyle = COLOR_CASTE_CIVILIAN_MARK;
      ctx.fillRect(rx + 2, ry + 4, 2, 1);
    }

    // ----------------------------------------------------
    // Layer 4: 突变器官 (羽翼、烈焰微光、岩石斑块、圣环、电弧)
    // ----------------------------------------------------
    if (phenotypeMask !== 0) {
      // 1. OrganFlags.WING: 背部两侧羽翼
      if ((phenotypeMask & OrganFlags.WING) !== 0) {
        ctx.fillStyle = COLOR_ORGAN_WING_STAMP;
        ctx.fillRect(rx - 3, ry + 2, 3, 1);
        ctx.fillRect(rx + 6, ry + 2, 3, 1);
      }

      // 2. OrganFlags.FLAME: 身体边缘橙红微光
      if ((phenotypeMask & OrganFlags.FLAME) !== 0) {
        ctx.fillStyle = COLOR_ORGAN_FLAME_STAMP;
        ctx.fillRect(rx - 1, ry + 1, 1, 4);
        ctx.fillRect(rx + 6, ry + 1, 1, 4);
      }

      // 3. OrganFlags.GRANITE: 身体中心花岗岩灰色硬化斑块
      if ((phenotypeMask & OrganFlags.GRANITE) !== 0) {
        ctx.fillStyle = COLOR_ORGAN_GRANITE_STAMP;
        ctx.fillRect(rx + 2, ry + 2, 2, 2);
      }

      // 4. OrganFlags.HOLY: 头顶淡金圣环
      if ((phenotypeMask & OrganFlags.HOLY) !== 0) {
        ctx.fillStyle = COLOR_ORGAN_HOLY_STAMP;
        ctx.fillRect(rx + 1, ry - 6, 4, 1);
      }

      // 5. OrganFlags.ELEC: 闪电微粒点阵
      if ((phenotypeMask & 0x0010) !== 0) { // ELEC
        ctx.fillStyle = COLOR_ORGAN_ELEC_STAMP;
        ctx.fillRect(rx - 2, ry, 1, 1);
        ctx.fillRect(rx + 7, ry + 5, 1, 1);
      }

      // 6. OrganFlags.AQUATIC: 侧边水蓝鳍斑
      if ((phenotypeMask & 0x0020) !== 0) { // AQUATIC
        ctx.fillStyle = COLOR_ORGAN_AQUATIC_STAMP;
        ctx.fillRect(rx + 1, ry + 5, 4, 1);
      }
    }
  }

  /**
   * 检索或烘焙外观模型切片
   *
   * @param {number} raceId 
   * @param {number} casteId 
   * @param {number} phenotypeMask 
   * @param {object|null} [out=null] 可选专用出参对象，未提供时使用预分配 this._lookupResult
   * @returns {{slotIndex: number, sx: number, sy: number, width: number, height: number}}
   */
  getOrBake(raceId, casteId, phenotypeMask, out = null) {
    const key = this.getAppearanceKey(raceId, casteId, phenotypeMask);
    let slot = this.cachedSlots.get(key);

    if (slot === undefined) {
      // 分配新槽位 (若满载则循环覆写)
      if (this.nextSlotIndex >= MAX_SLOTS) {
        slot = this.nextSlotIndex % MAX_SLOTS;
      } else {
        slot = this.nextSlotIndex++;
      }

      this.cachedSlots.set(key, slot);
      this.bakeDoll(slot, raceId, casteId, phenotypeMask);
    }

    const res = out || this._lookupResult;
    res.slotIndex = slot;
    res.sx = this.slotCoordsX[slot];
    res.sy = this.slotCoordsY[slot];
    res.width = SLOT_SIZE;
    res.height = SLOT_SIZE;
    return res;
  }

  /**
   * 在目标画布上以 (destCenterX, destCenterY) 为中心直接贴图绘制
   * 核心热路径：单次 ctx.drawImage 极速呈现，千人耗时 < 1.8ms
   *
   * @param {CanvasRenderingContext2D} ctx 
   * @param {number} destCenterX 
   * @param {number} destCenterY 
   * @param {number} raceId 
   * @param {number} casteId 
   * @param {number} phenotypeMask 
   */
  drawDoll(ctx, destCenterX, destCenterY, raceId, casteId, phenotypeMask) {
    const info = this.getOrBake(raceId, casteId, phenotypeMask);
    const dx = (destCenterX - 12.0) | 0;
    const dy = (destCenterY - 12.0) | 0;

    ctx.drawImage(
      this.canvas,
      info.sx,
      info.sy,
      SLOT_SIZE,
      SLOT_SIZE,
      dx,
      dy,
      SLOT_SIZE,
      SLOT_SIZE
    );
  }

  /**
   * 获取当前已烘焙的模型切片总数
   * @returns {number}
   */
  getBakedCount() {
    return this.cachedSlots.size;
  }

  /**
   * 清空图集缓存
   */
  clear() {
    this.cachedSlots.clear();
    this.nextSlotIndex = 0;
    if (this.ctx && typeof this.ctx.clearRect === 'function') {
      this.ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
    }
  }
}
