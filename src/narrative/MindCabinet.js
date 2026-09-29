/**
 * MindCabinet.js
 * 极乐迪斯科风濒死思维阁系统
 * 严格遵照 SPEC-M4-CONTRACT §4.3
 *
 * 核心机制:
 * 1. 领袖阵亡断气前最后一瞬唤醒
 * 2. 四大潜意识声部 (古老爬行脑、野心意志、食欲本能、骨骼与肌肉) 极速辩论
 * 3. 结构化 DTO 纯值输出，支持逐字打字机字符渲染
 */

export const MindVoiceType = Object.freeze({
  REPTILIAN_BRAIN: 'REPTILIAN_BRAIN',         // 古老爬行脑
  AMBITIOUS_WILL: 'AMBITIOUS_WILL',           // 野心意志
  APPETITE: 'APPETITE',                       // 食欲本能
  PHYSICAL_INSTRUMENT: 'PHYSICAL_INSTRUMENT'  // 骨骼与肌肉
});

export const MindVoiceColors = Object.freeze({
  REPTILIAN_BRAIN: '#7a8288',
  AMBITIOUS_WILL: '#e74c3c',
  APPETITE: '#f39c12',
  PHYSICAL_INSTRUMENT: '#3498db'
});

export class MindCabinet {
  constructor() {
    // 零 GC 预分配缓存 DTO
    this.currentCabinetDTO = {
      leaderEntityId: 0,
      killerEntityId: 0,
      timestamp: 0.0,
      raceName: 'UNKNOWN',
      factionName: 'UNKNOWN',
      dialogue: [
        { voice: MindVoiceType.REPTILIAN_BRAIN, speaker: '古老爬行脑', text: '', color: MindVoiceColors.REPTILIAN_BRAIN },
        { voice: MindVoiceType.AMBITIOUS_WILL, speaker: '野心意志', text: '', color: MindVoiceColors.AMBITIOUS_WILL },
        { voice: MindVoiceType.APPETITE, speaker: '食欲本能', text: '', color: MindVoiceColors.APPETITE },
        { voice: MindVoiceType.PHYSICAL_INSTRUMENT, speaker: '骨骼与肌肉', text: '', color: MindVoiceColors.PHYSICAL_INSTRUMENT }
      ]
    };

    this.active = false;
  }

  /**
   * 唤醒思维阁，生成濒死辩论 DTO
   * @param {number} leaderEid 领袖实体 ID
   * @param {number} killerEid 击杀者实体 ID
   * @param {number} timestamp 时间戳
   * @param {Object} [context={}] 上下文信息 { raceName, factionName, customTale }
   * @returns {Object} 结构化 DTO
   */
  triggerCabinet(leaderEid, killerEid, timestamp, context = {}) {
    const dto = this.currentCabinetDTO;
    dto.leaderEntityId = leaderEid;
    dto.killerEntityId = killerEid;
    dto.timestamp = timestamp;
    dto.raceName = context.raceName || '未知种族';
    dto.factionName = context.factionName || '失落氏族';

    const dialogue = dto.dialogue;

    // 1. 古老爬行脑
    dialogue[0].text = context.taleA || '好冷，腹部的破洞正在冒热气。别挣扎了，躺在烂泥里挺舒服的。';

    // 2. 野心意志
    dialogue[1].text = context.taleB || '废物！你的战斧还在三步之外！爬起来，用牙齿咬断篡位者的气管！';

    // 3. 食欲本能
    dialogue[2].text = context.taleC || '……其实昨晚地窖里那罐蓝莓甜酒，我还没来得及喝完呢。';

    // 4. 骨骼与肌肉
    dialogue[3].text = context.taleD || '报告长官，第四颈椎断成三截，我们已经尽力了。下班了，朋友。';

    this.active = true;
    return dto;
  }

  /**
   * 获取当前活跃的思维阁 DTO
   * @returns {Object|null}
   */
  getCurrentDTO() {
    return this.active ? this.currentCabinetDTO : null;
  }

  /**
   * 关闭思维阁
   */
  close() {
    this.active = false;
  }

  /**
   * 打字机字符步进计算器 (零 GC)
   * 给定已流逝时间与每秒打字速度，返回当前应显示的最大字符长度
   * @param {number} elapsedTime 
   * @param {number} [charsPerSecond=35] 
   * @param {number} maxLen 
   * @returns {number}
   */
  static calculateTypewriterCursor(elapsedTime, charsPerSecond = 35, maxLen = 100) {
    if (elapsedTime <= 0) return 0;
    const chars = Math.floor(elapsedTime * charsPerSecond);
    return Math.min(maxLen, chars);
  }
}
