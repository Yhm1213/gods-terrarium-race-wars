/**
 * WorldBoundaryGuard.js
 * Milestone 1 核心守门器: 物理刚体刚性边界 Clamp 与图腾绝对锚定系统 (TC-02, TC-03)
 * 
 * 核心指标与形式化断言:
 * 1. TC-02 (REQ-QA-002):
 *    - 边界范围: [MIN_X, MAX_X] x [MIN_Y, MAX_Y] = [12.0, 1332.0] x [12.0, 852.0]
 *    - 极限投掷 (100,000 px/s) 坐标死死 Clamp 在内边缘，绝不产生 NaN 或越界
 *    - 动量吸收自愈逻辑: 越界出界侧法向速度瞬间清零 (vx = 0 / vy = 0)
 * 2. TC-03 (REQ-QA-003):
 *    - 图腾绝对静态锚点: invMass === 0.0, mass === Infinity, 置位 IS_STATIC_ANCHOR
 *    - 巨魔冲撞、黑洞引力、强冲量撞击下，位移严格恒等于 0
 *    - 上帝之手抓取判定绝对拦截: 无法置位 IS_HELD，抓取失败
 * 3. 运行环境:
 *    - 连续 TypedArray 读写，绝对零 GC
 */

import {
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  PHY_OFFSET_MASS,
  PHY_OFFSET_INVMASS
} from '../core/ECS.js';
import {
  IS_ALIVE,
  IS_HELD,
  IS_STATIC_ANCHOR,
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
} from './TileGrid.js';

export const BOUNDARY_MARGIN = 12.0; // 半瓦片安全内边缘 12.0px
export const MIN_WORLD_X = BOUNDARY_MARGIN;
export const MAX_WORLD_X = WORLD_WIDTH - BOUNDARY_MARGIN;   // 1344 - 12 = 1332.0
export const MIN_WORLD_Y = BOUNDARY_MARGIN;
export const MAX_WORLD_Y = WORLD_HEIGHT - BOUNDARY_MARGIN;  // 864 - 12 = 852.0

export const MAX_SPEED_CAP = 800.0; // 瞬时速度硬截断上限 (px/s)

export class WorldBoundaryGuard {
  /**
   * 纯数学坐标截断与动量吸收自愈 (零 GC，入参对象就地更新)
   * @param {{x: number, y: number}} pos 
   * @param {{x: number, y: number}} vel 
   * @param {number} [margin=BOUNDARY_MARGIN]
   * @returns {boolean} 是否触发了边界截断
   */
  static clampPositionAndAbsorbMomentum(pos, vel, margin = BOUNDARY_MARGIN) {
    const minX = margin;
    const maxX = WORLD_WIDTH - margin;
    const minY = margin;
    const maxY = WORLD_HEIGHT - margin;

    let clamped = false;

    // 非数或无效值防御自愈
    if (!Number.isFinite(pos.x)) {
      pos.x = (minX + maxX) * 0.5;
      vel.x = 0.0;
      clamped = true;
    }
    if (!Number.isFinite(pos.y)) {
      pos.y = (minY + maxY) * 0.5;
      vel.y = 0.0;
      clamped = true;
    }

    // X 轴边界 Clamp 与动量吸收
    if (pos.x <= minX) {
      pos.x = minX;
      vel.x = 0.0; // 法向动量清零
      clamped = true;
    } else if (pos.x >= maxX) {
      pos.x = maxX;
      vel.x = 0.0;
      clamped = true;
    }

    // Y 轴边界 Clamp 与动量吸收
    if (pos.y <= minY) {
      pos.y = minY;
      vel.y = 0.0; // 法向动量清零
      clamped = true;
    } else if (pos.y >= maxY) {
      pos.y = maxY;
      vel.y = 0.0;
      clamped = true;
    }

    return clamped;
  }

  /**
   * 判定实体是否为绝对静态锚点 (图腾或永久要塞)
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {number} entityId 
   * @returns {boolean}
   */
  static isStaticAnchor(ecs, entityId) {
    if (entityId <= NULL_ENTITY) return false;
    return hasStatus(ecs.statusFlags, entityId, IS_STATIC_ANCHOR);
  }

  /**
   * 上帝之手抓取守门拦截 (TC-03)
   * 图腾及绝对静态锚点严禁被上帝之手抓起或悬空
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {number} entityId 
   * @returns {boolean} 是否允许抓取成功
   */
  static attemptGrab(ecs, entityId) {
    if (entityId <= NULL_ENTITY) return false;
    if (this.isStaticAnchor(ecs, entityId)) {
      // 绝对拒绝抓取图腾
      return false;
    }
    setStatus(ecs.statusFlags, entityId, IS_HELD);
    return true;
  }

  /**
   * 向实体施加外力冲量 (TC-03 守门拦截)
   * 若为静态锚点，冲量完全丢弃吸收，绝不产生速度与位移
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {number} entityId 
   * @param {number} impulseX 
   * @param {number} impulseY 
   * @returns {boolean} 冲量是否实际生效
   */
  static applyImpulse(ecs, entityId, impulseX, impulseY) {
    if (entityId <= NULL_ENTITY) return false;
    if (this.isStaticAnchor(ecs, entityId)) {
      // 静态图腾不可位移，完全吸收冲量
      return false;
    }

    const phyOffset = entityId * PHYSICS_STRIDE;
    const invMass = ecs.physics[phyOffset + PHY_OFFSET_INVMASS];
    if (invMass <= 0.0) return false;

    let vx = ecs.physics[phyOffset + PHY_OFFSET_VX] + impulseX * invMass;
    let vy = ecs.physics[phyOffset + PHY_OFFSET_VY] + impulseY * invMass;

    // 速度硬截断防止溢出
    const speedSq = vx * vx + vy * vy;
    if (speedSq > MAX_SPEED_CAP * MAX_SPEED_CAP) {
      const scale = MAX_SPEED_CAP / Math.sqrt(speedSq);
      vx *= scale;
      vy *= scale;
    }

    ecs.physics[phyOffset + PHY_OFFSET_VX] = vx;
    ecs.physics[phyOffset + PHY_OFFSET_VY] = vy;
    return true;
  }

  /**
   * 实体物理单步积分与边界守门更新 (零 GC)
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {number} entityId 
   * @param {number} dt 
   */
  static integrateEntity(ecs, entityId, dt) {
    if (entityId <= NULL_ENTITY) return;
    const flags = ecs.statusFlags[entityId];
    if ((flags & IS_ALIVE) === 0) return;

    const tfOffset = entityId * TRANSFORM_STRIDE;
    const phyOffset = entityId * PHYSICS_STRIDE;

    // 1. TC-03 图腾绝对静态锁：位移恒为 0，速度锁死为 0
    if (this.isStaticAnchor(ecs, entityId)) {
      ecs.physics[phyOffset + PHY_OFFSET_VX] = 0.0;
      ecs.physics[phyOffset + PHY_OFFSET_VY] = 0.0;
      return;
    }

    // 2. 正常位移积分
    let x = ecs.transforms[tfOffset + TF_OFFSET_X];
    let y = ecs.transforms[tfOffset + TF_OFFSET_Y];
    let vx = ecs.physics[phyOffset + PHY_OFFSET_VX];
    let vy = ecs.physics[phyOffset + PHY_OFFSET_VY];

    // 非数防御自愈
    if (!Number.isFinite(vx)) vx = 0.0;
    if (!Number.isFinite(vy)) vy = 0.0;
    if (!Number.isFinite(x)) x = (MIN_WORLD_X + MAX_WORLD_X) * 0.5;
    if (!Number.isFinite(y)) y = (MIN_WORLD_Y + MAX_WORLD_Y) * 0.5;

    x += vx * dt;
    y += vy * dt;

    // 3. TC-02 物理刚性边界 Clamp 与法向动量吸收
    if (x <= MIN_WORLD_X) {
      x = MIN_WORLD_X;
      vx = 0.0;
    } else if (x >= MAX_WORLD_X) {
      x = MAX_WORLD_X;
      vx = 0.0;
    }

    if (y <= MIN_WORLD_Y) {
      y = MIN_WORLD_Y;
      vy = 0.0;
    } else if (y >= MAX_WORLD_Y) {
      y = MAX_WORLD_Y;
      vy = 0.0;
    }

    // 回写内存
    ecs.transforms[tfOffset + TF_OFFSET_X] = x;
    ecs.transforms[tfOffset + TF_OFFSET_Y] = y;
    ecs.physics[phyOffset + PHY_OFFSET_VX] = vx;
    ecs.physics[phyOffset + PHY_OFFSET_VY] = vy;
  }

  /**
   * 全量活跃实体物理步进与边界守门器 (热路径零 GC)
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {number} dt 
   */
  static updateAll(ecs, dt) {
    const activeCount = ecs.getActiveCount();
    const dense = ecs.getActiveEntities();

    for (let i = 0; i < activeCount; i++) {
      const entityId = dense[i];
      this.integrateEntity(ecs, entityId, dt);
    }
  }
}
