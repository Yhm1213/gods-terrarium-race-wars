/**
 * WebAudioBusManager.test.js
 * Web Audio 压限拓扑总线与 8-Bit 合成音效单元测试套件
 * 严格遵照 SPEC-M4-CONTRACT §5.2 与 QA 规范
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WebAudioBusManager,
  MAX_POLYPHONY,
  FADE_OUT_SECONDS
} from '../../src/audio/WebAudioBusManager.js';
import { Synth8Bit } from '../../src/audio/Synth8Bit.js';

// 创建 Mock AudioContext 及节点链路
function createMockAudioContext() {
  let currentTime = 10.0;

  const createMockParam = (initialVal = 1.0) => ({
    value: initialVal,
    setValueAtTime: vi.fn(function(v) { this.value = v; }),
    linearRampToValueAtTime: vi.fn(function(v) { this.value = v; }),
    exponentialRampToValueAtTime: vi.fn(function(v) { this.value = v; }),
    cancelScheduledValues: vi.fn()
  });

  const createMockNode = () => ({
    connect: vi.fn(),
    disconnect: vi.fn()
  });

  const ctx = {
    get currentTime() { return currentTime; },
    set currentTime(t) { currentTime = t; },
    state: 'running',
    sampleRate: 44100,
    destination: createMockNode(),
    createGain: vi.fn(() => ({
      ...createMockNode(),
      gain: createMockParam(1.0)
    })),
    createDynamicsCompressor: vi.fn(() => ({
      ...createMockNode(),
      threshold: createMockParam(-12.0),
      knee: createMockParam(30.0),
      ratio: createMockParam(12.0),
      attack: createMockParam(0.003),
      release: createMockParam(0.25)
    })),
    createOscillator: vi.fn(() => ({
      ...createMockNode(),
      type: 'sine',
      frequency: createMockParam(440),
      start: vi.fn(),
      stop: vi.fn()
    })),
    createBuffer: vi.fn((channels, length, rate) => ({
      length,
      numberOfChannels: channels,
      sampleRate: rate,
      getChannelData: vi.fn(() => new Float32Array(length))
    })),
    createBufferSource: vi.fn(() => ({
      ...createMockNode(),
      buffer: null,
      loop: false,
      start: vi.fn(),
      stop: vi.fn()
    })),
    createBiquadFilter: vi.fn(() => ({
      ...createMockNode(),
      type: 'lowpass',
      frequency: createMockParam(350)
    })),
    resume: vi.fn().mockResolvedValue()
  };

  return ctx;
}

describe('Web Audio 压限拓扑与 8-Bit 合成音效规范套件', () => {
  let mockCtx;
  let busManager;
  let synth;

  beforeEach(() => {
    mockCtx = createMockAudioContext();
    busManager = new WebAudioBusManager(mockCtx);
    synth = new Synth8Bit(busManager);
  });

  describe('1. 四大总线拓扑与安全压限器规格断言', () => {
    it('四大总线完整初始化且 Ambient 总线为 -28dB', () => {
      expect(busManager.sfxBus).toBeDefined();
      expect(busManager.voiceBus).toBeDefined();
      expect(busManager.godBus).toBeDefined();
      expect(busManager.ambientBus).toBeDefined();

      // Ambient 默认 -28dB (约 0.0398)
      expect(busManager.ambientBus.gain.value).toBeCloseTo(0.0398, 3);
    });

    it('末端安全压限器参数严格对齐防爆音物理指标', () => {
      const comp = busManager.compressor;
      expect(comp.threshold.value).toBe(-12.0);
      expect(comp.knee.value).toBe(30.0);
      expect(comp.ratio.value).toBe(12.0);
      expect(comp.attack.value).toBe(0.003);
      expect(comp.release.value).toBe(0.25);
    });

    it('主音量控制与静音切换', () => {
      busManager.setMasterVolume(0.5);
      expect(busManager.masterVolume).toBe(0.5);
      expect(busManager.masterGain.gain.value).toBe(0.5);

      busManager.setMuted(true);
      expect(busManager.isMuted).toBe(true);
      expect(busManager.masterGain.gain.value).toBe(0.0);

      busManager.setMuted(false);
      expect(busManager.masterGain.gain.value).toBe(0.5);
    });
  });

  describe('2. 侧链闪避控制器 (Sidechain Ducking) 断言', () => {
    it('神迹天雷降临时，SFX 与 Voice 总线平滑下潜 -12dB 并恢复', () => {
      busManager.triggerDucking(-12.0, 1.0);

      // SFX Bus 下潜
      expect(busManager.sfxBus.gain.setValueAtTime).toHaveBeenCalled();
      expect(busManager.sfxBus.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(2);

      // Voice Bus 下潜
      expect(busManager.voiceBus.gain.setValueAtTime).toHaveBeenCalled();
      expect(busManager.voiceBus.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(2);
    });
  });

  describe('3. 16 轨复音池与 Voice Stealing 抢占调度断言', () => {
    it('并发音轨上限锁定为 16 轨', () => {
      expect(MAX_POLYPHONY).toBe(16);
      expect(FADE_OUT_SECONDS).toBe(0.008);

      // 注册 16 轨
      for (let i = 0; i < 16; i++) {
        const dummyNode = { stop: vi.fn() };
        const dummyGain = { gain: { value: 1.0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() } };
        busManager.registerVoice(dummyNode, dummyGain, 1.0 + i);
      }
      expect(busManager.getActiveVoiceCount()).toBe(16);

      // 注册第 17 轨，触发 Voice Stealing 抢占
      const stealNode = { stop: vi.fn() };
      const stealGain = { gain: { value: 1.0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() } };
      busManager.registerVoice(stealNode, stealGain, 5.0);

      // 活跃音轨依然维持在 16
      expect(busManager.getActiveVoiceCount()).toBe(16);
    });
  });

  describe('4. 8-Bit 数学合成音效发生器 (Synth8Bit) 断言', () => {
    it('音高抖动严格落在 ±4% 物理区间 (Pitch Jitter 防疲劳)', () => {
      const baseFreq = 440;
      for (let i = 0; i < 50; i++) {
        const jittered = synth.getJitteredFreq(baseFreq);
        expect(jittered).toBeGreaterThanOrEqual(440 * 0.959);
        expect(jittered).toBeLessThanOrEqual(440 * 1.041);
      }
    });

    it('8 大核心音效发生器顺利合成发声', () => {
      synth.playHit();
      synth.playThunder();
      synth.playMeteor();
      synth.playHorn();
      synth.playWaterDrop();
      synth.playMiracle();
      synth.playChant();
      synth.playUI();

      expect(mockCtx.createOscillator).toHaveBeenCalled();
      expect(busManager.getActiveVoiceCount()).toBeGreaterThan(0);
    });

    it('静音或无 AudioContext 时优雅静默，永不抛出异常', () => {
      const emptyBus = new WebAudioBusManager(null);
      const safeSynth = new Synth8Bit(emptyBus);

      expect(() => {
        safeSynth.playHit();
        safeSynth.playThunder();
        safeSynth.playMeteor();
        safeSynth.playHorn();
      }).not.toThrow();
    });
  });
});
