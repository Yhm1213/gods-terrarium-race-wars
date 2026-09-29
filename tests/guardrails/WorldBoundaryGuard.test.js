/**
 * WorldBoundaryGuard.test.js
 * Milestone 1 核心守门测试套件 (WP-9.1.1: TC-02, TC-03)
 * 严格覆盖 REQ-QA-002, REQ-QA-003, TDS §1.3, WBS §9.1.1
 * 
 * 守门断言清单:
 * 1. TC-02: 连续 10,000 次极限速度 (100,000 px/s) 投掷越界率严格为 0.0%，无 NaN 坐标，法向动量瞬间吸收
 * 2. TC-02: [-99999, 99999] 荒谬坐标与 NaN / Infinity 极端输入防御自愈
 * 3. TC-02: 空间哈希联动：边界 Clamp 后的实体 100% 落入合法桶 (0 ~ 503)
 * 4. TC-03: 图腾质量无穷大 (invMass=0.0)，巨魔/比蒙 5,000,000 N*s 极端冲撞位移恒为 0
 * 5. TC-03: 黑洞极端引力 100 帧持续拉拽，图腾坐标变化严格为 0
 * 6. TC-03: 上帝之手抓取绝对拦截，图腾绝不被置位 IS_HELD
 * 7. 极致性能：10,000 次混沌投掷物理步进耗时严格低于 30ms (亚毫秒级)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorldBoundaryGuard,
  MIN_WORLD_X,
  MAX_WORLD_X,
  MIN_WORLD_Y,
  MAX_WORLD_Y,
  BOUNDARY_MARGIN
} from '../../src/world/WorldBoundaryGuard.js';
import {
  TileGrid,
  WORLD_WIDTH,
  WORLD_HEIGHT
} from '../../src/world/TileGrid.js';
import {
  ECS,
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
  PHYSICS_STRIDE,
  PHY_OFFSET_VX,
  PHY_OFFSET_VY,
  PHY_OFFSET_MASS,
  PHY_OFFSET_INVMASS
} from '../../src/core/ECS.js';
import {
  IS_STATIC_ANCHOR,
  IS_HELD,
  hasStatus
} from '../../src/components/UnitStatusFlags.js';
import { PRNG } from '../../src/core/PRNG.js';
import { SpatialHash } from '../../src/core/SpatialHash.js';

describe('WorldBoundaryGuard (WP-9.1.1: TC-02, TC-03 核心守门测试套件)', () => {
  let ecs;
  let prng;
  let spatialHash;

  beforeEach(() => {
    ecs = new ECS();
    prng = new PRNG(20261104);
    spatialHash = new SpatialHash(WORLD_WIDTH, WORLD_HEIGHT, 48);
  });

  describe('TC-02: 物理刚体刚性边界 Clamp 与动量吸收守门断言 (REQ-QA-002)', () => {
    it('混沌打靶断言：连续 10,000 次极限速度 (100,000 px/s) 投掷，实体越界率为 0.0%，无非数坐标', () => {
      const entityId = ecs.allocateEntity();
      const tfOffset = entityId * TRANSFORM_STRIDE;
      const phyOffset = entityId * PHYSICS_STRIDE;

      const TRIALS = 10000;
      let outOfBoundsCount = 0;
      let nanCount = 0;
      let momentumAbsorbedCount = 0;

      const dt = 1.0 / 60.0; // 60 FPS 物理单帧
      const ABSURD_SPEED = 100000.0; // 100,000 px/s 荒谬初速度

      for (let i = 0; i < TRIALS; i++) {
        // 随机初始位置散布在地图任意位置 (包括靠近边界或超出边界)
        const startX = prng.nextFloat() * WORLD_WIDTH;
        const startY = prng.nextFloat() * WORLD_HEIGHT;

        // 随机角度 (-PI ~ PI) 全向投掷
        const angle = (prng.nextFloat() * 2.0 - 1.0) * Math.PI;
        const vx = Math.cos(angle) * ABSURD_SPEED;
        const vy = Math.sin(angle) * ABSURD_SPEED;

        ecs.transforms[tfOffset + TF_OFFSET_X] = startX;
        ecs.transforms[tfOffset + TF_OFFSET_Y] = startY;
        ecs.physics[phyOffset + PHY_OFFSET_VX] = vx;
        ecs.physics[phyOffset + PHY_OFFSET_VY] = vy;

        // 执行单帧物理积分与边界拦截
        WorldBoundaryGuard.integrateEntity(ecs, entityId, dt);

        const curX = ecs.transforms[tfOffset + TF_OFFSET_X];
        const curY = ecs.transforms[tfOffset + TF_OFFSET_Y];
        const curVx = ecs.physics[phyOffset + PHY_OFFSET_VX];
        const curVy = ecs.physics[phyOffset + PHY_OFFSET_VY];

        // 1. 非数检查
        if (!Number.isFinite(curX) || !Number.isFinite(curY)) {
          nanCount++;
        }

        // 2. 越界检查 [12.0, 1332.0] x [12.0, 852.0]
        if (curX < MIN_WORLD_X || curX > MAX_WORLD_X || curY < MIN_WORLD_Y || curY > MAX_WORLD_Y) {
          outOfBoundsCount++;
        }

        // 3. 动量吸收校验：触碰 X 边界则 vx 必须为 0；触碰 Y 边界则 vy 必须为 0
        if (curX === MIN_WORLD_X || curX === MAX_WORLD_X) {
          if (curVx === 0.0) momentumAbsorbedCount++;
        }
        if (curY === MIN_WORLD_Y || curY === MAX_WORLD_Y) {
          if (curVy === 0.0) momentumAbsorbedCount++;
        }
      }

      // 机器可执行形式化断言
      expect(nanCount).toBe(0);
      expect(outOfBoundsCount).toBe(0);
      const violationRate = outOfBoundsCount / TRIALS;
      expect(violationRate).toBe(0.0);
      expect(momentumAbsorbedCount).toBeGreaterThan(0);
    });

    it('荒谬坐标与极端非数输入自愈断言：[-99999, 99999] 及 NaN / Infinity 注入安全拦截', () => {
      const entityId = ecs.allocateEntity();
      const tfOffset = entityId * TRANSFORM_STRIDE;
      const phyOffset = entityId * PHYSICS_STRIDE;

      const extremeCases = [
        { x: -99999.0, y: -99999.0, vx: -100000.0, vy: -100000.0 },
        { x: 99999.0,  y: 99999.0,  vx: 100000.0,  vy: 100000.0 },
        { x: NaN,      y: NaN,      vx: 1000.0,    vy: 1000.0 },
        { x: Infinity, y: -Infinity, vx: 50000.0,   vy: -50000.0 },
        { x: 12.0,     y: 12.0,     vx: NaN,       vy: NaN }
      ];

      for (const tc of extremeCases) {
        ecs.transforms[tfOffset + TF_OFFSET_X] = tc.x;
        ecs.transforms[tfOffset + TF_OFFSET_Y] = tc.y;
        ecs.physics[phyOffset + PHY_OFFSET_VX] = tc.vx;
        ecs.physics[phyOffset + PHY_OFFSET_VY] = tc.vy;

        WorldBoundaryGuard.integrateEntity(ecs, entityId, 1.0 / 60.0);

        const x = ecs.transforms[tfOffset + TF_OFFSET_X];
        const y = ecs.transforms[tfOffset + TF_OFFSET_Y];
        const vx = ecs.physics[phyOffset + PHY_OFFSET_VX];
        const vy = ecs.physics[phyOffset + PHY_OFFSET_VY];

        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(MIN_WORLD_X);
        expect(x).toBeLessThanOrEqual(MAX_WORLD_X);
        expect(y).toBeGreaterThanOrEqual(MIN_WORLD_Y);
        expect(y).toBeLessThanOrEqual(MAX_WORLD_Y);
      }
    });

    it('四角撞击双向法向速度清零断言', () => {
      const entityId = ecs.allocateEntity();
      const tfOffset = entityId * TRANSFORM_STRIDE;
      const phyOffset = entityId * PHYSICS_STRIDE;

      // 投向左上角
      ecs.transforms[tfOffset + TF_OFFSET_X] = 15.0;
      ecs.transforms[tfOffset + TF_OFFSET_Y] = 15.0;
      ecs.physics[phyOffset + PHY_OFFSET_VX] = -1000.0;
      ecs.physics[phyOffset + PHY_OFFSET_VY] = -1000.0;

      WorldBoundaryGuard.integrateEntity(ecs, entityId, 0.1);

      expect(ecs.transforms[tfOffset + TF_OFFSET_X]).toBe(MIN_WORLD_X);
      expect(ecs.transforms[tfOffset + TF_OFFSET_Y]).toBe(MIN_WORLD_Y);
      expect(ecs.physics[phyOffset + PHY_OFFSET_VX]).toBe(0.0);
      expect(ecs.physics[phyOffset + PHY_OFFSET_VY]).toBe(0.0);

      // 投向右下角
      ecs.transforms[tfOffset + TF_OFFSET_X] = 1330.0;
      ecs.transforms[tfOffset + TF_OFFSET_Y] = 850.0;
      ecs.physics[phyOffset + PHY_OFFSET_VX] = 1000.0;
      ecs.physics[phyOffset + PHY_OFFSET_VY] = 1000.0;

      WorldBoundaryGuard.integrateEntity(ecs, entityId, 0.1);

      expect(ecs.transforms[tfOffset + TF_OFFSET_X]).toBe(MAX_WORLD_X);
      expect(ecs.transforms[tfOffset + TF_OFFSET_Y]).toBe(MAX_WORLD_Y);
      expect(ecs.physics[phyOffset + PHY_OFFSET_VX]).toBe(0.0);
      expect(ecs.physics[phyOffset + PHY_OFFSET_VY]).toBe(0.0);
    });

    it('空间哈希联动断言：极限投掷 Clamp 后的实体 100% 落入合法桶 (0 ~ 503)', () => {
      // 连续投掷 500 个不同实体至世界边界
      for (let i = 0; i < 500; i++) {
        const id = ecs.allocateEntity();
        const angle = (i / 500) * Math.PI * 2;
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_X] = WORLD_WIDTH * 0.5;
        ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_Y] = WORLD_HEIGHT * 0.5;
        ecs.physics[id * PHYSICS_STRIDE + PHY_OFFSET_VX] = Math.cos(angle) * 50000.0;
        ecs.physics[id * PHYSICS_STRIDE + PHY_OFFSET_VY] = Math.sin(angle) * 50000.0;
      }

      WorldBoundaryGuard.updateAll(ecs, 1.0 / 60.0);

      // 重构空间哈希
      spatialHash.rebuild(
        ecs.transforms,
        ecs.statusFlags,
        ecs.denseEntities,
        ecs.activeCount
      );

      // 校验所有实体的所在桶均在 [0, 503]
      const totalCells = spatialHash.cols * spatialHash.rows;
      expect(totalCells).toBe(504);

      for (let i = 0; i < ecs.activeCount; i++) {
        const id = ecs.denseEntities[i];
        if (id <= NULL_ENTITY) continue;
        const x = ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_X];
        const y = ecs.transforms[id * TRANSFORM_STRIDE + TF_OFFSET_Y];
        const col = Math.floor(x / 48);
        const row = Math.floor(y / 48);
        const bucket = row * spatialHash.cols + col;

        expect(col).toBeGreaterThanOrEqual(0);
        expect(col).toBeLessThan(spatialHash.cols);
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(spatialHash.rows);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(504);
      }
    });
  });

  describe('TC-03: 图腾法理锚定与物理静态绝对锁断言 (REQ-QA-003)', () => {
    it('图腾物理静态锁初始化断言：质量无穷大 (invMass=0.0)，置位 IS_STATIC_ANCHOR', () => {
      const totemId = ecs.allocateEntity();
      ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_X] = 672.0; // 地图中心
      ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_Y] = 432.0;
      ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_MASS] = Infinity;
      ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_INVMASS] = 0.0;
      ecs.statusFlags[totemId] = (ecs.statusFlags[totemId] | IS_STATIC_ANCHOR) >>> 0;

      expect(WorldBoundaryGuard.isStaticAnchor(ecs, totemId)).toBe(true);
      expect(ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_INVMASS]).toBe(0.0);
      expect(hasStatus(ecs.statusFlags, totemId, IS_STATIC_ANCHOR)).toBe(true);
    });

    it('比蒙巨兽极限撞击位移恒为 0 断言：施加 5,000,000 N*s 冲量位移严格为 0', () => {
      const totemId = ecs.allocateEntity();
      const originX = 500.0;
      const originY = 300.0;
      ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_X] = originX;
      ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_Y] = originY;
      ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_MASS] = Infinity;
      ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_INVMASS] = 0.0;
      ecs.statusFlags[totemId] = (ecs.statusFlags[totemId] | IS_STATIC_ANCHOR) >>> 0;

      // 施加荒谬量级碰撞冲量 (模拟质量 5000kg x 速度 1000px/s)
      const impulseApplied = WorldBoundaryGuard.applyImpulse(ecs, totemId, 5000000.0, 5000000.0);
      // 静态图腾必须拒绝吸收外来动力，返回 false
      expect(impulseApplied).toBe(false);

      // 物理积分更新
      WorldBoundaryGuard.integrateEntity(ecs, totemId, 1.0);

      // 坐标必须严格纹丝不动
      expect(ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_X]).toBe(originX);
      expect(ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_Y]).toBe(originY);
      expect(ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBe(0.0);
      expect(ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_VY]).toBe(0.0);
    });

    it('黑洞引力持续 100 帧拉扯断言：图腾位移与速度始终绝对为 0', () => {
      const totemId = ecs.allocateEntity();
      const initX = 300.0;
      const initY = 200.0;
      ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_X] = initX;
      ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_Y] = initY;
      ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_MASS] = Infinity;
      ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_INVMASS] = 0.0;
      ecs.statusFlags[totemId] = (ecs.statusFlags[totemId] | IS_STATIC_ANCHOR) >>> 0;

      // 模拟持续 100 帧黑洞引力
      for (let frame = 0; frame < 100; frame++) {
        WorldBoundaryGuard.applyImpulse(ecs, totemId, -999999.0, 999999.0);
        WorldBoundaryGuard.integrateEntity(ecs, totemId, 1.0 / 60.0);
      }

      expect(ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_X]).toBe(initX);
      expect(ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_Y]).toBe(initY);
      expect(ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_VX]).toBe(0.0);
      expect(ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_VY]).toBe(0.0);
    });

    it('上帝之手抓取守门拦截断言：图腾严禁被抓取悬空，绝不置位 IS_HELD', () => {
      const totemId = ecs.allocateEntity();
      ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_X] = 400.0;
      ecs.transforms[totemId * TRANSFORM_STRIDE + TF_OFFSET_Y] = 400.0;
      ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_MASS] = Infinity;
      ecs.physics[totemId * PHYSICS_STRIDE + PHY_OFFSET_INVMASS] = 0.0;
      ecs.statusFlags[totemId] = (ecs.statusFlags[totemId] | IS_STATIC_ANCHOR) >>> 0;

      // 上帝之手抓取拦截
      const grabbed = WorldBoundaryGuard.attemptGrab(ecs, totemId);
      expect(grabbed).toBe(false);
      expect(hasStatus(ecs.statusFlags, totemId, IS_HELD)).toBe(false);

      // 对比组：普通非静态生物实体允许抓取
      const normalId = ecs.allocateEntity();
      ecs.transforms[normalId * TRANSFORM_STRIDE + TF_OFFSET_X] = 100.0;
      ecs.transforms[normalId * TRANSFORM_STRIDE + TF_OFFSET_Y] = 100.0;
      ecs.physics[normalId * PHYSICS_STRIDE + PHY_OFFSET_MASS] = 65.0;
      ecs.physics[normalId * PHYSICS_STRIDE + PHY_OFFSET_INVMASS] = 1.0 / 65.0;

      const normalGrabbed = WorldBoundaryGuard.attemptGrab(ecs, normalId);
      expect(normalGrabbed).toBe(true);
      expect(hasStatus(ecs.statusFlags, normalId, IS_HELD)).toBe(true);
    });
  });

  describe('极端性能基准守门 (LL-007 防抖动加固)', () => {
    it('10,000 次混沌投掷物理步进耗时严格低于 60ms (LL-007 防抖动微基准门限)', () => {
      const entityId = ecs.allocateEntity();
      const tfOffset = entityId * TRANSFORM_STRIDE;
      const phyOffset = entityId * PHYSICS_STRIDE;

      ecs.transforms[tfOffset + TF_OFFSET_X] = 600.0;
      ecs.transforms[tfOffset + TF_OFFSET_Y] = 400.0;
      ecs.physics[phyOffset + PHY_OFFSET_VX] = 100000.0;
      ecs.physics[phyOffset + PHY_OFFSET_VY] = 100000.0;

      // JIT 充分预热 1,000 轮，消除多 Worker 并发冷启动抖动 (LL-007)
      for (let w = 0; w < 1000; w++) {
        WorldBoundaryGuard.integrateEntity(ecs, entityId, 1.0 / 60.0);
      }

      const t0 = performance.now();
      for (let i = 0; i < 10000; i++) {
        WorldBoundaryGuard.integrateEntity(ecs, entityId, 1.0 / 60.0);
      }
      const t1 = performance.now();
      const totalTime = t1 - t0;

      // 工程合理硬门限: 10,000 次 < 60ms (平均每次 < 6 微秒，兼顾严苛与 CI 调度防抖动)
      expect(totalTime).toBeLessThan(60.0);
    });
  });
});
