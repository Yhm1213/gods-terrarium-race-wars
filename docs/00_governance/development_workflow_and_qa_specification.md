# 《神之蛐蛐缸：万族争霸》开发流程与多 Agent 协同质量保证规范说明书

> **文档性质**：项目工程实施管理规范 (Development Workflow & QA Specification)  
> **制定基线**：Master GDD v3.0 & SRS v2.0 & WBS v2.0 & TDS v2.0 & RTM v5.1 & OPA v1.0  
> **核心目标**：明确多子 Agent 的协同流水线、各阶段测试（单测/组装/系统/混沌）实施准则、静态代码评审卡点与里程碑验收验收规程，确保项目在多并发开发下保持架构纯粹性、物理零 GC 与千人 60 FPS 底线。遵循《组织过程资产总目录与管理规程》（`docs/00_governance/organizational_process_assets_index.md`）确立的五大工程治理公理。  

---

## 一、 多 Agent（子智能体）分派与协同流水线 (Multi-Agent Team Orchestration)

本项目基于 Antigravity 多 Agent 体系，采用**“主控总指挥 (Lead Planner) + 领域研发子 Agent + 守门与评审子 Agent”**的三层矩阵结构：

```
                    ┌─────────────────────────────────────────────────────────┐
                    │               主控总指挥 (Lead Orchestrator)             │
                    │   • 维护全局甘特图与依赖拓扑 (WBS v1.1)                   │
                    │   • 分派任务包并把控接口契约 (TDS v1.1)                   │
                    │   • 裁决技术分歧与把关里程碑验收门禁                      │
                    └────────────────────────────┬────────────────────────────┘
                                                 │ 派发任务包 (Task Allocation)
         ┌───────────────────────────────────────┼───────────────────────────────────────┐
         ▼                                       ▼                                       ▼
【领域研发子 Agent】                   【质量守门子 Agent (QA)】              【架构评审子 Agent (Reviewer)】
• coder-core: 连续内存/空间哈希/事件总线  • qa-guardian: 编写 Vitest 套件/TC-EDGE • reviewer-architect: Clean架构
• coder-systems: 业务系统/生态/战争/内政  • qa-chaos: 10,000帧极速无头时间加速    • reviewer-perf: 零GC与L1缓存行
• coder-rendering: 图集/批处理/离散绘制    • qa-fuzzer: fast-check 模糊渗透测试    • reviewer-sec: 边界防穿透
• coder-narrative-storage: 战报/Worker
```

### 1.1 子 Agent 角色池与专长定义

| Agent 角色标识 | 专业领域与职责范围 | 负责代码物理目录 | 交付物红线与核心约束 |
| :--- | :--- | :--- | :--- |
| **`coder-core`** | 引擎基础设施与连续内存底座 | `src/core/`<br/>`src/components/` | 1. 锁死 `EntityID = 0` 墓碑隔离，全量分配 `4097` 槽位；<br/>2. 纯 SoA 拆分排布，杜绝内部 AoS；<br/>3. 空间哈希重建耗时严格 $<0.2\text{ms}$。 |
| **`coder-systems`** | 沙盒宏观世界、生态演替、军事战争与内政分裂 | `src/world/`<br/>`src/ecosystem/`<br/>`src/warfare/`<br/>`src/politics/` | 1. 业务逻辑纯函数化无状态；<br/>2. 依赖 `TDS v1.1` 声明的 API 签名，严禁私自为 ECS 挂动态属性；<br/>3. 跨系统 100% 走 `DomainEventBus`。 |
| **`coder-rendering-audio`** | 2D 像素合批、图集享元管理、镜头导播与音频合成 | `src/rendering/`<br/>`src/camera/`<br/>`src/director/`<br/>`src/audio/` | 1. 享元图集哈希池槽位严格收敛在 150 种外观内；<br/>2. 离散 8 向分桶纯整数平铺，主循环 0 次 save/restore；<br/>3. Web Audio 16 轨动态压限，防爆音破音。 |
| **`coder-narrative-storage`** | 三声道战报语料、验尸单离屏绘制、StorageWorker 持久化 | `src/narrative/`<br/>`src/persistence/` | 1. 验尸小票 Transferable 零拷贝移交 Worker；<br/>2. 主线程持久化帧耗时 $<0.1\text{ms}$；<br/>3. 数据库落实 LRU 60 张小票上限与三级容灾。 |
| **`coder-ui-god`** | DOM HUD 视窗、小人思维阁、上帝手势交互与奇迹触发 | `src/god/`<br/>`src/ui/` | 1. 上帝之手 5.0s 滞空天雷震脱与 1.5s 缓降金身防加冕死锁；<br/>2. UI 层仅读订阅，严禁反向污染底层数据。 |
| **`qa-guardian`** | 自动化测试体系、九大极端守门断言实现 | `tests/core/`<br/>`tests/guardrails/` | 1. 负责 TC-EDGE-01 ~ 09 代码级硬断言编写；<br/>2. 极速无头 Node 环境运行，单用例执行 $<2\text{ms}$。 |
| **`reviewer-architect`** | 静态代码审查、架构分层合规性与零 GC 巡检 | 全局审查 | 1. 审查 ESLint 与 dependency-cruiser 扫描结果；<br/>2. 发现任何热路径临时对象分配立即亮红灯阻断合入。 |

### 1.2 任务包派发与阶段契约先行动态规则 (Phase Contract & Dispatch Protocol)
1. **阶段契约发布前置门禁 (Pre-Dispatch Contract Gate - Step 0)**：
   - 在任何里程碑 (M0~M4) 动工派发任务包之前，主控总指挥 (Lead Orchestrator) **必须首先编制并发布本阶段的《系统技术详细设计与数据契约说明书》(docs/mX_detailed_technical_design_and_data_contracts.md)**；
   - 该说明书必须穷尽：子 Agent 必读文档专册清单、连续内存 TypedArray 布局与步长偏移、模块接口与方法签名、有限状态机与数学偏微分公式、领域事件载荷格式、DoD 与守门断言；
   - **未发布本阶段独立契约说明书前，严禁向任何子 Agent 分派任务包！**
2. **任务包派发三要素绑定 (Three-Element Package Dispatch)**：
   - 派发任务包时，主控 Agent 必须向承接子 Agent 同时送达：
     ① WBS 任务包编号（如 `WP-2.1.1`）；
     ② 本阶段《系统技术详细设计与数据契约说明书》对应章节；
     ③ GDD / SRS / TDS / QA 宪法对应专册索引。
3. **拓扑排序驱动**：主控 Agent 严格按照 WBS v1.1 的依赖拓扑链条派发。例如在 M0 任务（`SpatialHash`, `DomainEventBus`）未完成前，严禁分派依赖其接口的 `CombatSystem`。
4. **接口先行契约 (Contract-First)**：所有子 Agent 编写代码时，必须且只能引用《阶段系统技术详细设计与数据契约说明书》及 `TDS v1.1` 中已裁决的常量、偏移量、方法签名与事件枚举。严禁子 Agent 之间通过口头商定私自引入未经批准的数据结构。
5. **隔离开发与测试先行**：每个开发子 Agent 领取任务包后，**必须同步交付该模块的单元测试文件**。未包含单测的代码视为未完工，主控 Agent 拒绝接收。

### 1.3 母 Agent 定位铁律与缺陷工单定向打回机制 (PM Role & Defect Return Protocol)
1. **母 Agent (Lead Orchestrator / PM) 角色纯粹性**：
   - 母 Agent 严格恪守**项目经理 (PM) 与总调度**角色；
   - 职责边界：甘特图排期编排、WBS 任务包分派、阶段契约说明书发布、跨子 Agent 进度调度、质量门禁裁决、组织过程资产（《经验教训登记册》）维护；
   - **红线底线：严禁母 Agent 亲自下场编写、修改或重构任何业务生产代码**！所有业务实现、算法推演与代码缺陷修复必须 100% 交由专属子 Agent 完成，彻底杜绝母 Agent 上下文被语法与细节实现污染。
2. **代码所有权与缺陷工单定向打回机制 (Code Ownership & Rectification Protocol)**：
   - 遵循“**谁编写谁负责，谁交付谁修复**”的责任溯源机制；
   - 在单元测试飘红、质量守门报警或 Tier 2 专家联合会审【要求整改】时：
     - 母 Agent 整理《缺陷整改工单》(Rectification Work Order)；
     - 准确标明缺陷等级（P0/P1/P2）、出错文件、违背的契约条款与整改要求；
     - **定向打回给原作者子 Agent（如 `coder-rendering` 或 `coder-systems`）进行闭环修复**；
     - 原作者修复并自测绿灯后，重新提交交付汇报，再由 `qa-guardian` 与 `reviewer-architect` 重新复验！

---

## 二、 单元测试实施策略 (Unit Testing Strategy)

单元测试是保障代码零返工的最底层基石。本作由于采用 DOD（面向数据设计）与 TypedArray，具有**完全不依赖浏览器 DOM 的天然单测优势**。

### 2.1 测试框架与运行环境配置
* **测试框架**：原生 **Vitest**（具备极速 HMR 与原生 ESM 支持）。
* **运行环境**：配置为 `environment: 'node'`。核心计算与 ECS 内存池不需要启动笨重的 `jsdom`，执行速度提升 $10\times$ 以上（百组单测可在 300ms 内极速完成）。
* **数据库 Mock**：针对持久化单测，直接引入 `fake-indexeddb/auto` 虚拟内存数据库，零磁盘 IO 损耗。

### 2.2 覆盖率红线指标
* **核心数学与物理算法**（`DamageCalculator`, `SpatialHash`, `SpatialQuery`, `VectorFlowFieldSystem`, `MegaAtlasDollCache`, `TabooFilter`）：
  * **行覆盖率 (Line Coverage) $\ge 95\%$**；
  * **分支覆盖率 (Branch Coverage) $\ge 90\%$**。
* **业务状态机与代谢系统**（`MetabolismSystem`, `SchismSystem`, `DynastySystem`）：
  * **行覆盖率 $\ge 85\%$**。

### 2.3 基于属性的模糊测试 (Property-Based Chaos Testing)
针对核心计算器，采用 `fast-check` 库进行 10,000 组极端边界渗透：
* **`DamageCalculator.calculate` 模糊测试**：
  * 输入：随机生成包含 `NaN`、`Infinity`、`-Infinity`、负数、浮点数在内的 10,000 组参数；
  * 断言：
    1. 返回结果绝无 `NaN`：`Number.isFinite(outResultBuffer[0]) === true`；
    2. 护甲下限锁定：`safeArmor >= -40.0`，绝不发生除以零；
    3. 递归熔断硬生效：当 `currentCallDepth >= 3` 时，`isFused === 1` 且 `reflectDamage === 0`。
* **`SpatialHash` 边界越界模糊测试**：
  * 输入：向坐标内存随机注入 `[-99999, 99999]` 极端超界坐标；
  * 断言：网格重建与邻域检索不发生数组越界异常，坐标经物理积分后被刚性 Clamp 锁定在 `[12, W-12]`。

### 2.4 SRS 九大底层守门断言测试套件 (Guardrails Suite)
将 SRS 第 12 章定义的 9 大守门用例直接固化为 `tests/guardrails/` 下的独立可执行用例：
1. `TC-EDGE-01.test.js`：递归受创深度硬断言与环形反伤熔断（验证 3 层截断与 1.5s ICD）；
2. `TC-EDGE-02.test.js`：物理刚性边界 Clamp 与动量吸收断言（验证超速撞击动量归零）；
3. `TC-EDGE-03.test.js`：图腾法理锚定与物理静态绝对锁（验证质量无穷大、不可拾取）；
4. `TC-EDGE-04.test.js`：战争交火超时 300s 双门限绝对时长熔断（验证看门狗强制休战）；
5. `TC-EDGE-05.test.js`：阵营灭亡指针级联注销与广播断言（验证图腾倒塌 0 引用悬空）；
6. `TC-EDGE-06.test.js`：领地拓扑双向陆地连通性断言（验证中轴撕裂孤岛剔除）；
7. `TC-EDGE-07.test.js`：继承权 3.0s 原子事务与两阶段健康自检断言（验证无双王并发）；
8. `TC-EDGE-08.test.js`：仓储物料守恒与整数离散断言（验证打砸抢物料零凭空创生）；
9. `TC-EDGE-09.test.js`：阵营普查休眠解耦与防幽灵复国断言（验证石化与死者不参与普查）。

---

## 三、 组装测试 / 集成测试策略 (Integration & Pipeline Testing)

组装测试侧重于系统间的“数据连接”与“事件传递”，验证多个高内聚模块组合后的运行闭环。

### 3.1 确定性单向帧序流水线连通测试 (Pipeline End-to-End)
在 `tests/systems/Pipeline.test.js` 中模拟单帧执行：
* **测试场景**：
  1. 外部注入鼠标点击抓取事件（`HandOfGodSystem`）；
  2. 驱动 `TileElementSystem` 结算火瓦片蔓延；
  3. 驱动 `MetabolismSystem` 扣减饥饿度，验证连续内存 `PhysiologyComponent` 写入；
  4. 驱动 `VectorFlowFieldSystem` 生成寻路向量，验证 `MovementSystem` 消费该向量完成位置更新；
  5. 驱动 `SpatialHash.rebuild`，验证更新后的实体进入正确的哈希桶；
  6. 驱动 `CombatSystem` 执行索敌并调用 `DamageCalculator`；
  7. 驱动 `DomainEventBus.flush`。
* **验收判定**：数据流严格遵循单向流动，上一环节写入 TypedArray 的数据下一环节 100% 正确消费，无跨层回溯或数据竞争。

### 3.2 双轨领域事件总线全生命周期闭环测试
* **全生命周期戏剧链条测试**：
  $$\text{老皇帝阵亡} \xrightarrow{\text{EVT\_RULER\_DIED}} \text{继承原子锁开启} \xrightarrow{3.0\text{s}} \text{加冕新王} \xrightarrow{\text{EVT\_HEIR\_CROWNED}} \text{三声道战报与验尸单生成}$$
* **通道抗压测试**：
  - 在同一帧内模拟并发产生 1,000 个瞬态事件与 200 个关键事务事件；
  - 验证关键事务通道 512 槽位无一丢包（100% 投递），瞬态通道超出 3,584 部分平稳触发 FIFO 覆盖，系统无任何未捕获异常。

---

## 四、 系统级测试与混沌压测策略 (System & Chaos Testing)

系统测试用于检验完整游戏在长时间运行、高并发压力与极端外部扰动下的自稳能力。

```
       ┌─────────────────────────────────────────────────────────────┐
       │              混沌工程注入器 (Chaos Engine Runner)            │
       └──────────────────────────────┬──────────────────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            ▼                         ▼                         ▼
   【虚拟时钟时间加速】          【物理零 GC 防腐断言】       【极端灾难注入测试】
   100x 极速推进 18,000 帧      连续 10,000 帧无头浸润      全图农田大火/野兽杀绝
   300s 看门狗 50ms 内熔断     比对 deltaHeap < 500KB       16国大分裂陆地连通性
```

### 4.1 虚拟时钟无头时间加速沙盒 (Time-Warp Headless Runner)
* **设计原理**：剥离浏览器的 `requestAnimationFrame`，由无头 Node.js 执行纯逻辑循环；
* **测试用例**：
  - 以 100 倍速推进 18,000 个物理 Tick（相当于游戏内挂机 300 秒完整交火周期）；
  - 测试用例执行耗时可在 **100ms** 内极速完成；
  - 核心断言：断言在 300 秒节点精准捕获到 `EVT_PAX_DIVINA_FORCED` 事件，两军强制停火并解散归国，无任何状态机卡死。

### 4.2 物理零 GC 与堆内存防腐断言 (Zero-GC Heap Assertion)
* **执行方案**：
  1. 启动无头运行器，装载 1,000 个存活实体并置入高烈度交火场景；
  2. 运行 100 帧热身，触发 V8 JIT 优化编译并调用 `global.gc()`；
  3. 记录基准堆内存：`const baseHeap = process.memoryUsage().heapUsed;`；
  4. 连续无休止迭代 **10,000 帧**（相当于挂机近 3 小时物理量）；
  5. 再次调用 `global.gc()` 测量：`const finalHeap = process.memoryUsage().heapUsed;`；
  6. **硬门禁断言**：
     $$\Delta \text{Heap} = \text{finalHeap} - \text{baseHeap} < 500\text{ KB}$$
     （仅允许框架与测试工具自身少量常驻，引擎内部业务连续内存增长必须为严格的 **0 字节**！若有子 Agent 在循环中写了 `new Object()`，此测试必红线报错）。

### 4.3 极端边界混沌测试 (Chaos Monkey)
* **场景 A（神之手疯狂扰乱）**：模拟玩家以每秒 60 次的频率随机抓取、抛掷储君或图腾柱，断言天雷震脱与金身霸体机制 100% 触发，王位继承绝不发生死锁；
* **场景 B（全生态绝收热寂）**：模拟天灾将全图农田全烧光、野生动物被猎食殆尽、粮仓全被洗劫，断言四大代谢降级互斥锁生效，小人啃树皮、吸辐射，生态绝不发生除以零或死循环崩溃。

---

## 五、 静态代码评审卡点与审查机制 (Static Code Review Cadence)

代码评审不是开发结束后的形式主义，而是贯穿在流水线中的**三级静态检查门禁**：

### 5.1 自动化静态扫描工具链
1. **ESLint (ES2022+)**：开启 `import/no-cycle`，禁止任何形式的 ES Module 循环引用；
2. **`dependency-cruiser` 架构依赖巡检**：
   - 规则 1：`src/core/` 绝对严禁 `import` 任何 `src/world/`, `src/warfare/` 等上层业务模块（保证 Clean Architecture 纯粹性）；
   - 规则 2：各业务领域（如 `warfare/` 与 `politics/`）严禁横向私自网状 `import`，必须通过 `DomainEventBus` 解耦；
3. **TypeScript JSDoc 强契约校验**：
   - 运行 `tsc --noEmit --checkJs`，对所有 API 方法参数与返回值执行强类型推导检查，拦截类型不匹配。

### 5.2 三级评审时机与卡点规范 (Three-Tier Review Cadence)

```
                    【流水线静态评审三级防护网】
  
  [代码编写] ──► [Tier 1: 任务包提交即审] ──(通过)──► [合并至 Milestone 分支]
                      │ (CI 自动化扫描 + 单测)
                      │ (存在任何临时对象分配/类型报错)
                      ▼ (自动打回重写)
  
  [分支汇聚] ──► [Tier 2: 里程碑专家联合会审] ──(通过)──► [打里程碑 Tag & 演示]
                      │ (架构师/性能专家/QA 审查)
                      │ (发现架构偏差或潜在内存隐患)
                      ▼ (发布补丁修补)
  
  [异常熔断] ──► [Tier 3: 架构变更特批审查] ──(审批通过)──► [修订 TDS 规格书]
```

1. **Tier 1: 任务包提交即审 (Per-Package Gate)**：
   - 触发时机：子 Agent 完成某个具体 Feature Package 开发时；
   - 审查人：主控 Agent + 自动化 CI 脚本；
   - 检查项：单测覆盖率达标、无循环引用、热路径无临时对象创建；
   - 裁决：全绿灯方可合并，有一项飘红直接打回。
2. **Tier 2: 里程碑合并前集中会审 (Milestone Gateway Review)**：
   - 触发时机：每个 Milestone（M0~M4）全部任务包开发完毕、准备打 Tag 验收前；
   - 审查人：首席系统架构师、底层性能架构师、QA 测试架构师联合会审；
   - 检查项：核查本里程碑是否符合 TDS v1.1 规范、是否遗留未测试边缘用例、性能指标是否达到毫秒级门限；
   - 交付物：出具《里程碑代码审查与合规备忘录》。
3. **Tier 3: 重大架构变更熔断评审 (Architecture Escalation Review)**：
   - 触发时机：开发过程中若发现必须增删 ECS 内存组件字段、或变更事件总线载荷格式；
   - 规则：**严禁任何子 Agent 擅自就地魔改**！必须立刻暂停代码编写，向主控 Agent 提交变更提案，组织专家重新评估并修订 TDS 发布新版本后，方可继续开工。

---

## 三、 阶段性里程碑验收标准与操作规程 (Milestone Acceptance Framework)

每个里程碑（M0 ~ M4）对应明确的**客观验收断言与可运行 Demo 演示标准**，只有 100% 满足条件方可签署通过并进入下一里程碑：

### 6.1 里程碑 M0 验收：纯前端分层脚手架与 ECS 连续内存底座 (Week 1)
* **验收构件**：
  - 源码六大领域物理目录完整就绪；
  - `src/core/ECS.js` 稠密栈管理与 `TOTAL_SLOTS = 4097` 内存池分配；
  - `src/core/SpatialHash.js` 48px 平铺连续网格与重建逻辑；
  - `src/core/DomainEventBus.js` 双轨环形缓冲区。
* **客观验收标准 (Pass Criteria)**：
  1. `npm test` 执行 `tests/core/` 单测 100% 通过（用例数 $\ge 30$）；
  2. 验证 0 号墓碑隔离：向 `EntityID = 0` 写入位置，断言读取为默认值，系统不越界；
  3. 执行 4096 实体空间哈希重构性能基准测试：断言重构耗时严格 $< 0.2\text{ms}$；
  4. 静态常驻 TypedArray 内存核算：常驻内存总量严格 $\le 0.52\text{MB}$。

### 6.2 里程碑 M1 验收：极简宏观世界与生存代谢演变原型 (Week 2)
* **验收构件**：
  - `TileGrid.js` 56x36 瓦片网格实体与深浅水/阻力场；
  - `NutrientFieldSystem.js` 二维拉普拉斯养分扩散与绝热边界；
  - `FarmlandSystem.js` 2x2 农田四阶演替与大粮仓仓储；
  - `MetabolismSystem.js` 四大生存代谢与 10s 互斥锁。
* **客观验收标准与可运行 Demo**：
  1. 打开 `index.html` 浏览器秒开，画布清晰呈现 56x36 像素地形与地热/水域/神泉分布；
  2. 观察农田在 100 帧内自然呈现“荒地 $\rightarrow$ 绿芽 $\rightarrow$ 金黄麦浪 $\rightarrow$ 秸秆”演化；
  3. 小人饥饿度突破 80 时，思维阁精准打字输出“应急代谢启动，啃食树皮”，并锁定 10s 互斥；
  4. 养分底温断言：全图瓦片初始养分严格位于 $[0.0, 1.0]$ 区间，无植被瞬间刷屏溢出 Bug。

### 6.3 里程碑 M2 验收：种族突变、兼职与军团交火闭环 (Week 4)
* **验收构件**：
  - 12 种族平衡性配表与正交器官掩码库（`OrganFlags`）；
  - `CareerSystem.js` 生产+战斗双职业兼职；
  - `VectorFlowFieldSystem.js` 多源反向 BFS 流场与微观切线避障；
  - `DamageCalculator.js` 零分配减伤与反伤熔断；
  - `WarWatchdogSystem.js` 300s 战争超时看门狗。
* **客观验收标准与可运行 Demo**：
  1. 部署红蓝两军各 500 名小人（同屏 1,000 单位），帧率稳定维持在 **60 FPS**；
  2. 两军沿向量流场平滑冲锋对撞，无单点贴脸死锁，受击产生正确的击退物理与动量吸收；
  3. 观察魔像与兽人碰撞：240kg 魔像稳稳抗线，无上千等效血量绝对无敌现象；真菌人遇火触发灭火孢子被动；
  4. 战争交火超时测试：持续交战达到 300 秒，看门狗强制派发 `EVT_PAX_DIVINA_FORCED`，双方自动脱离战斗并签署休战。

### 6.4 里程碑 M3 验收：政治裂变、世袭继承与三声道叙事 (Week 6)
* **验收构件**：
  - `ClanCensusSystem.js` 60-Tick 部族普查与宏观张力累加；
  - `SchismSystem.js` Voronoi 双核内战分裂与国土中轴撕裂；
  - `DynastySystem.js` 老王驾崩五大意外转盘与 3.0s 原子事务锁；
  - `HandOfGodSystem.js` 鼠标抓取、反加冕天雷震脱与金身缓降；
  - `TriVocalEngine.js` 三声道战报与离屏带血渍验尸小票。
* **客观验收标准与可运行 Demo**：
  1. 部族粮食匮乏且张力累加至 100 时，画面触发剧烈震颤公报，母国领地中轴撕裂生成叛乱新阵营；
  2. 击杀老皇帝，触发五大继承转盘（演示野猪反杀、幼主摄政等分支）；
  3. 鼠标抓取储君悬空持续 5.0 秒，天道准时降下金色天雷震脱鼠标，储君金身缓降完成加冕；
  4. 英雄阵亡时，UI 右下角思维阁打出三声道反差生草战报，并可点击生成复古发黄的 Canvas 官僚验尸单。

### 6.5 里程碑 M4 验收：完整全量自走棋系统调优与发布封版 (Week 8)
* **验收构件**：
  - `MegaAtlasDollCache.js` 享元签名哈希池与 1000 人合批绘制；
  - `WebAudioBusManager.js` 16 轨复音池与动态压限；
  - `StorageWorker.js` 零拷贝后台持久化与三级容灾；
  - 16 位基因种子码（`SeedCodec.js`）编解码与 URL 分享。
* **全量发布终验门禁 (Final Release Gate)**：
  1. **极限性能门禁**：千人同屏持续战斗，Chrome Performance 面板实测 **平均帧率 $\ge 58.5\text{ FPS}$，主线程平均 CPU 耗时 $< 7.0\text{ms}$**；
  2. **混沌防腐门禁**：执行 10,000 帧无头时间加速浸润测试，断言 $\Delta\text{Heap} < 500\text{KB}$（物理零 GC）；
  3. **测试套件全绿**：全量单元测试、集成测试、守门断言测试（TC-EDGE-01~09）**100% PASS**；
  4. **全特性交付**：GDD v2.2 策划专册与 SRS v1.1 的 59 项原子需求全量闭环交付。

### 6.6 里程碑 M5 验收：活体文明涌现、动态领地与全系统有机闭环 (Week 9-10 / ECR-2026-001)
* **验收构件**：
  - `BiomeAffinitySettlementSystem.js` 生态群系自适应营火选址与建立；
  - `DynamicTerritorySystem.js` 领地潮汐扩张、战线推移与 35% 野区退耕还林；
  - `CasteBehaviorSystem.js` 部落粮仓、平民采收运粮、工匠立碑拓田与士兵巡防；
  - `LiveReproductionSystem.js` 粮仓物资驱动活体繁衍与显隐性孟德尔基因世代累积；
  - `SpatialCombatSystem.js` 基于 SpatialHash 的 32px 索敌交火与边境摩擦级联宣战；
  - `SandboxScenarioManager.js` 随机种子沙盒重玩器与首领性格系统；
  - `FactionRegistry.js` 种族与政权正交解耦（`RaceId` 0~11 vs `FactionId` 1~16）、一族多王国支持与大分裂内战；
  - `DualClassStateMachine.js` 双职业生产-战斗实体行为机与军民平战动员转换。
* **客观验收标准与可运行 Demo**：
  1. **文明自然建立**：观察到 12 始祖部族在各自分布的自然生态区建立半径 $R=2$ 的原始营火，初始人口各 4~6 人；
  2. **一族多王国共存与内战分裂**：验证同一种族（如人类、兽人）可初始化为两个不同法理王国（不同国号、图腾、旗帜色彩与外交关系），发生大分裂时，叛乱军作为同种族新 Faction 拔刀相向；
  3. **双职业实体闭环与经济运转**：平民生产主职（农夫割麦、石工采石、伐木砍柴、药剂采药）实际背负资源运回图腾粮仓入库；战斗副职（重盾卫士举盾列阵抗线、狂战士濒死暴走、暗影刺客潜行背刺敌酋/粮仓、神射长弓后排抛射）；遭遇入侵时拉响战号，平民瞬间由生产态切换为战斗态（如【暴怒民兵】拔刀反击）；
  4. **动态领地侵染与推移**：领地随工匠立碑和人口增长向外自然撑大；断粮时外围地块自动退耕还林收缩（守住 35% 荒野生态安全缓冲）；战争期间士兵推进实时吞并敌国瓦片；
  5. **活体繁衍与基因演进**：粮仓储备充足后，图腾旁诞生新生小人，肉眼可见继承双亲突变器官与二倍体显隐性基因；
  6. **自发交火与宣战**：跨界冲突自然推升摩擦值，摩擦满 70 吹响战角，军团总攻敌国图腾；
  7. **守门断言**：`TC-EDGE-10`（动态领地与粮仓繁衍守门）与 `TC-EDGE-11`（自发交火与军团推演守门）全部 100% PASS。


---

## 结论

本规范将 WBS 的任务排期与 TDS 的技术契约转化为**严丝合缝的工程管理流水线**。在多 Agent 协同体系下，各子 Agent 将在严格的分层隔离、契约约束与自动化质量门禁下高效推进，确保《神之蛐蛐缸：万族争霸》从第一行代码到最终发布全程高质量、零返工！
