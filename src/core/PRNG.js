/**
 * PRNG.js
 * 确定性伪随机数发生器 (Mulberry32 纯 32 位整型算法，100% 幂等可重现)
 * 严格遵循 TDS v1.1 与 Milestone 0 规范
 * 支持种子设定、序列分叉 (Fork)、区间整数与浮点生成，绝对零垃圾回收
 */

export class PRNG {
  /**
   * @param {number} seed - 32 位无符号整数种子
   */
  constructor(seed = 12345) {
    this.seed = 0;
    this.state = 0;
    this.setSeed(seed);
  }

  /**
   * 设置发生器种子并重置状态
   * @param {number} seed
   */
  setSeed(seed) {
    this.seed = (seed >>> 0) || 1;
    this.state = this.seed;
  }

  /**
   * 重置回当前种子初始状态
   */
  reset() {
    this.state = this.seed;
  }

  /**
   * 生成下一个 32 位无符号随机整数 (Mulberry32 核心)
   * @returns {number} 范围 [0, 4294967295]
   */
  next() {
    let t = (this.state = (this.state + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0);
  }

  /**
   * 生成 32 位无符号随机整数 (nextUint32 别名)
   * @returns {number}
   */
  nextUint32() {
    return this.next();
  }

  /**
   * 生成 [0, 1) 区间内的双精度浮点随机数
   * @returns {number} 0.0 <= r < 1.0
   */
  nextFloat() {
    // 2^32 = 4294967296
    return (this.next() >>> 0) / 4294967296.0;
  }

  /**
   * 生成 [min, max] 闭区间内的离散整数
   * 倒置参数 (min > max) 防御性处理，安全返回 min
   * @param {number} min - 下界 (包含)
   * @param {number} max - 上界 (包含)
   * @returns {number}
   */
  nextInt(min, max) {
    let floorMin = Math.floor(min);
    let floorMax = Math.floor(max);
    if (floorMin > floorMax) {
      const tmp = floorMin;
      floorMin = floorMax;
      floorMax = tmp;
    } else if (floorMin === floorMax) {
      return floorMin;
    }
    const range = floorMax - floorMin + 1;
    return floorMin + Math.floor(this.nextFloat() * range);
  }

  /**
   * 按照指定概率返回布尔值
   * @param {number} [probability=0.5] 
   * @returns {boolean}
   */
  nextBool(probability = 0.5) {
    return this.nextFloat() < probability;
  }

  /**
   * 分叉衍生一个独立的子 PRNG 实例，父子序列确定且互不污染
   * @returns {PRNG}
   */
  fork() {
    return new PRNG(this.next());
  }
}
