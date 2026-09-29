# 《Milestone 5 文明建立、动态领地与全系统有机涌现：系统技术详细设计与数据契约说明书》

> **文档代号**：SPEC-M5-CONTRACT-v1.0  
> **制定基线**：Master GDD v2.2, SRS v1.1, TDS v1.1, WBS v1.1, RTM v4.0, 研发管理宪法 v1.0, 策划专册 01~09, 经验教训登记册 (LL-001 ~ LL-007)  
> **文档性质**：Milestone 5 玩法与文明生态全链路有机串联阶段所有子 Agent (`coder_systems`, `coder_rendering`, `qa_guardian`) 的**唯一硬性执行技术契约**。  
> **研发纪律与宪法**：
> 1. 母 Agent 严格恪守 PM 调度职责，绝对禁止私自编辑生产源码；
> 2. 所有代码变更贯彻代码所有权责任制，由领域系统/视窗前端工程闭环交付；
> 3. 热路径物理/逻辑循环绝对**零 GC**（每帧 0 临时对象/数组/闭包创建）；
> 4. 彻底消灭“系统孤岛”与“两张皮”，让领地、职业、农田、代谢、繁殖、战斗、流场真正咬合；
> 5. 主渲染循环热路径内部**绝对 0 次调用 `ctx.save()` / `ctx.restore()`**，稳锁 60 FPS。

---

## 目录

1. [变更背景与核心目标 (Problem Statement & Scope)](#一-变更背景与核心目标)
2. [文明建立与生态自适应定居契约 (`BiomeAffinitySettlementSystem.js`)](#二-文明建立与生态自适应定居契约)
3. [领地动态潮汐扩张与退耕还林契约 (`DynamicTerritorySystem.js`)](#三-领地动态潮汐扩张与退耕还林契约)
4. [四大阶级自驱行为机与部落粮仓闭环契约 (`CasteBehaviorSystem.js` & `GranaryBuffer`)](#四-四大阶级自驱行为机与部落粮仓闭环契约)
5. [活体繁衍与世代孟德尔突变演化契约 (`LiveReproductionSystem.js`)](#五-活体繁衍与世代孟德尔突变演化契约)
6. [空间实时索敌、交火与战争级联契约 (`SpatialCombatSystem.js`)](#六-空间实时索敌交火与战争级联契约)
7. [程序化沙盒重玩性与首领性格契约 (`SandboxScenarioManager.js`)](#七-程序化沙盒重玩性与首领性格契约)
8. [WBS 任务包拆分与责任矩阵 (WP-5.1 ~ WP-5.6)](#八-wbs-任务包拆分与责任矩阵)
9. [DoD 交付与致命守门断言契约 (`TC-EDGE-10`, `TC-EDGE-11`)](#九-dod-交付与致命守门断言契约)

---

## 一、 变更背景与核心目标

### 1.1 现状痛点诊断 (Siloed System Crisis)
当前 M0~M4 虽然底层算法和单测全部 100% 通过，但在最终视窗与可玩性呈现上存在四大致命脱节：
1. **国土僵死**：开局写死 4x3 网格涂色 12 个固定圆圈，国土终身不扩张、不收缩、不被占领；
2. **职业架空**：平民不运粮、工匠不建田拓地、士兵不巡防打仗，职业系统只是无意义的 Enum 标签；
3. **繁殖缺失**：遗传系统仅在开局调用一次，世界内没有活体繁衍，突变器官无法世代涌现；
4. **交火断路**：`DamageCalculator` 和 `SpatialHash` 虽有完整代码但物理帧未接入，小人两两穿透，战争永远打不起来；
5. **重玩性归零**：每一局都是固定种子 42、固定位置、固定 12 族。

### 1.2 M5 终极目标 (The Living Terrarium)
将所有散落孤岛串联为自洽的活体文明：**开局自选群系营火定居 $\rightarrow$ 平民耕作捕猎入仓 $\rightarrow$ 粮足繁衍新生儿遗传突变 $\rightarrow$ 工匠立界碑扩张领地 $\rightarrow$ 国界接壤摩擦械斗 $\rightarrow$ 战角长鸣军团冲锋攻城 $\rightarrow$ 战败割地与退耕还林**。

---

## 二、 文明建立与生态自适应定居契约 (`src/world/BiomeAffinitySettlementSystem.js`)

### 2.1 种族与群系宜居度矩阵 (Biome Affinity Matrix)
12 始祖种族依据策划案专册 01/02 具备天然的栖息地亲和力，彻底摒弃均匀机械 4x3 平铺：
* **矮人 (DWARF)**：高山岩山 (Mountain/Rock) 宜居度 100%，挖矿产石加成 50%；
* **精灵 (ELF)**：远古森海 (Forest) 宜居度 100%，森林移速+30%；
* **兽人 (ORC) / 兽化人 (BEAST)**：荒原裂谷 (Badlands/Plains)，近战攻击+20%；
* **亡灵 (UNDEAD)**：遗忘墓园 (Graveyard)，在受诅咒土上免饥饿；
* **蜥蜴人 (LIZARD) / 孢子真菌 (SPORE)**：恶臭泥沼 (Swamp)，水体沼泽不减速；
* **恶魔 (DEMON) / 地精 (GOBLIN)**：地心裂隙与硫磺焦土 (Lava/Volcano)；
* **人类 (HUMAN) / 畸变 (ABERR)**：中央生命泉谷与温带平原。

### 2.2 营火奠基与自发开拓
* 开局不在虚空刷全城，而是选址产生 **先祖营火 (Founding Campfire / Tribal Totem)**；
* 初始仅生成 1 名酋长 (Leader)、1 名工匠 (Artisan)、4 名开拓平民 (Civilian)；
* 初始法理领地仅以营火为中心半径 $R=2$ 圈。

---

## 三、 领地动态潮汐扩张与退耕还林契约 (`src/territory/DynamicTerritorySystem.js`)

### 3.1 领地瓦片状态与归属步长
* 维护全图 2,016 (56x36) 瓦片的连续所属权矩阵 `Uint8Array(2016)` 与领地活力矩阵 `Float32Array(2016)`；
* **领地扩张公式**：
  * 当部落人口健康、工匠在边境巡查时，消耗木石在边界外沿涂色扩展，领地向外生展；
  * 最大领地半径 $R_{\max} = \min(10, 2 + \lfloor \text{Pop} / 3 \rfloor)$。

### 3.2 弹簧阻尼收缩与退耕还林 (01 专册 §4.2)
* 每块领地瓦片每秒消耗微量维护活力；
* 当部落断粮、人口凋零时，外围活力归零，瓦片自动剥离所属权，**退耕还林变回中立无主野生荒原**；
* **系统硬性红线**：全图恒久保留 $\ge 35\%$ 的中立野区与河流，杜绝全图空间窒息死锁。

### 3.3 战争推线吞并 (War Annexation)
* 处于战争状态的两国，士兵踩上敌方边境瓦片并停留超 2.0s，直接翻转该瓦片所属权，将战线向敌军腹地推移！

---

## 四、 四大阶级自驱行为机与部落粮仓闭环契约 (`src/profession/CasteBehaviorSystem.js`)

### 4.1 部落连续平铺粮仓 (`GranaryBuffer`)
```javascript
// 连续平铺 Float32Array(16 * 4): 16 阵营 * [FOOD, TIMBER, STONE, CAPACITY]
export const GRANARY_STRIDE = 4;
export const GRANARY_OFFSET_FOOD = 0;
export const GRANARY_OFFSET_TIMBER = 1;
export const GRANARY_OFFSET_STONE = 2;
export const GRANARY_OFFSET_CAPACITY = 3;
```

### 4.2 四大阶级核心行为 FSM (零 GC 驱动)
1. **平民 (CIVILIAN)**：
   - **日常求生**：若自身饥饿 $> 30$，优先在领地内吃粮仓口粮；
   - **劳作采收**：走向 2x2 农田或野生果丛，成熟时采收粮食，运回部落图腾粮仓（每次入仓 +10.0 食物），并获得 `casteSys.recordLabor(eid, 1.0)`；
   - **逃跑机制**：遭遇敌兵追击时，惊慌向图腾或防卫军后撤。
2. **工匠 (ARTISAN)**：
   - **农田拓荒**：当领地人口密度高且食物不足时，寻找肥力 $\ge 0.4$ 的平地开辟新 $2 \times 2$ 农田；
   - **边境立碑**：将木石运往边境，竖立图腾木桩将领地向外撑大；
   - **图腾修缮**：战损图腾血量 $< 100\%$ 时，消耗石料驻留修补。
3. **士兵 (SOLDIER)**：
   - **和平巡逻**：在领地最外沿（界碑周围 80~120px）进行环形警戒巡逻；
   - **驱逐入侵**：发现异族越界，上前拦截拔刀，推动 `borderFrictionSys.addFriction`；
   - **战时总攻**：宣战后沿 `flowFieldSys` 结集军团，直扑敌国前线或图腾！
4. **领袖 (LEADER)**：
   - **统御光环**：为周围 96px 内同族士兵赋予移速+15%、伤害+20% 战意光环；
   - **坐镇图腾**：图腾安全时驻留中枢，图腾被围攻时死战不退！

---

## 五、 活体繁衍与世代孟德尔突变演化契约 (`src/mutation/LiveReproductionSystem.js`)

### 5.1 繁衍触发门槛 (Zero-GC Reproduction Engine)
* **人口容量限制**：每个部族最大人口上限由图腾等级与粮仓容量决定（默认 25 人/族）；
* **繁殖物资条件**：部族粮仓食物储备 $\ge 40.0$ 点；
* **亲本匹配**：从领地内成熟活跃活体平民中按距离匹配成年男女亲本；
* **繁衍动作**：扣除粮仓 20.0 食物，在图腾或住宅旁诞生一名新生幼年小人！

### 5.2 世代遗传与突变涌现
* **显性/隐性基因重组**：调用 `geneticsSys.breedOffspring(parentA, parentB, childEid)`，将母系父系突变等位基因依孟德尔定律重组分配给子代；
* **变异禁忌过滤**：执行 `TabooFilter` 确保不会产生穿透性违规器官；
* **肉眼可见表型演进**：子代诞生时立即具备突变器官视觉外观（烈焰纹、岩石斑块、飞翼、圣环），随游戏时间推进，玩家在生态箱中能清晰目睹“一个原本普通的野人部落，历经十代繁衍，全族进化为带翅膀与烈焰器官的圣火神族”！

---

## 六、 空间实时索敌、交火与战争级联契约 (`src/warfare/SpatialCombatSystem.js`)

### 6.1 空间哈希索敌流水线
* 每 3~4 物理帧利用 `SpatialHash` 配合 `SpatialQuery.queryRadius(hash, x, y, 32.0, outBuffer)` 执行近距离敌军探测；
* 发现敌对阵营实体，依据阶级进入交战态：
  - 士兵立即执行拦截位移并拔刀；
  - 调用 `DamageCalculator.applyDamage(attacker, victim, atkPower, dmgType, 0, now)`；
  - 检查冷却执行 `RaceSkillSystem.triggerSkill(attacker)` 激发种族特技；
  - 触发受击闪红、击退物理冲量、播放 `synth.playHit()` 音效。

### 6.2 边境摩擦自然升级与战火蔓延
* 偷麦打砸抢：摩擦 +10；
* 边境械斗受伤：摩擦 +15；
* 将领阵亡：摩擦 +45；
* **宣战门槛**：摩擦 $\ge 70$ 或图腾受袭，触发 `EVT_WAR_DECLARED`，吹响 `synth.playWarHorn()`；
* **全军动员**：`WarWatchdogSystem` 启动，士兵阶级全员集结，平民撤回二线避难。

---

## 七、 程序化沙盒重玩性与首领性格契约 (`src/world/SandboxScenarioManager.js`)

### 7.1 三大多模态沙盒开局玩法
1. **模式 1：万族大争霸 (The Great Hegemony)**：
   - 12 始祖部族在适合各自的自然群系各自建寨，从零演进，角逐全图霸权；
2. **模式 2：双雄/四国鼎立宿命战 (Epic Clash)**：
   - 随机抽取 3~4 个强力部族，广袤的中间区域全为中立野生动植物群落与神圣生命泉谷，空间辽阔，战争史诗感极强；
3. **模式 3：白手起家单族起源 (Genesis Isolation)**：
   - 玩家选定一个种族降生荒岛，观察其从 5 个人逐渐开拓农田、繁衍百人帝国，最终因权力斗争和领地过大裂变出反叛军（`SchismSystem`）的大历史史诗！

### 7.2 首领性格随机标签 (Leader Personality Trait)
每个部族首领在加冕时随机获得 1 种性格：
* **好战狂徒 (Warlord)**：领地扩张欲望极强，宣战摩擦阈值降为 45，士兵攻击+25%；
* **神圣先知 (Prophet)**：专注祈祷与神恩积累，领民虔诚度双倍，极易唤醒神恩狂欢；
* **农耕长者 (Elder Harvester)**：专注开荒农田，平民产粮+40%，极度爱好和平；
* **残暴暴君 (Tyrant)**：动员士兵比例高达 60%，粮食不足时强行掠夺奴役邻族。

---

## 八、 WBS 任务包拆分与责任矩阵 (WP-5.1 ~ WP-5.6)

| 任务包编号 | 任务包名称 | 负责 Agent | 交付物理文件 | 核心契约与红线 |
| :--- | :--- | :--- | :--- | :--- |
| **`WP-5.1`** | 部落粮仓、四大阶级自驱行为机与闭环巡逻 | `coder_systems` | `src/profession/CasteBehaviorSystem.js`<br/>`tests/profession/CasteBehaviorSystem.test.js` | 零 GC 行为树 FSM；平民采收运粮入仓，士兵巡防边境 |
| **`WP-5.2`** | 领地动态潮汐推移、吞并与弹簧退耕还林 | `coder_systems` | `src/territory/DynamicTerritorySystem.js`<br/>`tests/territory/DynamicTerritorySystem.test.js` | 瓦片所属权动态侵染；国土随人口伸缩；保留 $\ge 35\%$ 中立野区 |
| **`WP-5.3`** | 活体繁衍引擎与世代孟德尔突变涌现系统 | `coder_systems` | `src/mutation/LiveReproductionSystem.js`<br/>`tests/mutation/LiveReproductionSystem.test.js` | 粮足繁衍新生儿；显隐性双亲遗传与突变器官世代累积 |
| **`WP-5.4`** | 空间实时交火系统与边境摩擦级联推进 | `coder_systems` | `src/warfare/SpatialCombatSystem.js`<br/>`tests/warfare/SpatialCombatSystem.test.js` | `SpatialHash` 索敌；调用 `DamageCalculator`；掉血反伤死伤战报 |
| **`WP-5.5`** | 多模态程序化沙盒重玩器与首领性格系统 | `coder_systems` | `src/world/SandboxScenarioManager.js`<br/>`src/world/BiomeAffinitySettlementSystem.js`<br/>`tests/world/SandboxScenarioManager.test.js` | 随机种子与群系定居；支持万族/四国/起源 3 种开局模式 |
| **`WP-5.6`** | 端到端全真视窗重装、HUD排行榜与生草动效 | `coder_rendering` | `index.html`<br/>`src/rendering/MiniRenderer.js`<br/>`tests/rendering/MiniRenderer.test.js` | 原生接入全量新系统；运粮背包/刀光打击特效；阵营排行榜 |

---

## 九、 DoD 交付与致命守门断言契约 (`TC-EDGE-10`, `TC-EDGE-11`)

### 9.1 新增守门套件 1: `TC-EDGE-10.test.js` (文明生命周期与动态领地守门断言)
1. **国土动态伸缩断言**：在 0 粮食供应极限压力下，领地外围瓦片在 30 秒内退耕还林剥离率 100%，无地块所属权死锁；
2. **粮仓守恒与繁衍断言**：平民采收运粮数量与粮仓累加严格匹配，无粮食凭空创造或丢失；消耗粮食繁衍的后代基因型 100% 符合孟德尔分离规律。

### 9.2 新增守门套件 2: `TC-EDGE-11.test.js` (自发摩擦交火与战争军团推演守门断言)
1. **自发械斗与宣战断言**：两族边境接壤后，无需任何人工脚本注入，小人跨界巡逻在 60 秒内自然产生 $\ge 1$ 次肢体冲突，摩擦值单调上升；
2. **千人连续交战零内存逃逸断言**：1,000 实体全要素多部族连续模拟 5,000 物理帧，0 崩溃，0 浮点 NaN，$\Delta\text{Heap} < 500\text{KB}$。

---
**契约发布签署**：主控总指挥 (Lead Orchestrator / PM)  
**签署日期**：2026-09-29  
