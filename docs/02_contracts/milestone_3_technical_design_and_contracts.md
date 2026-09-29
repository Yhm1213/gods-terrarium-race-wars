# 《Milestone 3 领地战线推移、大军团战争与王朝政治裂变系统：系统技术详细设计与数据契约说明书》

> **文档代号**：SPEC-M3-CONTRACT-v1.0  
> **制定基线**：Master GDD v2.2, SRS v1.1, TDS v1.1, WBS v1.1, RTM v2.0, 研发管理宪法 v1.0, 策划专册 05/06, 经验教训登记册 (LL-001 ~ LL-007)  
> **文档性质**：Milestone 3 阶段所有子 Agent (`coder-systems`, `coder-rendering`, `qa-guardian`, `reviewer-architect`) 的**唯一硬性执行技术契约**。  
> **研发纪律**：
> 1. 母 Agent 严格恪守 PM 调度职责，绝对禁止私自编辑生产源码；
> 2. 所有代码变更贯彻代码所有权责任制，缺陷整改工单定向打回原作者；
> 3. 热路径物理/逻辑循环绝对**零 GC**（每帧 0 临时对象/数组/闭包创建）；
> 4. 视窗展现层拒绝假 Mock“两张皮”，必须原生 ESM 消费全部真实系统构件。

---

## 目录与必读参考文档清单 (Mandatory Reference Docs)

开发、渲染、测试与审查子 Agent 在动工或校验前，**必须查阅以下文档的对应章节**：
1. `docs/01_design/design_books/`：
   - `05_territory_and_warfare.md`：§一 边际递减护甲公式、§二 远征疲劳光环与图腾 25% 圣盾波、§三 四级士气状态机与图腾 5 格破釜沉舟、§四 边境摩擦三阶梯推进
   - `06_post_war_and_internal_politics.md`：§一 双轨治理树与四大市政、§二 统治者个性与政治张力模型、§三 Voronoi 聚落双核切分与自由之怒、§3.4 世袭五大驾崩大转盘与基因防伪、§四 战后处置五重收束与流寇生态位、§五 四大超级奇观反噬
2. `docs/01_design/system_requirements_specification.md`：
   - §7 领地扩张、战线推移与军团战争需求矩阵 (`REQ-WAR-001` ~ `REQ-WAR-005`, `REQ-ENG-005`)
   - §8 国家治理、市政路线与政治裂变需求矩阵 (`REQ-POL-001` ~ `REQ-POL-008`)
   - §12 底层致命守门断言 (`TC-EDGE-01`, `TC-EDGE-04`, `TC-EDGE-05`, `TC-EDGE-06`, `TC-EDGE-07`)
3. `docs/01_design/technical_design_specification.md`：
   - §2.4 四大超级奇迹兵器与反噬物理参数表 (`SuperWeaponData.js`)
   - §2.5 宏观政权数据与张力容器规格 (`FactionData.js`)
   - §4.3 反向 BFS 流场寻路与切线避障 API 签名手册
   - §5.2 全局领域事件枚举字典 (`DomainEvents.js`)
4. `docs/00_governance/lessons_learned_register.md`：
   - 严格对照 **LL-001 ~ LL-007** 纠正与预防措施 (CAPA)，执行前置闭环检查。

---

## 一、 领地网络、边境摩擦与大军团战争契约 (`src/warfare/`)

### 1.1 领地瓦片权属容器与边界摩擦检测
* **数据结构**：在 `TileGrid.js` 中平铺连续维护领地权属数组：
  ```javascript
  this.territoryFaction = new Uint8Array(2016); // 瓦片领地所有权归属阵营 ID [0 ~ 16], 0=中立荒漠 (2,016 B)
  ```
* **宏观阵营数据容器 (`src/data/FactionData.js`)**：
  采用平铺连续类型化数组 `FactionRuntimeBuffer`，容量锁死为 `MAX_FACTIONS = 16`，步长 `FACTION_STRIDE = 8`：
  ```javascript
  // [TotemEntityId, CivicRouteId, Tension(0~100), PopCount, FoodStock, OreStock, WarCooldown, Flags]
  export const FAC_OFFSET_TOTEM_ID = 0;       // 图腾实体 ID
  export const FAC_OFFSET_CIVIC_ID = 1;       // 当前市政路线 ID (0=世袭, 1=军阀, 2=共和, 3=神权)
  export const FAC_OFFSET_TENSION = 2;        // 政治张力 (0.0 ~ 100.0, 达到 100 爆发大分裂)
  export const FAC_OFFSET_POP_COUNT = 3;      // 存活人口总数
  export const FAC_OFFSET_FOOD = 4;           // 粮仓储备量
  export const FAC_OFFSET_ORE = 5;            // 矿石建材储备
  export const FAC_OFFSET_WAR_COOLDOWN = 6;   // 停战/国家凝聚 300s 保护期倒计时
  export const FAC_OFFSET_FLAGS = 7;          // 阵营状态标志位 (0x01: IS_DESTROYED, 0x02: IS_AT_WAR, 0x04: IS_SCHISMED)
  ```

### 1.2 边境摩擦三阶梯状态机 (`src/warfare/BorderFrictionSystem.js`)
国与国冲突严格遵守微观至宏观的三阶梯推进逻辑，杜绝无预警突然全面爆发战争：
```text
[阶段 0: 中立相安无事 (Neutral)] -> 双方领地未接壤或仇怨值 = 0
       │ 领地接壤 / 争夺猎物 / 偷粮打砸抢
       ▼
[阶段 1: 微观私怨与打砸抢 (Friction: 1 ~ 29)] -> 小人单挑斗殴，败者带伤逃窜，累积摩擦仇隙值
       │ 仇怨值累积突破 30 / 边境筑墙推搡互掷石块
       ▼
[阶段 2: 边境哨戒与小队械斗 (Skirmish: 30 ~ 69)] -> 设立边防哨所，民兵前线对峙，越境即遭受箭矢齐射警告
       │ 仇怨值蓄满 70 / 图腾受袭 / 暴君单方面撕毁条约
       ▼
[阶段 3: 战争长鸣与军团总攻 (Total War: >= 70)] -> 战钟长鸣，大军集结，激活向量流场向敌方图腾发起总攻！
```
* **摩擦增量触发源**：
  - 偷粮/抢夺猎物：向两阵营摩擦仇隙池注入 $+10$ 张力；
  - 边境施工互殴致伤：注入 $+15$ 张力；
  - 皇子/将领被杀：瞬间注入 $+45$ 张力并直接跃迁至阶段 3。
* **外交连带宣战**：A 宣战 B，与 A 缔结血誓同盟的盟友 C 自动将 B 列入敌对列表，终止双边贸易。

### 1.3 远征后勤疲劳光环与图腾 25% 圣盾波 (`src/warfare/TotemDefenseSystem.js`)
* **远征后勤疲劳惩罚 (Supply Line Attrition)**：
  - 侵略方作战单位深入敌境时，每脱离自身母国图腾辐射圈外 $3$ 个瓦片，累加 1 层【远征疲劳】Buff（上限 5 层）：
    $$\text{SpeedMod} = 1.0 - 0.04 \times \text{layers} \quad (\text{最大 } -20\%)$$
    $$\text{DamageMod} = 1.0 - 0.05 \times \text{layers} \quad (\text{最大 } -25\%)$$
    $$\text{StunResistMod} = 1.0 - 0.08 \times \text{layers}$$
  - 有效压制优势方“一鼓作气横穿地图连灭三族”的滚雪球灾难。
* **图腾 25% 濒危【圣火涅槃冲击波 (Totem Aegis Protocol)】**：
  - 当任何阵营图腾当前生命值**首次跌破 $25\%$** 时，瞬间触发一次造物主保底机制：
    1. 以图腾为中心，向半径 $6$ 瓦片范围释放冲击波，将范围内全部敌军强力弹飞并施加 $2.5\text{s}$ 眩晕（`IS_STUNNED`）；
    2. 图腾生成一层持续 $12.0\text{s}$ 的金色绝对无敌圣盾（`IS_SACRED_BODY`）；
    3. 单次战争每个图腾严格仅可触发 **1 次**（记录于 `totemTriggeredFlags`）。

### 1.4 四级士气动态状态机与图腾 5 格破釜沉舟 (`src/warfare/MoraleSystem.js`)
基于 `MoraleComponent` 平铺内存 `Float32Array(4097 * 2)` (`MORALE_OFFSET_VAL`, `MORALE_OFFSET_TIMER`)：
```text
[状态 1: 稳固 (Solid: 100 ~ 60)] -> 保持正规战斗阵型，步兵推进，弓手掩护
       │ 密集伤亡
       ▼
[状态 2: 动摇 (Wavering: 59 ~ 30)] -> 攻击攻速 -15%，采取防御后撤步，退向掩体
       │ 阵线被敌军撕穿
       ▼
[状态 3: 惊恐后撤 (Disorganized: 29 ~ 1)] -> 举盾后退；
       │ ★ 退至母国图腾 5 格内触发【破釜沉舟 (Last Stand)】: 士气锁死在 1 点，移速+20%，死战不退！
       ▼
[状态 4: 溃不成军 (Routed: 0)] -> 丢弃重武器，全速逃窜；被包围无路可走时转为跪地投降
```
* **平滑扣除规则**：
  - 目睹 4 格以内友军阵亡：$d \le 2$ 扣除 3 点，$2 < d \le 4$ 扣除 1 点；
  - **3 秒滑动时间窗封顶**：单个实体在 3 秒内因目睹友军阵亡最多扣除 **$15$ 点士气**，彻底消除被一记 AOE 秒杀全军集体瞬崩的 Bug；
  - 首领阵亡扣除 $25$ 点士气；若阵中有军官立即接任加冕，瞬间回补 $+15$ 点稳定军心。

---

## 二、 战斗伤害计算、反伤熔断与交火超时看门狗契约 (`src/warfare/`)

### 2.1 边际递减护甲公式与 -40.0 负护甲死锁阻尼 (`src/warfare/DamageCalculator.js`)
彻底废除恶性叠加导致的物理绝对免伤漏洞，统一推行非线性渐近收敛公式：
$$\text{DamageReduction} = \frac{\text{Armor}}{\text{Armor} + 100.0} \quad (\text{当 } \text{Armor} \ge 0)$$
$$\text{DamageTaken} = \max\left(1.0, \text{RawDamage} \times (1.0 - \text{DamageReduction}) \times (1.0 - \text{ResistMod})\right)$$
* **数值基准**：
  - 护甲 $50 \rightarrow$ 减伤 $33.3\%$；护甲 $100 \rightarrow$ 减伤 $50.0\%$；极限堆叠护甲 $300 \rightarrow$ 减伤 $75.0\%$（极限渐近线为 100%，永不达到绝对免伤）；
  - 保底穿透伤害为 **$1.0$ 点**。
* **负护甲阻尼与除零防御**：
  - 极端破甲条件下，护甲下限严格死锁：
    $$\text{EffectiveArmor} = \max(-40.0, \text{Armor})$$
    彻底消除分母等于 0（如 $-50$ 或 $-100$）导致的 `NaN` / `Infinity` 崩溃灾难！
  - 当 $-40.0 \le \text{Armor} < 0$ 时：
    $$\text{DamageAmp} = 1.0 + \frac{|\text{Armor}|}{100.0} \quad (\text{最大伤害增幅 } +40\%)$$

### 2.2 反伤深度递归熔断与 1.5s ICD (TC-EDGE-01)
* **税后真实反伤铁律**：
  $$\text{ReflectDamage} = \text{ActualHpLost} \times \text{ReflectRatio}$$
  严禁基于免伤前的原始伤害进行反弹；
* **递归深度熔断 (Recursion Failsafe)**：
  - 方法形参显式携带当前调用深度：`calculateDamage(attackerId, victimId, rawDmg, dmgType, callDepth = 0)`；
  - 当两单位均具备反伤特性互相反弹时，**当 `callDepth >= 3` 时强制熔断反伤输出**（`outReflectDamage = 0`），彻底阻断调用栈溢出（Call Stack Overflow）；
* **全局内置冷却 (ICD $\ge 1.5\text{s}$)**：受击反伤触发后，写入实体 `CombatStatsComponent` 上次反伤时间戳，1.5 秒内不再响应反击判定。

### 2.3 300s 战争交火超时双门限防伪看门狗契约 (TC-EDGE-04) (`src/warfare/WarWatchdogSystem.js`)
为彻底解决两军残兵在角落互殴或心跳刷血无限保活导致的游戏死锁，建立双门限看门狗：
* **门限 1：60 秒无有效战果战意消磨**：
  - 连续 60 秒内，双方阵营没有核心作战单位阵亡、且图腾耐久无实质扣减（排除微量回血与击杀中立小动物的伪保活）；
  - 激活战意消磨惩罚：交火双方全体士兵士气每秒强制扣除 **$5.0$ 点**，直至进入溃逃或跪降；
* **门限 2：300 秒（5 分钟）战争绝对硬熔断**：
  - 战争持续时间达到 $300.0\text{s}$，无论战况如何激烈，系统强制宣布休战；
  - 派发关键事务领域事件 `EVT_PAX_DIVINA_FORCED` (0x8005)；
  - 清除交火状态 `IN_COMBAT`，双方施加 **$120.0\text{s}$ 绝对和平锁**；
  - **停战离心退避 (Centrifugal Retreat)**：休战瞬间若双方单位碰撞体积重叠，沿离心方向平移退回各自原始国界，彻底根除“休战 1 帧 $\leftrightarrow$ 宣战 1 帧”的抽搐死循环！

---

## 三、 大军团反向 BFS 向量流场与微观切线避障契约 (`src/pathfinding/`)

### 3.1 反向 BFS 距离场与无分配梯度积分 (`src/pathfinding/VectorFlowFieldSystem.js`)
针对千人同屏大军团寻路，废除单兵 A* 路径检索，推行全局向量流场（Vector Flow Field）：
* **网格规格**：与 $56 \times 36$ 瓦片网格 $1:1$ 拓扑映射（总格子数 2016）；
* **平铺连续内存**：
  ```javascript
  this.distanceField = new Uint16Array(2016);   // 到目标的离散曼哈顿/对角距离 (0 ~ 65535)
  this.vectorFieldX = new Float32Array(2016);   // X 轴归一化引导向量 [-1.0, 1.0]
  this.vectorFieldY = new Float32Array(2016);   // Y 轴归一化引导向量 [-1.0, 1.0]
  ```
* **反向 BFS 积分算法**：
  - 以目标图腾或集结点瓦片为起点（距离为 0），向外以 8 向队列波前扩散；
  - 瓦片通行成本根据 `TileGrid.moveCost[idx]` 权重加权；不可通行瓦片（深水、山岳、石墙）距离设为 65535；
  - 距离场生成后，每个瓦片的流向向量直接由 8 个邻居的距离差梯度计算得出：
    $$V_x = \frac{D_{x-1, y} - D_{x+1, y}}{2.0}, \quad V_y = \frac{D_{x, y-1} - D_{x, y+1}}{2.0}$$
    并执行归一化向量化，**单次全图积分耗时严格 $< 1.8\text{ms}$，每帧采样 0 内存分配**。

### 3.2 宏观 500ms 缓存与微观 2 格切线避障 (`src/pathfinding/LocalTangentSteering.js`)
彻底解决“流场更新滞后导致士兵直挺挺撞进火海或临时坍塌石墙”的致命缺陷：
* **双轨驱动架构**：
  1. **宏观流场轨**：按 $500\text{ms}$ 节流周期刷新全局静态流场；
  2. **微观避障轨 (Local Tangent Steering)**：
     - 单兵在前向探测射线（前方 2 瓦片，约 48px）检测到动态危险（燃烧瓦片、剧毒沼泽、临时工事、巨型障碍物）；
     - 此时不触发昂贵的全局流场重算，而是在微观层临时将速度向量旋转 $90^\circ$（正切向量）：
       $$\vec{V}_{\text{steer}} = \vec{V}_{\text{flow}} + \vec{N}_{\text{tangent}} \times w_{\text{avoid}}$$
     - 顺着障碍物边缘平滑绕行，通过后重新顺应宏观流场。

### 3.3 密度自适应解拥堵分离力
针对狭窄隘口百人挤压瘫痪互咬问题：
* 在实体移动积分器中引入密度阻尼分离力：
  $$\alpha_{\text{sep}} = \max\left(0.05, 0.30 - 0.05 \times \text{LocalDensity}\right)$$
* 当局部单位密度过高时，平滑弱化横向推挤排斥力，优先沿流场前向推移，消灭千人卡死死锁。

---

## 四、 国家治理、政治张力与 Voronoi 双核大分裂契约 (`src/politics/`)

### 4.1 双轨实用科技与超级奇观反噬参数 (`src/data/SuperWeaponData.js` & `TechCivicData.js`)
* **科技三阶梯**：
  - 阶梯 I (初民工具)：收割加速 50%、捕猎捕获率提升、掠夺抢粮速度翻倍；
  - 阶梯 II (城邦基建)：士兵前排盾墙减伤+15%、粮仓上限翻倍并防火、神恩速度+60%；
  - 阶梯 III (超级奇迹工程)：解锁各种族战略奇观兵器。
* **四大超级奇观兵器反噬参数表**：
  1. **矮人【地鸣破城轨道巨炮】**：最大射程 14 瓦片，破障真伤 280 点；**10% 几率炸膛**熏黑周围矮人并眩晕 5.0s，炮体自损 80 HP；
  2. **地精【神风自爆动力飞艇】**：飞行高度 Level 3，无视地面地形，爆炸半径 3 格造成 220 点范围火伤；**25% 几率升空失衡在自家广场殉爆**；
  3. **绿皮【生化憎恶比蒙巨兽】**：占地 $2\times2$ 瓦片，1200 HP，质量 550kg，横扫击退；**每日需投喂 5 份肉食**，断粮立即发狂践踏自家族人与帐篷 15.0s；
  4. **森灵【远古战争树精古卫】**：占地 $2\times2$ 瓦片，950 HP，缠绕减速 60%；**极度怕火**，一旦着火触发狂乱四处践踏 8.0s。

### 4.2 四大市政路线与微观普查张力累加公式 (`src/politics/ClanCensusSystem.js`)
* **四大市政路线**：
  - `0`: 👑 **血统世袭皇权** (Hereditary Dynasty) —— 阶层稳定，平民抗动乱+40%；伴随夺嫡随机大转盘；
  - `1`: ⚔️ **军阀强权独裁** (Military Autocracy) —— 士兵攻击+25%，溃退阈值降至 15；首领衰老易遭弑君；
  - `2`: 🏛️ **长者议会共和** (Elders' Council) —— 生产+30%，科研+50%；战时动员迟缓 10s；
  - `3`: 🕊️ **狂信神权国度** (Theocratic Orthodoxy) —— 神恩产出翻倍，上帝技能消耗减半；异教好感度锁死宿敌。
* **部族普查张力累加公式 (每 60 Tick 真实汇总)**：
  彻底废除虚构民忠数值，100% 统计微观实体状态：
  $$\Delta \text{Tension} = (\text{StarvationRatio} \times 2.0) + (\text{CasualtyRatio} \times 1.5) + (\text{MismatchFactor} \times 0.8) - (\text{GloryMod} \times 0.5)$$
  - 当 $\text{Tension} \ge 100.0$ 时，引爆不可逆的【图腾裂变与国家大分裂】。

### 4.3 Voronoi 聚落双核几何切分与拓扑连通分量泛洪 (TC-EDGE-06) (`src/politics/SchismSystem.js`)
* **双核自适应距离场切分**：
  1. 系统在原文明领地内检索两个人口最密集的聚落重心点：
     - 重心 A：原主基地老图腾；
     - 重心 B：距老图腾最远的次级军营/工坊要塞（生成新叛军图腾）；
  2. 以重心 A 与 B 为发生核（Seeds），在瓦片图上运行离散 Voronoi 距离切分；
* **孤岛飞地消除守门断言 (TC-EDGE-06)**：
  - 切分后，执行广度优先连通分量泛洪（Flood Fill）；
  - 任何与新图腾无直接陆地连通路径（或被山脉、深水阻隔、面积 $<4$ 瓦片）的孤悬飞地，**当帧自动注销为中立荒漠瓦片**，领地归属设为 0；
  - 彻底消灭因飞地孤岛引发的流场除零崩溃与小人被困死循环！

### 4.4 叛军【自由之怒】45 秒 Buff 与图腾瞬时驱散 (`src/politics/RebelWrathSystem.js`)
* **起义狂暴补偿**：
  - 分裂瞬间，全体叛乱阵营小人置位状态掩码 `HAS_WRATH_OF_LIBERTY`，持续 $45.0\text{s}$：
    * 攻击速度 $+30\%$，移动速度 $+20\%$；
    * 士气下限锁死在 50 点，完全免疫士气溃散；
* **提前驱散平叛机制 (Premature Purge)**：
  - 若在 45 秒内，叛乱图腾被忠诚派突袭摧毁，自由之怒瞬间全员驱散；
  - 叛军士气直接归零并全员转入【跪地投降】，王权宣告复辟平叛，起义失败收场。

### 4.5 四大防碎片化严苛协议综合守门 (`src/politics/AntiFragmentationGuard.js`)
防止挂机长时间演化导致地图碎片化为几十个单兵城邦：
1. **人口与地块门槛**：母国总人口必须 $\ge 12$、领地必须 $\ge 16$ 瓦片方可触发分裂，否则直接驳回并转为内部处决；
2. **300 秒分裂冷却锁**：发生一次分裂后，该阵营进入 300 秒国家凝聚期，张力清零且绝对免疫再次裂变；
3. **微型飞地秒级注销**：孤悬海外 $< 3$ 瓦片的地块在 30 秒内自然消融归还荒野；
4. **全球 16 国硬锁**：全大陆活跃政权上限硬锁为 **16 个**；当达到 16 个国家时，张力蓄满 100 自动转为【首领宫廷流血暗杀】，绝不创生第 17 个阵营！

---

## 五、 世袭继承意外大转盘、基因防伪与战后五重处置契约 (`src/politics/`)

### 5.1 世袭五大驾崩大转盘与 3.0s 原子事务锁 (TC-EDGE-07) (`src/politics/DynastySuccessionSystem.js`)
当老皇帝咽气瞬间，依据确定性 PRNG 触发五大继承意外大转盘：
* **[40% 正常顺位即位]**：大皇子顺利加冕；
* **[15% 离奇横死意外]**：大皇子打猎被野猪反杀或溺亡，王位顺位砸中二皇子；
* **[15% 幼主登基，权臣摄政]**：留下幼童皇子，氏族第一勇士出任摄政王（置位 `IS_REGENT`），代行王权；
* **[15% 兄弟掷骰夺门]**：兄弟在图腾前掷骰决斗，胜者即位；
* **[15% 荒野私生子夺嫡]**：民间私生子持皇家信物冲入大营抢夺王冠。
* **3.0 秒继承原子事务锁 (Succession Atomic Lock - TC-EDGE-07)**：
  - 老王阵亡至新王即位期间赋予 $3.0\text{s}$ 加冕过渡时钟；
  - 期间锁定王位读写指针，并发伤害与刺杀无法变更王权状态，**杜绝同帧并发双王死锁**。

### 5.2 双等位基因防伪认亲与绝嗣角斗空安全
* **父系基因防伪认亲掩码断言**：
  杜绝敌国刺客或骷髅兵冒充皇室私生子：
  $$\text{isValidHeir} = (\text{heir.isAlive}) \land (\neg \text{heir.isUndead}) \land (\text{heir.fatherId} == \text{deadKing.id}) \land ((\text{heir.paternalGene} \ \& \ \text{king.gene}) == \text{king.gene})$$
* **绝嗣角斗空安全 (Extinction Failsafe)**：
  - 若所有子嗣死绝，过滤奴隶实体（`!hasStatus(flags, id, IS_SLAVE)`），按战斗力遴选全族第一猛士即位；
  - 全族仅剩 1 人时强制推选该平民即位，政体自动坍塌为【军阀强权独裁】，**绝不抛出空数组异常**。

### 5.3 战后五重处置与飞行箭矢空安全守卫 (TC-EDGE-05) (`src/politics/PostWarTreatySystem.js`)
* **战后五重处置收束**：
  1. 屠城抢掠：掠夺敌方全部仓储，将地表瓦片降解为焦土；
  2. 奴役战俘：将战败士兵全员置位 `IS_SLAVE` 项圈，贬为苦力；
  3. 建立附庸：保留附属自治图腾，每 60 秒上缴 30% 资源贡赋；
  4. 领地吞并：将敌方领地瓦片权属并入己方；
  5. 驱逐流寇：残兵败将放逐至深山重组为中立盗贼。
* **飞行箭矢空安全守卫 (In-Flight Projectiles Guard - TC-EDGE-05)**：
  - 敌方阵营灭亡瞬间，全图正在飞行中的投射物挂载空指针守卫；
  - 命中已灭亡实体时，伤害安全消解并回收投射物，**杜绝 `Cannot read properties of null` 运行时崩溃**。

### 5.4 弱小流寇乞讨与保护费生态位
* 残兵 $< 5$ 且无领地的流寇团伙，战力比邻国弱小（$< 0.2$）时，**绝对禁止无脑正面冲锋大军自杀**；
* 转为边境盘剥游荡：向邻国商队收取 1~2 份干粮过路费，或在粮仓围墙外乞讨；若获得粮食，120 秒内不发起敌对行动，保留弱小阵营生存空间。

---

## 六、 领域事件字典扩充契约 (`src/data/DomainEvents.js`)

增补 Milestone 3 领域事件枚举（维持双轨通道规则）：

```javascript
// 关键事务通道 (0x8000 起始，绝对不丢包)
EVT_WAR_DECLARED:         0x8004, // [已存在] 全面战争爆发 (Param1: 宣战国ID, Param2: 被宣国ID)
EVT_PAX_DIVINA_FORCED:    0x8005, // [已存在] 300s 战争超时强制休战 (Param1: 阵营A, Param2: 阵营B)
EVT_FACTION_SCHISM:       0x8001, // [已存在] 领地大裂变触发 (Param1: 母国ID, Param2: 叛军国ID)
EVT_FACTION_DESTROYED:    0x8002, // [已存在] 阵营图腾倒塌灭绝 (Param1: 阵营ID, Param2: 击杀者国ID)
EVT_PEACE_TREATY_SIGNED:  0x800A, // [已存在] 战后五重处置和谈条约签署 (Param1: 战胜国, Param2: 条约类型)
EVT_SUPER_WEAPON_MISFIRE: 0x800E, // [已存在] 超级奇迹兵器毁灭性反噬 (Param1: 武器ID, Param2: 反噬类型)
EVT_TOTEM_AEGIS_TRIGGERED:0x8012, // 图腾 25% 圣盾击退波爆发 (Param1: 阵营ID, Param2: 图腾ID) [新增]
EVT_SCHISM_ENCLAVE_PURGED:0x8013, // 裂变非连通孤岛飞地注销 (Param1: 阵营ID, Param2: 瓦片Index) [新增]

// 瞬态表现通道 (0x0001 起始，供视窗消费)
EVT_SUPER_WEAPON_FIRED:   0x0005, // [已存在] 超级奇观正常射击 (Param1: 武器ID, Param2: 目标瓦片)
EVT_MORALE_STATE_CHANGED: 0x0013, // 士兵士气四阶状态改变 (Param1: 实体ID, Param2: 新士气等级) [新增]
EVT_FRICTION_ESCALATED:   0x0014, // 边境摩擦阶梯升级 (Param1: 阵营A, Param2: 阵营B) [新增]
EVT_LAST_STAND_ACTIVATED: 0x0015, // 图腾 5 格破釜沉舟绝地死战激活 (Param1: 实体ID, Param2: 0) [新增]
```

---

## 七、 展现层视窗与渲染契约 (`src/rendering/MiniRenderer.js` & `index.html`)

### 7.1 表现层无 Mock 真实消费铁律 (LL-003)
* 视窗必须原生 `import` 真实 M3 领域系统（`BorderFrictionSystem`, `DamageCalculator`, `WarWatchdogSystem`, `VectorFlowFieldSystem`, `SchismSystem`, `DynastySuccessionSystem`）；
* 严禁手写假战线或假战争倒计时。

### 7.2 战争与政体视觉元素
1. **领地国界光晕 (Territory Borders)**：
   - 依据 `TileGrid.territoryFaction` 为不同阵营地块绘制半透明阵营色边缘；
2. **战线流场可视化调试开关 (Flow Field Vectors)**：
   - 支持按按键切换显示当前大军团向量流场箭头，便于直观观察避障与兵团推进；
3. **士气微表情与光晕**：
   - 动摇：冒微汗小水滴 💧；
   - 溃逃：慌张急汗 💦 并加速逃跑；
   - 破釜沉舟：周身燃起暗红死战火焰气焰；
4. **图腾 25% 圣盾波特效**：
   - 爆发瞬时扩散的金色环形冲击波与 12s 旋转金身圣盾；
5. **HUD 战争与政治看板**：
   - 阵营宣战/休战指示器、300s 战争倒计时、政治张力实时进度条、内战分裂报警提示。

---

## 八、 质量守门断言契约 (Shift-Left QA Guardrails & DoD)

| 守门用例编号 | 目标模块 | 机器可执行硬断言 |
| :---: | :--- | :--- |
| **`TC-EDGE-01`** | `DamageCalculator.js` | 两个 100% 反伤单位对刀，`callDepth > 3` 强行截断，反伤输出归零，调用栈溢出次数恒为 0；护甲 -100 时被 Clamp 至 -40.0，结算伤害为有限非 NaN 数值。 |
| **`TC-EDGE-04`** | `WarWatchdogSystem.js` | 战争满 300.0s 强制休战清除 `IN_COMBAT` 并派发 `EVT_PAX_DIVINA_FORCED`；休战时重叠单位沿离心方向平移退回国界；排除击杀野怪伪保活。 |
| **`TC-EDGE-05`** | `PostWarTreatySystem.js` | 阵营灭亡图腾倒塌时，空中飞行中的箭矢在下一帧安全回收，不抛出 `null` 访问异常；灭国阵营领地释放为荒原。 |
| **`TC-EDGE-06`** | `SchismSystem.js` | 人为构造 Voronoi 切割产生的离岛孤悬飞地（面积 $< 4$ 瓦片或被深水阻隔），广度优先连通性泛洪守门器在 1 帧内将其所有权注销为 0。 |
| **`TC-EDGE-07`** | `DynastySuccessionSystem.js` | 老皇帝驾崩后赋予 3.0s 原子事务锁，在此期间施加高频刺杀，王位指针严格锁定，绝无双王并发；无子嗣时角斗重铸不抛空指针异常。 |

---

## 九、 Milestone 3 任务包分解与子 Agent 派发表 (WBS & Task Assignment)

```
                    ┌────────────────────────────────────────────────────────┐
                    │       Milestone 3 核心攻坚任务包 (WP-3.1 ~ WP-3.7)      │
                    └───────────────────────────┬────────────────────────────┘
                                                │
         ┌──────────────────────────────────────┼──────────────────────────────────────┐
         ▼                                      ▼                                      ▼
【coder-systems】                      【coder-rendering】                    【qa-guardian】
• WP-3.1 边境摩擦与战争士气系统         • WP-3.5 领地国界、流场与战争视窗       • WP-3.6 TC-EDGE-01 / 04 / 05 / 06 / 07
• WP-3.2 护甲伤害与反伤超时看门狗                                              守门测试套件全面落地
• WP-3.3 大军团反向 BFS 流场寻路
• WP-3.4 政治张力、双核分裂与世袭继承
```

| 任务包编号 | 任务名称 | 责任子 Agent | 交付物文件路径 | 前置依赖 | 核心工期 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **`WP-3.1`** | 领地边境摩擦、远征疲劳与四级士气状态机 | `coder-systems` | `src/warfare/BorderFrictionSystem.js`<br/>`src/warfare/TotemDefenseSystem.js`<br/>`src/warfare/MoraleSystem.js`<br/>`tests/warfare/BorderFrictionSystem.test.js` | M2 封版基线 | 3.0 pd |
| **`WP-3.2`** | 边际递减护甲伤害计算、反伤熔断与 300s 战争看门狗 | `coder-systems` | `src/warfare/DamageCalculator.js`<br/>`src/warfare/WarWatchdogSystem.js`<br/>`tests/warfare/DamageCalculator.test.js` | `WP-3.1` | 2.5 pd |
| **`WP-3.3`** | 大军团反向 BFS 向量流场寻路与微观切线避障 | `coder-systems` | `src/pathfinding/VectorFlowFieldSystem.js`<br/>`src/pathfinding/LocalTangentSteering.js`<br/>`tests/pathfinding/VectorFlowFieldSystem.test.js` | `WP-3.1` | 3.5 pd |
| **`WP-3.4`** | 部族普查张力、Voronoi 聚落双核大分裂与王朝继承 | `coder-systems` | `src/politics/ClanCensusSystem.js`<br/>`src/politics/SchismSystem.js`<br/>`src/politics/RebelWrathSystem.js`<br/>`src/politics/DynastySuccessionSystem.js`<br/>`src/politics/PostWarTreatySystem.js`<br/>`tests/politics/SchismSystem.test.js` | `WP-3.2` | 4.0 pd |
| **`WP-3.5`** | 视窗端到端集成：领地国界光晕、流场可视化与战争 HUD | `coder-rendering` | `src/rendering/MiniRenderer.js`<br/>`index.html`<br/>`tests/rendering/MiniRenderer.test.js` | `WP-3.3`<br/>`WP-3.4` | 2.5 pd |
| **`WP-3.6`** | 守门测试套件 TC-EDGE-01 / 04 / 05 / 06 / 07 落地 | `qa-guardian` | `tests/guardrails/TC-EDGE-01.test.js`<br/>`tests/guardrails/TC-EDGE-06.test.js`<br/>`tests/guardrails/TC-EDGE-07.test.js` | `WP-3.2`<br/>`WP-3.4` | 3.0 pd |
| **`WP-3.7`** | Tier 2 专家联合评审与零 GC 巡检结项 | `reviewer-architect`<br/>母 Agent (PM) | `docs/03_reviews/milestone_3_acceptance_report.md` | 全量通过 | 1.0 pd |

---

## 十、 组织过程资产与经验教训前置检查清单 (LL-001 ~ LL-007 Pre-Flight Checklist)

开工前必须逐条核实《经验教训登记册》中的纠正与预防措施 (CAPA)，严禁重蹈覆辙：

- [x] **LL-001 (契约先行)**：本说明书已正式编写并发布于 `docs/02_contracts/milestone_3_technical_design_and_contracts.md`，彻底杜绝无契约盲目施工；
- [x] **LL-002 (母 Agent 纯粹性)**：所有 WP 任务已划归 `coder-systems`, `coder-rendering`, `qa-guardian`，母 Agent 严格履行 PM 调度职责，绝不下场改代码；
- [x] **LL-003 (视窗防两张皮)**：`WP-3.5` 明确规定 `index.html` 必须作为真实系统的唯一消费者，原生 ESM 驱动全部 M3 构件，杜绝本地 Mock 假战线与假演化；
- [x] **LL-004 (数值量纲同构)**：护甲减免公式统一为 $\frac{\text{Armor}}{\text{Armor} + 100}$、护甲下限死锁 $-40.0$、战争超时锁定 300s，跨系统阈值同构推导；
- [x] **LL-005 (分层文档工程)**：契约与后续评审报告严格存放于 `docs/02_contracts/` 与 `docs/03_reviews/`，保持清晰工程目录树；
- [x] **LL-006 (接口鲁棒与 Fallback)**：所有新增方法签名显式声明形参默认值与判空保护，消灭 `ReferenceError` 与 `Cannot read properties of null`；
- [x] **LL-007 (CI 防抖动工程设计)**：大军团流场性能与 10,000 Tick 战争压力测试配置充足的 JIT 预热轮次与合理的 CI 容差，杜绝并发环境下的调度抖动。

---
**Milestone 3 技术详细设计与数据契约说明书发布完毕！正式具备施工前置许可！**
