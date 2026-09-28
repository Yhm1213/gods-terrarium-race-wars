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
  EVT_CORPSE_DEGRADED:      0x000A  // 尸体降解回流地脉 (Param1: 尸体ID, Param2: 养分量) [降级]
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
