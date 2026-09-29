/**
 * HandOfGodSystem.js
 * 上帝之手物理交互系统与六大硬性安全边界
 * 严格遵照 SPEC-M4-CONTRACT §1.3
 *
 * 核心机制:
 * 1. 规范 1: 图腾绝对不可抓取锁 (拦截 pickup 并派发 EVT_DIVINE_ACTION_BLOCKED)
 * 2. 规范 2: 世界边缘刚性截断 (X clamped [12, W-12], Y clamped [12, H-12])
 * 3. 规范 3: 防穿模回弹 (落地遇不可通行瓦片，即时 3x3 邻域推挤至合法平地)
 * 4. 规范 4: 基于质量 Mass 投掷冲击波与下落伤害，落地击退并硬直 0.8s
 * 5. 规范 5: 抓取瞬间清空施法/攻击，落地赋予 0.5s ICD
 * 6. 规范 6: 天命悬空防死锁 (抓取继承人/领袖 > 5.0s 触发 EVT_DIVINE_BACKFIRE 强制震脱加冕)
 */

import {
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  PHYSICS_STRIDE,
  PHY_OFFSET_MASS,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT
} from '../core/ECS.js';
import {
  IS_HELD,
  IS_AIRBORNE,
  IS_STATIC_ANCHOR,
  IS_SACRED_BODY,
  IS_IMMOBILIZED,
  IS_STUNNED,
  IS_LEADER,
  IS_CASTING,
  IS_SKILL_ACTIVE,
  hasStatus,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_SIZE,
  WORLD_WIDTH,
  WORLD_HEIGHT
} from '../world/TileGrid.js';
import { isBiomeImpassable } from '../data/BiomeData.js';
import { DomainEvents } from '../data/DomainEvents.js';
import { MAX_FACTIONS, FACTION_STRIDE, FAC_OFFSET_TOTEM_ID } from '../data/FactionData.js';

export const BOUNDARY_MARGIN = 12.0;            // 边缘刚性截断安全边距 (px)
export const MAX_HELD_DURATION_SECONDS = 5.0;   // 天命悬空反噬最大容忍时长 (5 秒)
export const SACRED_BODY_DURATION = 1.5;        // 反噬震脱金身霸体时长 (1.5 秒)
export const LANDING_ICD_DURATION = 0.5;        // 落地技能硬直冷却 (0.5 秒)
export const LANDING_STUN_DURATION = 0.8;       // 冲击波硬直眩晕时长 (0.8 秒)

export class HandOfGodSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {import('../world/TileGrid.js').TileGrid} tileGrid 
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null] 
   * @param {Int32Array|null} [factionBuffer=null]
   */
  constructor(ecs, tileGrid, eventBus = null, factionBuffer = null) {
    this.ecs = ecs;
    this.tileGrid = tileGrid;
    this.eventBus = eventBus;
    this.factionBuffer = factionBuffer;

    this.worldWidth = WORLD_WIDTH;
    this.worldHeight = WORLD_HEIGHT;

    // 当前被抓取的实体 ID
    this.heldEntity = NULL_ENTITY;
    // 悬空滞留时钟 (秒)
    this.heldDuration = 0.0;

    // 鼠标移动滑动窗口缓存 (记录最近 3 帧以计算投掷矢量)
    this._recentMouseX = [0, 0, 0];
    this._recentMouseY = [0, 0, 0];
    this._recentDt = [0.016, 0.016, 0.016];
    this._mouseSampleIdx = 0;

    // 零 GC 复用位置返回对象
    this._resolvedPos = { x: 0, y: 0 };
  }

  /**
   * 抓取实体 (Pickup)
   * 严格遵守规范 1 (图腾与金身霸体不可抓取锁) 与规范 5 (动作打断)
   *
   * @param {number} entityId 欲抓取的实体 ID
   * @returns {boolean} 是否抓取成功
   */
  pickup(entityId) {
    if (entityId <= NULL_ENTITY || !this.ecs.isAlive(entityId)) {
      return false;
    }

    // 规范 1: 图腾绝对不可抓取锁与金身霸体拦截
    if (
      hasStatus(this.ecs.statusFlags, entityId, IS_STATIC_ANCHOR) ||
      hasStatus(this.ecs.statusFlags, entityId, IS_SACRED_BODY)
    ) {
      if (this.eventBus) {
        this.eventBus.emit(DomainEvents.EVT_DIVINE_ACTION_BLOCKED, entityId, 1, 0, 0);
      }
      return false;
    }

    // 若当前已抓有实体，先将其释放
    if (this.heldEntity > NULL_ENTITY) {
      this.release(0, 0);
    }

    this.heldEntity = entityId;
    this.heldDuration = 0.0;

    // 规范 5: 捏起瞬间清空施法读条与活跃技能
    clearStatus(this.ecs.statusFlags, entityId, IS_CASTING);
    clearStatus(this.ecs.statusFlags, entityId, IS_SKILL_ACTIVE);

    // 标记悬空
    setStatus(this.ecs.statusFlags, entityId, IS_HELD);

    // 动量清零
    const phyOff = entityId * PHYSICS_STRIDE;
    this.ecs.physics[phyOff + PHY_OFFSET_VX] = 0.0;
    this.ecs.physics[phyOff + PHY_OFFSET_VY] = 0.0;

    // 初始化鼠标滑动点
    const tfOff = entityId * TRANSFORM_STRIDE;
    const curX = this.ecs.transforms[tfOff + TF_OFFSET_X];
    const curY = this.ecs.transforms[tfOff + TF_OFFSET_Y];
    this._recentMouseX.fill(curX);
    this._recentMouseY.fill(curY);
    this._recentDt.fill(0.016);
    this._mouseSampleIdx = 0;

    return true;
  }

  /**
   * 抓取状态下拖拽移动光标位置
   * 严格遵守规范 2 (世界边缘刚性截断)
   *
   * @param {number} targetWorldX 世界坐标 X
   * @param {number} targetWorldY 世界坐标 Y
   * @param {number} dt 帧间隔
   */
  moveHeld(targetWorldX, targetWorldY, dt = 0.016) {
    if (this.heldEntity <= NULL_ENTITY || !this.ecs.isAlive(this.heldEntity)) {
      this.heldEntity = NULL_ENTITY;
      return;
    }

    // 规范 2: 世界边缘刚性截断 [BOUNDARY_MARGIN, W - BOUNDARY_MARGIN]
    const clampedX = Math.max(BOUNDARY_MARGIN, Math.min(this.worldWidth - BOUNDARY_MARGIN, targetWorldX));
    const clampedY = Math.max(BOUNDARY_MARGIN, Math.min(this.worldHeight - BOUNDARY_MARGIN, targetWorldY));

    // 写入实体位置
    const tfOff = this.heldEntity * TRANSFORM_STRIDE;
    this.ecs.transforms[tfOff + TF_OFFSET_X] = clampedX;
    this.ecs.transforms[tfOff + TF_OFFSET_Y] = clampedY;

    // 记录鼠标速度采样点
    const idx = this._mouseSampleIdx % 3;
    this._recentMouseX[idx] = clampedX;
    this._recentMouseY[idx] = clampedY;
    this._recentDt[idx] = Math.max(0.001, dt);
    this._mouseSampleIdx++;
  }

  /**
   * 松开上帝之手，赋予投掷动量与下落处理 (Release)
   * 包含规范 3 (防穿模回弹) 与规范 4 (质量冲击波与下落伤害)
   *
   * @param {number} [manualVx=null] 可选覆盖初速度 X
   * @param {number} [manualVy=null] 可选覆盖初速度 Y
   */
  release(manualVx = null, manualVy = null) {
    if (this.heldEntity <= NULL_ENTITY || !this.ecs.isAlive(this.heldEntity)) {
      this.heldEntity = NULL_ENTITY;
      return;
    }

    const eid = this.heldEntity;
    this.heldEntity = NULL_ENTITY;
    this.heldDuration = 0.0;

    // 解除抓取状态
    clearStatus(this.ecs.statusFlags, eid, IS_HELD);

    const tfOff = eid * TRANSFORM_STRIDE;
    const phyOff = eid * PHYSICS_STRIDE;

    let posX = this.ecs.transforms[tfOff + TF_OFFSET_X];
    let posY = this.ecs.transforms[tfOff + TF_OFFSET_Y];

    // 计算甩掷初速度 (基于最近 3 帧滑动窗口)
    let vx = 0.0;
    let vy = 0.0;
    if (manualVx !== null && manualVy !== null) {
      vx = manualVx;
      vy = manualVy;
    } else {
      const pOld = (this._mouseSampleIdx + 1) % 3;
      const pNew = (this._mouseSampleIdx + 2) % 3;
      const dtSum = this._recentDt[pOld] + this._recentDt[pNew];
      if (dtSum > 0.001) {
        vx = (this._recentMouseX[pNew] - this._recentMouseX[pOld]) / dtSum;
        vy = (this._recentMouseY[pNew] - this._recentMouseY[pOld]) / dtSum;
      }
    }

    // 限制最大甩掷速度
    const speed = Math.sqrt(vx * vx + vy * vy);
    const maxSpeed = 1500.0;
    if (speed > maxSpeed) {
      vx = (vx / speed) * maxSpeed;
      vy = (vy / speed) * maxSpeed;
    }

    this.ecs.physics[phyOff + PHY_OFFSET_VX] = vx;
    this.ecs.physics[phyOff + PHY_OFFSET_VY] = vy;

    // 规范 3: 防穿模回弹 (落地帧 3x3 BFS 推挤至最近合法平地)
    const corrected = this._resolveImpassable(posX, posY);
    posX = corrected.x;
    posY = corrected.y;
    this.ecs.transforms[tfOff + TF_OFFSET_X] = posX;
    this.ecs.transforms[tfOff + TF_OFFSET_Y] = posY;

    // 规范 4: 基于质量的下落冲击波与落地结算
    const mass = this.ecs.physics[phyOff + PHY_OFFSET_MASS] || 50.0;
    const impactSpeed = Math.sqrt(vx * vx + vy * vy);

    if (impactSpeed > 30.0) {
      // 计算下落伤害: max(0, (V_impact - 30.0) * 0.5 * (Mass / 50.0))
      const damage = (impactSpeed - 30.0) * 0.5 * (mass / 50.0);
      if (damage > 0.0) {
        const hpOff = eid * HEALTH_STRIDE;
        const curHp = this.ecs.health[hpOff + HP_OFFSET_CURRENT];
        this.ecs.health[hpOff + HP_OFFSET_CURRENT] = Math.max(1.0, curHp - damage); // 保底 1 HP 不摔死
      }

      // 冲击波半径: max(1, floor(Mass / 40)) 瓦片
      const blastRadiusTiles = Math.max(1, Math.floor(mass / 40.0));
      this._applyShockwave(eid, posX, posY, blastRadiusTiles, impactSpeed);
    }

    // 赋予落地硬直 (IS_IMMOBILIZED)
    setStatus(this.ecs.statusFlags, eid, IS_IMMOBILIZED);

    // 派发平稳落地事件
    const tileX = Math.floor(posX / TILE_SIZE);
    const tileY = Math.floor(posY / TILE_SIZE);
    const tileIdx = tileY * GRID_WIDTH + tileX;

    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_AIRBORNE_LANDED, eid, tileIdx, 0, 0);
    }
  }

  /**
   * 规范 3: 防穿模回弹 (3x3 邻域检索最近合法可通行瓦片)
   * @private
   */
  _resolveImpassable(worldX, worldY) {
    const tx = Math.floor(worldX / TILE_SIZE);
    const ty = Math.floor(worldY / TILE_SIZE);

    if (!this._isTileImpassable(tx, ty)) {
      this._resolvedPos.x = worldX;
      this._resolvedPos.y = worldY;
      return this._resolvedPos;
    }

    // 在 3x3 邻域寻找首个可通行瓦片
    for (let r = 1; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const nx = tx + dx;
          const ny = ty + dy;
          if (!this._isTileImpassable(nx, ny)) {
            this._resolvedPos.x = nx * TILE_SIZE + 12.0;
            this._resolvedPos.y = ny * TILE_SIZE + 12.0;
            return this._resolvedPos;
          }
        }
      }
    }

    this._resolvedPos.x = worldX;
    this._resolvedPos.y = worldY;
    return this._resolvedPos;
  }

  /**
   * 判定瓦片是否不可通行
   * @private
   */
  _isTileImpassable(tx, ty) {
    if (tx < 0 || tx >= GRID_WIDTH || ty < 0 || ty >= GRID_HEIGHT) {
      return true;
    }
    const idx = ty * GRID_WIDTH + tx;
    const biome = this.tileGrid.tileTypes[idx];
    return isBiomeImpassable(biome) || this.tileGrid.moveCost[idx] >= 999.0;
  }

  /**
   * 落地冲击波推挤周围敌兵并造成硬直
   * @private
   */
  _applyShockwave(sourceEid, centerX, centerY, radiusTiles, speed) {
    const radiusPx = radiusTiles * TILE_SIZE;
    const r2 = radiusPx * radiusPx;

    const myFac = this.ecs.identities[sourceEid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;

    for (let i = 0; i < total; i++) {
      const otherId = dense[i];
      if (otherId === NULL_ENTITY || otherId === sourceEid) continue;

      const tfOff = otherId * TRANSFORM_STRIDE;
      const ox = this.ecs.transforms[tfOff + TF_OFFSET_X];
      const oy = this.ecs.transforms[tfOff + TF_OFFSET_Y];

      const dx = ox - centerX;
      const dy = oy - centerY;
      const d2 = dx * dx + dy * dy;

      if (d2 <= r2 && d2 > 0.0001) {
        const dist = Math.sqrt(d2);
        const nx = dx / dist;
        const ny = dy / dist;

        const pushForce = Math.min(400.0, speed * 0.4);
        const phyOff = otherId * PHYSICS_STRIDE;
        this.ecs.physics[phyOff + PHY_OFFSET_VX] += nx * pushForce;
        this.ecs.physics[phyOff + PHY_OFFSET_VY] += ny * pushForce;

        // 施加硬直
        setStatus(this.ecs.statusFlags, otherId, IS_IMMOBILIZED);
      }
    }
  }

  /**
   * 系统每帧更新
   * 包含规范 6 (天命悬空防死锁神威反噬)
   *
   * @param {number} dt 帧间隔 (秒)
   */
  update(dt) {
    if (this.heldEntity <= NULL_ENTITY || !this.ecs.isAlive(this.heldEntity)) {
      this.heldEntity = NULL_ENTITY;
      return;
    }

    this.heldDuration += dt;

    // 规范 6: 天命悬空防死锁 (抓取继承人/领袖 > 5.0 秒，触发神威反噬)
    const eid = this.heldEntity;
    const isVip = hasStatus(this.ecs.statusFlags, eid, IS_LEADER);

    if (this.heldDuration >= MAX_HELD_DURATION_SECONDS) {
      // 强制触发神威反噬震脱玩家
      const facId = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];

      if (this.eventBus) {
        this.eventBus.emit(DomainEvents.EVT_DIVINE_BACKFIRE, eid, facId, 0, 0);
      }

      // 震脱松手
      this.release(0.0, 0.0);

      // 赋予 1.5 秒不可抓取的金色霸体 (IS_SACRED_BODY)
      setStatus(this.ecs.statusFlags, eid, IS_SACRED_BODY);

      // 轻柔缓降至母国图腾前或平地安全加冕
      if (this.factionBuffer && facId > 0 && facId <= MAX_FACTIONS) {
        const totemId = this.factionBuffer[(facId - 1) * FACTION_STRIDE + FAC_OFFSET_TOTEM_ID];
        if (totemId > NULL_ENTITY && this.ecs.isAlive(totemId)) {
          const tTf = totemId * TRANSFORM_STRIDE;
          const tx = this.ecs.transforms[tTf + TF_OFFSET_X];
          const ty = this.ecs.transforms[tTf + TF_OFFSET_Y];
          const eTf = eid * TRANSFORM_STRIDE;
          this.ecs.transforms[eTf + TF_OFFSET_X] = tx + 24.0;
          this.ecs.transforms[eTf + TF_OFFSET_Y] = ty;
        }
      }
    }
  }
}
