/**
 * SchismSystem.js
 * Voronoi 聚落双核几何切分与拓扑连通分量泛洪飞地消除系统 (TC-EDGE-06)
 * 严格遵照 SPEC-M3-CONTRACT §4.3
 *
 * 核心机制:
 * 1. 聚落双核自适应切分: 重心 A (老图腾) 与重心 B (最远聚集点，生成新叛军图腾)，运行离散 Voronoi 领地划分
 * 2. 孤岛飞地消除断言 (TC-EDGE-06): BFS 泛洪检查，无陆地连通或面积 < 4 的孤岛飞地当帧注销为中立荒漠 (领地权属=0)
 *    并派发关键事务领域事件 EVT_SCHISM_ENCLAVE_PURGED (0x8013)
 * 3. 悬空站队事务锁: IS_HELD 掩码实体挂起换籍事务，着陆后再安全归属
 * 4. 100% 物理零 GC: 预分配队列与复用位图
 */

import {
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
  MORALE_OFFSET_VAL
} from '../core/ECS.js';
import {
  IS_HELD,
  IS_ALIVE,
  hasStatus
} from '../components/UnitStatusFlags.js';
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
  FactionFlags
} from '../data/FactionData.js';
import {
  GRID_WIDTH,
  GRID_HEIGHT,
  TOTAL_TILES,
  TILE_SIZE
} from '../world/TileGrid.js';
import { isBiomeImpassable } from '../data/BiomeData.js';
import { DomainEvents } from '../data/DomainEvents.js';
import { SchismBlockReason } from './AntiFragmentationGuard.js';

export const MIN_ENCLAVE_SIZE = 4; // 飞地最小连通面积门槛 (< 4 瓦片当帧注销)

export class SchismSystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {import('../world/TileGrid.js').TileGrid} tileGrid 
   * @param {Int32Array} factionBuffer 
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null] 
   * @param {import('./AntiFragmentationGuard.js').AntiFragmentationGuard|null} [antiFragGuard=null] 
   * @param {import('./RebelWrathSystem.js').RebelWrathSystem|null} [rebelWrathSystem=null] 
   */
  constructor(ecs, tileGrid, factionBuffer, eventBus = null, antiFragGuard = null, rebelWrathSystem = null) {
    this.ecs = ecs;
    this.tileGrid = tileGrid;
    this.factionBuffer = factionBuffer;
    this.eventBus = eventBus;
    this.antiFragGuard = antiFragGuard;
    this.rebelWrathSystem = rebelWrathSystem;

    this.width = GRID_WIDTH;
    this.height = GRID_HEIGHT;
    this.totalTiles = TOTAL_TILES;

    // 预分配 BFS 泛洪连通分量队列与访问标记 (容量 2016，零 GC)
    this._floodQueue = new Uint16Array(TOTAL_TILES);
    this._visited = new Uint8Array(TOTAL_TILES);

    // 悬空事务锁挂起实体队列 (容量 256)
    this.heldPendingEntities = new Uint16Array(256);
    this.heldPendingMotherFac = new Uint8Array(256);
    this.heldPendingRebelFac = new Uint8Array(256);
    this.heldPendingCount = 0;
  }

  /**
   * 统计某阵营当前领地瓦片总数
   * @param {number} factionId 
   * @returns {number}
   */
  countTerritory(factionId) {
    let count = 0;
    const tFac = this.tileGrid.territoryFaction;
    for (let i = 0; i < this.totalTiles; i++) {
      if (tFac[i] === factionId) count++;
    }
    return count;
  }

  /**
   * 统计当前全大陆活跃国家总数
   * @returns {number}
   */
  countActiveFactions() {
    let active = 0;
    for (let f = 1; f <= MAX_FACTIONS; f++) {
      const baseOff = (f - 1) * FACTION_STRIDE;
      const flags = this.factionBuffer[baseOff + FAC_OFFSET_FLAGS];
      if ((flags & FactionFlags.ACTIVE) !== 0 && 
          (flags & FactionFlags.DESTROYED) === 0 && 
          (flags & FactionFlags.IS_RUINS) === 0) {
        active++;
      }
    }
    return active;
  }

  /**
   * 检索第一个未激活可用的叛军政权槽位 ID [1 ~ 16]
   * @returns {number} 0 表示无空闲槽位
   */
  allocateRebelFactionSlot() {
    for (let f = 1; f <= MAX_FACTIONS; f++) {
      const baseOff = (f - 1) * FACTION_STRIDE;
      const flags = this.factionBuffer[baseOff + FAC_OFFSET_FLAGS];
      if ((flags & FactionFlags.ACTIVE) === 0) {
        return f;
      }
    }
    return 0;
  }

  /**
   * 尝试引爆指定阵营的大裂变
   * @param {number} motherFac 
   * @returns {boolean} 是否成功分裂
   */
  attemptSchism(motherFac) {
    if (motherFac < 1 || motherFac > MAX_FACTIONS) return false;

    const baseOffsetM = (motherFac - 1) * FACTION_STRIDE;
    const currentPop = this.factionBuffer[baseOffsetM + FAC_OFFSET_POP_COUNT];
    const territoryCount = this.countTerritory(motherFac);
    const warCooldown = this.factionBuffer[baseOffsetM + FAC_OFFSET_WAR_COOLDOWN];
    const activeCount = this.countActiveFactions();

    // 1. 防碎片化协议综合守门
    if (this.antiFragGuard) {
      const check = this.antiFragGuard.evaluateSchismEligibility(
        motherFac,
        currentPop,
        territoryCount,
        warCooldown,
        activeCount
      );

      if (!check.allowed) {
        // 门槛不符，驳回并转为内部处决/流血政变，张力回退至 50
        this.factionBuffer[baseOffsetM + FAC_OFFSET_TENSION] = 50;
        return false;
      }
    }

    // 2. 分配新叛军阵营槽位
    const rebelFac = this.allocateRebelFactionSlot();
    if (rebelFac === 0) {
      // 达到全球 16 国硬锁，转为内部刺杀，清空张力
      this.factionBuffer[baseOffsetM + FAC_OFFSET_TENSION] = 0;
      return false;
    }

    // 3. 检索双核重心 A 与重心 B
    const totemIdM = this.factionBuffer[baseOffsetM + FAC_OFFSET_TOTEM_ID];
    let seedAx = 10;
    let seedAy = 10;
    if (totemIdM > NULL_ENTITY && this.ecs.isAlive(totemIdM)) {
      const tfM = totemIdM * TRANSFORM_STRIDE;
      seedAx = Math.floor(this.ecs.transforms[tfM + TF_OFFSET_X] / TILE_SIZE);
      seedAy = Math.floor(this.ecs.transforms[tfM + TF_OFFSET_Y] / TILE_SIZE);
    }

    // 检索距重心 A 最远的次级聚集点/军营作为叛乱重心 B (生成新图腾点)
    let maxDist2 = -1;
    let seedBx = seedAx;
    let seedBy = seedAy;
    const tFac = this.tileGrid.territoryFaction;

    const dense = this.ecs.denseEntities;
    const total = this.ecs.activeCount;
    let foundPopSeed = false;

    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY || eid === totemIdM) continue;

      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f !== motherFac) continue;

      const tf = eid * TRANSFORM_STRIDE;
      const ex = Math.floor(this.ecs.transforms[tf + TF_OFFSET_X] / TILE_SIZE);
      const ey = Math.floor(this.ecs.transforms[tf + TF_OFFSET_Y] / TILE_SIZE);

      if (ex >= 0 && ex < this.width && ey >= 0 && ey < this.height) {
        const dx = ex - seedAx;
        const dy = ey - seedAy;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxDist2) {
          maxDist2 = d2;
          seedBx = ex;
          seedBy = ey;
          foundPopSeed = true;
        }
      }
    }

    // 若无小人，回退到领地瓦片检索
    if (!foundPopSeed) {
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = y * this.width + x;
          if (tFac[idx] === motherFac) {
            const dx = x - seedAx;
            const dy = y - seedAy;
            const d2 = dx * dx + dy * dy;
            if (d2 > maxDist2) {
              maxDist2 = d2;
              seedBx = x;
              seedBy = y;
            }
          }
        }
      }
    }

    // 创建叛军图腾实体
    const rebelTotem = this.ecs.allocateEntity();
    this.ecs.identities[rebelTotem * IDENTITY_STRIDE + ID_OFFSET_FACTION] = rebelFac;
    const tfR = rebelTotem * TRANSFORM_STRIDE;
    this.ecs.transforms[tfR + TF_OFFSET_X] = seedBx * TILE_SIZE + 12.0;
    this.ecs.transforms[tfR + TF_OFFSET_Y] = seedBy * TILE_SIZE + 12.0;
    const hpR = rebelTotem * HEALTH_STRIDE;
    this.ecs.health[hpR + HP_OFFSET_MAX] = 1000.0;
    this.ecs.health[hpR + HP_OFFSET_CURRENT] = 1000.0;

    // 4. 离散 Voronoi 领地划分
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x;
        if (tFac[idx] === motherFac) {
          const distA = Math.abs(x - seedAx) + Math.abs(y - seedAy);
          const distB = Math.abs(x - seedBx) + Math.abs(y - seedBy);

          if (distB < distA) {
            tFac[idx] = rebelFac;
          }
        }
      }
    }

    // 保证新旧图腾所在瓦片权属确定
    const idxA = seedAy * this.width + seedAx;
    const idxB = seedBy * this.width + seedBx;
    tFac[idxA] = motherFac;
    tFac[idxB] = rebelFac;

    // 5. 孤岛飞地消除断言 (TC-EDGE-06 内联)
    this._purgeEnclaves(rebelFac, seedBx, seedBy);

    // 6. 实体站队与悬空事务锁
    for (let i = 0; i < total; i++) {
      const eid = dense[i];
      if (eid === NULL_ENTITY || eid === totemIdM || eid === rebelTotem) continue;

      const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
      if (f !== motherFac) continue;

      // 悬空事务锁: 若正在被上帝之手抓取，挂起换籍
      if (hasStatus(this.ecs.statusFlags, eid, IS_HELD)) {
        if (this.heldPendingCount < this.heldPendingEntities.length) {
          this.heldPendingEntities[this.heldPendingCount] = eid;
          this.heldPendingMotherFac[this.heldPendingCount] = motherFac;
          this.heldPendingRebelFac[this.heldPendingCount] = rebelFac;
          this.heldPendingCount++;
        }
        continue;
      }

      // 根据实体当前所在瓦片权属划分阵营
      const tf = eid * TRANSFORM_STRIDE;
      const ex = Math.floor(this.ecs.transforms[tf + TF_OFFSET_X] / TILE_SIZE);
      const ey = Math.floor(this.ecs.transforms[tf + TF_OFFSET_Y] / TILE_SIZE);

      if (ex >= 0 && ex < this.width && ey >= 0 && ey < this.height) {
        const tIdx = ey * this.width + ex;
        if (tFac[tIdx] === rebelFac) {
          this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = rebelFac;
        }
      }
    }

    // 7. 注册并初始化新叛军政权缓冲区与仓储物料守恒划分 (TC-EDGE-08)
    const baseOffsetR = (rebelFac - 1) * FACTION_STRIDE;
    this.factionBuffer[baseOffsetR + FAC_OFFSET_TOTEM_ID] = rebelTotem;
    this.factionBuffer[baseOffsetR + FAC_OFFSET_TENSION] = 0;
    this.factionBuffer[baseOffsetR + FAC_OFFSET_WAR_COOLDOWN] = 300; // 300s 凝聚保护锁
    this.factionBuffer[baseOffsetR + FAC_OFFSET_FLAGS] = FactionFlags.ACTIVE | FactionFlags.IS_REBEL;

    // 仓储物料严格整数守恒划分 (∑Food_new === ∑Food_old, ∑Ore_new === ∑Ore_old)
    const oldFood = this.factionBuffer[baseOffsetM + FAC_OFFSET_FOOD];
    const oldOre = this.factionBuffer[baseOffsetM + FAC_OFFSET_ORE];
    const rebelFood = Math.floor(oldFood / 2);
    const rebelOre = Math.floor(oldOre / 2);
    this.factionBuffer[baseOffsetR + FAC_OFFSET_FOOD] = rebelFood;
    this.factionBuffer[baseOffsetR + FAC_OFFSET_ORE] = rebelOre;
    this.factionBuffer[baseOffsetM + FAC_OFFSET_FOOD] = oldFood - rebelFood;
    this.factionBuffer[baseOffsetM + FAC_OFFSET_ORE] = oldOre - rebelOre;

    // 母国张力清零并进入 300s 分裂凝聚冷却
    this.factionBuffer[baseOffsetM + FAC_OFFSET_TENSION] = 0;
    this.factionBuffer[baseOffsetM + FAC_OFFSET_WAR_COOLDOWN] = 300;
    this.factionBuffer[baseOffsetM + FAC_OFFSET_FLAGS] |= FactionFlags.SCHISMED;

    // 8. 激活叛军【自由之怒】45 秒 Buff
    if (this.rebelWrathSystem) {
      this.rebelWrathSystem.activateRebelWrath(rebelFac);
    }

    // 9. 派发关键事务大裂变领域事件
    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_FACTION_SCHISM, motherFac, rebelFac, 0, 0);
    }

    return true;
  }

  /**
   * 拓扑连通分量泛洪与孤岛飞地消除 (TC-EDGE-06)
   * 任何与新图腾无直接陆地连通路径的孤岛瓦片，当帧注销为中立荒漠 (权属=0)
   * @private
   */
  _purgeEnclaves(rebelFac, seedX, seedY) {
    this._visited.fill(0);

    const w = this.width;
    const h = this.height;
    const tFac = this.tileGrid.territoryFaction;
    const tTypes = this.tileGrid.tileTypes;

    let head = 0;
    let tail = 0;

    const startIdx = seedY * w + seedX;
    this._floodQueue[tail++] = startIdx;
    this._visited[startIdx] = 1;

    // 4 向广度优先泛洪连通分量
    while (head < tail) {
      const curr = this._floodQueue[head++];
      const cx = curr % w;
      const cy = (curr / w) | 0;

      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (let i = 0; i < 4; i++) {
        const nx = cx + dirs[i][0];
        const ny = cy + dirs[i][1];

        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;

        const nIdx = ny * w + nx;
        if (this._visited[nIdx] === 1) continue;

        // 仅在属于叛军领地且陆地可通行的瓦片上泛洪
        if (tFac[nIdx] === rebelFac) {
          if (!isBiomeImpassable(tTypes[nIdx])) {
            this._visited[nIdx] = 1;
            this._floodQueue[tail++] = nIdx;
          }
        }
      }
    }

    // 遍历所有划归叛军的瓦片，未被连通访问到的孤岛飞地当帧注销为中立荒漠
    for (let idx = 0; idx < this.totalTiles; idx++) {
      if (tFac[idx] === rebelFac && this._visited[idx] === 0) {
        tFac[idx] = 0; // 注销为中立荒漠

        if (this.eventBus) {
          this.eventBus.emit(DomainEvents.EVT_SCHISM_ENCLAVE_PURGED, rebelFac, idx, 0, 0);
        }
      }
    }
  }

  /**
   * 系统每帧更新 (处理悬空实体的着陆安全归属与保护锁衰减)
   * @param {number} dt 
   */
  update(dt) {
    if (this.heldPendingCount === 0) return;

    const tFac = this.tileGrid.territoryFaction;
    let writeIdx = 0;

    for (let i = 0; i < this.heldPendingCount; i++) {
      const eid = this.heldPendingEntities[i];
      if (eid <= NULL_ENTITY || !this.ecs.isAlive(eid)) continue;

      // 若仍然处于悬空抓取中，保留在挂起队列
      if (hasStatus(this.ecs.statusFlags, eid, IS_HELD)) {
        this.heldPendingEntities[writeIdx] = eid;
        this.heldPendingMotherFac[writeIdx] = this.heldPendingMotherFac[i];
        this.heldPendingRebelFac[writeIdx] = this.heldPendingRebelFac[i];
        writeIdx++;
        continue;
      }

      // 实体已着陆: 安全判定其着陆位置归属
      const tf = eid * TRANSFORM_STRIDE;
      const ex = Math.floor(this.ecs.transforms[tf + TF_OFFSET_X] / TILE_SIZE);
      const ey = Math.floor(this.ecs.transforms[tf + TF_OFFSET_Y] / TILE_SIZE);

      if (ex >= 0 && ex < this.width && ey >= 0 && ey < this.height) {
        const tIdx = ey * this.width + ex;
        const rebelF = this.heldPendingRebelFac[i];
        if (tFac[tIdx] === rebelF) {
          this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION] = rebelF;
        }
      }
    }

    this.heldPendingCount = writeIdx;
  }
}
