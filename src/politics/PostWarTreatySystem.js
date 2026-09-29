/**
 * PostWarTreatySystem.js
 * 战后五重处置、飞行箭矢空安全守卫与流寇生态位系统 (TC-EDGE-05)
 * 严格遵照 SPEC-M3-CONTRACT §5.3 & §5.4
 *
 * 核心机制:
 * 1. 战后五重处置收束: 屠城掠夺、奴役战俘(IS_SLAVE)、建立附庸(30%贡赋)、领地吞并、驱逐流寇
 * 2. 飞行箭矢空安全守卫 (TC-EDGE-05): 阵营灭亡瞬间，飞行投射物若命中已销毁实体，安全消解伤害，杜绝 null 崩溃
 * 3. 弱小流寇乞讨生态位: 残兵 < 5 且无领地时，边境盘剥乞讨干粮，获食后 120s 免袭
 * 4. 100% 物理零 GC
 */

import {
  NULL_ENTITY,
  IDENTITY_STRIDE,
  ID_OFFSET_FACTION
} from '../core/ECS.js';
import {
  IS_SLAVE,
  IN_COMBAT,
  setStatus,
  clearStatus
} from '../components/UnitStatusFlags.js';
import {
  MAX_FACTIONS,
  FACTION_STRIDE,
  FAC_OFFSET_FOOD,
  FAC_OFFSET_ORE,
  FAC_OFFSET_POP_COUNT,
  FAC_OFFSET_FLAGS,
  FactionFlags
} from '../data/FactionData.js';
import { DomainEvents } from '../data/DomainEvents.js';

export const TreatyType = Object.freeze({
  SACK_CITY: 1,         // 屠城抢掠
  ENSLAVE_PRISONERS: 2, // 奴役战俘
  ESTABLISH_VASSAL: 3,  // 建立附庸
  ANNEX_TERRITORY: 4,   // 领地吞并
  EXPEL_OUTLAWS: 5      // 驱逐流寇
});

export const OUTLAW_POPULATION_THRESHOLD = 5; // 流寇残兵规模门槛 (< 5 人)
export const BEGGING_PEACE_LOCK_SECONDS = 120.0; // 乞讨获赠粮食后 120s 免袭

export class PostWarTreatySystem {
  /**
   * @param {import('../core/ECS.js').ECS} ecs 
   * @param {import('../world/TileGrid.js').TileGrid} tileGrid 
   * @param {Int32Array} factionBuffer 
   * @param {import('../core/DomainEventBus.js').DomainEventBus|null} [eventBus=null] 
   * @param {import('../warfare/BorderFrictionSystem.js').BorderFrictionSystem|null} [frictionSystem=null] 
   */
  constructor(ecs, tileGrid, factionBuffer, eventBus = null, frictionSystem = null) {
    this.ecs = ecs;
    this.tileGrid = tileGrid;
    this.factionBuffer = factionBuffer;
    this.eventBus = eventBus;
    this.frictionSystem = frictionSystem;

    // 附庸国上缴贡赋倒计时 (秒)
    this.vassalTributeTimers = new Float32Array(MAX_FACTIONS + 1);
    this.vassalMaster = new Uint8Array(MAX_FACTIONS + 1);
  }

  /**
   * 签署执行战后五重处置条约
   *
   * @param {number} victorFac 战胜国阵营 ID
   * @param {number} defeatedFac 战败国阵营 ID
   * @param {number} treatyType 条约类型枚举 (TreatyType.*)
   */
  enactTreaty(victorFac, defeatedFac, treatyType) {
    if (victorFac < 1 || victorFac > MAX_FACTIONS || defeatedFac < 1 || defeatedFac > MAX_FACTIONS || victorFac === defeatedFac) {
      return;
    }

    const baseOffsetV = (victorFac - 1) * FACTION_STRIDE;
    const baseOffsetD = (defeatedFac - 1) * FACTION_STRIDE;

    switch (treatyType) {
      case TreatyType.SACK_CITY: {
        // 1. 屠城掠夺: 抢掠战败国全部仓储物资转移至战胜国
        const foodPillaged = this.factionBuffer[baseOffsetD + FAC_OFFSET_FOOD];
        const orePillaged = this.factionBuffer[baseOffsetD + FAC_OFFSET_ORE];

        this.factionBuffer[baseOffsetV + FAC_OFFSET_FOOD] += foodPillaged;
        this.factionBuffer[baseOffsetV + FAC_OFFSET_ORE] += orePillaged;

        this.factionBuffer[baseOffsetD + FAC_OFFSET_FOOD] = 0;
        this.factionBuffer[baseOffsetD + FAC_OFFSET_ORE] = 0;
        break;
      }

      case TreatyType.ENSLAVE_PRISONERS: {
        // 2. 奴役战俘: 战败士兵全员置位 IS_SLAVE 项圈
        const dense = this.ecs.denseEntities;
        const total = this.ecs.activeCount;

        for (let i = 0; i < total; i++) {
          const eid = dense[i];
          if (eid === NULL_ENTITY) continue;

          const f = this.ecs.identities[eid * IDENTITY_STRIDE + ID_OFFSET_FACTION];
          if (f === defeatedFac) {
            setStatus(this.ecs.statusFlags, eid, IS_SLAVE);
            clearStatus(this.ecs.statusFlags, eid, IN_COMBAT);
          }
        }
        break;
      }

      case TreatyType.ESTABLISH_VASSAL: {
        // 3. 建立附庸: 保留自治图腾，每 60s 上缴 30% 资源贡赋
        this.vassalMaster[defeatedFac] = victorFac;
        this.vassalTributeTimers[defeatedFac] = 60.0;
        break;
      }

      case TreatyType.ANNEX_TERRITORY: {
        // 4. 领地吞并: 将敌方领地瓦片权属全部划归战胜国
        const tFac = this.tileGrid.territoryFaction;
        const totalTiles = this.tileGrid.totalTiles;

        for (let i = 0; i < totalTiles; i++) {
          if (tFac[i] === defeatedFac) {
            tFac[i] = victorFac;
          }
        }
        break;
      }

      case TreatyType.EXPEL_OUTLAWS: {
        // 5. 驱逐流寇: 残兵重组为边境中立盗匪 (IS_OUTLAW)
        this.factionBuffer[baseOffsetD + FAC_OFFSET_FLAGS] |= FactionFlags.IS_OUTLAW;
        break;
      }
    }

    // 派发关键事务和谈条约签署领域事件 (0x800A)
    if (this.eventBus) {
      this.eventBus.emit(DomainEvents.EVT_PEACE_TREATY_SIGNED, victorFac, treatyType, defeatedFac, 0);
    }
  }

  /**
   * 飞行投射物空指针安全消解守卫 (TC-EDGE-05)
   * 敌方图腾倒塌或阵营灭亡瞬间，飞行箭矢命中已灭绝实体时安全回收伤害
   *
   * @param {number} targetEntityId 
   * @param {number} rawDamage 
   * @returns {number} 安全结算后的真实伤害 (若实体已不存在返回 0.0)
   */
  guardInFlightProjectile(targetEntityId, rawDamage) {
    if (targetEntityId <= NULL_ENTITY || !this.ecs.isAlive(targetEntityId)) {
      // 安全消解飞行投射物伤害，绝不抛出 Cannot read properties of null 崩溃
      return 0.0;
    }
    return rawDamage;
  }

  /**
   * 弱小流寇乞讨过路费生态位
   * 若流寇残兵 < 5 且无领地，在边境乞讨 1~2 份干粮；获赠后 120s 免袭
   *
   * @param {number} outlawFac 
   * @param {number} neighborFac 
   * @returns {boolean} 是否达成乞讨免袭协议
   */
  handleOutlawBegging(outlawFac, neighborFac) {
    if (outlawFac < 1 || outlawFac > MAX_FACTIONS || neighborFac < 1 || neighborFac > MAX_FACTIONS) {
      return false;
    }

    const baseOffsetO = (outlawFac - 1) * FACTION_STRIDE;
    const baseOffsetN = (neighborFac - 1) * FACTION_STRIDE;

    const outlawPop = this.factionBuffer[baseOffsetO + FAC_OFFSET_POP_COUNT];
    const neighborFood = this.factionBuffer[baseOffsetN + FAC_OFFSET_FOOD];

    // 仅当残兵 < 5 人且邻国有干粮储备时
    if (outlawPop < OUTLAW_POPULATION_THRESHOLD && neighborFood >= 2) {
      // 赠予 2 份干粮
      this.factionBuffer[baseOffsetN + FAC_OFFSET_FOOD] -= 2;
      this.factionBuffer[baseOffsetO + FAC_OFFSET_FOOD] += 2;

      // 施加 120s 绝对和平锁
      if (this.frictionSystem) {
        this.frictionSystem.enforcePeace(outlawFac, neighborFac, BEGGING_PEACE_LOCK_SECONDS);
      }
      return true;
    }

    return false;
  }

  /**
   * 系统每帧更新 (处理附庸国 60s 贡赋上缴)
   * @param {number} dt 
   */
  update(dt) {
    for (let f = 1; f <= MAX_FACTIONS; f++) {
      const master = this.vassalMaster[f];
      if (master > 0) {
        this.vassalTributeTimers[f] -= dt;
        if (this.vassalTributeTimers[f] <= 0.0) {
          this.vassalTributeTimers[f] = 60.0;

          // 上缴 30% 仓储贡赋给宗主国
          const baseOffsetVassal = (f - 1) * FACTION_STRIDE;
          const baseOffsetMaster = (master - 1) * FACTION_STRIDE;

          const foodTribute = Math.floor(this.factionBuffer[baseOffsetVassal + FAC_OFFSET_FOOD] * 0.30);
          const oreTribute = Math.floor(this.factionBuffer[baseOffsetVassal + FAC_OFFSET_ORE] * 0.30);

          if (foodTribute > 0) {
            this.factionBuffer[baseOffsetVassal + FAC_OFFSET_FOOD] -= foodTribute;
            this.factionBuffer[baseOffsetMaster + FAC_OFFSET_FOOD] += foodTribute;
          }
          if (oreTribute > 0) {
            this.factionBuffer[baseOffsetVassal + FAC_OFFSET_ORE] -= oreTribute;
            this.factionBuffer[baseOffsetMaster + FAC_OFFSET_ORE] += oreTribute;
          }
        }
      }
    }
  }
}
