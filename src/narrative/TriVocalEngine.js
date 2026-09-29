/**
 * TriVocalEngine.js
 * 三声道人格叙事引擎与高信噪比降频节流器
 * 严格遵照 SPEC-M4-CONTRACT §4.1
 *
 * 核心特性:
 * 1. 三大声道:
 *    - 声道 A: 解剖学法医 (The Anatomist) - 冰冷解剖、骨折创口、体液失血、神经反射
 *    - 声道 B: 崇高虚无诗人 (The Melancholic Bard) - 史诗神话、悲剧宿命、帝国更迭
 *    - 声道 C: 冷酷官僚审计员 (The Bureaucratic Auditor) - 抚恤冲抵、欠税核销、工伤免责
 * 2. 降频节流器 (Signal-to-Noise Throttle):
 *    - 普通平砍伤害自动静默折叠
 *    - 暴击、断肢、弑君、突变诞生、内战分裂、神迹、宿仇狂暴方可生成战报
 * 3. 2.0s 聚合窗口: 连续碎事件合并输出
 * 4. 纯值 Slab 对象池驱动，严格物理零 GC
 */

import { DomainEvents } from '../data/DomainEvents.js';
import { ContextSlabPool } from './ContextSlabPool.js';

export const AGGREGATION_WINDOW_SECONDS = 2.0;

export const VocalVoice = Object.freeze({
  ANATOMIST: 'ANATOMIST', // 解剖学法医
  BARD: 'BARD',           // 崇高虚无诗人
  AUDITOR: 'AUDITOR'      // 冷酷官僚审计员
});

export class TriVocalEngine {
  /**
   * @param {ContextSlabPool} slabPool 
   */
  constructor(slabPool) {
    this.slabPool = slabPool;

    // 聚合队列 (固定预分配引用，容量 64)
    this.pendingQueue = new Array(64);
    this.pendingCount = 0;
    this.windowTimer = 0.0;

    // 外部叙事战报监听回调列表
    this.listeners = [];
  }

  /**
   * 注册叙事文本回调
   * @param {(slab: import('./ContextSlabPool.js').ContextSlab) => void} callback 
   */
  onNarrativeReady(callback) {
    this.listeners.push(callback);
  }

  /**
   * 判断是否为高信噪比关键事件 (低价值普通平砍静默折叠)
   * @param {number} eventType 
   * @param {number} p1 
   * @param {number} p2 
   * @param {boolean} [isCritical=false] 
   * @param {boolean} [isMutilation=false] 
   * @returns {boolean}
   */
  isHighSignalEvent(eventType, p1, p2, isCritical = false, isMutilation = false) {
    // 强制放行关键重磅事件
    switch (eventType) {
      case DomainEvents.EVT_RULER_DIED:
      case DomainEvents.EVT_FACTION_DESTROYED:
      case DomainEvents.EVT_FACTION_SCHISM:
      case DomainEvents.EVT_ORGAN_MUTATED:
      case DomainEvents.EVT_HEIR_CROWNED:
      case DomainEvents.EVT_VENDETTA_TRIGGERED:
      case DomainEvents.EVT_OVERDRIVE_STARTED:
      case DomainEvents.EVT_OVERDRIVE_ENDED:
      case DomainEvents.EVT_SUPER_WEAPON_MISFIRE:
      case DomainEvents.EVT_MIRACLE_RAIN:
      case DomainEvents.EVT_MIRACLE_FRUIT:
      case DomainEvents.EVT_MIRACLE_THUNDER:
      case DomainEvents.EVT_MIRACLE_WAR_HORN:
      case DomainEvents.EVT_MIRACLE_METEOR:
      case DomainEvents.EVT_PAX_DIVINA_FORCED:
        return true;

      case DomainEvents.EVT_ENTITY_SLAIN:
        return true; // 实体阵亡

      case DomainEvents.EVT_DAMAGE_APPLIED:
        // 普通平砍必须满足暴击、断肢或单次大额伤害 (>60)
        return isCritical || isMutilation || p1 >= 60;

      default:
        // 其他非关键事件过滤折叠
        return false;
    }
  }

  /**
   * 接收领域事件，评估并生成三声道文案
   *
   * @param {number} eventType 领域事件 ID
   * @param {number} srcId 发起实体 ID
   * @param {number} dstId 目标实体 ID
   * @param {number} p1 参数1 (如伤害数值)
   * @param {number} p2 参数2 (如附加代码)
   * @param {number} timestamp 时间戳 (秒)
   * @param {Object} [meta={}] 扩展元数据 { isCritical, isMutilation, isRegicide }
   * @returns {import('./ContextSlabPool.js').ContextSlab|null} 若被折叠或池满返回 null
   */
  recordEvent(eventType, srcId, dstId, p1, p2, timestamp, meta = {}) {
    const isCritical = meta.isCritical || false;
    const isMutilation = meta.isMutilation || false;

    // 1. 高信噪比节流器拦截
    if (!this.isHighSignalEvent(eventType, p1, p2, isCritical, isMutilation)) {
      return null;
    }

    // 2. 从池中租借 Slab
    const slab = this.slabPool.borrow();
    if (!slab) {
      return null; // 池耗尽
    }

    slab.eventType = eventType;
    slab.srcEntityId = srcId;
    slab.dstEntityId = dstId;
    slab.param1 = p1;
    slab.param2 = p2;
    slab.timestamp = timestamp;
    slab.isCritical = isCritical;
    slab.isMutilation = isMutilation;
    slab.isRegicide = meta.isRegicide || (eventType === DomainEvents.EVT_RULER_DIED);

    // 3. 声道文案装配
    this._assembleTriVocalTexts(slab);

    // 4. 重磅事件立即发布；次要高信噪事件排入聚合队列
    if (this._isImmediateEvent(eventType) || meta.isRegicide) {
      this._emitSlab(slab);
    } else {
      if (this.pendingCount < this.pendingQueue.length) {
        this.pendingQueue[this.pendingCount++] = slab;
      } else {
        // 满载时强制冲刷
        this.flush();
        this.pendingQueue[this.pendingCount++] = slab;
      }
    }

    return slab;
  }

  /**
   * 更新计时器与聚合窗口推进
   * @param {number} dt 
   */
  update(dt) {
    if (this.pendingCount === 0) return;

    this.windowTimer += dt;
    if (this.windowTimer >= AGGREGATION_WINDOW_SECONDS) {
      this.flush();
    }
  }

  /**
   * 冲刷聚合队列并派发给监听者
   */
  flush() {
    this.windowTimer = 0.0;
    const count = this.pendingCount;
    this.pendingCount = 0;

    for (let i = 0; i < count; i++) {
      const slab = this.pendingQueue[i];
      this._emitSlab(slab);
      this.pendingQueue[i] = null;
    }
  }

  /**
   * 是否需要无延迟立即发布的超级关键事件
   * @private
   */
  _isImmediateEvent(eventType) {
    return (
      eventType === DomainEvents.EVT_RULER_DIED ||
      eventType === DomainEvents.EVT_FACTION_DESTROYED ||
      eventType === DomainEvents.EVT_FACTION_SCHISM ||
      eventType === DomainEvents.EVT_OVERDRIVE_STARTED ||
      eventType === DomainEvents.EVT_OVERDRIVE_ENDED ||
      eventType === DomainEvents.EVT_MIRACLE_METEOR ||
      eventType === DomainEvents.EVT_MIRACLE_THUNDER
    );
  }

  /**
   * 派发单个 Slab 战报
   * @private
   */
  _emitSlab(slab) {
    for (let i = 0; i < this.listeners.length; i++) {
      this.listeners[i](slab);
    }
  }

  /**
   * 三声道文案装配机
   * @private
   */
  _assembleTriVocalTexts(slab) {
    const { eventType, srcEntityId, dstEntityId, param1, isCritical, isMutilation, isRegicide } = slab;

    switch (eventType) {
      case DomainEvents.EVT_RULER_DIED:
        slab.textA = `【法医解剖】受创者为主脑控制中枢。胸骨凹陷性骨折，心主动脉破裂，脑电活动彻底静默。死亡推定用时 0.4 秒。`;
        slab.textB = `【崇高诗人】冠冕坠入血污，高耸的石阶未等来新的誓言。又一尊权柄在凡人的泥淖中分崩离析。`;
        slab.textC = `【官僚审计】注销 #${dstEntityId} 君主户籍。皇家丧葬免税额度已超支，剩余国库应缴财产税按 15% 自动划拨新主。`;
        break;

      case DomainEvents.EVT_ENTITY_SLAIN:
        if (isRegicide) {
          slab.textA = `【法医解剖】弑君性创伤：颈部大动脉横向切断，喷射性失血 2400ml，气管软骨粉碎。`;
          slab.textB = `【崇高诗人】猎猎王旗撕碎于血手之中，王冠跌落，旧神亦为之沉默。`;
          slab.textC = `【官僚审计】已从抚恤金中扣除弑君污染治理费 120 金币，原兵器作为违禁凶器归公入库。`;
        } else {
          slab.textA = `【法医解剖】钝器/锐器击中要害，创伤深度深入脏腑，失血过多致循环衰竭停止。`;
          slab.textB = `【崇高诗人】苍穹铁骑踏碎晨霜，无名的躯壳倒在荒原，泥泞安详接纳了这缕归尘战魂。`;
          slab.textC = `【官僚审计】编号 #${dstEntityId} 战损销号。损坏工服一套，欠缴过境人头税 3 枚铜币，已从家属抚恤抵扣。`;
        }
        break;

      case DomainEvents.EVT_DAMAGE_APPLIED:
        if (isMutilation) {
          slab.textA = `【法医解剖】创伤性截肢：骨骺端爆裂撕脱，肌肉纤维严重拉伤，失血量每分钟 400ml。`;
          slab.textB = `【崇高诗人】断肢坠入焦土，战意在残破的肉体中嘶吼，血泊倒映着不屈的残阳。`;
          slab.textC = `【官僚审计】工伤等级评定：三级断残。根据战时临时劳工法令，免除当季伐木徭役，改充低保编织工。`;
        } else if (isCritical) {
          slab.textA = `【法医解剖】致命重创！穿透性内出血，软组织大面积撕裂，体表痛觉神经处于过载休克。`;
          slab.textB = `【崇高诗人】雷霆之击破晓而至，撕裂了钢铁甲胄，撕裂了微不足道的生之妄想。`;
          slab.textC = `【官僚审计】甲胄损耗报告：钢板报废率 85%，由被击中者个人战功积分全额赔偿。`;
        }
        break;

      case DomainEvents.EVT_ORGAN_MUTATED:
        slab.textA = `【法医解剖】细胞核高频裂变，表皮角质层硬化为外骨骼，突变器官血液供应已自发建构完成。`;
        slab.textB = `【崇高诗人】造物主的古老禁忌被打破，混沌之血在胚胎中狂舞，畸形的造物迎风而生。`;
        slab.textC = `【官僚审计】新器官登册：按异端征税标准第 4 条征收【异常体态增值税】，由所在阵营宗族统筹缴纳。`;
        break;

      case DomainEvents.EVT_VENDETTA_TRIGGERED:
        slab.textA = `【法医解剖】肾上腺素瞬间激增 500%，瞳孔散大，心率超 220bpm，骨骼进入超负荷临战态。`;
        slab.textB = `【崇高诗人】仇恨穿透岁月与深渊，在对视的瞬间苏醒。唯有鲜血能洗刷旧日的折辱！`;
        slab.textC = `【官僚审计】调取历史民事纠纷第 #${srcEntityId} 卷：双方此前未了仇怨今日强制执行，工伤保险临时中止。`;
        break;

      case DomainEvents.EVT_MIRACLE_THUNDER:
      case DomainEvents.EVT_MIRACLE_METEOR:
        slab.textA = `【法医解剖】超高温等离子体电灼伤，表皮焦炭化，范围神经通路瞬时蒸发。`;
        slab.textB = `【崇高诗人】神怒如天崩之火！苍天降下无情灭绝之槌，大地在巨响中沉沦为炽热焦土。`;
        slab.textC = `【官僚审计】不可抗力天灾免责条款生效：神圣灾异引发的全部人员及固定资产损失，帝国财政部概不理赔。`;
        break;

      default:
        slab.textA = `【法医解剖】常规生理指标异常波动，创口正在产生局部应激反应。`;
        slab.textB = `【崇高诗人】宿命的微尘在战场起伏，历史的巨轮无情碾过凡躯。`;
        slab.textC = `【官僚审计】事项已归档记录，流转文书已盖戳公证。`;
        break;
    }
  }
}
