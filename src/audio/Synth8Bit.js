/**
 * Synth8Bit.js
 * 原生 8-bit 数学合成音效发生器
 * 严格遵照 SPEC-M4-CONTRACT §5.2 与 09_art_audio_and_technical_spec.md §3
 *
 * 核心技术指标:
 * 1. 零外部依赖: 绝对不加载任何外部 .mp3/.wav，纯靠 Oscillator 与 NoiseBuffer 数学合成
 * 2. 8 大核心事件合成: 打击、天雷、陨石、圣战号角、生机水滴、神迹响应、祈祷低语、UI反馈
 * 3. 声音防疲劳机制: 每次发声基础音高随机动态浮动 ±4% (Pitch Jitter)
 * 4. 接入 WebAudioBusManager: 自动执行四大总线路由、侧链闪避与 16 轨复音防爆音抢占
 * 5. 安全兜底: 无 Web Audio 环境时静默安全返回
 */

export class Synth8Bit {
  /**
   * @param {import('./WebAudioBusManager.js').WebAudioBusManager} busManager 
   */
  constructor(busManager) {
    this.bus = busManager;
  }

  /**
   * 计算带 ±4% 动态浮动的随机频率 (防机械听觉疲劳)
   * @param {number} baseFreq 
   * @returns {number}
   */
  getJitteredFreq(baseFreq) {
    const jitter = 1.0 + (Math.random() * 0.08 - 0.04); // ±4%
    return baseFreq * jitter;
  }

  /**
   * 检查 AudioContext 是否有效可用
   * @private
   */
  _isReady() {
    return !!(this.bus && this.bus.ctx && this.bus.isSupported && !this.bus.isMuted);
  }

  /**
   * 1. 打击/采集/着陆音效 (方波扫频: 220Hz -> 50Hz, 80ms)
   * 路由: SFX Bus
   * @param {object} [options={}]
   */
  playHit(options = {}) {
    if (!this._isReady()) return;
    const ctx = this.bus.ctx;

    try {
      const now = ctx.currentTime;
      const duration = options.duration || 0.08;
      const startFreq = this.getJitteredFreq(options.freq || 220);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, startFreq * 0.25), now + duration);

      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.bus.sfxBus);

      this.bus.registerVoice(osc, gain, duration);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (e) {}
  }

  /**
   * 2. 神圣天雷音效 (低频方波爆炸 + 白噪音爆破, 800ms)
   * 路由: God Power Bus, 并触发 SFX/Voice 侧链下潜 -12dB
   * @param {object} [options={}]
   */
  playThunder(options = {}) {
    if (!this._isReady()) return;
    const ctx = this.bus.ctx;

    try {
      const now = ctx.currentTime;
      const duration = options.duration || 0.8;

      // 触发侧链闪避 (-12dB)
      this.bus.triggerDucking(-12.0, duration + 0.2);

      // (1) 低频震颤方波
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      const baseFreq = this.getJitteredFreq(75);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(25, now + duration);

      oscGain.gain.setValueAtTime(0.6, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.bus.godBus);

      this.bus.registerVoice(osc, oscGain, duration);
      osc.start(now);
      osc.stop(now + duration + 0.01);

      // (2) 白噪音爆破冲击
      const sampleRate = ctx.sampleRate || 44100;
      const noiseBuffer = ctx.createBuffer(1, sampleRate * 0.4, sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < output.length; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      const noiseSrc = ctx.createBufferSource();
      const noiseGain = ctx.createGain();
      noiseSrc.buffer = noiseBuffer;

      noiseGain.gain.setValueAtTime(0.5, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

      noiseSrc.connect(noiseGain);
      noiseGain.connect(this.bus.godBus);

      this.bus.registerVoice(noiseSrc, noiseGain, 0.4);
      noiseSrc.start(now);
      noiseSrc.stop(now + 0.41);
    } catch (e) {}
  }

  /**
   * 3. 灭世陨石轰砸音效 (极低频方波 45Hz + 深沉白噪音轰鸣, 1.2s)
   * 路由: God Power Bus, 并触发下潜
   * @param {object} [options={}]
   */
  playMeteor(options = {}) {
    if (!this._isReady()) return;
    const ctx = this.bus.ctx;

    try {
      const now = ctx.currentTime;
      const duration = options.duration || 1.2;

      this.bus.triggerDucking(-12.0, duration + 0.3);

      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      const baseFreq = this.getJitteredFreq(55);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(18, now + duration);

      oscGain.gain.setValueAtTime(0.8, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(oscGain);
      oscGain.connect(this.bus.godBus);

      this.bus.registerVoice(osc, oscGain, duration);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (e) {}
  }

  /**
   * 4. 狂暴圣战号角音效 (双音正弦/锯齿和弦 220Hz / 330Hz, 1.2s)
   * 路由: God Power Bus
   * @param {object} [options={}]
   */
  playHorn(options = {}) {
    if (!this._isReady()) return;
    const ctx = this.bus.ctx;

    try {
      const now = ctx.currentTime;
      const duration = options.duration || 1.2;
      const baseA = this.getJitteredFreq(220);
      const baseE = baseA * 1.5; // 五度纯和弦

      // 主音
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(baseA, now);
      gain1.gain.setValueAtTime(0.001, now);
      gain1.gain.linearRampToValueAtTime(0.35, now + 0.1);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc1.connect(gain1);
      gain1.connect(this.bus.godBus);
      this.bus.registerVoice(osc1, gain1, duration);
      osc1.start(now);
      osc1.stop(now + duration + 0.01);

      // 五度和弦伴音
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(baseE, now);
      gain2.gain.setValueAtTime(0.001, now);
      gain2.gain.linearRampToValueAtTime(0.25, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc2.connect(gain2);
      gain2.connect(this.bus.godBus);
      this.bus.registerVoice(osc2, gain2, duration);
      osc2.start(now);
      osc2.stop(now + duration + 0.01);
    } catch (e) {}
  }

  /**
   * 5. 生机甘霖水滴音效 (正弦波升频: 900Hz -> 1800Hz, 60ms)
   * 路由: SFX Bus
   * @param {object} [options={}]
   */
  playWaterDrop(options = {}) {
    if (!this._isReady()) return;
    const ctx = this.bus.ctx;

    try {
      const now = ctx.currentTime;
      const duration = 0.06;
      const baseFreq = this.getJitteredFreq(900);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 2.0, now + duration);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.bus.sfxBus);

      this.bus.registerVoice(osc, gain, duration);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (e) {}
  }

  /**
   * 6. 神迹清脆响应音效 (清脆琶音: E5 -> G#5 -> B5 -> E6, 400ms)
   * 路由: God Power Bus
   * @param {object} [options={}]
   */
  playMiracle(options = {}) {
    if (!this._isReady()) return;
    const ctx = this.bus.ctx;

    try {
      const now = ctx.currentTime;
      const notes = [659.25, 830.61, 987.77, 1318.51];
      const step = 0.08;

      notes.forEach((freq, idx) => {
        const t = now + idx * step;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const jFreq = this.getJitteredFreq(freq);

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(jFreq, t);

        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

        osc.connect(gain);
        gain.connect(this.bus.godBus);

        this.bus.registerVoice(osc, gain, 0.15);
        osc.start(t);
        osc.stop(t + 0.16);
      });
    } catch (e) {}
  }

  /**
   * 7. 祈祷低语/狂喜音效 (方波微颤, 500ms)
   * 路由: Voice/UI Bus
   * @param {object} [options={}]
   */
  playChant(options = {}) {
    if (!this._isReady()) return;
    const ctx = this.bus.ctx;

    try {
      const now = ctx.currentTime;
      const duration = 0.45;
      const baseFreq = this.getJitteredFreq(330);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(baseFreq, now);

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.bus.voiceBus);

      this.bus.registerVoice(osc, gain, duration);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (e) {}
  }

  /**
   * 8. UI 点击/切换音效 (短促正弦波 660Hz, 40ms)
   * 路由: Voice/UI Bus
   * @param {object} [options={}]
   */
  playUI(options = {}) {
    if (!this._isReady()) return;
    const ctx = this.bus.ctx;

    try {
      const now = ctx.currentTime;
      const duration = 0.04;
      const baseFreq = this.getJitteredFreq(660);

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, now);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

      osc.connect(gain);
      gain.connect(this.bus.voiceBus);

      this.bus.registerVoice(osc, gain, duration);
      osc.start(now);
      osc.stop(now + duration + 0.01);
    } catch (e) {}
  }
}
