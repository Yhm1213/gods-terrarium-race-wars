/**
 * WebAudioBusManager.js
 * 工业级 Web Audio 压限拓扑总线管理器
 * 严格遵照 SPEC-M4-CONTRACT §5.2 与 09_art_audio_and_technical_spec.md §3
 *
 * 核心技术指标:
 * 1. 四大总线拓扑: SFX Bus, Voice/UI Bus, God Power Bus, Ambient Bus (-28dB 粉红白噪音)
 * 2. 侧链闪避控制器 (Sidechain Ducking): 天雷/神迹触发时，SFX 与 Voice 自动下潜 -12dB
 * 3. 16 轨复音池与抢占调度 (Voice Stealing): 8ms 极速指数淡出，防 Click 咔哒切断杂音
 * 4. 末端安全限幅压限器 (DynamicsCompressorNode: Threshold -12dB, Knee 30, Ratio 12:1, Attack 0.003s, Release 0.25s)
 * 5. 跨环境优雅检测与安全降级 (Node/Vitest/无交互环境绝不抛异常)
 */

export const MAX_POLYPHONY = 16;
export const FADE_OUT_SECONDS = 0.008; // 8ms 极速指数淡出

export class WebAudioBusManager {
  /**
   * @param {AudioContext|object|null} [customContext=null] 
   */
  constructor(customContext = null) {
    this.ctx = null;
    this.isSupported = false;
    this.isMuted = false;
    this.masterVolume = 1.0;

    // 活跃复音池 (最多 16 轨)
    this.activeVoices = [];

    // 初始化 AudioContext 与音频图拓扑
    this._initAudioContext(customContext);
  }

  /**
   * 初始化 AudioContext 与四大总线节点
   * @private
   */
  _initAudioContext(customContext) {
    if (customContext) {
      this.ctx = customContext;
      this.isSupported = true;
    } else if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      try {
        this.ctx = new AudioCtxClass();
        this.isSupported = true;
      } catch (e) {
        this.isSupported = false;
      }
    }

    if (!this.isSupported || !this.ctx) {
      // 优雅 Mock 兜底
      this._createMockTopology();
      return;
    }

    try {
      const ctx = this.ctx;

      // 1. 末端安全限幅压限器 (DynamicsCompressorNode)
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -12.0; // -12dB
      this.compressor.knee.value = 30.0;       // 30
      this.compressor.ratio.value = 12.0;      // 12:1
      this.compressor.attack.value = 0.003;    // 3ms 快速响应
      this.compressor.release.value = 0.25;    // 250ms 缓慢释放

      // 2. 主输出增益节点 (Master Gain)
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = 1.0;

      // 拓扑连接: Compressor -> MasterGain -> Destination
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(ctx.destination);

      // 3. 四大子总线 Gain 节点
      this.sfxBus = ctx.createGain();
      this.voiceBus = ctx.createGain();
      this.godBus = ctx.createGain();
      this.ambientBus = ctx.createGain();

      this.sfxBus.gain.value = 1.0;
      this.voiceBus.gain.value = 1.0;
      this.godBus.gain.value = 1.0;
      // Ambient Bus 默认 -28dB 极轻微环境底噪 (约 0.0398 线性增益)
      this.ambientBus.gain.value = 0.0398;

      // 4. 连接到末端压限器
      this.sfxBus.connect(this.compressor);
      this.voiceBus.connect(this.compressor);
      this.godBus.connect(this.compressor);
      this.ambientBus.connect(this.compressor);

      // 环境白噪音发生器状态
      this._ambientSource = null;
    } catch (err) {
      this._createMockTopology();
    }
  }

  /**
   * 创建用于测试与降级环境的 Mock 拓扑对象
   * @private
   */
  _createMockTopology() {
    const createMockGain = (val = 1.0) => ({
      gain: {
        value: val,
        setValueAtTime: (v) => { this.value = v; },
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
        cancelScheduledValues: () => {}
      },
      connect: () => {},
      disconnect: () => {}
    });

    this.compressor = {
      threshold: { value: -12.0 },
      knee: { value: 30.0 },
      ratio: { value: 12.0 },
      attack: { value: 0.003 },
      release: { value: 0.25 },
      connect: () => {},
      disconnect: () => {}
    };

    this.masterGain = createMockGain(1.0);
    this.sfxBus = createMockGain(1.0);
    this.voiceBus = createMockGain(1.0);
    this.godBus = createMockGain(1.0);
    this.ambientBus = createMockGain(0.0398);
  }

  /**
   * 解锁浏览器 Web Audio 自动播放限制
   */
  async resume() {
    if (this.ctx && typeof this.ctx.resume === 'function' && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {}
    }
  }

  /**
   * 设置主音量 (0.0 ~ 1.0)
   * @param {number} volume 
   */
  setMasterVolume(volume) {
    this.masterVolume = Math.max(0.0, Math.min(1.0, volume));
    if (!this.isMuted && this.masterGain && this.masterGain.gain) {
      this.masterGain.gain.value = this.masterVolume;
    }
  }

  /**
   * 切换全局静音
   * @param {boolean} muted 
   */
  setMuted(muted) {
    this.isMuted = !!muted;
    if (this.masterGain && this.masterGain.gain) {
      this.masterGain.gain.value = this.isMuted ? 0.0 : this.masterVolume;
    }
  }

  /**
   * 触发侧链闪避 (Sidechain Ducking)
   * 天雷/陨石等神力降临时，将 SFX 与 Voice 总线快速压低 -12dB，随后平滑回弹
   *
   * @param {number} [duckDb=-12.0] 下潜分贝值 (默认 -12dB)
   * @param {number} [durationSec=1.0] 恢复持续时间 (秒)
   */
  triggerDucking(duckDb = -12.0, durationSec = 1.0) {
    if (!this.ctx || typeof this.ctx.currentTime !== 'number') return;

    const now = this.ctx.currentTime;
    // -12dB 对应约 0.251 线性增益
    const duckRatio = Math.max(0.05, Math.pow(10, duckDb / 20));

    // 1. SFX Bus 闪避
    if (this.sfxBus && this.sfxBus.gain && typeof this.sfxBus.gain.setValueAtTime === 'function') {
      try {
        this.sfxBus.gain.cancelScheduledValues(now);
        this.sfxBus.gain.setValueAtTime(this.sfxBus.gain.value, now);
        this.sfxBus.gain.linearRampToValueAtTime(duckRatio, now + 0.02);
        this.sfxBus.gain.linearRampToValueAtTime(1.0, now + durationSec);
      } catch (e) {}
    }

    // 2. Voice Bus 闪避
    if (this.voiceBus && this.voiceBus.gain && typeof this.voiceBus.gain.setValueAtTime === 'function') {
      try {
        this.voiceBus.gain.cancelScheduledValues(now);
        this.voiceBus.gain.setValueAtTime(this.voiceBus.gain.value, now);
        this.voiceBus.gain.linearRampToValueAtTime(duckRatio, now + 0.02);
        this.voiceBus.gain.linearRampToValueAtTime(1.0, now + durationSec);
      } catch (e) {}
    }
  }

  /**
   * 16 轨复音池分配与抢占调度 (Voice Stealing)
   * 若活跃音源达到上限，查找到期最快或最旧音源，施加 8ms 极速指数淡出并断开
   *
   * @param {AudioNode} sourceNode 
   * @param {GainNode} voiceGainNode 
   * @param {number} expectedDurationSec 
   * @returns {{sourceNode: AudioNode, gainNode: GainNode, stopVoice: Function}}
   */
  registerVoice(sourceNode, voiceGainNode, expectedDurationSec = 0.5) {
    const now = (this.ctx && typeof this.ctx.currentTime === 'number') ? this.ctx.currentTime : 0;
    const expireTime = now + expectedDurationSec;

    // 清理已自然结束的音轨
    this._cleanupDeadVoices(now);

    // 检查是否达到 16 轨上限
    if (this.activeVoices.length >= MAX_POLYPHONY) {
      // Voice Stealing: 抢占最早过期的音轨
      let oldestIdx = 0;
      let minExpire = Infinity;

      for (let i = 0; i < this.activeVoices.length; i++) {
        if (this.activeVoices[i].expireTime < minExpire) {
          minExpire = this.activeVoices[i].expireTime;
          oldestIdx = i;
        }
      }

      const stolenVoice = this.activeVoices.splice(oldestIdx, 1)[0];
      this._smoothFadeOutVoice(stolenVoice, now);
    }

    // 登记新音轨
    const voiceEntry = {
      sourceNode,
      gainNode: voiceGainNode,
      expireTime,
      stopVoice: () => {
        const curTime = (this.ctx && typeof this.ctx.currentTime === 'number') ? this.ctx.currentTime : 0;
        this._smoothFadeOutVoice(voiceEntry, curTime);
        const idx = this.activeVoices.indexOf(voiceEntry);
        if (idx !== -1) this.activeVoices.splice(idx, 1);
      }
    };

    this.activeVoices.push(voiceEntry);
    return voiceEntry;
  }

  /**
   * 8ms 极速指数淡出单个音轨并安全停止，杜绝 Click 咔哒声
   * @private
   */
  _smoothFadeOutVoice(voice, now) {
    if (!voice || !voice.gainNode || !voice.gainNode.gain) return;

    try {
      const g = voice.gainNode.gain;
      if (typeof g.setValueAtTime === 'function' && typeof g.exponentialRampToValueAtTime === 'function') {
        const curVal = Math.max(0.0001, g.value || 0.5);
        g.cancelScheduledValues(now);
        g.setValueAtTime(curVal, now);
        g.exponentialRampToValueAtTime(0.0001, now + FADE_OUT_SECONDS);
      }
    } catch (e) {}

    // 延迟 8ms 后彻底停止与断开
    if (voice.sourceNode) {
      try {
        if (typeof voice.sourceNode.stop === 'function') {
          voice.sourceNode.stop(now + FADE_OUT_SECONDS);
        }
      } catch (e) {}
    }
  }

  /**
   * 清理过期死音轨
   * @private
   */
  _cleanupDeadVoices(now) {
    for (let i = this.activeVoices.length - 1; i >= 0; i--) {
      if (this.activeVoices[i].expireTime <= now) {
        this.activeVoices.splice(i, 1);
      }
    }
  }

  /**
   * 启动 Ambient Bus 持续背景粉红/白噪音 (微风草原与夏夜白噪音，-28dB)
   */
  startAmbient() {
    if (!this.ctx || this._ambientSource) return;

    try {
      const bufferSize = this.ctx.sampleRate * 2; // 2 秒循环白噪声
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      // 生成粉红噪声 (1/f 滤波平缓特性)
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        output[i] = (b0 + b1 + b2 + white * 0.5362) * 0.08;
      }

      const whiteNoise = this.ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      // 低通滤波器营造轻柔微风感
      const lowpass = this.ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 450; // 450Hz 沉稳低频

      whiteNoise.connect(lowpass);
      lowpass.connect(this.ambientBus);

      whiteNoise.start(0);
      this._ambientSource = whiteNoise;
    } catch (e) {}
  }

  /**
   * 停止背景氛围音
   */
  stopAmbient() {
    if (this._ambientSource) {
      try {
        this._ambientSource.stop();
        this._ambientSource.disconnect();
      } catch (e) {}
      this._ambientSource = null;
    }
  }

  /**
   * 获取当前活跃复音数
   * @returns {number}
   */
  getActiveVoiceCount() {
    const now = (this.ctx && typeof this.ctx.currentTime === 'number') ? this.ctx.currentTime : 0;
    this._cleanupDeadVoices(now);
    return this.activeVoices.length;
  }
}
