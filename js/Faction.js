// ==========================================
// 部落阵营与图腾系统 (Faction & Totem Anchor)
// (包含专家评审团规范: 图腾绝对不可抓取锁、领地影响圈、人口繁衍统计)
// ==========================================

import { CONFIG } from './config.js';

export class Faction {
  constructor(factionConfig, totemTileX, totemTileY) {
    this.id = factionConfig.id;
    this.name = factionConfig.name;
    this.color = factionConfig.color;
    this.bannerColor = factionConfig.bannerColor;
    this.accentColor = factionConfig.accentColor;

    // 核心基地图腾 (世界的法理与几何空间之锚，QA 绝对防死锁红线)
    this.totem = {
      isAnchor: true, // 核心标记：绝对禁止被上帝之手抓取或物理抛掷！
      tileX: totemTileX,
      tileY: totemTileY,
      worldX: (totemTileX + 0.5) * CONFIG.TILE_SIZE,
      worldY: (totemTileY + 0.5) * CONFIG.TILE_SIZE,
      radius: 18,
      hp: 1000,
      maxHp: 1000,
      shieldActive: false,
      chainVibrateTimer: 0 // 被上帝之手尝试抓取时的锁链抗拒震颤计时器
    };

    // 族群人口与世代历史
    this.members = [];
    this.population = 0;
    this.generation = 1;
    this.totalBirths = 0;
    this.totalDeaths = 0;

    // 领地影响圈
    this.influenceRadius = 7 * CONFIG.TILE_SIZE; // 像素半径
  }

  // 触发图腾受天意干扰时的金色神圣锁链震颤
  triggerTotemResist() {
    this.totem.chainVibrateTimer = 18; // 持续 18 帧震颤
  }

  update(timeScale = 1.0) {
    if (this.totem.chainVibrateTimer > 0) {
      this.totem.chainVibrateTimer -= timeScale;
    }

    // 领地半径随存活人口微调
    this.population = this.members.length;
    this.influenceRadius = (7 + Math.min(10, Math.sqrt(this.population) * 1.8)) * CONFIG.TILE_SIZE;
  }

  /**
   * 渲染图腾建筑与领地影响光晕
   */
  render(ctx) {
    const tx = this.totem.worldX;
    const ty = this.totem.worldY;

    // 1. 领地半透明势力范围光晕
    ctx.save();
    ctx.strokeStyle = this.bannerColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(tx, ty, this.influenceRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = this.bannerColor;
    ctx.globalAlpha = 0.04;
    ctx.fill();
    ctx.restore();

    // 2. 图腾建筑实体
    ctx.save();
    let shakeX = 0;
    let shakeY = 0;

    // 若触发了不可抓取锁链抗拒，产生剧烈震颤
    if (this.totem.chainVibrateTimer > 0) {
      shakeX = (Math.random() - 0.5) * 6;
      shakeY = (Math.random() - 0.5) * 6;

      // 绘制神圣金色锁链环绕特效
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(tx + shakeX, ty + shakeY, 26, 0, Math.PI * 2);
      ctx.stroke();

      // 文字提示
      ctx.fillStyle = '#fbbf24';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⛓️ 大地之锚不可撼动！', tx, ty - 32);
    }

    const drawX = tx + shakeX;
    const drawY = ty + shakeY;

    if (this.id === 'ORC') {
      // 绿皮兽骨图腾柱
      ctx.fillStyle = '#78350f'; // 粗壮木柱
      ctx.fillRect(drawX - 6, drawY - 18, 12, 28);
      // 兽骨尖刺横梁
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(drawX - 16, drawY - 12, 32, 5);
      // 血红旗帜
      ctx.fillStyle = '#dc2626';
      ctx.beginPath();
      ctx.moveTo(drawX - 6, drawY - 18);
      ctx.lineTo(drawX - 18, drawY - 10);
      ctx.lineTo(drawX - 6, drawY - 6);
      ctx.fill();
      // 顶端巨型兽角
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(drawX - 8, drawY - 22, 4, 6);
      ctx.fillRect(drawX + 4, drawY - 22, 4, 6);
    } else {
      // 森灵神木神龛
      ctx.fillStyle = '#15803d'; // 碧绿神树主干
      ctx.fillRect(drawX - 7, drawY - 20, 14, 30);
      // 茂密神圣树冠
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(drawX, drawY - 20, 14, 0, Math.PI * 2);
      ctx.fill();
      // 悬浮自然符文石
      ctx.fillStyle = '#60a5fa';
      ctx.fillRect(drawX - 3, drawY - 32, 6, 8);
      // 碧蓝飘带
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect(drawX + 8, drawY - 16, 8, 4);
    }

    // 图腾血量条 (稳固状态)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(drawX - 14, drawY + 14, 28, 4);
    ctx.fillStyle = this.bannerColor;
    ctx.fillRect(drawX - 14, drawY + 14, 28 * (this.totem.hp / this.totem.maxHp), 4);

    // 阵营标牌
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.name} [${this.population}人]`, drawX, drawY + 26);

    ctx.restore();
  }
}
