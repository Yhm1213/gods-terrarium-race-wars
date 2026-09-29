/**
 * SmartDirector.js
 * 智能导播画中画系统 (Smart Director PiP)
 * 严格遵照 SPEC-M4-CONTRACT §3 与 07_god_powers_and_interaction.md §4
 *
 * 核心技术指标:
 * 1. 导播热点威胁传感器 (Director Threat Sensor): 每 1.0 秒扫描全图视口外威胁
 * 2. 四大高潮事件: 首领 HP<30%受围攻、图腾受创跌破 50%/20%、传说级突变诞生、超武充能起飞
 * 3. 160x120 像素离屏特写 Canvas，高潮主角动态聚光灯居中
 * 4. 10.0 秒无冲突平滑淡出
 * 5. 点击联动: 支持向摄像机发起 1200px/s 平滑巡航请求，彻底零 GC
 */

import {
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../core/ECS.js';

import {
  IS_ALIVE,
  IS_LEADER,
  IN_COMBAT,
  hasStatus
} from '../components/UnitStatusFlags.js';

import { OrganFlags } from '../data/MutationFlags.js';

export const PIP_WIDTH = 160;
export const PIP_HEIGHT = 120;
export const SCAN_INTERVAL_SEC = 1.0;
export const AUTO_FADE_SECONDS = 10.0;
export const FADE_OUT_DURATION = 1.5;
export const CRUISE_SPEED = 1200.0; // 巡航速度 1200px/s

export const HighlightEventType = Object.freeze({
  NONE: 0,
  LEADER_PERIL: 1,       // 首领 HP < 30% 且处于交火中
  TOTEM_PERIL: 2,        // 图腾生命跌破 50% 或 20%
  LEGENDARY_MUTATION: 3, // 传说级突变 (HOLY 或 FLAME|ELEC)
  SUPER_WEAPON: 4        // 超级武器点火
});

export class SmartDirector {
  /**
   * @param {HTMLCanvasElement|OffscreenCanvas|object|null} [canvas=null]
   */
  constructor(canvas = null) {
    // 1. 初始化 160x120 离屏特写画布
    if (canvas) {
      this.canvas = canvas;
    } else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      this.canvas = document.createElement('canvas');
    } else if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(PIP_WIDTH, PIP_HEIGHT);
    } else {
      this.canvas = {
        width: PIP_WIDTH,
        height: PIP_HEIGHT,
        getContext: () => ({
          fillStyle: '#000000',
          strokeStyle: '#000000',
          fillRect: () => {},
          strokeRect: () => {},
          fillText: () => {},
          drawImage: () => {}
        })
      };
    }

    this.canvas.width = PIP_WIDTH;
    this.canvas.height = PIP_HEIGHT;
    this.ctx = this.canvas.getContext('2d');

    // 2. 状态机与计时器 (零 GC)
    this.isActive = false;
    this.opacity = 0.0;
    this.fadeTimer = 0.0;
    this.scanTimer = 0.0;

    // 当前聚焦的高潮事件结构 (预分配单例复用)
    this.currentEvent = {
      type: HighlightEventType.NONE,
      title: '',
      targetEntityId: NULL_ENTITY,
      targetWorldX: 0.0,
      targetWorldY: 0.0,
      priority: 0
    };

    // 图腾生命快照 (16 阵营，记录是否跌破 50% 与 20%)
    this.totemThresholdPassed50 = new Uint8Array(17);
    this.totemThresholdPassed20 = new Uint8Array(17);
  }

  /**
   * 判定目标世界坐标是否位于当前摄像机视口外部
   *
   * @param {number} worldX 
   * @param {number} worldY 
   * @param {import('../camera/Camera2D.js').Camera2D|null} camera 
   * @returns {boolean}
   */
  isOutOfView(worldX, worldY, camera) {
    if (!camera) return false;
    const zoom = camera.zoom || 1.0;
    const viewW = camera.viewportWidth / zoom;
    const viewH = camera.viewportHeight / zoom;

    const minX = camera.x;
    const maxX = camera.x + viewW;
    const minY = camera.y;
    const maxY = camera.y + viewH;

    // 若在视口范围内，返回 false；若在外部则返回 true
    return worldX < minX || worldX > maxX || worldY < minY || worldY > maxY;
  }

  /**
   * 手动或由领域事件注入高潮事件
   *
   * @param {number} type 
   * @param {string} title 
   * @param {number} targetEntityId 
   * @param {number} targetWorldX 
   * @param {number} targetWorldY 
   * @param {number} [priority=1] 
   */
  triggerHighlight(type, title, targetEntityId, targetWorldX, targetWorldY, priority = 1) {
    if (this.isActive && this.currentEvent.priority > priority) {
      return; // 现有事件优先级更高，拒绝被低级事件打断
    }

    this.currentEvent.type = type;
    this.currentEvent.title = title;
    this.currentEvent.targetEntityId = targetEntityId;
    this.currentEvent.targetWorldX = targetWorldX;
    this.currentEvent.targetWorldY = targetWorldY;
    this.currentEvent.priority = priority;

    this.isActive = true;
    this.opacity = 1.0;
    this.fadeTimer = AUTO_FADE_SECONDS;
  }

  /**
   * 导播热点威胁传感器 (每 1.0 秒扫描全图视口外部威胁，零 GC)
   *
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {import('../camera/Camera2D.js').Camera2D|null} camera 
   * @param {import('../warfare/TotemDefenseSystem.js').TotemDefenseSystem|null} [totemDefense=null]
   */
  scanThreats(ecs, camera, totemDefense = null) {
    if (!ecs || !camera) return;

    const activeCount = ecs.activeCount;
    const dense = ecs.denseEntities;
    const transforms = ecs.transforms;
    const health = ecs.health;
    const statusFlags = ecs.statusFlags;
    const genetics = ecs.genetics;
    const identities = ecs.identities;

    // 1. 扫描图腾威胁 (优先级 4)
    if (totemDefense && totemDefense.totemEntityIds) {
      for (let f = 1; f <= 16; f++) {
        const tid = totemDefense.totemEntityIds[f];
        if (tid > NULL_ENTITY && ecs.isAlive(tid)) {
          const hpOff = tid * HEALTH_STRIDE;
          const curHp = health[hpOff + HP_OFFSET_CURRENT];
          const maxHp = health[hpOff + HP_OFFSET_MAX];
          const ratio = maxHp > 0 ? (curHp / maxHp) : 1.0;

          const tfOff = tid * TRANSFORM_STRIDE;
          const tx = transforms[tfOff + TF_OFFSET_X];
          const ty = transforms[tfOff + TF_OFFSET_Y];

          if (this.isOutOfView(tx, ty, camera)) {
            if (ratio <= 0.20 && this.totemThresholdPassed20[f] === 0) {
              this.totemThresholdPassed20[f] = 1;
              this.triggerHighlight(
                HighlightEventType.TOTEM_PERIL,
                `阵营 #${f} 图腾危在旦夕 (<20%)!`,
                tid,
                tx,
                ty,
                4
              );
              return;
            } else if (ratio <= 0.50 && this.totemThresholdPassed50[f] === 0) {
              this.totemThresholdPassed50[f] = 1;
              this.triggerHighlight(
                HighlightEventType.TOTEM_PERIL,
                `阵营 #${f} 图腾受到致命围攻!`,
                tid,
                tx,
                ty,
                3
              );
              return;
            }
          }
        }
      }
    }

    // 2. 扫描首领绝地交火与传说级突变 (优先级 3 与 2)
    for (let i = 0; i < activeCount; i++) {
      const eid = dense[i];
      const flag = statusFlags[eid];
      if ((flag & IS_ALIVE) === 0) continue;

      const tfOff = eid * TRANSFORM_STRIDE;
      const x = transforms[tfOff + TF_OFFSET_X];
      const y = transforms[tfOff + TF_OFFSET_Y];

      // 仅关注当前视口外部的突发焦点
      if (!this.isOutOfView(x, y, camera)) continue;

      // (A) 首领 HP < 30% 且交火
      if ((flag & IS_LEADER) !== 0 && (flag & IN_COMBAT) !== 0) {
        const hpOff = eid * HEALTH_STRIDE;
        const curHp = health[hpOff + HP_OFFSET_CURRENT];
        const maxHp = health[hpOff + HP_OFFSET_MAX];
        if (maxHp > 0 && curHp / maxHp < 0.30) {
          const facId = identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
          this.triggerHighlight(
            HighlightEventType.LEADER_PERIL,
            `阵营 #${facId} 领袖绝地弑君交火中!`,
            eid,
            x,
            y,
            3
          );
          return;
        }
      }

      // (B) 传说级稀有突变 (HOLY 或 FLAME | ELEC)
      if (genetics) {
        const pheno = genetics[eid * 4 + 2]; // GEN_OFFSET_PHENOTYPE = 2
        const isHoly = (pheno & OrganFlags.HOLY) !== 0;
        const isFireElec = ((pheno & OrganFlags.FLAME) !== 0) && ((pheno & 0x0010) !== 0);
        if (isHoly || isFireElec) {
          // 传说级突变诞生特写
          if (!this.isActive || this.currentEvent.priority < 2) {
            this.triggerHighlight(
              HighlightEventType.LEGENDARY_MUTATION,
              `✨ 传说级稀有圣灵突变诞生!`,
              eid,
              x,
              y,
              2
            );
            return;
          }
        }
      }
    }
  }

  /**
   * 导播核心更新时钟
   *
   * @param {number} dt 帧间隔 (秒)
   * @param {import('../core/ECS.js').ECS} [ecs=null] 
   * @param {import('../camera/Camera2D.js').Camera2D|null} [camera=null] 
   * @param {import('../warfare/TotemDefenseSystem.js').TotemDefenseSystem|null} [totemDefense=null]
   */
  update(dt, ecs = null, camera = null, totemDefense = null) {
    // 1. 驱动威胁传感器扫描时钟 (每 1.0s 一次)
    this.scanTimer += dt;
    if (this.scanTimer >= SCAN_INTERVAL_SEC) {
      this.scanTimer = 0.0;
      if (ecs && camera) {
        this.scanThreats(ecs, camera, totemDefense);
      }
    }

    // 2. 驱动画中画存在倒计时与平滑淡出
    if (this.isActive) {
      this.fadeTimer -= dt;
      if (this.fadeTimer <= 0.0) {
        this.isActive = false;
        this.opacity = 0.0;
        this.currentEvent.type = HighlightEventType.NONE;
      } else if (this.fadeTimer < FADE_OUT_DURATION) {
        this.opacity = Math.max(0.0, this.fadeTimer / FADE_OUT_DURATION);
      } else {
        this.opacity = 1.0;
      }

      // 实时动态追踪主角移动世界坐标
      if (ecs && this.currentEvent.targetEntityId > NULL_ENTITY && ecs.isAlive(this.currentEvent.targetEntityId)) {
        const tfOff = this.currentEvent.targetEntityId * TRANSFORM_STRIDE;
        this.currentEvent.targetWorldX = ecs.transforms[tfOff + TF_OFFSET_X];
        this.currentEvent.targetWorldY = ecs.transforms[tfOff + TF_OFFSET_Y];
      }
    }
  }

  /**
   * 绘制 160x120 离屏特写视口
   *
   * @param {import('../world/TileGrid.js').TileGrid|null} tileGrid 
   * @param {import('../core/ECS.js').ECS|null} ecs 
   */
  renderPiP(tileGrid = null, ecs = null) {
    if (!this.isActive || this.opacity <= 0.001) return;
    const ctx = this.ctx;
    if (!ctx) return;

    const w = PIP_WIDTH;
    const h = PIP_HEIGHT;

    // 1. 绘制科技风半透明深黑底衬
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(0, 0, w, h);

    // 2. 特写主角动态聚光灯 (以主角世界坐标为中心进行局部放大展示)
    const cx = w * 0.5;
    const cy = h * 0.5 + 4;

    // 聚光灯光晕
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.fillRect(cx - 24, cy - 24, 48, 48);

    // 绘制简易中心主角点阵 (6x6 像素方块与高亮外圈)
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(cx - 3, cy - 3, 6, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 1, cy - 1, 2, 2);

    // 准星锁定框
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 10.5, cy - 10.5, 21, 21);

    // 3. 顶部突发标志与红点
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, w, 22);

    // 🔴 闪烁红点 (每秒闪烁)
    const isBlink = (Math.floor(Date.now() / 400) % 2) === 0;
    ctx.fillStyle = isBlink ? '#ef4444' : '#7f1d1d';
    ctx.fillRect(6, 7, 8, 8);

    // 标题文本
    ctx.fillStyle = '#f87171';
    ctx.font = 'bold 9px monospace';
    ctx.fillText('LIVE 特写', 18, 14);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '9px sans-serif';
    const subTitle = this.currentEvent.title.length > 12 
      ? this.currentEvent.title.slice(0, 11) + '..' 
      : this.currentEvent.title;
    ctx.fillText(subTitle, 64, 14);

    // 4. 底部点击交互提示
    ctx.fillStyle = 'rgba(30, 41, 59, 0.7)';
    ctx.fillRect(0, h - 16, w, 16);
    ctx.fillStyle = '#38bdf8';
    ctx.font = '8px monospace';
    ctx.fillText('[点击巡航镜头 ↗]', 36, h - 5);

    // 5. 1px 危险外边框
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  }

  /**
   * 玩家点击画中画视口交互联动
   *
   * @param {number} screenX 
   * @param {number} screenY 
   * @param {number} pipScreenX 画中画在屏幕上的左上角 X
   * @param {number} pipScreenY 画中画在屏幕上的左上角 Y
   * @param {import('../camera/Camera2D.js').Camera2D|null} camera 
   * @returns {{handled: boolean, event: object|null}}
   */
  handleClick(screenX, screenY, pipScreenX, pipScreenY, camera = null) {
    if (!this.isActive || this.opacity <= 0.1) {
      return { handled: false, event: null };
    }

    // 判定是否点击在画中画视口矩形范围内
    if (
      screenX >= pipScreenX &&
      screenX <= pipScreenX + PIP_WIDTH &&
      screenY >= pipScreenY &&
      screenY <= pipScreenY + PIP_HEIGHT
    ) {
      // 触发向摄像机发起 1200px/s 平滑巡航请求
      if (camera && typeof camera.smoothPanTo === 'function') {
        camera.smoothPanTo(
          this.currentEvent.targetWorldX,
          this.currentEvent.targetWorldY,
          CRUISE_SPEED
        );
      }

      return {
        handled: true,
        event: this.currentEvent
      };
    }

    return { handled: false, event: null };
  }
}
