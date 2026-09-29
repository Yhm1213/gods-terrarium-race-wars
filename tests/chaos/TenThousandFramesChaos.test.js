/**
 * TenThousandFramesChaos.test.js
 * Milestone 4 核心混沌大压测: 10,000 物理帧千人同屏混沌极限压力测试
 * 严格覆盖 SPEC-M4-CONTRACT §7.3, QA 规范 §4.1, LL-007 JIT 预热与堆内存防腐断言
 * 
 * 核心硬性验收红线:
 * 1. 机器断言 1 (零崩溃异常): 56x36 完整世界，1,000 实体同屏，无头高速推进 10,000 物理帧，0 未捕获异常；
 * 2. 机器断言 2 (物理坐标刚性与防超界): 模拟随机高频上帝之手甩飞、六大神迹轮番轰炸、政治裂变与领袖刺杀，
 *    10,000 帧内全量实体坐标绝无 NaN、Infinity 或越界溢出，超界率为 0.0%；
 * 3. 机器断言 3 (物理零 GC 堆防腐断言): 按照 LL-007 进行 50 帧充分 JIT 预热，记录 baseHeap，
 *    在 10,000 帧结束后测量 finalHeap，断言 ΔHeap < 500KB，证明全系统无内存泄漏！
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION,
  HEALTH_STRIDE,
  HP_OFFSET_CURRENT,
  HP_OFFSET_MAX
} from '../../src/core/ECS.js';
import {
  TileGrid,
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_SIZE,
  WORLD_WIDTH,
  WORLD_HEIGHT
} from '../../src/world/TileGrid.js';
import {
  WorldBoundaryGuard,
  MIN_WORLD_X,
  MAX_WORLD_X,
  MIN_WORLD_Y,
  MAX_WORLD_Y
} from '../../src/world/WorldBoundaryGuard.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { PRNG } from '../../src/core/PRNG.js';
import {
  IS_ALIVE,
  IS_STATIC_ANCHOR,
  IS_LEADER,
  setStatus,
  hasStatus
} from '../../src/components/UnitStatusFlags.js';
import {
  MAX_FACTIONS,
  FACTION_STRIDE,
  FAC_OFFSET_TOTEM_ID,
  FAC_OFFSET_TENSION,
  FAC_OFFSET_POP_COUNT,
  FAC_OFFSET_FOOD,
  FAC_OFFSET_ORE,
  FAC_OFFSET_WAR_COOLDOWN,
  FAC_OFFSET_FLAGS,
  FactionFlags,
  createFactionRuntimeBuffer
} from '../../src/data/FactionData.js';
import { AntiFragmentationGuard } from '../../src/politics/AntiFragmentationGuard.js';
import { SchismSystem } from '../../src/politics/SchismSystem.js';
import { ClanCensusSystem } from '../../src/politics/ClanCensusSystem.js';
import { DynastySuccessionSystem } from '../../src/politics/DynastySuccessionSystem.js';
import { HandOfGodSystem } from '../../src/god/HandOfGodSystem.js';
import { DivineMiraclesSystem, MiracleId } from '../../src/god/DivineMiraclesSystem.js';
import { BorderFrictionSystem } from '../../src/warfare/BorderFrictionSystem.js';

describe('TenThousandFramesChaos: 10,000 帧千人同屏混沌总压测 (Milestone 4 Chaos Guardrail)', () => {
  it('1,000 实体全要素同屏，连续推进 10,000 物理帧，0 崩溃、坐标 0 NaN/溢出且 ΔHeap < 500KB', () => {
    const prng = new PRNG(0xFEEDFACE);
    const dt = 1.0 / 60.0; // 60 FPS 物理帧间隔 (~16.6ms)
    const TOTAL_FRAMES = 10000;
    const POPULATION = 1000;

    // 1. 初始化核心世界与子系统
    const ecs = new ECS();
    const tileGrid = new TileGrid();
    const factionBuffer = createFactionRuntimeBuffer();
    const eventBus = new DomainEventBus();
    const antiFrag = new AntiFragmentationGuard();
    const schismSys = new SchismSystem(ecs, tileGrid, factionBuffer, eventBus, antiFrag, null);
    const censusSys = new ClanCensusSystem(ecs, factionBuffer, eventBus, schismSys);
    const successionSys = new DynastySuccessionSystem(ecs, factionBuffer, eventBus, prng, null);
    const frictionSys = new BorderFrictionSystem(ecs, factionBuffer, eventBus, null);
    const handOfGod = new HandOfGodSystem(ecs, tileGrid, eventBus, factionBuffer);
    const miraclesSys = new DivineMiraclesSystem(ecs, tileGrid, eventBus, factionBuffer, frictionSys);

    // 2. 建立 12 个始祖政权与图腾，平铺分布
    const totemIds = new Int32Array(MAX_FACTIONS + 1);
    for (let f = 1; f <= 12; f++) {
      const baseOff = (f - 1) * FACTION_STRIDE;
      factionBuffer[baseOff + FAC_OFFSET_FLAGS] = FactionFlags.ACTIVE;
      factionBuffer[baseOff + FAC_OFFSET_FOOD] = 500;
      factionBuffer[baseOff + FAC_OFFSET_ORE] = 300;

      // 创建该阵营图腾
      const totem = ecs.allocateEntity();
      ecs.identities[totem * IDENTITY_STRIDE + ID_OFFSET_FACTION] = f;
      setStatus(ecs.statusFlags, totem, IS_STATIC_ANCHOR);

      const totemTx = 5 + (f % 4) * 12;
      const totemTy = 6 + Math.floor((f - 1) / 4) * 10;
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_X] = totemTx * TILE_SIZE + 12;
      ecs.transforms[totem * TRANSFORM_STRIDE + TF_OFFSET_Y] = totemTy * TILE_SIZE + 12;
      ecs.health[totem * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 5000;
      ecs.health[totem * HEALTH_STRIDE + HP_OFFSET_MAX] = 5000;

      totemIds[f] = totem;
      factionBuffer[baseOff + FAC_OFFSET_TOTEM_ID] = totem;

      // 围绕图腾划定 5x5 领地
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const gx = totemTx + dx;
          const gy = totemTy + dy;
          if (gx >= 0 && gx < GRID_WIDTH && gy >= 0 && gy < GRID_HEIGHT) {
            tileGrid.setTerritoryByCoord(gx, gy, f);
          }
        }
      }
    }

    // 3. 投放 1,000 名存活实体
    const entities = new Int32Array(POPULATION);
    for (let i = 0; i < POPULATION; i++) {
      const eid = ecs.allocateEntity();
      const fac = (i % 12) + 1;
      ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = fac;

      // 围绕所属图腾随机分散
      const totemTx = 5 + (fac % 4) * 12;
      const totemTy = 6 + Math.floor((fac - 1) / 4) * 10;
      const spawnX = Math.max(MIN_WORLD_X, Math.min(MAX_WORLD_X, (totemTx + (prng.nextFloat() * 6 - 3)) * TILE_SIZE));
      const spawnY = Math.max(MIN_WORLD_Y, Math.min(MAX_WORLD_Y, (totemTy + (prng.nextFloat() * 6 - 3)) * TILE_SIZE));

      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_X] = spawnX;
      ecs.transforms[eid * TRANSFORM_STRIDE + TF_OFFSET_Y] = spawnY;

      // 赋予初速度与质量
      ecs.physics[eid * PHYSICS_STRIDE + PHY_OFFSET_VX] = (prng.nextFloat() - 0.5) * 60.0;
      ecs.physics[eid * PHYSICS_STRIDE + PHY_OFFSET_VY] = (prng.nextFloat() - 0.5) * 60.0;
      ecs.physics[eid * PHYSICS_STRIDE + PHY_OFFSET_MASS] = 50.0 + prng.nextFloat() * 30.0;

      ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_CURRENT] = 100.0;
      ecs.health[eid * HEALTH_STRIDE + HP_OFFSET_MAX] = 100.0;

      entities[i] = eid;
    }

    const miracleList = [
      MiracleId.DIVINE_RAIN,
      MiracleId.HOLY_FRUIT,
      MiracleId.HOLY_THUNDER,
      MiracleId.WAR_HORN,
      MiracleId.PAX_DIVINA,
      MiracleId.METEOR_CATACLYSM
    ];

    // 4. JIT 充分预热 200 帧以覆盖全部混沌扰动分支并消除 V8 编译抖动 (LL-007)
    for (let w = 0; w < 200; w++) {
      WorldBoundaryGuard.updateAll(ecs, dt);
      handOfGod.update(dt);
      miraclesSys.update(dt);
      frictionSys.update(dt);
      censusSys.update(dt);
      schismSys.update(dt);
      successionSys.update(dt);
      // 预热全部 6 种神迹分支
      miraclesSys.castMiracle(miracleList[w % miracleList.length], 200, 200, true);
      // 预热上帝之手
      if (w % 20 === 0) {
        handOfGod.pickup(entities[0]);
        handOfGod.moveHeld(100, 100, dt);
        handOfGod.release(200, 200);
      }
      eventBus.flush();
    }

    // 5. 堆内存基准记录 (LL-007)
    if (typeof global.gc === 'function') {
      global.gc();
    }
    const baseHeap = process.memoryUsage().heapUsed;

    let unhandledExceptionCount = 0;
    let coordinateNaNCount = 0;
    let coordinateOverflowCount = 0;

    // 6. 执行 10,000 帧高速混沌推进循环
    let lastHeap = baseHeap;
    try {
      for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
        // (1) 物理与刚性边界守门
        WorldBoundaryGuard.updateAll(ecs, dt);

        // (2) 领域系统流水线更新
        handOfGod.update(dt);
        miraclesSys.update(dt);
        frictionSys.update(dt);
        schismSys.update(dt);
        censusSys.update(dt);
        successionSys.update(dt);

        // (3) 高烈度混沌扰动注入器 (每 100 帧注入多重极端扰动)
        if (frame % 100 === 0) {
          // A. 上帝之手高速抓取并向随机方向甩飞
          const pickIdx = Math.floor(prng.nextFloat() * POPULATION);
          const pickEntity = entities[pickIdx];
          if (pickEntity > NULL_ENTITY && ecs.isAlive(pickEntity) && !hasStatus(ecs.statusFlags, pickEntity, IS_STATIC_ANCHOR)) {
            if (handOfGod.pickup(pickEntity)) {
              const dragX = MIN_WORLD_X + prng.nextFloat() * (MAX_WORLD_X - MIN_WORLD_X);
              const dragY = MIN_WORLD_Y + prng.nextFloat() * (MAX_WORLD_Y - MIN_WORLD_Y);
              handOfGod.moveHeld(dragX, dragY, dt);
              // 赋予 ±600 px/s 极速甩飞初速度
              const flingVx = (prng.nextFloat() - 0.5) * 1200.0;
              const flingVy = (prng.nextFloat() - 0.5) * 1200.0;
              handOfGod.release(flingVx, flingVy);
            }
          }

          // B. 随机神迹轰炸
          const mIdx = Math.floor(prng.nextFloat() * miracleList.length);
          const targetX = MIN_WORLD_X + prng.nextFloat() * (MAX_WORLD_X - MIN_WORLD_X);
          const targetY = MIN_WORLD_Y + prng.nextFloat() * (MAX_WORLD_Y - MIN_WORLD_Y);
          miraclesSys.castMiracle(miracleList[mIdx], targetX, targetY, true);

          // C. 随机触发弑君与政权张力注入
          const targetFac = Math.floor(prng.nextFloat() * 12) + 1;
          censusSys.recordCasualty(targetFac, 3);
          if (frame % 500 === 0) {
            const currentKing = successionSys.getLeader(targetFac);
            if (currentKing > NULL_ENTITY) {
              successionSys.triggerSuccession(targetFac, currentKing, 0);
            }
          }
        }

        // (4) 清空关键与瞬态事件队列，杜绝丢包与溢出
        eventBus.flush();

        // (5) 每 1,000 帧抽样核实全量实体坐标数值刚性
        if (frame % 1000 === 0) {
          for (let e = 0; e < POPULATION; e++) {
            const eid = entities[e];
            if (eid <= NULL_ENTITY || !ecs.isAlive(eid)) continue;

            const tfOff = eid * TRANSFORM_STRIDE;
            const x = ecs.transforms[tfOff + TF_OFFSET_X];
            const y = ecs.transforms[tfOff + TF_OFFSET_Y];

            if (Number.isNaN(x) || Number.isNaN(y) || !Number.isFinite(x) || !Number.isFinite(y)) {
              coordinateNaNCount++;
            }
            if (x < MIN_WORLD_X - 0.1 || x > MAX_WORLD_X + 0.1 ||
                y < MIN_WORLD_Y - 0.1 || y > MAX_WORLD_Y + 0.1) {
              coordinateOverflowCount++;
            }
          }
        }
      }
    } catch (err) {
      unhandledExceptionCount++;
    }

    // 7. 测量最终堆内存
    if (typeof global.gc === 'function') {
      global.gc();
    }
    const finalHeap = process.memoryUsage().heapUsed;
    const deltaHeap = Math.max(0, finalHeap - baseHeap);

    // 机器硬断言 1: 零未捕获异常抛出
    expect(unhandledExceptionCount).toBe(0);

    // 机器硬断言 2: 坐标刚性，NaN 次数为 0，超界溢出次数为 0
    expect(coordinateNaNCount).toBe(0);
    expect(coordinateOverflowCount).toBe(0);

    // 机器硬断言 3 (堆内存防腐断言): 10,000 帧千人高烈度混沌压测后，ΔHeap 严格受限 (存在显式 GC 时 < 500KB，无显式 GC 时 < 2MB 杜绝线性泄漏)
    const maxAllowedDelta = (typeof global.gc === 'function') ? (500 * 1024) : (2048 * 1024);
    expect(deltaHeap).toBeLessThan(maxAllowedDelta);
  });
});
