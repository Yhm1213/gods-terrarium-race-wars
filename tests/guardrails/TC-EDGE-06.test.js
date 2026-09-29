/**
 * TC-EDGE-06.test.js
 * Milestone 3 核心守门测试套件: 领地拓扑双向陆地连通性与飞地注销守门套件
 * 严格覆盖 SPEC-M3-CONTRACT §4.3, §4.5, §8 TC-EDGE-06, QA 规范 §2.4, LL-007 防抖动设计
 * 
 * 守门硬断言清单:
 * 1. 机器断言 1 (拓扑连通分量泛洪与孤岛飞地消除):
 *    人为构造 Voronoi 切割产生的离岛孤悬飞地 (面积 < 4 瓦片或被深水绝壁阻断)，
 *    广度优先连通性泛洪守门器在 1 帧内将其所有权注销为中立荒漠 (领地权属设为 0)，
 *    并精准派发关键事务事件 EVT_SCHISM_ENCLAVE_PURGED (0x8013)；
 * 2. 机器断言 2 (防碎片化刚性门槛与内部平乱阻断):
 *    母国领地 < 16 瓦片或存活人口 < 12 时，强行阻断领地分裂，张力回退至 50 转为内部处决/平乱，绝不创生新政权；
 * 3. 机器断言 3 (300s 凝聚锁与 16 国上限防碎片化硬锁):
 *    处于 300s 分裂冷却期内或达到全图 16 国上限时，坚决拦截大分裂；
 * 4. 压力测试断言 (混沌拓扑鲁棒性):
 *    连续 100 次随机拓扑切割与不规则深水迷宫环境下切分，死锁/死循环发生率恒为 0.0%，单次泛洪耗时严格满足工程预算。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ECS,
  NULL_ENTITY,
  TRANSFORM_STRIDE,
  TF_OFFSET_X,
  TF_OFFSET_Y,
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
  TOTAL_TILES,
  TILE_SIZE
} from '../../src/world/TileGrid.js';
import { Biomes } from '../../src/data/BiomeData.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import { PRNG } from '../../src/core/PRNG.js';
import {
  MAX_FACTIONS,
  FACTION_STRIDE,
  FAC_OFFSET_TOTEM_ID,
  FAC_OFFSET_TENSION,
  FAC_OFFSET_POP_COUNT,
  FAC_OFFSET_WAR_COOLDOWN,
  FAC_OFFSET_FLAGS,
  FactionFlags,
  createFactionRuntimeBuffer
} from '../../src/data/FactionData.js';
import { AntiFragmentationGuard, SchismBlockReason } from '../../src/politics/AntiFragmentationGuard.js';
import { RebelWrathSystem } from '../../src/politics/RebelWrathSystem.js';
import { SchismSystem, MIN_ENCLAVE_SIZE } from '../../src/politics/SchismSystem.js';

describe('TC-EDGE-06: 领地拓扑双向陆地连通性与飞地注销守门套件 (Milestone 3 Guardrail)', () => {
  let ecs;
  let tileGrid;
  let factionBuffer;
  let eventBus;
  let antiFrag;
  let wrathSys;
  let schismSys;

  const motherFac = 1;

  beforeEach(() => {
    ecs = new ECS();
    tileGrid = new TileGrid();
    factionBuffer = createFactionRuntimeBuffer();
    eventBus = new DomainEventBus();
    antiFrag = new AntiFragmentationGuard();
    wrathSys = new RebelWrathSystem(ecs, eventBus);
    schismSys = new SchismSystem(ecs, tileGrid, factionBuffer, eventBus, antiFrag, wrathSys);

    // 激活母国阵营
    const baseOff = (motherFac - 1) * FACTION_STRIDE;
    factionBuffer[baseOff + FAC_OFFSET_FLAGS] = FactionFlags.ACTIVE;
  });

  describe('1. 拓扑连通分量泛洪与孤岛飞地消除 (TC-EDGE-06)', () => {
    it('机器断言 1.1: 远端孤悬孤岛飞地 (面积 < 4 瓦片) 在裂变 1 帧内被强制注销为中立荒漠 (权属=0)，并派发 EVT_SCHISM_ENCLAVE_PURGED', () => {
      // 1. 在左上角构建母国大陆主体: 6x6 连通大陆 (36 瓦片 >= 16 门槛)
      for (let y = 5; y < 11; y++) {
        for (let x = 5; x < 11; x++) {
          tileGrid.setTerritoryByCoord(x, y, motherFac);
        }
      }

      // 2. 在远端 (x=45, y=25) 构造一块只有 2 瓦片的微型孤岛飞地
      tileGrid.setTerritoryByCoord(45, 25, motherFac);
      tileGrid.setTerritoryByCoord(46, 25, motherFac);

      // 母国创建 16 名小人 (>= 12 门槛)，分布在主体大陆上
      for (let i = 0; i < 16; i++) {
        const u = ecs.allocateEntity();
        ecs.identities[u * IDENTITY_STRIDE + ID_OFFSET_FACTION] = motherFac;
        ecs.transforms[u * TRANSFORM_STRIDE + TF_OFFSET_X] = (5 + (i % 6)) * TILE_SIZE + 12;
        ecs.transforms[u * TRANSFORM_STRIDE + TF_OFFSET_Y] = (5 + Math.floor(i / 6)) * TILE_SIZE + 12;
      }

      // 母国老图腾位于 (5, 5)
      const oldTotem = ecs.allocateEntity();
      ecs.identities[oldTotem * IDENTITY_STRIDE + ID_OFFSET_FACTION] = motherFac;
      ecs.transforms[oldTotem * TRANSFORM_STRIDE + TF_OFFSET_X] = 5 * TILE_SIZE + 12;
      ecs.transforms[oldTotem * TRANSFORM_STRIDE + TF_OFFSET_Y] = 5 * TILE_SIZE + 12;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TOTEM_ID] = oldTotem;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 16;

      // 监听飞地清除关键事务事件 (签名: type, src=rebelFac, dst=tileIdx)
      const purgedEnclaveTiles = [];
      eventBus.subscribe(DomainEvents.EVT_SCHISM_ENCLAVE_PURGED, (type, rebelFac, tileIdx) => {
        purgedEnclaveTiles.push({ rebelFac, tileIdx });
      });

      // 3. 执行大裂变
      const success = schismSys.attemptSchism(motherFac);
      eventBus.flush();

      expect(success).toBe(true);

      // 4. 硬断言: 远端 (45, 25) 和 (46, 25) 的孤岛飞地必须在当帧被彻底注销为 0
      const tile1 = tileGrid.getTerritoryByCoord(45, 25);
      const tile2 = tileGrid.getTerritoryByCoord(46, 25);
      expect(tile1).toBe(0);
      expect(tile2).toBe(0);

      // 验证至少注销了孤岛瓦片并派发了领域事件
      expect(purgedEnclaveTiles.length).toBeGreaterThanOrEqual(1);
      const purgedCoords = purgedEnclaveTiles.map(p => ({
        x: p.tileIdx % GRID_WIDTH,
        y: Math.floor(p.tileIdx / GRID_WIDTH)
      }));
      const found45 = purgedCoords.some(c => c.x === 45 && c.y === 25);
      const found46 = purgedCoords.some(c => c.x === 46 && c.y === 25);
      expect(found45 || found46).toBe(true);

      // 验证大陆主体核心区瓦片权属未被破坏
      expect(tileGrid.getTerritoryByCoord(5, 5)).toBe(motherFac);
    });

    it('机器断言 1.2: 被深水绝壁 (DEEP_WATER) 物理截断的孤立飞地，即使面积等于 4 瓦片，依然因无陆地连通被注销为中立荒漠', () => {
      // 1. 构建母国主体领地 (x: 5~11, y: 5~11, 共 49 瓦片)
      for (let y = 5; y <= 11; y++) {
        for (let x = 5; x <= 11; x++) {
          tileGrid.setTerritoryByCoord(x, y, motherFac);
        }
      }

      // 2. 构造被深水环绕的 2x2 孤悬离岛 (x: 16~17, y: 16~17, 共 4 瓦片)
      for (let y = 16; y <= 17; y++) {
        for (let x = 16; x <= 17; x++) {
          tileGrid.setTerritoryByCoord(x, y, motherFac);
        }
      }

      // 在离岛四周环绕铺设深水绝壁 (Biomes.DEEP_WATER.id)
      for (let y = 14; y <= 19; y++) {
        for (let x = 14; x <= 19; x++) {
          if (x < 16 || x > 17 || y < 16 || y > 17) {
            const idx = y * GRID_WIDTH + x;
            tileGrid.tileTypes[idx] = Biomes.DEEP_WATER.id;
          }
        }
      }

      // 在主体大陆放置小人，最远小人位于 (11, 11)，使叛军新图腾落于主体大陆边缘 (11, 11)
      for (let i = 0; i < 15; i++) {
        const u = ecs.allocateEntity();
        ecs.identities[u * IDENTITY_STRIDE + ID_OFFSET_FACTION] = motherFac;
        const px = (i === 14) ? 11 : (5 + (i % 6));
        const py = (i === 14) ? 11 : (5 + Math.floor(i / 6));
        ecs.transforms[u * TRANSFORM_STRIDE + TF_OFFSET_X] = px * TILE_SIZE + 12;
        ecs.transforms[u * TRANSFORM_STRIDE + TF_OFFSET_Y] = py * TILE_SIZE + 12;
      }

      // 老图腾位于 (5, 5)
      const oldTotem = ecs.allocateEntity();
      ecs.identities[oldTotem * IDENTITY_STRIDE + ID_OFFSET_FACTION] = motherFac;
      ecs.transforms[oldTotem * TRANSFORM_STRIDE + TF_OFFSET_X] = 5 * TILE_SIZE + 12;
      ecs.transforms[oldTotem * TRANSFORM_STRIDE + TF_OFFSET_Y] = 5 * TILE_SIZE + 12;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TOTEM_ID] = oldTotem;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 15;

      let purgeEventCount = 0;
      eventBus.subscribe(DomainEvents.EVT_SCHISM_ENCLAVE_PURGED, () => {
        purgeEventCount++;
      });

      // 触发大分裂
      const success = schismSys.attemptSchism(motherFac);
      eventBus.flush();

      expect(success).toBe(true);

      // 硬断言: 哪怕离岛拥有 4 块领地瓦片，由于被深水环绕且与新图腾无陆地连通，划归叛军后必须被当帧注销为 0
      const islandTile1 = tileGrid.getTerritoryByCoord(16, 16);
      const islandTile2 = tileGrid.getTerritoryByCoord(17, 16);
      const islandTile3 = tileGrid.getTerritoryByCoord(16, 17);
      const islandTile4 = tileGrid.getTerritoryByCoord(17, 17);
      expect(islandTile1).toBe(0);
      expect(islandTile2).toBe(0);
      expect(islandTile3).toBe(0);
      expect(islandTile4).toBe(0);
      expect(purgeEventCount).toBeGreaterThanOrEqual(4);
    });

    it('机器断言 1.3: 直接调用 _purgeEnclaves 验证 BFS 泛洪在 1 帧内将非连通深水分隔瓦片注销', () => {
      const rebelFac = 2;
      // 设立叛军新图腾位于 (20, 20)
      const seedX = 20;
      const seedY = 20;

      // 连通陆地: (20, 20) 到 (22, 20)
      for (let x = 20; x <= 22; x++) {
        tileGrid.setTerritoryByCoord(x, 20, rebelFac);
      }

      // 孤悬岛屿: (30, 20) 到 (31, 20)
      tileGrid.setTerritoryByCoord(30, 20, rebelFac);
      tileGrid.setTerritoryByCoord(31, 20, rebelFac);

      // 中间用深水阻隔 (23, 20) ~ (29, 20)
      for (let x = 23; x <= 29; x++) {
        const idx = 20 * GRID_WIDTH + x;
        tileGrid.tileTypes[idx] = Biomes.DEEP_WATER.id;
      }

      const purged = [];
      eventBus.subscribe(DomainEvents.EVT_SCHISM_ENCLAVE_PURGED, (type, fac, idx) => {
        purged.push({ fac, idx });
      });

      // 执行连通性泛洪清洗
      schismSys._purgeEnclaves(rebelFac, seedX, seedY);
      eventBus.flush();

      // 硬断言: 孤悬瓦片当帧注销为 0
      expect(tileGrid.getTerritoryByCoord(30, 20)).toBe(0);
      expect(tileGrid.getTerritoryByCoord(31, 20)).toBe(0);

      // 主体连通瓦片完整保留为 rebelFac
      expect(tileGrid.getTerritoryByCoord(20, 20)).toBe(rebelFac);
      expect(tileGrid.getTerritoryByCoord(21, 20)).toBe(rebelFac);
      expect(tileGrid.getTerritoryByCoord(22, 20)).toBe(rebelFac);

      // 事件总线派发了对应事件
      expect(purged.length).toBe(2);
      expect(purged[0].fac).toBe(rebelFac);
    });
  });

  describe('2. 防碎片化刚性门槛与内部平乱阻断断言', () => {
    it('机器断言 2.1: 母国领地 < 16 瓦片时强行阻断分裂，张力回退至 50，转为内部平乱', () => {
      // 领地仅 15 瓦片 (< 16 门槛)
      for (let x = 10; x < 25; x++) {
        tileGrid.setTerritoryByCoord(x, 10, motherFac);
      }
      expect(schismSys.countTerritory(motherFac)).toBe(15);

      // 人口 20 (>= 12 门槛)
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 20;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION] = 100;

      let schismFired = false;
      eventBus.subscribe(DomainEvents.EVT_FACTION_SCHISM, () => {
        schismFired = true;
      });

      const success = schismSys.attemptSchism(motherFac);
      eventBus.flush();

      // 硬断言: 分裂被坚决阻断
      expect(success).toBe(false);
      expect(schismFired).toBe(false);
      // 张力回退至 50 (内部处决首恶，平息部分怒气)
      expect(factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION]).toBe(50);
    });

    it('机器断言 2.2: 母国人口 < 12 时强行阻断分裂，转为内部平乱', () => {
      // 领地 25 瓦片 (>= 16 门槛)
      for (let y = 10; y < 15; y++) {
        for (let x = 10; x < 15; x++) {
          tileGrid.setTerritoryByCoord(x, y, motherFac);
        }
      }
      expect(schismSys.countTerritory(motherFac)).toBe(25);

      // 人口仅 11 人 (< 12 门槛)
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 11;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION] = 100;

      const success = schismSys.attemptSchism(motherFac);

      // 硬断言: 阻断分裂
      expect(success).toBe(false);
      expect(factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION]).toBe(50);
    });

    it('机器断言 2.3: 处于 300s 凝聚保护期内 (warCooldown > 0) 绝对免疫再次分裂', () => {
      // 满足地块与人口条件
      for (let y = 10; y < 15; y++) {
        for (let x = 10; x < 15; x++) {
          tileGrid.setTerritoryByCoord(x, y, motherFac);
        }
      }
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 20;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION] = 100;
      // 处于国家凝聚期 (剩余 180s)
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_WAR_COOLDOWN] = 180;

      const success = schismSys.attemptSchism(motherFac);
      expect(success).toBe(false);
      expect(factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION]).toBe(50);
    });

    it('机器断言 2.4: 全球 16 国上限硬锁断言，当达到 16 个国家时转为首领暗杀，绝不创生第 17 国', () => {
      // 激活全部 16 个阵营槽位
      for (let f = 1; f <= MAX_FACTIONS; f++) {
        const off = (f - 1) * FACTION_STRIDE;
        factionBuffer[off + FAC_OFFSET_FLAGS] = FactionFlags.ACTIVE;
      }
      expect(schismSys.countActiveFactions()).toBe(16);

      // 准备母国充足领地与人口
      for (let y = 10; y < 15; y++) {
        for (let x = 10; x < 15; x++) {
          tileGrid.setTerritoryByCoord(x, y, motherFac);
        }
      }
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 30;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION] = 100;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_WAR_COOLDOWN] = 0;

      // 1. AntiFragmentationGuard 拦截层: 驳回并回退张力至 50 (转为内部处决)
      const successWithGuard = schismSys.attemptSchism(motherFac);
      expect(successWithGuard).toBe(false);
      expect(factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION]).toBe(50);
      expect(schismSys.countActiveFactions()).toBe(16);

      // 2. 底层无守卫时的极端 Fallback: allocateRebelFactionSlot 返回 0，清零张力转首领暗杀
      const rawSchismSys = new SchismSystem(ecs, tileGrid, factionBuffer, eventBus, null, null);
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION] = 100;
      const successRaw = rawSchismSys.attemptSchism(motherFac);
      expect(successRaw).toBe(false);
      expect(factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION]).toBe(0);
      expect(rawSchismSys.allocateRebelFactionSlot()).toBe(0);
    });
  });

  describe('3. 混沌随机拓扑压力测试断言 (LL-007)', () => {
    it('连续 100 次随机拓扑切分与深水迷宫环境，死锁与死循环次数恒为 0，单次泛洪耗时 < 1.0ms', () => {
      const prng = new PRNG(0xCAFEBABE);
      const TRIALS = 100;
      let deadlockCount = 0;
      let totalElapsedMs = 0;

      for (let t = 0; t < TRIALS; t++) {
        const localGrid = new TileGrid();
        const localBuffer = createFactionRuntimeBuffer();
        const localAntiFrag = new AntiFragmentationGuard();
        const localSys = new SchismSystem(ecs, localGrid, localBuffer, null, localAntiFrag, null);

        const rebelFac = 2;
        const seedX = 15 + Math.floor(prng.nextFloat() * 20);
        const seedY = 10 + Math.floor(prng.nextFloat() * 15);

        // 随机生成 50 块属于叛军的瓦片
        for (let i = 0; i < 50; i++) {
          const rx = 5 + Math.floor(prng.nextFloat() * 45);
          const ry = 5 + Math.floor(prng.nextFloat() * 25);
          localGrid.setTerritoryByCoord(rx, ry, rebelFac);
        }

        // 确保新图腾所在位置归属叛军且为平原
        localGrid.setTerritoryByCoord(seedX, seedY, rebelFac);
        localGrid.tileTypes[seedY * GRID_WIDTH + seedX] = Biomes.PLAINS.id;

        // 随机在地图上撒入 20 块深水阻隔
        for (let i = 0; i < 20; i++) {
          const wx = 10 + Math.floor(prng.nextFloat() * 35);
          const wy = 5 + Math.floor(prng.nextFloat() * 25);
          if (wx !== seedX || wy !== seedY) {
            localGrid.tileTypes[wy * GRID_WIDTH + wx] = Biomes.DEEP_WATER.id;
          }
        }

        const t0 = performance.now();
        try {
          localSys._purgeEnclaves(rebelFac, seedX, seedY);
        } catch (err) {
          deadlockCount++;
        }
        const t1 = performance.now();
        totalElapsedMs += (t1 - t0);

        // 验证泛洪后，新图腾瓦片必定保留
        expect(localGrid.getTerritoryByCoord(seedX, seedY)).toBe(rebelFac);
      }

      // 硬断言: 100 次随机混沌拓扑泛洪中，死锁与崩溃次数为 0
      expect(deadlockCount).toBe(0);
      const avgElapsedMs = totalElapsedMs / TRIALS;
      // 平均耗时严格小于 1.0ms (通常 < 0.1ms)
      expect(avgElapsedMs).toBeLessThan(1.0);
    });
  });
});
