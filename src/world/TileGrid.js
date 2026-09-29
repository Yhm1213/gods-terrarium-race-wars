/**
 * TileGrid.js
 * 56x36 瓦片逻辑网格与生物群系环境阻力场
 * 
 * 核心设计指标:
 * 1. 规格: 56x36 = 2016 瓦片，步长 24px，总像素范围 1344x864
 * 2. 纯 SoA TypedArray 连续平铺内存布局，绝对零 GC
 * 3. 严格边界防御: 越界坐标自动 Clamp 阻尼截断，杜绝返回 undefined
 * 4. 严格对齐 src/data/BiomeData.js 中的 6 大生物群系参数
 */

import { Biomes, BiomeList, HazardTypes, isBiomeImpassable } from '../data/BiomeData.js';

export const GRID_WIDTH = 56;
export const GRID_HEIGHT = 36;
export const TOTAL_TILES = GRID_WIDTH * GRID_HEIGHT; // 2016
export const TILE_SIZE = 24;
export const WORLD_WIDTH = GRID_WIDTH * TILE_SIZE;   // 1344
export const WORLD_HEIGHT = GRID_HEIGHT * TILE_SIZE; // 864

export class TileGrid {
  constructor() {
    this.width = GRID_WIDTH;
    this.height = GRID_HEIGHT;
    this.cols = GRID_WIDTH;
    this.rows = GRID_HEIGHT;
    this.totalTiles = TOTAL_TILES;
    this.tileSize = TILE_SIZE;
    this.worldWidth = WORLD_WIDTH;
    this.worldHeight = WORLD_HEIGHT;

    // SoA 连续类型化数组内存池
    this.tileTypes = new Uint8Array(TOTAL_TILES);
    this.moveCost = new Float32Array(TOTAL_TILES);
    this.elevation = new Float32Array(TOTAL_TILES);
    this.hazardType = new Uint8Array(TOTAL_TILES);
    this.hazardDamage = new Float32Array(TOTAL_TILES);
    this.nutrientFloor = new Float32Array(TOTAL_TILES);
    this.territoryFaction = new Uint8Array(TOTAL_TILES); // 瓦片领地归属阵营 ID [0 ~ 16], 0=中立荒漠 (2,016 B)

    this.reset();
  }

  /**
   * 将瓦片坐标截断在合法网格范围内 [0, 55]
   * @param {number} x
   * @returns {number}
   */
  clampX(x) {
    if (x < 0) return 0;
    if (x >= GRID_WIDTH) return GRID_WIDTH - 1;
    return x | 0;
  }

  /**
   * 将瓦片坐标截断在合法网格范围内 [0, 35]
   * @param {number} y
   * @returns {number}
   */
  clampY(y) {
    if (y < 0) return 0;
    if (y >= GRID_HEIGHT) return GRID_HEIGHT - 1;
    return y | 0;
  }

  /**
   * 计算瓦片坐标在扁平数组中的索引 (自动 Clamp)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getIndex(x, y) {
    return this.clampY(y) * GRID_WIDTH + this.clampX(x);
  }

  /**
   * 无防御快速索引 (调用方保证坐标合法)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getFastIndex(x, y) {
    return (y * GRID_WIDTH + x) | 0;
  }

  /**
   * 检查坐标是否完全在有效范围内
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isValid(x, y) {
    return x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT;
  }

  /**
   * 世界像素坐标转瓦片坐标 X (自动 Clamp)
   * @param {number} wx
   * @returns {number}
   */
  worldToTileX(wx) {
    return this.clampX(Math.floor(wx / TILE_SIZE));
  }

  /**
   * 世界像素坐标转瓦片坐标 Y (自动 Clamp)
   * @param {number} wy
   * @returns {number}
   */
  worldToTileY(wy) {
    return this.clampY(Math.floor(wy / TILE_SIZE));
  }

  /**
   * 世界像素坐标转一维索引 (自动 Clamp)
   * @param {number} wx
   * @param {number} wy
   * @returns {number}
   */
  worldToTileIndex(wx, wy) {
    return this.getIndex(
      Math.floor(wx / TILE_SIZE),
      Math.floor(wy / TILE_SIZE)
    );
  }

  /**
   * 世界像素坐标转瓦片坐标 (支持零 GC 出参对象)
   * @param {number} wx
   * @param {number} wy
   * @param {{x: number, y: number}|null} [out=null]
   * @returns {{x: number, y: number}}
   */
  worldToTile(wx, wy, out = null) {
    const tx = this.worldToTileX(wx);
    const ty = this.worldToTileY(wy);
    if (out) {
      out.x = tx;
      out.y = ty;
      return out;
    }
    return { x: tx, y: ty };
  }

  /**
   * 根据世界物理像素坐标获取瓦片类型 ID (自动 Clamp)
   * @param {number} wx
   * @param {number} wy
   * @returns {number}
   */
  getTileTypeByWorld(wx, wy) {
    return this.tileTypes[this.worldToTileIndex(wx, wy)];
  }

  /**
   * 瓦片坐标转世界中心点 X 像素坐标
   * @param {number} tx
   * @returns {number}
   */
  tileToWorldCenterX(tx) {
    return (this.clampX(tx) + 0.5) * TILE_SIZE;
  }

  /**
   * 瓦片坐标转世界中心点 Y 像素坐标
   * @param {number} ty
   * @returns {number}
   */
  tileToWorldCenterY(ty) {
    return (this.clampY(ty) + 0.5) * TILE_SIZE;
  }

  /**
   * 瓦片坐标转世界像素中心坐标 (支持零 GC 出参对象)
   * @param {number} tx
   * @param {number} ty
   * @param {{x: number, y: number}|null} [out=null]
   * @returns {{x: number, y: number}}
   */
  tileToWorld(tx, ty, out = null) {
    const wx = this.tileToWorldCenterX(tx);
    const wy = this.tileToWorldCenterY(ty);
    if (out) {
      out.x = wx;
      out.y = wy;
      return out;
    }
    return { x: wx, y: wy };
  }

  /**
   * 通过世界像素坐标直接获取瓦片群系 ID (基于 worldToTileIndex，带边界 Clamp)
   * @param {number} wx
   * @param {number} wy
   * @returns {number}
   */
  getTileTypeByWorld(wx, wy) {
    const idx = this.worldToTileIndex(wx, wy);
    return this.tileTypes[idx];
  }

  /**
   * 获取指定瓦片的群系 ID (别名契约，越界自动 Clamp)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getTile(x, y) {
    return this.getTileType(x, y);
  }

  /**
   * 获取指定瓦片的群系 ID (越界自动 Clamp，不返回 undefined)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getTileType(x, y) {
    return this.tileTypes[this.getIndex(x, y)];
  }

  /**
   * 判断瓦片是否可通行 (moveCost < 100.0)
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isWalkable(x, y) {
    return this.getMoveCost(x, y) < 100.0;
  }

  /**
   * 获取指定瓦片的移动消耗倍率 (越界自动 Clamp)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getMoveCost(x, y) {
    return this.moveCost[this.getIndex(x, y)];
  }

  /**
   * 获取指定瓦片的海拔高度 (越界自动 Clamp)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getElevation(x, y) {
    return this.elevation[this.getIndex(x, y)];
  }

  /**
   * 获取指定瓦片的危险类型 (越界自动 Clamp)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getHazardType(x, y) {
    return this.hazardType[this.getIndex(x, y)];
  }

  /**
   * 获取指定瓦片的每秒危险伤害/治疗 (越界自动 Clamp)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getHazardDamage(x, y) {
    return this.hazardDamage[this.getIndex(x, y)];
  }

  /**
   * 获取指定瓦片的地脉保底养分 (越界自动 Clamp)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getNutrientFloor(x, y) {
    return this.nutrientFloor[this.getIndex(x, y)];
  }

  /**
   * 检查瓦片是否绝对不可通行 (moveCost >= 999.0)
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  isImpassable(x, y) {
    return this.getMoveCost(x, y) >= 999.0;
  }

  /**
   * 设置指定坐标瓦片的环境参数
   * @param {number} x
   * @param {number} y
   * @param {number} biomeId
   * @param {number} [elevation=0.0]
   */
  setTile(x, y, biomeId, elevation = 0.0) {
    const idx = this.getIndex(x, y);
    this.setTileByIndex(idx, biomeId, elevation);
  }

  /**
   * 通过扁平索引设置瓦片环境参数
   * @param {number} idx
   * @param {number} biomeId
   * @param {number} [elevation=0.0]
   */
  setTileByIndex(idx, biomeId, elevation = 0.0) {
    if (idx < 0 || idx >= TOTAL_TILES) return;
    const biome = BiomeList[biomeId] || Biomes.PLAINS;
    this.tileTypes[idx] = biome.id;
    this.moveCost[idx] = biome.moveCostMultiplier;
    this.elevation[idx] = elevation;
    this.hazardType[idx] = biome.hazardType;
    this.hazardDamage[idx] = biome.hazardDps;
    this.nutrientFloor[idx] = biome.nutrientFloor;
  }

  /**
   * 获取指定瓦片的领地归属阵营 ID [0 ~ 16] (0=中立)
   * @param {number} idx
   * @returns {number}
   */
  getTerritory(idx) {
    if (idx < 0 || idx >= TOTAL_TILES) return 0;
    return this.territoryFaction[idx];
  }

  /**
   * 通过坐标获取瓦片领地归属阵营 ID (越界自动 Clamp)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getTerritoryByCoord(x, y) {
    return this.territoryFaction[this.getIndex(x, y)];
  }

  /**
   * 设置指定瓦片的领地归属阵营 ID
   * @param {number} idx
   * @param {number} factionId
   */
  setTerritory(idx, factionId) {
    if (idx < 0 || idx >= TOTAL_TILES) return;
    this.territoryFaction[idx] = factionId & 0xFF;
  }

  /**
   * 通过坐标设置瓦片领地归属阵营 ID
   * @param {number} x
   * @param {number} y
   * @param {number} factionId
   */
  setTerritoryByCoord(x, y, factionId) {
    this.territoryFaction[this.getIndex(x, y)] = factionId & 0xFF;
  }

  /**
   * 重置全部瓦片为默认温带平原 (PLAINS) 并清除领地权属为中立
   */
  reset() {
    const defaultBiome = Biomes.PLAINS;
    for (let i = 0; i < TOTAL_TILES; i++) {
      this.tileTypes[i] = defaultBiome.id;
      this.moveCost[i] = defaultBiome.moveCostMultiplier;
      this.elevation[i] = 0.0;
      this.hazardType[i] = defaultBiome.hazardType;
      this.hazardDamage[i] = defaultBiome.hazardDps;
      this.nutrientFloor[i] = defaultBiome.nutrientFloor;
      this.territoryFaction[i] = 0;
    }
  }

  /**
   * 测算 TileGrid 静态常驻连续内存字节总数
   * @returns {number} 字节总数
   */
  calculateMemoryUsageBytes() {
    return (
      this.tileTypes.byteLength +
      this.moveCost.byteLength +
      this.elevation.byteLength +
      this.hazardType.byteLength +
      this.hazardDamage.byteLength +
      this.nutrientFloor.byteLength +
      this.territoryFaction.byteLength
    );
  }
}
