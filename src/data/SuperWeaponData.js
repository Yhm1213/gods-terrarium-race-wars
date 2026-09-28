/**
 * @file SuperWeaponData.js
 * @description 四大超级战略兵器参数字典 (SuperWeapons)
 * 严格遵循 TDS 2.4 节设计规范与数值平衡规范：
 * 完整落地矮人轨道巨炮、地精自爆飞艇、绿皮比蒙巨兽与森灵古树古卫的战斗、移速与生草反噬机制。
 */

/**
 * 超级兵器生草反噬类型枚举
 */
export const SuperWeaponMisfireType = Object.freeze({
  NONE: 0,
  CANNON_BACKFIRE: 1, // 矮人火炮炸膛熏黑并眩晕
  AIRSHIP_EXPLODE: 2, // 地精飞艇大本营原地殉爆
  BEHEMOTH_FRENZY: 3, // 比蒙巨兽饥饿发狂践踏本族
  TREANT_FIRE_PANIC: 4 // 树精遇火恐慌狂乱暴走
});

/**
 * 四大超级战略兵器参数字典
 * @type {Readonly<Record<string, Readonly<object>>>}
 */
export const SuperWeapons = Object.freeze({
  DWARF_CANNON: Object.freeze({
    id: 'DWARF_CANNON',
    raceId: 'DWARF',
    name: '地鸣破城轨道巨炮',
    maxRange: 14,             // 射程 14 瓦片
    damage: 280,              // 穿甲真伤
    cooldownSec: 25.0,
    knockbackForce: 120.0,
    misfireRate: 0.10,        // 10% 炸膛几率
    misfireType: SuperWeaponMisfireType.CANNON_BACKFIRE,
    misfireEffect: Object.freeze({
      stunRadius: 3,
      stunDurationSec: 5.0,
      selfDamage: 80           // 炮体自损 80 HP
    })
  }),

  GOBLIN_AIRSHIP: Object.freeze({
    id: 'GOBLIN_AIRSHIP',
    raceId: 'GOBLIN',
    name: '神风自爆动力飞艇',
    maxHp: 180,               // 补齐飞艇自身生命值 (地面远程可集火拦截击落)
    baseSpeed: 45.0,
    flightAltitude: 3,
    explosionRadius: 3,
    damage: 220,
    fireDurationSec: 10.0,
    misfireRate: 0.25,        // 25% 自家主城失衡殉爆升天几率
    misfireType: SuperWeaponMisfireType.AIRSHIP_EXPLODE,
    misfireEffect: Object.freeze({
      selfExplodeInBase: true,
      destructionRadius: 3
    })
  }),

  ORC_BEHEMOTH: Object.freeze({
    id: 'ORC_BEHEMOTH',
    raceId: 'ORC',
    name: '生化憎恶比蒙巨兽',
    footprint: Object.freeze({ w: 2, h: 2 }),
    maxHp: 1200,
    mass: 550.0,
    baseSpeed: 36.0,          // 补齐移速
    damage: 60,               // 补齐普攻伤害
    attackIntervalSec: 2.2,   // 攻击间隔
    sweepAngleRad: 1.57,      // 90 度扇形横扫
    knockbackForce: 160.0,    // 巨大击退冲量
    dailyMeatUpkeep: 5,       // 每日需投喂 5 份鲜肉
    starvationFrenzySec: 15.0,// 断粮发狂践踏自家帐篷时间
    misfireType: SuperWeaponMisfireType.BEHEMOTH_FRENZY
  }),

  ELF_ANCIENT_TREANT: Object.freeze({
    id: 'ELF_ANCIENT_TREANT',
    raceId: 'ELF',
    name: '远古战争树精古卫',
    footprint: Object.freeze({ w: 2, h: 2 }),
    maxHp: 950,
    mass: 420.0,
    baseSpeed: 22.0,          // 补齐移速 (拉齐 GDD 0.4 倍移速)
    damage: 45,               // 补齐普攻
    attackIntervalSec: 2.6,
    entangle: Object.freeze({
      radius: 2,
      slowPct: 0.60,          // 减速 60%
      durationSec: 3.0
    }),
    firePanicDurationSec: 8.0,// 遇火恐慌无差别践踏时间
    misfireType: SuperWeaponMisfireType.TREANT_FIRE_PANIC
  })
});

/**
 * 根据种族 ID 查找其超级战略武器配置
 * @param {string} raceId - 种族 ID (DWARF / GOBLIN / ORC / ELF)
 * @returns {Readonly<object> | null}
 */
export function getSuperWeaponByRace(raceId) {
  return Object.values(SuperWeapons).find(w => w.raceId === raceId) || null;
}
