// ==========================================
// 小人实体类与状态机 (Unit & Doll Stamp Cache)
// (包含专家评审团规范: 7:2:1色彩律、离屏雪碧图单次烘焙、物理质量推力、四大生存代谢)
// ==========================================

import { CONFIG } from './config.js';

export class Unit {
  constructor(index, faction, x, y, options = {}) {
    this.index = index;
    this.id = options.id || `unit_${faction.id}_${index}_${Date.now() % 10000}`;
    this.factionId = faction.id;
    this.faction = faction;

    // 空间位置与物理动量
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;

    // 物理质量 (专家规范: Mass 决定碰撞击飞与坠落冲击)
    this.mass = options.mass || faction.mass || 1.0;

    // 生存代谢范式 (MARAUDER / AGRARIAN / HUNTER / INORGANIC)
    this.metabolism = faction.metabolism || CONFIG.METABOLISM_TYPES.AGRARIAN;

    // 生理属性
    this.maxHp = faction.baseHp || 100;
    this.hp = this.maxHp;
    this.speed = faction.baseSpeed || 1.0;
    this.hunger = options.hunger !== undefined ? options.hunger : 60 + Math.random() * 30; // 0~100
    this.hungerRate = faction.hungerDepletionRate || 0.1;
    this.breedThreshold = faction.breedThreshold || 80;
    this.isDead = false;

    // 身份与职业
    const nameList = faction.names || ['无名氏'];
    this.name = options.name || nameList[(Math.random() * nameList.length) | 0];
    const titleList = faction.titles || ['平民'];
    this.title = options.title || titleList[(Math.random() * titleList.length) | 0];
    this.generation = options.generation || 1;
    this.age = options.age || 0; // 纪元岁数

    // 状态机
    // IDLE | FORAGING | BRAWLING | MEDITATING | BREEDING | SUSPENDED | THROWN | LAND_SHOCKED
    this.state = 'IDLE';
    this.stateTimer = 60 + Math.random() * 120;
    this.target = null; // 目标 (灌木/食物/同伴/图腾)

    // 上帝之手抓取物理状态
    this.isGrabbed = false;
    this.tetherX = x;
    this.tetherY = y;
    this.landShockTimer = 0;

    // 视觉反馈 (专家规范: 2 帧 Flash White 替代马赛克粒子)
    this.flashWhiteFrames = 0;
    this.emotionEmoji = null;
    this.emotionTimer = 0;

    // 宿怨清单 (Blood Ledger: 最多 3 条宿仇)
    this.bloodLedger = [];

    // 离屏雪碧图单次烘焙缓存 (Doll Stamp Cache)
    this.stamp = null;
    this.bakeStamp();
  }

  /**
   * 离屏微型 Canvas (24x24) 单次烘焙纸娃娃剪影 (极致 60 FPS 性能基石)
   * 贯彻 7:2:1 色彩面积律: 70% 躯干底色、20% 阵营标志色、10% 变异发光点缀
   */
  bakeStamp() {
    const stampCanvas = document.createElement('canvas');
    stampCanvas.width = 24;
    stampCanvas.height = 24;
    const sctx = stampCanvas.getContext('2d');
    sctx.imageSmoothingEnabled = false;

    const bodyColor = this.faction.color;
    const bannerColor = this.faction.bannerColor;
    const accentColor = this.faction.accentColor;

    if (this.factionId === 'ORC') {
      // 绿皮兽人: 粗壮方体剪影 (身长 15px)
      // 1. 粗壮身躯 (70%)
      sctx.fillStyle = bodyColor;
      sctx.fillRect(7, 7, 10, 11);
      // 2. 兽皮护肩与战裙 (20% 阵营色)
      sctx.fillStyle = bannerColor;
      sctx.fillRect(6, 6, 12, 3);
      sctx.fillRect(7, 15, 10, 3);
      // 3. 头部野蛮巨角 (10% 点缀)
      sctx.fillStyle = '#f8fafc';
      sctx.fillRect(5, 5, 2, 4);
      sctx.fillRect(17, 5, 2, 4);
      // 4. 眼睛与粗眉
      sctx.fillStyle = '#0f172a';
      sctx.fillRect(9, 9, 2, 2);
      sctx.fillRect(13, 9, 2, 2);
      // 5. 手持骨棒
      sctx.fillStyle = '#cbd5e1';
      sctx.fillRect(17, 10, 3, 8);
    } else {
      // 森灵树民: 轻盈纤细剪影 (身长 16px)
      // 1. 修长身段 (70%)
      sctx.fillStyle = bodyColor;
      sctx.fillRect(8, 6, 8, 12);
      // 2. 飘逸绿袍与肩饰 (20% 阵营色)
      sctx.fillStyle = bannerColor;
      sctx.fillRect(7, 7, 10, 4);
      sctx.fillRect(8, 14, 8, 4);
      // 3. 尖细长耳 (10% 点缀)
      sctx.fillStyle = accentColor;
      sctx.fillRect(5, 6, 3, 2);
      sctx.fillRect(16, 6, 3, 2);
      // 4. 晶莹碧眼
      sctx.fillStyle = '#22d3ee';
      sctx.fillRect(10, 8, 2, 2);
      sctx.fillRect(12, 8, 2, 2);
      // 5. 手持翠绿木杖
      sctx.fillStyle = '#854d0e';
      sctx.fillRect(16, 8, 2, 10);
      sctx.fillStyle = '#4ade80';
      sctx.fillRect(15, 6, 4, 3);
    }

    this.stamp = stampCanvas;
  }

  showEmotion(emoji, duration = 90) {
    this.emotionEmoji = emoji;
    this.emotionTimer = duration;
  }

  /**
   * 状态机与自主行为逻辑 Tick (每帧更新)
   */
  update(terrarium, faction, spatialGrid, audioEngine, onLog, timeScale = 1.0) {
    if (this.isDead) return;

    // 1. 情绪计时器递减
    if (this.emotionTimer > 0) {
      this.emotionTimer -= timeScale;
      if (this.emotionTimer <= 0) this.emotionEmoji = null;
    }

    // 2. 受创闪白计时器
    if (this.flashWhiteFrames > 0) {
      this.flashWhiteFrames -= timeScale;
    }

    // 3. 落地惊魂保护
    if (this.landShockTimer > 0) {
      this.landShockTimer -= timeScale;
      this.vx *= 0.8;
      this.vy *= 0.8;
      return;
    }

    // 4. 若正被上帝之手抓起或在物理抛射中
    if (this.state === 'SUSPENDED') {
      return; // 坐标完全由 GodHand 驱动
    }

    if (this.state === 'THROWN') {
      // 物理抛物线运动 + 空气阻力
      this.x += this.vx * timeScale;
      this.y += this.vy * timeScale;
      this.vx *= 0.94;
      this.vy *= 0.94;

      // 世界刚性边界 Clamp
      this.clampToBounds();

      if (Math.hypot(this.vx, this.vy) < 0.8) {
        // 着陆判定 (Land Event)
        this.vx = 0;
        this.vy = 0;
        this.state = 'LAND_SHOCKED';
        this.landShockTimer = 35; // 约 0.6s 爬起
        audioEngine.playLand();

        // BFS 防穿模回弹
        const safePos = terrarium.findNearestWalkable(this.x, this.y);
        this.x = safePos.x;
        this.y = safePos.y;

        onLog({
          type: 'LAND',
          unit: this,
          message: `${this.name} 摔了个倒栽葱，屁股着地弹起，头晕目眩！`
        });
      }
      return;
    }

    // 5. 生理代谢与饥饿消耗 (不同范式区别处理)
    if (this.metabolism !== CONFIG.METABOLISM_TYPES.INORGANIC) {
      this.hunger -= this.hungerRate * timeScale * 0.05;
      if (this.hunger < 0) {
        this.hunger = 0;
        this.hp -= 0.05 * timeScale; // 挨饿扣血
        if (this.hp <= 0) {
          this.isDead = true;
          onLog({
            type: 'STARVE',
            unit: this,
            message: `${this.name} 因长期未寻得食粮，饥寒交迫，化为大地养分。`
          });
          return;
        }
      }
    }

    // 6. 状态机推进
    this.stateTimer -= timeScale;

    // 饥饿驱动觅食 (Hunger Trigger)
    if (this.hunger < 45 && this.state !== 'FORAGING' && this.state !== 'RAIDING') {
      this.startForaging(terrarium);
    }

    // 饱腹且在图腾附近驱动繁衍 (Breeding Trigger)
    if (this.hunger >= this.breedThreshold && this.state === 'IDLE' && faction.members.length < 50) {
      const distToTotem = Math.hypot(this.x - faction.totem.worldX, this.y - faction.totem.worldY);
      if (distToTotem < 40 && Math.random() < 0.02) {
        this.breed(faction, audioEngine, onLog);
      }
    }

    switch (this.state) {
      case 'IDLE':
        this.handleIdle(faction, audioEngine, onLog, timeScale);
        break;

      case 'FORAGING':
        this.handleForaging(terrarium, audioEngine, onLog, timeScale);
        break;

      case 'BRAWLING':
        this.handleBrawling(audioEngine, onLog, timeScale);
        break;

      case 'MEDITATING':
        this.handleMeditating(terrarium, audioEngine, timeScale);
        break;
    }

    // 边界刚性 Clamp
    this.clampToBounds();

    // 插入空间哈希网格 (零 GC 索引)
    spatialGrid.insert(this.index, this.x, this.y);
  }

  clampToBounds() {
    const margin = 14;
    this.x = Math.max(margin, Math.min(CONFIG.WORLD_WIDTH - margin, this.x));
    this.y = Math.max(margin, Math.min(CONFIG.WORLD_HEIGHT - margin, this.y));
  }

  // 闲逛行为
  handleIdle(faction, audioEngine, onLog, timeScale) {
    if (this.stateTimer <= 0) {
      this.stateTimer = 90 + Math.random() * 150;

      // 种族专属挂机行为倾向
      if (this.factionId === 'ORC') {
        // 绿皮日常: 摔跤角力互掐 (40% 几率)
        if (Math.random() < 0.45) {
          this.state = 'BRAWLING';
          this.stateTimer = 100;
          this.showEmotion('💢', 60);
          audioEngine.playBrawl();
          onLog({
            type: 'BRAWL',
            unit: this,
            message: `【粗野角力】${this.name} 嗷嗷大叫，一把抱住旁边的同伴摔跤练兵！`
          });
          return;
        }
      } else if (this.factionId === 'ELF') {
        // 森灵日常: 树下祈祷冥想 (40% 几率)
        if (Math.random() < 0.45) {
          this.state = 'MEDITATING';
          this.stateTimer = 140;
          this.showEmotion('✨', 90);
          audioEngine.playMeditate();
          return;
        }
      }

      // 普通微量巡逻位移
      const angle = Math.random() * Math.PI * 2;
      this.vx = Math.cos(angle) * this.speed * 0.5;
      this.vy = Math.sin(angle) * this.speed * 0.5;
    }

    // 缓速巡步
    this.x += this.vx * timeScale;
    this.y += this.vy * timeScale;
    this.vx *= 0.96;
    this.vy *= 0.96;
  }

  // 寻路觅食 (采摘成熟浆果)
  startForaging(terrarium) {
    let nearestBush = null;
    let minDist = Infinity;

    for (let i = 0; i < terrarium.bushes.length; i++) {
      const b = terrarium.bushes[i];
      if (b.hasBerry) {
        const d = Math.hypot(this.x - b.worldX, this.y - b.worldY);
        if (d < minDist) {
          minDist = d;
          nearestBush = b;
        }
      }
    }

    if (nearestBush) {
      this.target = nearestBush;
      this.state = 'FORAGING';
      this.stateTimer = 300;
      this.showEmotion('🍖', 80);
    }
  }

  handleForaging(terrarium, audioEngine, onLog, timeScale) {
    if (!this.target || !this.target.hasBerry || this.stateTimer <= 0) {
      this.state = 'IDLE';
      this.target = null;
      return;
    }

    const dx = this.target.worldX - this.x;
    const dy = this.target.worldY - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist > 6) {
      this.vx = (dx / dist) * this.speed;
      this.vy = (dy / dist) * this.speed;
      this.x += this.vx * timeScale;
      this.y += this.vy * timeScale;
    } else {
      // 到达并采摘食用
      this.target.hasBerry = false;
      this.target.regrowTimer = 0;
      this.hunger = Math.min(100, this.hunger + this.target.nutrition);
      this.hp = Math.min(this.maxHp, this.hp + 15);
      audioEngine.playEat();
      this.showEmotion('😋', 60);

      onLog({
        type: 'EAT',
        unit: this,
        message: `${this.name} 大口啃食野生红浆果，吧唧嘴擦了擦下巴。`
      });

      this.state = 'IDLE';
      this.target = null;
    }
  }

  // 绿皮摔跤状态
  handleBrawling(audioEngine, onLog, timeScale) {
    // 原地晃动推搡
    this.x += (Math.random() - 0.5) * 1.5;
    this.y += (Math.random() - 0.5) * 1.5;

    if (this.stateTimer <= 0) {
      this.state = 'IDLE';
    }
  }

  // 精灵祈祷状态 (催生周围植被养分)
  handleMeditating(terrarium, audioEngine, timeScale) {
    // 缓步静止并向脚下瓦片释放养分
    const gx = (this.x / terrarium.tileSize) | 0;
    const gy = (this.y / terrarium.tileSize) | 0;
    terrarium.setNutrient(gx, gy, terrarium.getNutrient(gx, gy) + 0.15 * timeScale);

    if (this.stateTimer <= 0) {
      this.state = 'IDLE';
    }
  }

  // 饱食繁衍新生儿
  breed(faction, audioEngine, onLog) {
    this.hunger -= 40;
    audioEngine.playBirth();
    this.showEmotion('🍼', 90);

    const childIndex = faction.members.length;
    const child = new Unit(
      childIndex,
      faction,
      this.x + (Math.random() - 0.5) * 16,
      this.y + (Math.random() - 0.5) * 16,
      {
        generation: this.generation + 1,
        age: 0,
        hunger: 80
      }
    );

    faction.members.push(child);
    faction.totalBirths++;

    onLog({
      type: 'BIRTH',
      unit: child,
      message: `【天伦之乐】${this.name} 诞下了第 ${child.generation} 代后嗣【${child.name}】！`
    });
  }

  /**
   * 渲染小人实体
   */
  render(ctx) {
    if (this.isDead) return;

    const drawX = Math.round(this.x - 12);
    const drawY = Math.round(this.y - 12);

    // 1. 若受创闪白 (Flash White 2帧)
    if (this.flashWhiteFrames > 0) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(drawX + 6, drawY + 6, 12, 12);
      ctx.restore();
      return;
    }

    // 2. 正常贴图 (单次 drawImage 极速贴装离屏 Stamp)
    if (this.stamp) {
      ctx.drawImage(this.stamp, drawX, drawY);
    }

    // 3. 情绪气泡 (Emoji Bubble)
    if (this.emotionEmoji) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(this.emotionEmoji, this.x, this.y - 15);
    }

    // 4. 血量微型条 (受损时显现)
    if (this.hp < this.maxHp) {
      const barW = 14;
      const barH = 2.5;
      const barX = this.x - barW / 2;
      const barY = this.y - 14;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(barX, barY, barW, barH);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect(barX, barY, barW * (this.hp / this.maxHp), barH);
    }
  }
}
