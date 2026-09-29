/**
 * @file DomainEvents.js
 * @description 全量领域事件枚举字典 (DomainEvents)
 * 严格遵循 TDS 5.2 节设计规范与微观物理通道架构：
 * 1. 关键事务通道 (Critical Transaction Channel)：(EventType & 0x8000) !== 0，容量 512，100% 绝对不丢包；
 * 2. 瞬态表现通道 (Ephemeral Event Channel)：最高位为 0，容量 3584，供表现层拉取，超载时自动按 FIFO 覆盖降频。
 */

/**
 * 全量领域事件枚举字典
 * @type {Readonly<Record<string, number>>}
 */
export const DomainEvents = Object.freeze({
  // ================= 关键事务通道 (0x8000 起始，绝对可靠) =================
  EVT_FACTION_SCHISM:       0x8001, // 领地大裂变触发 (Param1: 母国ID, Param2: 叛军国ID)
  EVT_FACTION_DESTROYED:    0x8002, // 阵营图腾倒塌灭绝 (Param1: 阵营ID, Param2: 击杀者国ID)
  EVT_HEIR_CROWNED:         0x8003, // 新王即位加冕 (Param1: 新王ID, Param2: 继承方式代码)
  EVT_WAR_DECLARED:         0x8004, // 全面战争爆发 (Param1: 宣战国ID, Param2: 被宣国ID)
  EVT_PAX_DIVINA_FORCED:    0x8005, // 300s 战争超时强制休战 (Param1: 阵营A, Param2: 阵营B)
  EVT_PHYLACTERY_SHATTERED: 0x8006, // 亡灵命匣粉碎万魂反噬 (Param1: 命匣ID, Param2: 巫妖ID)
  EVT_GOLEM_PETRIFIED:      0x8007, // 魔像断能石化为古代遗迹 (Param1: 魔像ID, Param2: 瓦片Index)
  EVT_RULER_DIED:           0x8009, // 君主驾崩/继承原子事务开启 (Param1: 阵营ID, Param2: 老王ID) [新增]
  EVT_PEACE_TREATY_SIGNED:  0x800A, // 战后五重处置和谈条约签署 (Param1: 战胜国, Param2: 条约类型) [新增]
  EVT_GRUDGE_SETTLED:       0x800B, // 血亲复仇达成销账 (Param1: 复仇者ID, Param2: 仇人ID) [新增]
  EVT_OVERDRIVE_STARTED:    0x800C, // 15秒神恩满溢狂欢开启 (Param1: 触发Tick, Param2: 0) [新增]
  EVT_OVERDRIVE_ENDED:      0x800D, // 神恩狂欢结束结算 (Param1: 结束Tick, Param2: 击杀统计) [新增]
  EVT_SUPER_WEAPON_MISFIRE: 0x800E, // 超级奇迹兵器毁灭性反噬 (Param1: 武器ID, Param2: 反噬类型) [升格]
  EVT_DEATH_STARVATION:     0x800F, // 实体饥饿衰竭死亡 (Param1: 实体ID, Param2: 瓦片Index) [新增]
  EVT_CASTE_PROMOTED:       0x8010, // 实体社会阶级晋升 (Param1: entityId, Param2: newCaste) [M2新增]
  EVT_GENE_ASSIMILATED:     0x8011, // 模式 A 基因驱动全族同化完成 (Param1: factionId, Param2: organMask) [M2新增]
  EVT_TOTEM_AEGIS_TRIGGERED:0x8012, // 图腾 25% 圣盾击退波爆发 (Param1: 阵营ID, Param2: 图腾ID) [M3新增]
  EVT_SCHISM_ENCLAVE_PURGED:0x8013, // 裂变非连通孤岛飞地注销 (Param1: 阵营ID, Param2: 瓦片Index) [M3新增]
  EVT_DIVINE_ACTION_BLOCKED:0x8016, // 上帝之手操作被图腾锁拦截 (Param1: entityId, Param2: reason) [M4新增]
  EVT_DIVINE_BACKFIRE:      0x8017, // 天命悬空防死锁神威反噬震脱 (Param1: entityId, Param2: factionId) [M4新增]

  // ================= 瞬态表现通道 (0x0001 起始，可降频抽帧) =================
  EVT_DAMAGE_APPLIED:       0x0001, // 实体受创 (Param1: 实际扣血量, Param2: 伤害类型掩码)
  EVT_ENTITY_SLAIN:         0x0002, // 实体阵亡 (Param1: 凶手ID, Param2: 上下文SlabHandle)
  EVT_ORGAN_MUTATED:        0x0003, // 觉醒新突变器官 (Param1: 器官ID, Param2: 0)
  EVT_JOB_AWAKENED:         0x0004, // 复合职业履历觉醒 (Param1: 战斗职业ID, Param2: 头衔ID)
  EVT_SUPER_WEAPON_FIRED:   0x0005, // 超级奇观正常射击 (Param1: 武器ID, Param2: 目标瓦片)
  EVT_ELEMENT_EXPLODED:     0x0006, // 瓦斯连环大引爆 (Param1: 中心瓦片, Param2: 爆炸半径)
  EVT_MIRACLE_ACTIVATED:    0x0007, // 上帝神力释放 (Param1: 神力ID, Param2: 瓦片Index)
  EVT_AIRBORNE_LANDED:      0x0008, // 神之手抛掷实体平稳落地 (Param1: 实体ID, Param2: 落地瓦片)
  EVT_GRUDGE_RECORDED:      0x0009, // 宿怨账本记上一笔 (Param1: 受害国ID, Param2: SlabHandle)
  EVT_CORPSE_DEGRADED:      0x000A, // 尸体降解回流地脉 (Param1: 尸体ID, Param2: 养分量) [降级]
  EVT_BRAWL_RATION:         0x000B, // 掠夺种族同伴互殴抢粮 (Param1: 抢夺者ID, Param2: 受害者ID) [新增]
  EVT_RACE_SKILL_TRIGGERED: 0x0010, // 种族主动/被动特技激活 (Param1: entityId, Param2: skillId) [M2新增]
  EVT_WEAPON_DISARMED:      0x0011, // 实体兵器被打落缴械 (Param1: victimId, Param2: attackerId) [M2新增]
  EVT_ACTION_MUTEX_BLOCKED: 0x0012, // 动作轨道互斥阻断打断 (Param1: entityId, Param2: blockedChannel) [M2新增]
  EVT_MORALE_STATE_CHANGED: 0x0013, // 士兵士气四阶状态改变 (Param1: 实体ID, Param2: 新士气等级) [M3新增]
  EVT_FRICTION_ESCALATED:   0x0014, // 边境摩擦阶梯升级 (Param1: 阵营A, Param2: 阵营B) [M3新增]
  EVT_LAST_STAND_ACTIVATED: 0x0015, // 图腾 5 格破釜沉舟绝地死战激活 (Param1: 实体ID, Param2: 0) [M3新增]
  EVT_MIRACLE_RAIN:         0x0020, // 生机甘霖释放 (Param1: 瓦片Index, Param2: 半径) [M4新增]
  EVT_MIRACLE_FRUIT:        0x0021, // 神圣金苹果空投 (Param1: 瓦片Index, Param2: 0) [M4新增]
  EVT_MIRACLE_THUNDER:      0x0022, // 神圣天雷轰击 (Param1: 瓦片Index, Param2: 伤害量) [M4新增]
  EVT_MIRACLE_WAR_HORN:     0x0023, // 狂暴圣战号角吹响 (Param1: 0, Param2: 0) [M4新增]
  EVT_MIRACLE_METEOR:       0x0024, // 灭世陨石天降 (Param1: 瓦片Index, Param2: 伤害量) [M4新增]
  EVT_VENDETTA_TRIGGERED:   0x0025, // 宿怨对账狂暴触发 (Param1: 实体ID, Param2: 仇人ID) [M4新增]
  EVT_CORONATION_CEREMONY:  0x0026  // 皇室登基大典特写 (Param1: 领袖ID, Param2: 阵营ID) [M4新增]
});

/**
 * 关键事务通道高位掩码
 */
export const CRITICAL_CHANNEL_MASK = 0x8000;

/**
 * 关键事务队列容量上限 (TDS 5.1 节)
 */
export const CRITICAL_QUEUE_CAPACITY = 512;

/**
 * 瞬态表现队列容量上限 (TDS 5.1 节)
 */
export const EPHEMERAL_QUEUE_CAPACITY = 3584;

/**
 * 判定事件是否为关键事务通道事件
 * @param {number} eventType - 事件枚举值
 * @returns {boolean}
 */
export function isCriticalEvent(eventType) {
  return (eventType & CRITICAL_CHANNEL_MASK) !== 0;
}

/**
 * 获取事件名称的逆向映射字典
 */
export const DomainEventNames = Object.freeze(
  Object.fromEntries(
    Object.entries(DomainEvents).map(([key, val]) => [val, key])
  )
);
