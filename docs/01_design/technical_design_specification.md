# 《神之蛐蛐缸：万族争霸》系统技术详细设计与数据契约说明书 (TDS v2.0 活体文明涌现版)

> **工程代名**：Project God-Cricket (万族争霸)  
> **设计依据**：Master GDD v3.0 (总策划案) & SRS v2.0 (系统需求规格说明书) & WBS v2.0 & ECR-2026-001  
> **评审基线**：已全量纳入 ECR-2026-001 活体文明涌现与全系统有机闭环技术架构规程  
> **文档性质**：工程实施与编码装配强制施工蓝图 (Technical Design Specification, TDS)  
> **核心目标**：统一全系统分层目录脚手架、ECS 连续平铺内存池（零越界、纯 SoA 缓存行优化）、部族粮仓连续池、领地动态侵染矩阵、活体繁衍遗传引擎、核心系统无分配 API 签名、以及前端 60 FPS 零 GC 渲染，构建生机勃勃的活体文明生态箱。  
> **文档密级**：内部技术交付基线 (开发阶段不可违背之施工宪法)  

---

## 目录
1. [技术架构总览与工程脚手架规范](#一-技术架构总览与工程脚手架规范)
2. [静态数值配表与数据字典规范 (Static Data Schemas)](#二-静态数值配表与数据字典规范)
3. [ECS 组件数据字典与连续内存布局 (Component Schemas & TypedArray Layout)](#三-ecs-组件数据字典与连续内存布局)
4. [核心系统 API 契约与方法签名手册 (API Contracts)](#四-核心系统-api-契约与方法签名手册)
5. [全局领域事件枚举与载荷字典 (Domain Events Catalog)](#五-全局领域事件枚举与载荷字典)
6. [客户端三层数据存储与持久化规范 (Persistence & IndexedDB)](#六-客户端三层数据存储与持久化规范)
7. [施工准则与红线门禁 (Construction Mandates)](#七-施工准则与红线门禁)
8. [活体文明涌现与全系统闭环技术扩展 (TDS v2.0 M5 Expansion)](#八-活体文明涌现与全系统闭环技术扩展-tds-v20-m5-expansion)


---

## 一、 技术架构总览与工程脚手架规范

### 1.1 系统架构设计哲学与核心契约
1. **零第三方重型依赖 (Pure Native ES6+)**：全系统基于原生 JavaScript (ES2022+)，不引入 Phaser/Pixi 等重型外部黑盒，直接操纵原生 Canvas 2D 上下文与 Web Audio API，保证极速冷启动与极致底层控制力。
2. **面向数据设计与连续内存 (Data-Oriented Design & ECS-Lite)**：
   - 数据（Components）与逻辑（Systems）严格物理解耦，禁止任何面向对象充血模型（严禁 `new Unit().update()`）；
   - 核心高频数值（位置、速度、血量、士气、生理代谢、战斗抗性）全面平铺于连续 `Float32Array` / `Uint32Array`，针对 CPU 64 字节 Cache Line 实施纯 SoA 预取优化；
   - 运行期主循环实现严格的 **物理零 GC (Zero Garbage Collection)**，杜绝运行时内存抖动与垃圾回收掉帧。
3. **单向事件流与双轨总线解耦 (Unidirectional Event Flow)**：
   - 系统间通信 100% 依托 `DomainEventBus` 双轨环形事件总线异步解耦，禁止跨系统网状直接引用与深层同步调用栈，彻底免疫循环依赖与调用栈溢出；
   - 关键事务（灭国、加冕、大分裂）绝对保底不丢包；瞬态特效支持 FIFO 降频。
4. **后台 Worker 线程解耦持久化 (Offscreen Thread Decoupling)**：
   - 严禁在主渲染线程执行图像压缩编码与数据库事务；
   - 离屏 `OffscreenCanvas` 验尸单通过零拷贝（Transferable Objects）移交专属 `StorageWorker`，确保主线程在发生大事件与存盘时帧耗时稳定在 0.2ms 以内。

---

### 1.2 物理目录树与 Clean Architecture 分层拓扑

为彻底消除模块路径二义性并严格落实 WBS v1.1 规划，全项目源代码目录严格规划为六大同心圆层次：

```
Project Root (/Users/yuhaomiao/Documents/antigravity/Game/)
  ├── docs/                             # 策划案 (GDD v2.2)、需求 (SRS v1.1)、排期 (WBS v1.1) 与本规格书 (TDS v1.1)
  ├── index.html                        # 宿主页面入口 (单页秒开，挂载 Canvas 与 UI HUD)
  ├── style.css                         # 游戏全局视口、暗角与思维阁打字机样式
  ├── src/
  │     ├── main.js                     # 游戏主启动入口 (负责组装 Systems、初始化主循环)
  │     │
  │     ├── core/                       # 【基础设施层】：引擎底层运行时 (纯引擎语义，严禁反向感知具体业务)
  │     │     ├── GameLoop.js           # 定步长物理累加器循环与单向流水线管线编排
  │     │     ├── Scheduler.js          # 分帧削峰调度器 (1-Tick, 10-Tick, 60-Tick)
  │     │     ├── SpatialHash.js        # 48px 平铺连续内存空间哈希网格
  │     │     ├── SpatialQuery.js       # 零分配空间邻域/视锥范围检索 (显式依赖注入，防溢出截断)
  │     │     ├── DomainEventBus.js     # 零 GC 双轨双缓冲环形事件总线内核
  │     │     ├── ECS.js                # 紧凑型稠密栈实体管理器 (Swap-and-Pop, 0号墓碑隔离)
  │     │     └── PRNG.js               # 确定性伪随机数发生器 (Mulberry32/xoshiro128)
  │     │
  │     ├── components/                 # 【数据结构层】：纯数据连续内存定义 (零业务方法，纯标量视图)
  │     │     ├── TransformComponent.js # 坐标 X/Y、旋转、缩放 (纯 SoA 拆分排布)
  │     │     ├── PhysicsComponent.js   # 线性速度 vx/vy、质量 mass、质量倒数 invMass
  │     │     ├── HealthComponent.js    # 当前生命、生命上限、上次伤害来源整型ID
  │     │     ├── CombatStatsComponent.js # 护甲、钝击/穿刺抗性、税后反伤系数 (补齐核心战斗属性)
  │     │     ├── PhysiologyComponent.js# 饥饿度、10s 应急代谢锁、上帝之手滞空计时、反加冕霸体计时
  │     │     ├── MoraleComponent.js    # 士气值 (0~100)、破釜沉舟/恐慌状态倒计时
  │     │     ├── UnitStatusFlags.js    # 32 位实体物理/内政状态二进制位掩码 (带 >>> 0 与语义互斥)
  │     │     └── Identities.js         # 3 字长数组 [FactionID, ProductionJobID, CombatJobID] (双职业支持)
  │     │
  │     ├── data/                       # 【静态配表与契约层】：只读配置字典与领域枚举 (Object.freeze)
  │     │     ├── RaceData.js           # 12 基础种族物理参数与正交器官禁忌掩码表 (拉齐平衡)
  │     │     ├── MutationFlags.js      # 正交变异器官 9 大属性位掩码库 (OrganFlags)
  │     │     ├── BiomeData.js          # 6 大生物群系阻力、养分底温 [0.0, 1.0] 与深浅水矩阵
  │     │     ├── SuperWeaponData.js    # 四大超级奇迹兵器完整战斗构件与反噬物理参数表
  │     │     ├── FactionData.js        # 16 阵营初始配表与 FactionRuntimeBuffer 宏观政治张力容器
  │     │     ├── TechCivicData.js      # 生产军事实用科技与四大市政属性修正
  │     │     ├── OrganData.js          # 解剖器官挂件物理属性与 CFG 文法积木库
  │     │     ├── GodMiracleData.js     # 原案六大上帝玩具技能参数表
  │     │     ├── DomainEvents.js       # 全局领域事件枚举 (从 core 迁移至 data，解除反向依赖)
  │     │     └── SeedCodec.js          # 16 位分歧点基因种子码编解码器
  │     │
  │     ├── world/                      # 【世界瓦片领域】：地形与网格物理
  │     │     ├── TileGrid.js           # 56x36 瓦片网格实体与阻力场管理
  │     │     └── TileElementSystem.js  # 瓦片火/水/酸/电/瓦斯元素连锁反应系统
  │     │
  │     ├── ecosystem/                  # 【生态与经济领域】：自然循环与仓储
  │     │     ├── NutrientFieldSystem.js# 二维拉普拉斯连续养分扩散与绝热边界系统
  │     │     ├── FarmlandSystem.js     # 农田 2x2 四阶演替与收割入仓系统
  │     │     ├── WildlifeSystem.js     # 中立野生动物群落摄食、育幼与反击系统
  │     │     └── GranaryStorage.js     # 部族粮仓实体、容量守恒与打砸抢结算
  │     │
  │     ├── race/                       # 【种族与生理领域】：代谢与生理演变
  │     │     ├── MetabolismSystem.js   # 四大生存代谢范式与 10s 应急降级互斥锁系统
  │     │     ├── TabooFilter.js        # 正交禁忌掩码校验与 CFG 降级重映射
  │     │     └── CorpseDegradation.js  # 尸体 120s 自然降解回流地脉系统
  │     │
  │     ├── profession/                 # 【职业领域】：双职业兼职与履历
  │     │     └── CareerSystem.js       # 生产底色 + 战斗副职觉醒与 ICD 内置冷却控制
  │     │
  │     ├── mutation/                   # 【基因突变领域】：变异文法与器官
  │     │     ├── CFGBehaviorEngine.js  # 上下文无关文法突变行为生成器
  │     │     └── BehaviorValidator.js  # 突变行为有效性与禁忌校验器
  │     │
  │     ├── warfare/                    # 【军事与战争领域】：交火、伤害与看门狗
  │     │     ├── DamageCalculator.js   # 边际递减护甲、NaN净化、零分配伤害计算器
  │     │     ├── CombatSystem.js       # 索敌、攻击判定与伤害穿透减免系统
  │     │     ├── MoraleSystem.js       # 士气崩溃逃散与 5 格破釜沉舟系统
  │     │     └── WarWatchdogSystem.js  # 300s 战争交火超时双门限熔断系统 (TC-EDGE-04)
  │     │
  │     ├── pathfinding/                # 【寻路领域】：大军团流场与避障
  │     │     └── VectorFlowFieldSystem.js # 多源反向 BFS 寻路与死区防 NaN 采样系统
  │     │
  │     ├── politics/                   # 【政治与内政领域】：分裂与王朝继承
  │     │     ├── ClanCensusSystem.js   # 60-Tick 部族普查饥饿统计与宏观政治张力累加
  │     │     ├── SchismSystem.js       # Voronoi 双核领地中轴撕裂与内战分裂系统
  │     │     └── DynastySystem.js      # 老王驾崩 3.0s 原子事务锁、五大意外转盘与绝嗣角斗
  │     │
  │     ├── god/                        # 【上帝交互层】：鼠标操作与神力
  │     │     ├── HandOfGodSystem.js    # 鼠标悬浮抓取、反加冕 5.0s 天雷震脱与缓降金身
  │     │     └── DivineMiraclesSystem.js# 原案六大上帝玩具与 15s 神恩满溢狂欢控制
  │     │
  │     ├── rendering/                  # 【渲染表现层】：GPU 批处理与像素管线
  │     │     ├── RenderSystem.js       # 离散 8 向分桶纯整数零状态 GPU Batch 绘制系统
  │     │     ├── MegaAtlasDollCache.js # 享元签名哈希池 (Flyweight Stamp Pool) 与擦除防鬼影
  │     │     └── PixelPaletteShader.js # 7:2:1 像素调色盘与领袖金色描边着色器
  │     │
  │     ├── camera/                     # 【视口与镜头层】
  │     │     └── Camera2D.js           # 视口平移缩放、阻尼平滑与视锥剔除包围盒
  │     │
  │     ├── director/                   # 【智能导播层】
  │     │     └── SmartDirector.js      # 焦点加权平滑导播与高戏剧张力事件慢动作特写
  │     │
  │     ├── ui/                         # 【UI 交互层】：DOM / Canvas 表现视图
  │     │     ├── HUDController.js      # 顶端神力环、阵营面板与倍速控制
  │     │     ├── InspectorPanel.js     # 小人思维阁、器官解剖图谱与履历视窗
  │     │     ├── ThoughtLogView.js     # 三声道战报打字机流式呈现
  │     │     └── ReceiptModal.js       # 离屏验尸小票展示与图片导出弹窗
  │     │
  │     ├── audio/                      # 【音频管线层】：Web Audio 原生 8-bit 合成
  │     │     ├── WebAudioBusManager.js # 16 轨复音池、动态压限总线与视锥裁剪
  │     │     └── Synth8Bit.js          # 原生方波/三角波/白噪声 PCM 预烘焙池
  │     │
  │     ├── narrative/                  # 【叙事引擎层】：三声道语料与战报
  │     │     ├── TriVocalEngine.js     # 冰冷法医/崇高诗人/冷酷审计三声道战报聚合
  │     │     ├── ContextSlabPool.js    # 富上下文定长环形 Slab 快照池 (携带世代号防 ABA)
  │     │     ├── DramaScore.js         # 戏剧张力评分器 (高信噪比准入网，防战报刷屏)
  │     │     ├── DeathAuditReceipt.js  # 帝国官僚验尸小票 OffscreenCanvas 绘制器
  │     │     └── BloodLedger.js        # 宿怨账本有向图与物理因果对账
  │     │
  │     └── persistence/                # 【数据持久化层】：客户端本地多级容灾存储
  │           ├── StorageFacade.js      # 统一存储门面 (IDB -> localStorage -> In-Memory 三级降级)
  │           ├── LocalStore.js         # localStorage 键值存取 (设置/种子码/成就位)
  │           ├── IndexedDBManager.js   # 本地轻量数据库 (验尸单Blob/宿怨长卷，带 LRU 60张上限)
  │           └── StorageWorker.js      # 专属后台 Web Worker (零拷贝接收 Canvas 执行后台 PNG 压缩)
  │
  └── tests/                            # 【自动化测试金字塔】：Vitest 极速无头测试与攻防套件
        ├── core/                       # 核心基础设施单元测试 (Node 极速环境，零 DOM 依赖)
        ├── systems/                    # 业务系统纯逻辑单测
        ├── guardrails/                 # TC-EDGE-01 ~ 09 九大底层守门黑盒渗透测试套件
        └── chaos/                      # 10,000 帧极速无头时间加速混沌测试 (断言堆内存增长 == 0)
```

---

### 1.3 确定性单向帧序执行管线 (Deterministic Frame Pipeline)

禁止各系统自发监听事件随意穿插更新。在 `src/core/GameLoop.js` 中，主物理循环以固定的 **1/60s (16.67ms)** 步长按以下单向管线顺序刚性编排执行：

```
[1. Input & God]           HandOfGodSystem (鼠标悬浮/抓取/反加冕天威检测)
       │
[2. Environment]           TileElementSystem (元素连锁) -> NutrientFieldSystem (养分扩散)
       │
[3. Economy & Ecology]     FarmlandSystem (演替) -> WildlifeSystem -> GranaryStorage
       │
[4. Physiology & Career]   MetabolismSystem (饥饿/10s应急互斥) -> CareerSystem
       │
[5. Pathfinding]           VectorFlowFieldSystem (多源反向BFS，500ms节流更新，采样防NaN)
       │
[6. Physics Integration]   MovementSystem (刚体物理位移，刚性边界Clamp TC-EDGE-02)
       │
[7. Spatial Acceleration]  SpatialHash.rebuild (刷新 48px 网格，耗时 < 0.2ms)
       │
[8. Warfare & Combat]      CombatSystem (索敌/调用 DamageCalculator 零分配结算) -> MoraleSystem
       │
[9. Safety Watchdog]       WarWatchdogSystem (300s 战争超时双门限熔断 TC-EDGE-04)
       │
[10. Politics & Schism]    ClanCensusSystem (60-Tick 政治张力普查) -> SchismSystem -> DynastySystem
       │
[11. Event Dispatch]       DomainEventBus.flush (分发双轨事件，驱动音效/战报/成就)
       │
[12. Render Batch]         RenderSystem (离散8向平铺无状态 Batch) -> Camera2D -> SmartDirector
```

---

## 二、 静态数值配表与数据字典规范 (Static Data Schemas)

所有配表数据存放在 `src/data/` 目录，对外暴露纯只读不可变对象（`Object.freeze`），严禁在运行时直接篡改。

### 2.1 12 基础种族物理参数字典 (`src/data/RaceData.js`)

吸收数值专家审查意见，修正超模属性（角魔/魔像）、挽救蒸发种族（真菌人）、消除魔眼饥饿自绝，并将禁忌彻底解耦为正交的器官类型掩码：

```javascript
import { OrganFlags } from './MutationFlags.js';

export const Races = Object.freeze({
  ORC: {
    id: 'ORC',
    name: '绿皮菌兽',
    mass: 85.0,           // 物理质量 (kg)，用于冲量守恒碰撞
    baseSpeed: 52.0,      // 基础移速 (px/s)
    baseHp: 140,          // 拉齐 GDD 基准 (140)
    metabolicRate: 1.2,   // 饥饿消耗速率倍率
    metabolicType: 2,     // 0=农耕, 1=捕猎, 2=掠夺, 3=无机充能
    tabooMask: OrganFlags.HOLY | OrganFlags.MERCURY, // 禁忌圣灵与水银器官
    resistances: { blunt: 0.20, pierce: -0.10, fire: -0.20, acid: 0.10 }
  },
  ELF: {
    id: 'ELF',
    name: '森灵树民',
    mass: 40.0,
    baseSpeed: 68.0,
    baseHp: 85,
    metabolicRate: 0.8,
    metabolicType: 0,
    tabooMask: OrganFlags.FLAME | OrganFlags.GAS, // 禁忌火焰与瓦斯器官 (自动重映射为剧毒孢子)
    resistances: { blunt: -0.10, pierce: 0.10, fire: -0.40, acid: 0.30 }
  },
  HUMAN: {
    id: 'HUMAN',
    name: '人类帝国',
    mass: 65.0,
    baseSpeed: 58.0,
    baseHp: 100,
    metabolicRate: 1.0,
    metabolicType: 0,
    tabooMask: 0,         // 全相容，无任何突变禁忌
    resistances: { blunt: 0.00, pierce: 0.00, fire: 0.00, acid: 0.00 }
  },
  DWARF: {
    id: 'DWARF',
    name: '高山矮人',
    mass: 90.0,
    baseSpeed: 42.0,
    baseHp: 130,          // 修复虚高，拉齐 GDD 基准 (130)
    metabolicRate: 1.1,
    metabolicType: 1,
    tabooMask: OrganFlags.WING, // 禁忌薄翼翅膀 (无法长出肉翅)
    resistances: { blunt: 0.30, pierce: 0.10, fire: 0.20, acid: -0.10 }
  },
  UNDEAD: {
    id: 'UNDEAD',
    name: '墓园亡灵',
    mass: 38.0,
    baseSpeed: 48.0,
    baseHp: 75,
    metabolicRate: 0.0,   // 零食物消耗
    metabolicType: 3,     // 无机死灵充能
    tabooMask: OrganFlags.HOLY | OrganFlags.FLESH, // 修复 Bug: 完整包含圣灵与鲜肉禁忌
    resistances: { blunt: -0.30, pierce: 0.40, fire: -0.30, acid: 0.50 }
  },
  GOBLIN: {
    id: 'GOBLIN',
    name: '狂躁地精',
    mass: 26.0,
    baseSpeed: 72.0,      // 微调移速，保持高速但不压倒精灵
    baseHp: 60,
    metabolicRate: 1.3,
    metabolicType: 2,
    tabooMask: OrganFlags.HOLY,
    resistances: { blunt: -0.20, pierce: -0.10, fire: 0.30, acid: 0.10 }
  },
  DEMON: {
    id: 'DEMON',
    name: '深渊角魔',
    mass: 90.0,
    baseSpeed: 55.0,
    baseHp: 130,          // 彻底修复超模 (由 180 砍回 130)
    metabolicRate: 1.5,
    metabolicType: 2,
    tabooMask: OrganFlags.HOLY | OrganFlags.AQUATIC,
    resistances: { blunt: 0.15, pierce: 0.05, fire: 0.50, acid: -0.20 } // 火抗降至合理 0.50
  },
  LIZARD: {
    id: 'LIZARD',
    name: '沼泽蜥蜴人',
    mass: 65.0,
    baseSpeed: 55.0,
    baseHp: 110,
    metabolicRate: 0.9,
    metabolicType: 1,
    tabooMask: OrganFlags.FLAME,
    resistances: { blunt: 0.10, pierce: 0.00, fire: -0.20, acid: 0.60 }
  },
  BEAST: {
    id: 'BEAST',
    name: '荒原兽化人',
    mass: 85.0,
    baseSpeed: 64.0,
    baseHp: 135,
    metabolicRate: 1.4,
    metabolicType: 1,
    tabooMask: OrganFlags.MERCURY | OrganFlags.ELEC,
    resistances: { blunt: 0.10, pierce: -0.10, fire: -0.10, acid: 0.00 }
  },
  SPORE: {
    id: 'SPORE',
    name: '孢子真菌人',
    mass: 38.0,
    baseSpeed: 45.0,
    baseHp: 95,           // 挽救蒸发种族 (由 70 恢复至 95)
    metabolicRate: 0.5,
    metabolicType: 0,
    tabooMask: OrganFlags.FLAME | OrganFlags.GRANITE,
    resistances: { blunt: 0.35, pierce: -0.20, fire: -0.35, acid: 0.40 } // 火抗修正至 -0.35
  },
  GOLEM: {
    id: 'GOLEM',
    name: '晶石魔像',
    mass: 180.0,          // 修正过大质量 (由 240kg 调至 180kg)
    baseSpeed: 32.0,
    baseHp: 180,          // 修复无解血量黑洞 (由 260 降至 180)
    metabolicRate: 0.0,
    metabolicType: 3,
    tabooMask: OrganFlags.FLESH | OrganFlags.WING | OrganFlags.AQUATIC,
    resistances: { blunt: 0.25, pierce: 0.35, fire: 0.20, acid: -0.40 } // 强化酸液弱点
  },
  ABERR: {
    id: 'ABERR',
    name: '拟态魔眼',
    mass: 25.0,
    baseSpeed: 68.0,
    baseHp: 85,           // 恢复至 85
    metabolicRate: 0.0,   // 修复饥饿自绝死锁: 修正为严格 0.0 (无机心智生物免饥饿)
    metabolicType: 3,
    tabooMask: OrganFlags.HOLY | OrganFlags.FLESH,
    resistances: { blunt: -0.30, pierce: -0.10, fire: 0.10, acid: 0.20 }
  }
});
```

---

### 2.2 正交变异器官掩码库 (`src/data/MutationFlags.js`)

彻底解决种族禁忌与器官类型耦合问题，提供 9 大解剖属性正交位掩码：

```javascript
export const OrganFlags = Object.freeze({
  HOLY:      1 << 0,  // 0x0001: 圣灵系光环/圣血
  FLAME:     1 << 1,  // 0x0002: 烈焰焦黑腺体
  GAS:       1 << 2,  // 0x0004: 易燃瓦斯囊袋
  WING:      1 << 3,  // 0x0008: 昆虫薄翼/羽翼
  FLESH:     1 << 4,  // 0x0010: 鲜肉/血肉器官
  MERCURY:   1 << 5,  // 0x0020: 水银液态流道
  GRANITE:   1 << 6,  // 0x0040: 花岗岩重甲角质
  ELEC:      1 << 7,  // 0x0080: 导电金属神经
  AQUATIC:   1 << 8   // 0x0100: 水栖腮与呼吸管
});
```

---

### 2.3 6 大生物群系环境参数字典 (`src/data/BiomeData.js`)

修复养分量纲超标 100 倍问题，严格拉齐 GDD 的 $[0.0, 1.0]$ 规范，并建立深浅水通行分流：

```javascript
export const Biomes = Object.freeze({
  PLAINS: {
    id: 0,
    name: '温带平原',
    moveCostMultiplier: 1.0,
    nutrientFloor: 0.25,      // 修正量纲: 0.25 (催生长草与普通浆果)
    hazardType: 0,
    hazardDps: 0,
    colorCode: '#4a8505'
  },
  MOUNTAINS: {
    id: 1,
    name: '高山岩矿',
    moveCostMultiplier: 1.5,
    nutrientFloor: 0.05,      // 贫瘠岩石
    hazardType: 0,
    hazardDps: 0,
    colorCode: '#736d71'
  },
  SHALLOW_WATER: {
    id: 2,
    name: '浅水滩涂',
    moveCostMultiplier: 2.0,  // 减速通行
    nutrientFloor: 0.30,
    hazardType: 0,
    hazardDps: 0,
    colorCode: '#3a7b9c'
  },
  DEEP_WATER: {
    id: 3,
    name: '深水绝壁',
    moveCostMultiplier: 999.0,// 绝对不可通行阻挡
    nutrientFloor: 0.10,
    hazardType: 0,
    hazardDps: 0,
    colorCode: '#163854'
  },
  SWAMP: {
    id: 4,
    name: '腐蚀沼泽',
    moveCostMultiplier: 1.8,
    nutrientFloor: 0.40,
    hazardType: 2,             // 腐蚀减速，每秒 1 点真伤
    hazardDps: 1.0,
    colorCode: '#2a4436'
  },
  VOLCANO: {
    id: 5,
    name: '地热熔岩',
    moveCostMultiplier: 2.2,
    nutrientFloor: 0.0,
    hazardType: 1,             // 灼烧，每秒 2 点火焰真伤
    hazardDps: 2.0,
    colorCode: '#932200'
  },
  HOLY_SPRING: {
    id: 6,
    name: '神圣泉眼',
    moveCostMultiplier: 0.9,
    nutrientFloor: 0.85,       // 超级高肥沃地脉 (催生古树)
    hazardType: 3,             // 神圣愈合 (每秒恢复 2 HP)
    hazardDps: -2.0,
    colorCode: '#ffd700'
  }
});
```

---

### 2.4 四大超级战略兵器参数字典 (`src/data/SuperWeaponData.js`)

补齐比蒙巨兽、树精古卫的伤害、攻速、横扫、缠绕比例等完整战斗参数，并给飞艇增加 HP 与防空机制：

```javascript
export const SuperWeapons = Object.freeze({
  DWARF_CANNON: {
    id: 'DWARF_CANNON',
    raceId: 'DWARF',
    name: '地鸣破城轨道巨炮',
    maxRange: 14,             // 射程 14 瓦片
    damage: 280,              // 穿甲真伤
    cooldownSec: 25.0,
    knockbackForce: 120.0,
    misfireRate: 0.10,        // 10% 炸膛几率
    misfireEffect: { stunRadius: 3, stunDurationSec: 5.0, selfDamage: 80 } // 炮体自损 80 HP
  },
  GOBLIN_AIRSHIP: {
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
    misfireEffect: { selfExplodeInBase: true, destructionRadius: 3 }
  },
  ORC_BEHEMOTH: {
    id: 'ORC_BEHEMOTH',
    raceId: 'ORC',
    name: '生化憎恶比蒙巨兽',
    footprint: { w: 2, h: 2 },
    maxHp: 1200,
    mass: 550.0,
    baseSpeed: 36.0,          // 补齐移速
    damage: 60,               // 补齐普攻伤害
    attackIntervalSec: 2.2,   // 攻击间隔
    sweepAngleRad: 1.57,      // 90 度扇形横扫
    knockbackForce: 160.0,    // 巨大击退冲量
    dailyMeatUpkeep: 5,       // 每日需投喂 5 份鲜肉
    starvationFrenzySec: 15.0 // 断粮发狂践踏自家帐篷时间
  },
  ELF_ANCIENT_TREANT: {
    id: 'ELF_ANCIENT_TREANT',
    raceId: 'ELF',
    name: '远古战争树精古卫',
    footprint: { w: 2, h: 2 },
    maxHp: 950,
    mass: 420.0,
    baseSpeed: 22.0,          // 补齐移速 (拉齐 GDD 0.4 倍移速)
    damage: 45,               // 补齐普攻
    attackIntervalSec: 2.6,
    entangle: { radius: 2, slowPct: 0.60, durationSec: 3.0 }, // 减速 60% 持续 3s
    firePanicDurationSec: 8.0 // 遇火恐慌无差别践踏时间
  }
});
```

---

### 2.5 宏观政权数据与张力容器 (`src/data/FactionData.js`)

彻底清除“外交好感度 -50”、“仇恨值 200”等虚构属性。全图最多 16 个政权，其宏观状态直接物化为类型化数组 `FactionRuntimeBuffer`，张力由微观小人普查真实统计得出：

```javascript
/**
 * 阵营宏观运行时数据缓冲规格 (最多 16 个政权，每阵营 8 个 32位整型字，仅 512 字节)
 * [TotemEntityId, CivicRouteId, Tension(0~100), PopCount, FoodStock, OreStock, WarCooldown, Flags]
 */
export const MAX_FACTIONS = 16;
export const FACTION_STRIDE = 8;
export const FAC_OFFSET_TOTEM_ID = 0;
export const FAC_OFFSET_CIVIC_ID = 1;
export const FAC_OFFSET_TENSION = 2;    // 政治张力 (0.0 ~ 100.0, 达到 100 爆发大分裂)
export const FAC_OFFSET_POP_COUNT = 3;  // 当前存活总人口
export const FAC_OFFSET_FOOD = 4;       // 部族大粮仓储备
export const FAC_OFFSET_ORE = 5;        // 矿石建材储备
export const FAC_OFFSET_WAR_COOLDOWN = 6;// 停战 300s 凝聚保护期倒计时
export const FAC_OFFSET_FLAGS = 7;      // 阵营状态位 (如 IS_DESTROYED, IS_SCHISMED)
```

---

## 三、 ECS 组件数据字典与连续内存布局 (Component Schemas & TypedArray Layout)

为了达成 **千人同屏稳定 60 FPS、连续 10 小时挂机堆内存零 GC 增长** 的极端性能底线，所有高频运行态实体数据全面采用平铺连续的 `Float32Array` 与 `Uint32Array` 结构。

### 3.1 零越界与 0 号墓碑隔离机制
* **痛点根治**：`EntityID` 取值范围规定为 `1 ~ MAX_ENTITIES (4096)`。
* **分配规格**：所有 TypedArray 长度统一分配为 **`(MAX_ENTITIES + 1) * STRIDE`**。
* **0 号墓碑**：`EntityID = 0` 永久保留为全局 `NULL_ENTITY` 墓碑占位符。任何未命中或空指针均落入 0 号槽位，彻底消除第 4096 号实体访问越界的静默失败灾难。

```
                ┌─────────────────────────────────────────────────────────┐
                │   ECS-Lite 连续内存池规格表 (MAX_ENTITIES=4096, 纯 SoA)  │
                ├─────────────────────────────────────────────────────────┤
                │  TransformComponent:  Float32Array((4097) * 4)          │
                │  PhysicsComponent:    Float32Array((4097) * 4)          │
                │  HealthComponent:     Float32Array((4097) * 4)          │
                │  CombatStatsComponent:Float32Array((4097) * 4) [新增]   │
                │  PhysiologyComponent: Float32Array((4097) * 4) [新增]   │
                │  MoraleComponent:     Float32Array((4097) * 2)          │
                │  StatusFlags:         Uint32Array(4097)                 │
                │  Identities:          Uint32Array((4097) * 3)  [3字长]  │
                └─────────────────────────────────────────────────────────┘
```

---

### 3.2 高频物理与生理组件排布常量

```javascript
export const MAX_ENTITIES = 4096;
export const TOTAL_SLOTS = MAX_ENTITIES + 1; // 4097

// 1. TransformComponent (纯 SoA 拆分，极大提升 L1 缓存预取命中率)
export const TRANSFORM_STRIDE = 4;
export const TF_OFFSET_X = 0;        // 世界坐标 X 浮点数 (px)
export const TF_OFFSET_Y = 1;        // 世界坐标 Y 浮点数 (px)
export const TF_OFFSET_ROTATION = 2; // 弧度朝向 (-PI ~ PI)
export const TF_OFFSET_SCALE = 3;    // 视觉缩放因子 (基准=1.0)

// 2. PhysicsComponent
export const PHYSICS_STRIDE = 4;
export const PHY_OFFSET_VX = 0;      // X 轴线性初速度 (px/s)
export const PHY_OFFSET_VY = 1;      // Y 轴线性初速度 (px/s)
export const PHY_OFFSET_MASS = 2;    // 实体有效质量 (kg)
export const PHY_OFFSET_INVMASS = 3; // 质量倒数 1/mass (静态图腾为 0.0)

// 3. HealthComponent
export const HEALTH_STRIDE = 4;
export const HP_OFFSET_CURRENT = 0;  // 当前生命值 (<=0 触发死亡注销)
export const HP_OFFSET_MAX = 1;      // 生命值上限
export const HP_OFFSET_LAST_SRC = 2; // 上次伤害来源 EntityID (整型)
export const HP_OFFSET_LAST_TICK = 3;// 上次受创的世界 Tick (用于反伤 ICD 计算)

// 4. CombatStatsComponent (补齐高频战斗数值)
export const COMBAT_STRIDE = 4;
export const CS_OFFSET_ARMOR = 0;        // 聚合有效护甲值 (下限 Clamp 至 -40.0)
export const CS_OFFSET_BLUNT_RESIST = 1; // 钝击抗性 (-0.40 ~ 0.60)
export const CS_OFFSET_PIERCE_RESIST = 2;// 穿刺抗性 (-0.40 ~ 0.60)
export const CS_OFFSET_REFLECT_RATIO = 3;// 税后反伤系数 (默认 0.0, 荆棘器官/职业生效)

// 5. PhysiologyComponent (补齐四大代谢与防死锁生理数据)
export const PHYSIOLOGY_STRIDE = 4;
export const PHY_OFFSET_HUNGER = 0;         // 当前饥饿度 (0.0 ~ 100.0, >80.0 激活应急降级)
export const PHY_OFFSET_EMERGENCY_LOCK = 1; // 应急代谢 10s 独占互斥锁倒计时 (秒)
export const PHY_OFFSET_HOLD_TIMER = 2;     // 上帝之手抓取滞空计时器 (防加冕死锁，累加至 5.0s)
export const PHY_OFFSET_SACRED_BODY = 3;    // 反加冕金身霸体剩余时间 (1.5s 倒计时)

// 6. MoraleComponent
export const MORALE_STRIDE = 2;
export const MORALE_OFFSET_VAL = 0;  // 当前士气 (0.0 ~ 100.0)
export const MORALE_OFFSET_TIMER = 1;// 状态倒计时 (如破釜沉舟剩余时间)

// 7. Identities (扩展为 3 字长，完整承接双职业兼职)
export const IDENTITY_STRIDE = 3;
export const ID_OFFSET_FACTION = 0;  // 阵营 ID (1 ~ 16)
export const ID_OFFSET_PROD_JOB = 1; // 生产生活底色职业 ID (石工/农夫/草药/屠夫...)
export const ID_OFFSET_COMBAT_JOB = 2;// 战斗副职 ID (铁卫/狂战/伏击/长弓...)
```

---

### 3.3 实体 32 位状态位掩码表 (`src/components/UnitStatusFlags.js`)

位掩码定义显式追加 `>>> 0`，防止第 31 位符号位翻转陷阱；判断逻辑严格使用 `(flags & MASK) !== 0`：

```javascript
export const StatusFlags = Object.freeze({
  IS_ALIVE:             (1 << 0)  >>> 0, // 0x0001: 实体是否存活
  IS_HELD:              (1 << 1)  >>> 0, // 0x0002: 是否正被上帝之手悬空抓取 (挂起站队事务)
  IS_AIRBORNE:          (1 << 2)  >>> 0, // 0x0004: 是否正在弹射飞行中 (忽略地面摩擦)
  IS_STUNNED:           (1 << 3)  >>> 0, // 0x0008: 眩晕麻痹中 (禁止位移与攻击)
  IS_SLAVE:             (1 << 4)  >>> 0, // 0x0010: 是否为戴项圈战俘奴隶 (绝嗣角斗过滤)
  IS_LEADER:            (1 << 5)  >>> 0, // 0x0020: 是否为部族酋长/统治者 (破除 24px 金色描边)
  IS_MUTANT:            (1 << 6)  >>> 0, // 0x0040: 是否拥有突变器官 (10% 突变色着色)
  HAS_WRATH_OF_LIBERTY: (1 << 7)  >>> 0, // 0x0080: 叛乱军【自由之怒】45 秒无敌士气
  IS_LAST_STAND:        (1 << 8)  >>> 0, // 0x0100: 图腾 5 格内【破釜沉舟】绝地死战中
  IS_STATIC_ANCHOR:     (1 << 9)  >>> 0, // 0x0200: 物理绝对静态锚点 (图腾柱专用，质量无穷大)
  IS_PETRIFIED:         (1 << 10) >>> 0, // 0x0400: 魔像断能石化解耦为遗迹 (普查系统排除)
  IS_EMERGENCY_LOCK:    (1 << 11) >>> 0, // 0x0800: 应急代谢 10s 独占互斥锁生效中
  IS_AVENGED:           (1 << 12) >>> 0, // 0x1000: 已完成血亲复仇
  IS_CORPSE_DEGRADING:  (1 << 13) >>> 0, // 0x2000: 尸体残骸自然降解中
  IS_SACRED_BODY:       (1 << 14) >>> 0, // 0x4000: 反加冕金身霸体中 (免疫上帝之手抓取与伤害)
  IS_REGENT:            (1 << 15) >>> 0, // 0x8000: 摄政王身份 (幼主摄政代行王权)
  IN_COMBAT:            (1 << 16) >>> 0, // 0x10000: 交火交战状态中
  IS_PANICKED:          (1 << 17) >>> 0  // 0x20000: 士气崩溃逃窜状态中
});
```

* **原子注销铁律**：实体生命值归零判定阵亡时，当帧必须立即清除 `IS_ALIVE` 掩码。后续系统（索敌、碰撞、寻路）在单指令内通过 `statusFlags[id] & StatusFlags.IS_ALIVE` 短路跳过，彻底切断僵尸实体被鞭尸的 Bug 链条。

---

## 四、 核心系统 API 契约与方法签名手册 (API Contracts)

### 4.1 空间哈希与邻域检索 API (`src/core/SpatialHash.js` & `SpatialQuery.js`)

移除隐式全局单例，显式注入网格实例；接收容量上限并实施防溢出截断：

```javascript
export class SpatialHash {
  constructor(mapWidthPx = 1344, mapHeightPx = 864, cellSize = 48);

  /**
   * 刷新空间网格 (耗时严格 < 0.2ms，零 GC)
   * @param {Float32Array} transforms - 位置连续内存
   * @param {Uint32Array} statusFlags - 状态掩码
   * @param {Uint16Array} denseEntities - 稠密活跃实体列表
   * @param {number} activeCount - 活跃总数
   * @returns {void}
   */
  rebuild(transforms, statusFlags, denseEntities, activeCount);
}

export class SpatialQuery {
  /**
   * 零分配圆形区域范围实体检索 (纯函数，显式依赖注入)
   * @param {SpatialHash} hashInstance - 空间网格实例
   * @param {number} centerX - 查询中心 X
   * @param {number} centerY - 查询中心 Y
   * @param {number} radius - 查询半径 (px)
   * @param {Int32Array} outResults - 外部复用接收缓冲区
   * @param {number} maxCapacity - 缓冲区最大容量 (默认 512)
   * @returns {number} writtenCount - 实际写入缓冲区的实体数 (安全截断，防越界崩溃)
   */
  static queryRadius(hashInstance, centerX, centerY, radius, outResults, maxCapacity = 512);

  /**
   * 视锥矩形范围实体剔除检索
   */
  static queryRect(hashInstance, minX, minY, maxX, maxY, outResults, maxCapacity = 512);
}
```

---

### 4.2 战斗减伤与反伤熔断计算器 API (`src/warfare/DamageCalculator.js`)

彻底消灭临时对象返回（改用复用出参缓冲区），增加 `Number.isFinite` 净化防御 `NaN` 毒化，负护甲 Clamp 阻尼至 -40，分母增加 `Math.max(0.001, ...)` 防除零：

```javascript
export class DamageCalculator {
  static ARMOR_CONSTANT = 50.0;
  static MIN_ARMOR_CLAMP = -40.0;
  static MAX_REFLECT_DEPTH = 3; // TC-EDGE-01: 递归深度达 3 强制熔断

  /**
   * 边际递减护甲与反伤熔断伤害结算 (纯函数，绝对零 GC)
   * @param {number} rawDamage - 攻击原始伤害标量
   * @param {number} targetArmor - 受击者聚合有效护甲值
   * @param {number} targetResistance - 受击者属性抗性 (-0.40 ~ 0.60)
   * @param {number} reflectRatio - 受击者税后反伤系数 (0.0 ~ 0.5)
   * @param {number} currentCallDepth - 当前递归深度 (初始 0)
   * @param {Int32Array} outResultBuffer - 外部复用输出缓冲区 [actualDamage, reflectDamage, isFused]
   * @returns {void}
   */
  static calculate(rawDamage, targetArmor, targetResistance, reflectRatio, currentCallDepth, outResultBuffer) {
    // 1. 入参防御性净化 (彻底免疫 NaN 与非法类型)
    const validRawDamage = Number.isFinite(rawDamage) ? Math.max(0.0, rawDamage) : 0.0;
    if (validRawDamage === 0.0) {
      outResultBuffer[0] = 0;
      outResultBuffer[1] = 0;
      outResultBuffer[2] = 0;
      return;
    }

    const validArmor = Number.isFinite(targetArmor) ? targetArmor : 0.0;
    const validResistance = Number.isFinite(targetResistance) 
      ? Math.max(-0.40, Math.min(0.60, targetResistance)) 
      : 0.0;
    const validRatio = Number.isFinite(reflectRatio) ? Math.max(0.0, Math.min(0.50, reflectRatio)) : 0.0;
    const validDepth = Number.isSafeInteger(currentCallDepth) ? Math.max(0, currentCallDepth) : 0;

    // 2. 负护甲刚性 Clamp 与防除零奇异点
    const safeArmor = Math.max(validArmor, this.MIN_ARMOR_CLAMP);
    const denominator = Math.max(0.001, safeArmor + this.ARMOR_CONSTANT);
    const reduction = safeArmor / denominator;

    // 3. 税后真实伤害与保底 (仅当 rawDamage > 0 时保底 1 点)
    const computedDamage = validRawDamage * (1.0 - reduction) * (1.0 - validResistance);
    const actualDamage = Math.max(1, Math.floor(computedDamage));

    // 4. 反伤硬熔断 (达到 3 层强制截断)
    const isFused = validDepth >= this.MAX_REFLECT_DEPTH ? 1 : 0;
    const reflectDamage = (isFused === 0 && validRatio > 0.0) 
      ? Math.floor(actualDamage * validRatio) 
      : 0;

    outResultBuffer[0] = actualDamage;
    outResultBuffer[1] = reflectDamage;
    outResultBuffer[2] = isFused;
  }
}
```

---

### 4.3 多源反向 BFS 向量流场与避障 API (`src/pathfinding/VectorFlowFieldSystem.js`)

支持多源网格目标（图腾 2x2 占地），并在采样向量时增加到达死区检测（$<0.5$ 瓦片直接置 `[0, 0]`，消灭零向量归一化产生的 `NaN`）：

```javascript
export class VectorFlowFieldSystem {
  /**
   * 多源反向 BFS 距离场重算 (由 500ms 看门狗节流驱动，单次耗时 < 1.8ms)
   * @param {number} targetMinTileX - 目标包围盒最小 X
   * @param {number} targetMinTileY - 目标包围盒最小 Y
   * @param {number} targetMaxTileX - 目标包围盒最大 X
   * @param {number} targetMaxTileY - 目标包围盒最大 Y
   * @param {Uint8Array} costField - 瓦片阻挡阻力矩阵 (0=不可行, 1~255=移动代价)
   * @param {Float32Array} outVectorField - 预分配输出向量场 (56 * 36 * 2)
   * @returns {boolean} isReachable - 目标点是否可达
   */
  static computeMultiSourceFlowField(targetMinTileX, targetMinTileY, targetMaxTileX, targetMaxTileY, costField, outVectorField);

  /**
   * 实体每帧采样前进向量 (带死区零向量保护与切线避障)
   * @param {number} posX - 实体世界坐标 X
   * @param {number} posY - 实体世界坐标 Y
   * @param {Float32Array} vectorField - 宏观反向 BFS 向量场
   * @param {TileGrid} tileGrid - 瓦片阻挡网格
   * @param {Float32Array} outMoveVec - 接收输出向量 [vx, vy]
   * @returns {boolean} hasArrived - 是否已进入死区目标终点
   */
  static sampleMovementVector(posX, posY, vectorField, tileGrid, outMoveVec);
}
```

---

### 4.4 享元图集管理器 API (`src/rendering/MegaAtlasDollCache.js`)

彻底废除单实体绑定单槽位，升级为**享元签名哈希池 (Flyweight Stamp Pool)**，将千人外观收敛在 150 种以内，从数学上杜绝 1764 槽位溢出崩溃；槽位释放强制执行 `ctx.clearRect` 消灭 Alpha 鬼影；弃用对象返回：

```javascript
export class MegaAtlasDollCache {
  constructor(offscreenCanvas);

  /**
   * 基于 32 位视觉签名获取或申请槽位 (享元复用)
   * @param {number} stampKey - (raceId) | (paletteId<<4) | (weaponTier<<8) | (organMask<<11)
   * @returns {number} slotId - 槽位 ID (0 ~ 1763，满载返回 -1)
   */
  getOrCreateSlot(stampKey);

  /**
   * 实体注销时递减引用计数；引用归零时擦除像素并压回栈
   * @param {number} slotId
   * @returns {void}
   */
  releaseSlotRef(slotId);

  /**
   * 纯标量获取槽位 X/Y 像素偏移 (绝对零 GC 对象分配)
   */
  static getStampX(slotId) { return (slotId % 42) * 24; }
  static getStampY(slotId) { return ((slotId / 42) | 0) * 24; }
}
```

---

### 4.5 王朝更迭与天道看门狗 API (`src/politics/DynastySystem.js` & `src/god/HandOfGodSystem.js`)

将世袭继承与神之手反死锁固化为二阶段原子事务状态机：

```javascript
export class DynastySystem {
  /**
   * 老王驾崩，开启 3.0s 继承原子事务窗
   * @param {number} factionId - 阵营 ID
   * @param {number} deadKingEntityId - 驾崩君主 EntityID
   * @returns {void}
   */
  static triggerSuccession(factionId, deadKingEntityId);

  /**
   * 驱动五大意外转盘并判定王位法理继承
   * @param {number} factionId
   * @returns {number} newRulerEntityId
   */
  static resolveSuccessionWheel(factionId);
}

export class HandOfGodSystem {
  /**
   * 神之手抓取死锁看门狗 (每帧检测)
   * 若选定之储君被悬空持续超 5.0 秒，天道降下金色天雷强制震脱，赋予 1.5s 金身霸体缓降加冕
   * @param {number} heldEntityId - 当前悬空实体
   * @param {number} deltaSec - 帧间隔
   * @returns {void}
   */
  static updateHoldWatchdog(heldEntityId, deltaSec);
}
```

---

## 五、 全局领域事件枚举与载荷字典 (Domain Events Catalog)

事件底层存储于定长平铺连续内存 `Int32Array(4096 * 5)` 中，每个事件由 **5 个 32 位整型字** 构成：  
`[EventType, SourceEntityId, TargetEntityId, Param1, Param2]`。

### 5.1 双轨事件通道分类规范
1. **关键事务通道 (Critical Transaction Channel)**：最高有效位 `(EventType & 0x8000) !== 0`。容量 512，满载抛出严重断言，**100% 绝对不丢包**；
2. **瞬态表现通道 (Ephemeral Event Channel)**：最高位为 0。容量 3584，供表现层拉取，超载时自动按 FIFO 覆盖降频。

---

### 5.2 全量领域事件枚举字典 (`src/data/DomainEvents.js`)

补齐老王驾崩、和谈、复仇、神恩狂欢与奇迹反噬，降级尸体降解事件：

```javascript
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
```

---

### 5.3 富上下文定长环形快照池 (`src/narrative/ContextSlabPool.js`)

升级为 512 槽定长环形 Slab，`Param2` 采用 `(Ticket << 9) | SlotIndex` 携带世代号，彻底免疫 ABA 覆写脏读；完整承载解剖法医参数、官僚财务账目与宿怨因果溯源：

```javascript
/**
 * 定长 Slab 结构 Schema (单条定长复用，零 GC)
 */
export const ContextSlabSchema = {
  // 1. 基础元数据
  ticket: 0,                   // 世代号 (防 ABA 覆写脏读)
  timestamp: 0,
  killerEntityId: 0,
  victimEntityId: 0,
  
  // 2. 解剖法医物理参数 (供法医声道消费)
  bodyPartDamaged: 0,          // 0=颅骨, 1=股动脉, 2=肺叶, 3=几丁质腹腔, 4=高压瓦斯囊
  impactSpeedPx: 0.0,          // 相对撞击速度
  overkillDamage: 0,           // 溢出致死伤害
  fatalOrganName: '',          // 致命器官名
  
  // 3. 官僚财务与遗物账目 (供官僚审计声道与验尸小票消费)
  damagedGearValueCopper: 0,   // 损毁装备估值 (铜币)
  arrearsTaxCopper: 0,         // 生前欠税/透支军粮
  heirDebtBalanceCopper: 0,    // 遗孀需补缴差额 (生草核心)
  personalItemName: '',        // 遗物私人物品名 (如 "未寄出的求婚信")
  notaryOfficialTitle: '',     // 经手公证官戳印
  
  // 4. 宿怨与戏剧溯源 (供诗人声道与宿怨账本消费)
  grudgeOriginEventCode: 0,    // 原初结仇代码 (如 BIT_OFF_EAR / BURNT_HOME)
  grudgeYearsElapsed: 0        // 历经年数
};
```

---

### 5.4 戏剧张力评分器 (`src/narrative/DramaScore.js`)

叙事引擎严格执行高信噪比原则，防千人混战战报刷屏：

$$\text{DramaScore} = \text{OverkillRatio} \times 2.0 + (\text{IsLeader} ? 50 : 0) + (\text{IsAvenged} ? 40 : 0) + (\text{IsMisfire} ? 30 : 0)$$

* $\text{DramaScore} < 20$：普通战斗，静默存入环形缓冲区，UI 绝不弹窗打扰；
* $20 \le \text{DramaScore} < 60$：三声道战报栏单行打印（随机选择法医、诗人或审计员声道之一）；
* $\text{DramaScore} \ge 60$：触发史诗大事件！画面 1.2 秒 0.2x 慢动作，屏幕滑下《纪元公报》横幅，并允许生成 Canvas 官僚验尸小票。

---

## 六、 客户端三层数据存储与持久化规范 (Persistence & IndexedDB)

由于本作 100% 纯前端单机运行，持久化建立在原生安全容器上，严禁向不存在的远程后端发送请求。

### 6.1 StorageWorker 异步零拷贝管线

主线程严禁直接调用 `canvas.toBlob()`（避免引发 25~45ms 的 GPU 管线阻塞与 CPU 同步 Deflate 压缩）：

```
[主线程: 实体阵亡]
       │
       ▼
使用 new OffscreenCanvas(w, h) 绘制发黄带血渍验尸小票
       │
       ▼ (耗时 < 0.1ms，Transferable 零拷贝移交所有权)
postMessage({ type: 'SAVE_RECEIPT', canvas, meta }, [canvas])
       │
       ▼
[后台 StorageWorker.js]
       ├─► 离线执行 canvas.convertToBlob({ type: 'image/png' })
       └─► 打开 IndexedDB 异步执行事务写入 (主线程 60 FPS 满帧丝滑)
```

---

### 6.2 存储门面三级容灾自愈规范 (`src/persistence/StorageFacade.js`)

```
[业务保存调用]
      │
      ├─► [Tier 1: IndexedDB] (正常环境: 存储完整 PNG Blob 与宿怨长卷)
      │         │
      │         ▼ (捕获 QuotaExceededError / SecurityError 无痕模式)
      ├─► [Tier 2: localStorage] (丢弃图片 Blob，仅保留纯 JSON 结构化摘要)
      │         │
      │         ▼ (配额亦满)
      └─► [Tier 3: In-Memory Map] (运行期会话内存兜底，零抛错保活)
```

* **LRU 淘汰硬指标**：`autopsy_receipts` 仓库强制设置上限为 **60 张**。写入前审计容量，超出时原子删除最早的时间戳记录。

---

## 八、 活体文明涌现与全系统闭环技术扩展 (TDS v2.0 M5 Expansion)

### 8.1 部落连续粮仓内存池 (`GranaryBuffer`)
```javascript
// 16 阵营 * 4 步长连续平铺内存: Float32Array(64)
export const MAX_FACTIONS = 16;
export const GRANARY_STRIDE = 4;
export const GRANARY_OFFSET_FOOD = 0;      // 粮食物理库存 (0.0 ~ 500.0)
export const GRANARY_OFFSET_TIMBER = 1;    // 木料库存 (用于扩地立碑)
export const GRANARY_OFFSET_STONE = 2;     // 石料库存 (用于修缮图腾)
export const GRANARY_OFFSET_CAPACITY = 3;  // 仓储上限 (默认 200.0，升级可扩充)
```

### 8.2 动态领地侵染与活力矩阵 (`DynamicTerritorySystem`)
* **瓦片所属权矩阵**：`Uint8Array(2016)` (56 列 x 36 行)，值为 0 (中立荒原) 或 1~12 (阵营 ID)；
* **瓦片活力矩阵**：`Float32Array(2016)`，每个瓦片维护活力值 (0.0 ~ 100.0)。
* **伸缩与阻尼**：
  - 人口充足、工匠活跃时向外侵染扩张 ($R_{\max} = 10$)；
  - 战乱饥荒断粮时，活力每秒衰减 2.0 点，跌至 0 剥离所属权（退耕还林）；
  - 全图常驻看门狗确保全大陆至少保留 **35% 无主野区**。

### 8.3 四大阶级行为机决策管线 (`CasteBehaviorSystem`)
* **平民**：求生(吃粮) $\rightarrow$ 采收(赴农田) $\rightarrow$ 运粮(回图腾粮仓+10) $\rightarrow$ 逃跑(遇敌后撤)；
* **工匠**：农田开垦(寻适耕地) $\rightarrow$ 边界立碑(扩充领地) $\rightarrow$ 图腾修缮(战损维护)；
* **士兵**：领地巡防(界碑环巡) $\rightarrow$ 敌军驱逐(拔刀拦截) $\rightarrow$ 战时攻城(沿流场总攻)；
* **首领**：坐镇中枢 $\rightarrow$ 战意光环(96px +15%移速/+20%攻击) $\rightarrow$ 死战不退。

### 8.4 活体繁衍与世代突变演进管线 (`LiveReproductionSystem`)
* 粮仓粮食 $\ge 40.0$ 时触发成年市民繁衍，消耗 20.0 粮食在图腾旁诞生新生小人；
* 实时调用 `MendelianGeneticsSystem.breedOffspring` 与 `TabooFilter`，双亲突变显隐性等位基因依孟德尔定律重组，突变表型在子代实时呈现。

### 8.5 空间实时交火管线 (`SpatialCombatSystem`)
* 结合 `SpatialHash` 32px 索敌，士兵遇敌自动靠近进入挥刀距离；
* 调用 `DamageCalculator.applyDamage` 执行边际减伤、真实反伤与种族特技轰击；
* 越界砍杀推升 `BorderFrictionSystem`，摩擦满 70 触发全面宣战。

---
**全套技术蓝图正式升级至 TDS v2.0 活体文明涌现版！**

**全套技术蓝图自即日起正式封版，研发团队遵照本说明书推进 Milestone 0 代码实装！**
