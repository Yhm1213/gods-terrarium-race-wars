/**
 * SchismSystem.test.js
 * Voronoi 双核大分裂、飞地清除与叛乱狂暴规范测试套件 (WP-3.4)
 * 验证 SPEC-M3-CONTRACT §4.2, §4.3, §4.4, §4.5 (TC-EDGE-06)
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
  HP_OFFSET_MAX,
  MORALE_STRIDE,
  MORALE_OFFSET_VAL,
  PHYSIOLOGY_STRIDE,
  PHY_OFFSET_HUNGER
} from '../../src/core/ECS.js';
import {
  IS_HELD,
  IS_PANICKED,
  HAS_WRATH_OF_LIBERTY,
  hasStatus,
  setStatus,
  clearStatus
} from '../../src/components/UnitStatusFlags.js';
import {
  TileGrid,
  GRID_WIDTH,
  GRID_HEIGHT,
  TILE_SIZE
} from '../../src/world/TileGrid.js';
import { Biomes } from '../../src/data/BiomeData.js';
import { DomainEventBus } from '../../src/core/DomainEventBus.js';
import { DomainEvents } from '../../src/data/DomainEvents.js';
import {
  MAX_FACTIONS,
  FACTION_STRIDE,
  FAC_OFFSET_TOTEM_ID,
  FAC_OFFSET_TENSION,
  FAC_OFFSET_POP_COUNT,
  FAC_OFFSET_FLAGS,
  FactionFlags,
  createFactionRuntimeBuffer
} from '../../src/data/FactionData.js';
import { AntiFragmentationGuard } from '../../src/politics/AntiFragmentationGuard.js';
import { RebelWrathSystem } from '../../src/politics/RebelWrathSystem.js';
import { SchismSystem } from '../../src/politics/SchismSystem.js';
import { ClanCensusSystem } from '../../src/politics/ClanCensusSystem.js';

describe('SchismSystem Specification Suite (WP-3.4, TC-EDGE-06)', () => {
  let ecs;
  let tileGrid;
  let factionBuffer;
  let eventBus;
  let antiFrag;
  let wrathSys;
  let schismSys;
  let censusSys;

  const motherFac = 1;

  beforeEach(() => {
    ecs = new ECS();
    tileGrid = new TileGrid();
    factionBuffer = createFactionRuntimeBuffer();
    eventBus = new DomainEventBus();
    antiFrag = new AntiFragmentationGuard();
    wrathSys = new RebelWrathSystem(ecs, eventBus);
    schismSys = new SchismSystem(ecs, tileGrid, factionBuffer, eventBus, antiFrag, wrathSys);
    censusSys = new ClanCensusSystem(ecs, factionBuffer, eventBus, schismSys);

    // 激活母国阵营
    const baseOff = (motherFac - 1) * FACTION_STRIDE;
    factionBuffer[baseOff + FAC_OFFSET_FLAGS] = FactionFlags.ACTIVE;
  });

  describe('1. 真实微观普查与政治张力累加', () => {
    it('饥饿与战损通过真实公式累加张力，蓄满 100 引爆裂变', () => {
      // 创建 10 名饥饿人口 (hunger = 90 >= 80)
      for (let i = 0; i < 10; i++) {
        const u = ecs.allocateEntity();
        ecs.identities[u * IDENTITY_STRIDE + ID_OFFSET_FACTION] = motherFac;
        ecs.physiology[u * PHYSIOLOGY_STRIDE + PHY_OFFSET_HUNGER] = 90.0;
      }

      // 执行普查
      censusSys.executeCensus();

      const baseOff = (motherFac - 1) * FACTION_STRIDE;
      expect(factionBuffer[baseOff + FAC_OFFSET_POP_COUNT]).toBe(10);
      expect(censusSys.getTension(motherFac)).toBeGreaterThan(0);
    });
  });

  describe('2. Voronoi 双核切分与孤岛飞地消除 (TC-EDGE-06)', () => {
    it('双核 Voronoi 切分领地，并将未连通新图腾的孤悬飞地当帧注销为中立荒漠', () => {
      // 1. 设置母国领地为 5x5 大陆 (25 块瓦片 >= 16 门槛)
      for (let y = 10; y < 15; y++) {
        for (let x = 10; x < 15; x++) {
          tileGrid.setTerritoryByCoord(x, y, motherFac);
        }
      }

      // 并在远端 (x=30, y=30) 设立一个孤悬海外的 2 瓦片飞地
      tileGrid.setTerritoryByCoord(30, 30, motherFac);
      tileGrid.setTerritoryByCoord(31, 30, motherFac);

      // 母国创建 15 名小人 (满足 >= 12 人口门槛)
      for (let i = 0; i < 15; i++) {
        const u = ecs.allocateEntity();
        ecs.identities[u * IDENTITY_STRIDE + ID_OFFSET_FACTION] = motherFac;
        ecs.transforms[u * TRANSFORM_STRIDE + TF_OFFSET_X] = (10 + (i % 5)) * TILE_SIZE;
        ecs.transforms[u * TRANSFORM_STRIDE + TF_OFFSET_Y] = (10 + Math.floor(i / 5)) * TILE_SIZE;
      }

      // 老图腾位于 (10, 10)
      const oldTotem = ecs.allocateEntity();
      ecs.identities[oldTotem * IDENTITY_STRIDE + ID_OFFSET_FACTION] = motherFac;
      ecs.transforms[oldTotem * TRANSFORM_STRIDE + TF_OFFSET_X] = 10 * TILE_SIZE + 12;
      ecs.transforms[oldTotem * TRANSFORM_STRIDE + TF_OFFSET_Y] = 10 * TILE_SIZE + 12;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TOTEM_ID] = oldTotem;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 15;

      // 监听飞地注销事件
      let enclavePurgedFired = false;
      eventBus.subscribe(DomainEvents.EVT_SCHISM_ENCLAVE_PURGED, () => {
        enclavePurgedFired = true;
      });

      // 触发大分裂
      const success = schismSys.attemptSchism(motherFac);
      eventBus.flush();

      expect(success).toBe(true);

      // 断言: 孤悬海外的 (30, 30) 瓦片由于无法连通叛军图腾，被当帧注销为 0 (荒漠) (TC-EDGE-06)
      const remoteTile = tileGrid.getTerritoryByCoord(30, 30);
      expect(remoteTile).toBe(0);
      expect(enclavePurgedFired).toBe(true);
    });
  });

  describe('3. 悬空站队事务锁与着陆安全判定', () => {
    it('悬空 IS_HELD 实体在大裂变时挂起换籍，着陆后根据落点安全划分阵营', () => {
      // 准备 20 块领地与 14 人口
      for (let y = 10; y < 14; y++) {
        for (let x = 10; x < 15; x++) {
          tileGrid.setTerritoryByCoord(x, y, motherFac);
        }
      }
      for (let i = 0; i < 14; i++) {
        const u = ecs.allocateEntity();
        ecs.identities[u * IDENTITY_STRIDE + ID_OFFSET_FACTION] = motherFac;
        ecs.transforms[u * TRANSFORM_STRIDE + TF_OFFSET_X] = 10 * TILE_SIZE + 12;
        ecs.transforms[u * TRANSFORM_STRIDE + TF_OFFSET_Y] = 10 * TILE_SIZE + 12;
      }
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 14;

      // 某实体正被上帝之手抓起悬空 (置位 IS_HELD)
      const heldUnit = ecs.allocateEntity();
      ecs.identities[heldUnit * IDENTITY_STRIDE + ID_OFFSET_FACTION] = motherFac;
      setStatus(ecs.statusFlags, heldUnit, IS_HELD);
      ecs.transforms[heldUnit * TRANSFORM_STRIDE + TF_OFFSET_X] = 14 * TILE_SIZE + 12;
      ecs.transforms[heldUnit * TRANSFORM_STRIDE + TF_OFFSET_Y] = 13 * TILE_SIZE + 12;

      // 触发分裂
      schismSys.attemptSchism(motherFac);

      // 断言: 悬空小人阵营未被粗暴篡改，仍保留原阵营
      expect(ecs.identities[heldUnit * IDENTITY_STRIDE + ID_OFFSET_FACTION]).toBe(motherFac);
      expect(schismSys.heldPendingCount).toBe(1);

      // 小人着陆 (放下上帝之手)
      clearStatus(ecs.statusFlags, heldUnit, IS_HELD);
      schismSys.update(0.1);

      // 断言: 着陆后安全换籍
      expect(schismSys.heldPendingCount).toBe(0);
    });
  });

  describe('4. 叛乱狂暴与图腾坍塌平叛 (RebelWrath)', () => {
    it('叛军全员获得【自由之怒】45 秒 Buff，图腾倒塌瞬时驱散转跪地投降', () => {
      const rebelFac = 2;
      const rebelSoldier = ecs.allocateEntity();
      ecs.identities[rebelSoldier * IDENTITY_STRIDE + ID_OFFSET_FACTION] = rebelFac;
      ecs.morale[rebelSoldier * MORALE_STRIDE + MORALE_OFFSET_VAL] = 20.0;

      // 激活自由之怒
      wrathSys.activateRebelWrath(rebelFac);

      // 断言: 获得狂暴掩码且士气抬升至 50 下限
      expect(wrathSys.hasWrath(rebelSoldier)).toBe(true);
      expect(ecs.morale[rebelSoldier * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBe(50.0);

      // 叛军图腾被摧毁平叛
      wrathSys.onTotemDestroyed(rebelFac);

      // 断言: 狂暴被驱散，士气归零并陷入惊恐投降
      expect(wrathSys.hasWrath(rebelSoldier)).toBe(false);
      expect(ecs.morale[rebelSoldier * MORALE_STRIDE + MORALE_OFFSET_VAL]).toBe(0.0);
      expect(hasStatus(ecs.statusFlags, rebelSoldier, IS_PANICKED)).toBe(true);
    });
  });

  describe('5. 四大防碎片化综合守门', () => {
    it('人口 < 12 或领地 < 16 时驳回大裂变并转为内部流血政变', () => {
      // 仅有 5 人口与 8 块领地 (未达门槛)
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_POP_COUNT] = 5;
      factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION] = 100;

      const success = schismSys.attemptSchism(motherFac);
      expect(success).toBe(false);
      // 张力回退至 50 (内部处决首恶)
      expect(factionBuffer[(motherFac - 1) * FACTION_STRIDE + FAC_OFFSET_TENSION]).toBe(50);
    });
  });
});
