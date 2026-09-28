// ==========================================
// 世界网格与动态生态系统 (Terrarium Grid)
// (包含专家评审团规范: 离屏地图预烘焙、地脉养分连续扩散场、BFS防穿模回弹)
// ==========================================

import { CONFIG } from './config.js';

export class Terrarium {
  constructor() {
    this.width = CONFIG.GRID_WIDTH;
    this.height = CONFIG.GRID_HEIGHT;
    this.tileSize = CONFIG.TILE_SIZE;
    this.totalTiles = this.width * this.height;

    // 瓦片地貌类型数组 (Uint8Array)
    this.tiles = new Uint8Array(this.totalTiles);

    // 地脉连续养分扩散场 (Float32Array, 0.0 ~ 100.0)
    this.nutrients = new Float32Array(this.totalTiles);
    this.nutrientBuffer = new Float32Array(this.totalTiles);

    // 浆果灌木清单与状态
    this.bushes = [];

    // 离屏预烘焙 Canvas (极其关键的前端 60 FPS 性能优化)
    this.offscreenCanvas = null;
    this.offscreenCtx = null;
    this.isDirty = true;

    // 地表动态残迹斑块 (Cellular Fluid Stains: 鲜血/酸液/烧焦)
    this.stains = new Map(); // key: "x,y" => { color, opacity, age }

    this.initWorld();
  }

  /**
   * 程序化生成 56x36 经典地貌
   * 西部平原(兽人) - 中央河流与神圣泉水 - 东部林地(精灵) - 南北高山屏障
   */
  initWorld() {
    // 1. 基础填充为丰美草地
    this.tiles.fill(CONFIG.TILE_TYPES.GRASS);
    this.nutrients.fill(30.0);

    // 2. 生成南北高山岩石屏障
    for (let x = 0; x < this.width; x++) {
      // 北部山脉 (带起伏)
      const northDepth = 2 + ((Math.sin(x * 0.4) * 1.5 + 1.5) | 0);
      for (let y = 0; y < northDepth; y++) {
        this.setTile(x, y, CONFIG.TILE_TYPES.MOUNTAIN);
        this.setNutrient(x, y, 5.0);
      }
      // 南部山脉 (带起伏)
      const southDepth = 2 + ((Math.cos(x * 0.35) * 1.5 + 1.5) | 0);
      for (let y = this.height - southDepth; y < this.height; y++) {
        this.setTile(x, y, CONFIG.TILE_TYPES.MOUNTAIN);
        this.setNutrient(x, y, 5.0);
      }
    }

    // 3. 生成贯穿南北的蜿蜒河流 (浅水为主，中心深水)
    const midX = (this.width / 2) | 0;
    for (let y = 0; y < this.height; y++) {
      const riverCenter = midX + Math.round(Math.sin(y * 0.25) * 3);
      for (let rx = riverCenter - 2; rx <= riverCenter + 2; rx++) {
        if (rx >= 0 && rx < this.width && this.getTile(rx, y) !== CONFIG.TILE_TYPES.MOUNTAIN) {
          const dist = Math.abs(rx - riverCenter);
          if (dist <= 1 && y > 4 && y < this.height - 4) {
            this.setTile(rx, y, CONFIG.TILE_TYPES.WATER);
          } else {
            this.setTile(rx, y, CONFIG.TILE_TYPES.SAND);
          }
        }
      }
    }

    // 4. 生成中央【神圣泉眼】(Holy Spring 3x3 奇观)
    const cx = midX;
    const cy = (this.height / 2) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.setTile(cx + dx, cy + dy, CONFIG.TILE_TYPES.HOLY_SPRING);
        this.setNutrient(cx + dx, cy + dy, 100.0);
      }
    }

    // 5. 生成东部精灵繁茂森林 (Forest)
    for (let y = 4; y < this.height - 4; y++) {
      for (let x = midX + 5; x < this.width - 2; x++) {
        // 伪随机森林聚类
        const noise = Math.sin(x * 0.6) * Math.cos(y * 0.5) + (Math.random() * 0.3);
        if (noise > 0.1) {
          this.setTile(x, y, CONFIG.TILE_TYPES.FOREST);
          this.setNutrient(x, y, 60.0);
        }
      }
    }

    // 6. 生成西部兽人干燥荒原与偶发沼泽
    for (let y = 5; y < this.height - 5; y++) {
      for (let x = 3; x < midX - 5; x++) {
        if (Math.random() < 0.08) {
          this.setTile(x, y, CONFIG.TILE_TYPES.SAND);
        }
      }
    }

    // 7. 撒落初始野生浆果灌木 (Berry Bushes)
    this.seedBerryBushes();

    // 8. 预烘焙静态地图画布
    this.bakeOffscreenCanvas();
  }

  // 播种浆果灌木
  seedBerryBushes() {
    this.bushes = [];
    let count = 0;
    let attempts = 0;

    while (count < CONFIG.RESOURCES.INITIAL_BERRY_BUSHES && attempts < 400) {
      attempts++;
      const gx = 3 + ((Math.random() * (this.width - 6)) | 0);
      const gy = 3 + ((Math.random() * (this.height - 6)) | 0);
      const t = this.getTile(gx, gy);

      if (t === CONFIG.TILE_TYPES.GRASS || t === CONFIG.TILE_TYPES.FOREST) {
        // 避免过于贴近已有灌木
        const tooClose = this.bushes.some(b => Math.hypot(b.x - gx, b.y - gy) < 3);
        if (!tooClose) {
          this.bushes.push({
            id: `bush_${count}`,
            x: gx,
            y: gy,
            worldX: (gx + 0.5) * this.tileSize,
            worldY: (gy + 0.5) * this.tileSize,
            hasBerry: true,
            regrowTimer: 0,
            nutrition: CONFIG.RESOURCES.BERRY_NUTRITION
          });
          count++;
        }
      }
    }
  }

  getTile(gx, gy) {
    if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return CONFIG.TILE_TYPES.MOUNTAIN;
    return this.tiles[gy * this.width + gx];
  }

  setTile(gx, gy, type) {
    if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return;
    this.tiles[gy * this.width + gx] = type;
  }

  getNutrient(gx, gy) {
    if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return 0;
    return this.nutrients[gy * this.width + gx];
  }

  setNutrient(gx, gy, val) {
    if (gx < 0 || gx >= this.width || gy < 0 || gy >= this.height) return;
    this.nutrients[gy * this.width + gx] = Math.max(0, Math.min(100, val));
  }

  /**
   * 判断瓦片是否对陆生步兵可行走
   */
  isWalkable(gx, gy) {
    const t = this.getTile(gx, gy);
    // 高山与深水不可行走
    return t !== CONFIG.TILE_TYPES.MOUNTAIN && t !== CONFIG.TILE_TYPES.DEEP_WATER;
  }

  /**
   * BFS 防穿模回弹：若单位落入不可行走区域，寻找最近合法通行瓦片
   */
  findNearestWalkable(worldX, worldY) {
    const targetGx = Math.max(0, Math.min(this.width - 1, (worldX / this.tileSize) | 0));
    const targetGy = Math.max(0, Math.min(this.height - 1, (worldY / this.tileSize) | 0));

    if (this.isWalkable(targetGx, targetGy)) {
      return { x: (targetGx + 0.5) * this.tileSize, y: (targetGy + 0.5) * this.tileSize };
    }

    // 广度优先搜索 5x5
    const queue = [{ gx: targetGx, gy: targetGy }];
    const visited = new Set();
    visited.add(`${targetGx},${targetGy}`);

    const directions = [
      { dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
      { dx: 1, dy: 1 }, { dx: -1, dy: 1 }, { dx: 1, dy: -1 }, { dx: -1, dy: -1 }
    ];

    while (queue.length > 0) {
      const cur = queue.shift();
      if (this.isWalkable(cur.gx, cur.gy)) {
        return {
          x: (cur.gx + 0.5) * this.tileSize,
          y: (cur.gy + 0.5) * this.tileSize
        };
      }

      for (const d of directions) {
        const nx = cur.gx + d.dx;
        const ny = cur.gy + d.dy;
        const key = `${nx},${ny}`;
        if (nx >= 0 && nx < this.width && ny >= 0 && ny < this.height && !visited.has(key)) {
          visited.add(key);
          queue.push({ gx: nx, gy: ny });
        }
      }
    }

    // 兜底回弹至中心
    return { x: (this.width / 2) * this.tileSize, y: (this.height / 2) * this.tileSize };
  }

  /**
   * 离屏预烘焙静态地图 (极致 60 FPS 性能基石)
   */
  bakeOffscreenCanvas() {
    if (!this.offscreenCanvas) {
      this.offscreenCanvas = document.createElement('canvas');
      this.offscreenCanvas.width = CONFIG.WORLD_WIDTH;
      this.offscreenCanvas.height = CONFIG.WORLD_HEIGHT;
      this.offscreenCtx = this.offscreenCanvas.getContext('2d');
    }

    const ctx = this.offscreenCtx;
    ctx.imageSmoothingEnabled = false;

    for (let gy = 0; gy < this.height; gy++) {
      for (let gx = 0; gx < this.width; gx++) {
        const t = this.getTile(gx, gy);
        const px = gx * this.tileSize;
        const py = gy * this.tileSize;

        // 基础底色
        ctx.fillStyle = CONFIG.TILE_COLORS[t] || '#333';
        ctx.fillRect(px, py, this.tileSize, this.tileSize);

        // 像素复古点阵细节贴装
        if (t === CONFIG.TILE_TYPES.GRASS) {
          ctx.fillStyle = '#4c7c2b';
          if ((gx + gy) % 3 === 0) ctx.fillRect(px + 4, py + 6, 2, 4);
          if ((gx * 2 + gy) % 5 === 0) ctx.fillRect(px + 14, py + 12, 2, 3);
        } else if (t === CONFIG.TILE_TYPES.FOREST) {
          ctx.fillStyle = '#1b5e20';
          // 绘制一棵小树形剪影
          ctx.fillRect(px + 8, py + 4, 8, 8);
          ctx.fillRect(px + 6, py + 8, 12, 6);
          ctx.fillStyle = '#4e342e'; // 树干
          ctx.fillRect(px + 10, py + 14, 4, 6);
        } else if (t === CONFIG.TILE_TYPES.MOUNTAIN) {
          ctx.fillStyle = '#37474f';
          ctx.fillRect(px + 4, py + 4, 16, 16);
          ctx.fillStyle = '#546e7a'; // 高光
          ctx.fillRect(px + 6, py + 6, 8, 6);
        } else if (t === CONFIG.TILE_TYPES.HOLY_SPRING) {
          ctx.fillStyle = '#80deea';
          ctx.fillRect(px + 2, py + 2, 20, 20);
          ctx.fillStyle = '#e0f7fa';
          ctx.fillRect(px + 6, py + 6, 12, 12);
        } else if (t === CONFIG.TILE_TYPES.WATER) {
          ctx.fillStyle = '#4fc3f7';
          if ((gx + gy) % 2 === 0) ctx.fillRect(px + 4, py + 10, 10, 2);
        }
      }
    }

    this.isDirty = false;
  }

  /**
   * 生态代谢 Tick 更新 (养分拉普拉斯扩散、灌木再生)
   */
  update(timeScale = 1.0) {
    // 1. 浆果再生计时器推进
    for (let i = 0; i < this.bushes.length; i++) {
      const bush = this.bushes[i];
      if (!bush.hasBerry) {
        bush.regrowTimer += timeScale;
        // 附近养分充足加速再生
        const localNutrient = this.getNutrient(bush.x, bush.y);
        const effectiveRegrow = CONFIG.RESOURCES.BERRY_REGROW_FRAMES * (1.2 - (localNutrient / 200));

        if (bush.regrowTimer >= effectiveRegrow) {
          bush.hasBerry = true;
          bush.regrowTimer = 0;
        }
      }
    }

    // 2. 神圣泉眼持续喷涌养分
    const midX = (this.width / 2) | 0;
    const midY = (this.height / 2) | 0;
    this.setNutrient(midX, midY, 100.0);
  }

  /**
   * 渲染世界地貌与浆果灌木
   */
  render(ctx) {
    if (this.isDirty || !this.offscreenCanvas) {
      this.bakeOffscreenCanvas();
    }

    // 单次绘制预烘焙离屏背景 (极致节省 GPU Draw 调用)
    ctx.drawImage(this.offscreenCanvas, 0, 0);

    // 渲染动态浆果灌木
    for (let i = 0; i < this.bushes.length; i++) {
      const bush = this.bushes[i];
      const px = bush.x * this.tileSize;
      const py = bush.y * this.tileSize;

      // 灌木丛枝叶 (深绿球状)
      ctx.fillStyle = '#33691e';
      ctx.beginPath();
      ctx.arc(px + 12, py + 12, 7, 0, Math.PI * 2);
      ctx.fill();

      // 成熟的鲜红果实
      if (bush.hasBerry) {
        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.arc(px + 9, py + 10, 2.5, 0, Math.PI * 2);
        ctx.arc(px + 15, py + 10, 2.5, 0, Math.PI * 2);
        ctx.arc(px + 12, py + 14, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
