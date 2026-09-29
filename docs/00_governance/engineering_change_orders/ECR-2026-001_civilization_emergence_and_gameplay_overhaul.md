# 工程变更申请单 (Engineering Change Request - ECR)

**变更单编号**：`ECR-2026-001`  
**变更主题**：文明建立、动态领地与全系统有机涌现大重构 (Milestone 5 Emergence Overhaul)  
**发起人**：主控总指挥 / 项目经理 (Lead Orchestrator / PM)  
**提交日期**：2026-09-29  
**变更影响级别**：一级架构变更 (Level 1 - Core Architecture & Gameplay Overhaul)  
**变更委员会 (CCB) / 批准人**：用户 (Lead Architect & Product Owner)  
**当前状态**：**待批准 (PENDING APPROVAL)**  

---

## 一、 变更背景与问题陈述 (Problem Statement)
在完成 Milestone 0 ~ Milestone 4 后，尽管底层基础设施、连续内存池、空间哈希、遗传算法、减伤公式、Web Audio、渲染管线全部通过了 45 个测试套件和 355 项单元断言，但在端到端视窗实际游玩体验中，暴露出严重的“系统孤岛 (Siloed Engineering)”与“毫无游戏性”的致命缺陷：
1. **国土僵死**：机械硬编码 4x3 矩阵画出 12 个固定圆圈，国土终身不扩张、不收缩、不被占领；
2. **职业架空**：平民不运粮、工匠不建田拓地、士兵不巡防打仗，职业系统只是无意义的 Enum 标签；
3. **繁殖缺失**：遗传系统仅在开局调用一次，世界内没有活体繁衍，突变器官无法世代涌现；
4. **交火断路**：`DamageCalculator` 和 `SpatialHash` 虽有完整代码但物理帧未接入，小人两两穿透，战争永远打不起来；
5. **重玩性归零**：每一局都是固定种子 42、固定位置、固定 12 族，千篇一律。

---

## 二、 变更方案与范围 (Scope of Change)
本变更将把散落的引擎系统全面打通为具有生命的有机体：
1. **群系自适应营火选址 (`BiomeAffinitySettlementSystem.js`)**：依据自然生态群系选址，建立原始先祖营火；
2. **领地动态潮汐推移与退耕还林 (`DynamicTerritorySystem.js`)**：国土随人口动态侵染扩张，断粮时退耕还林（守住 35% 荒野），战时战线推移吞并；
3. **四大职业闭环行为机与部落粮仓 (`CasteBehaviorSystem.js` & `GranaryBuffer`)**：平民采收运粮入仓，工匠拓荒扩地，士兵巡防边境，首领战意光环；
4. **活体繁衍与世代孟德尔演进 (`LiveReproductionSystem.js`)**：粮足繁衍生子，显隐性突变器官真实世代重组扩散；
5. **空间实时索敌交火与自发宣战 (`SpatialCombatSystem.js`)**：`SpatialHash` 32px 索敌，士兵主动拔刀，调用 `DamageCalculator`，摩擦飙升至 70 触发全面战争；
6. **程序化重玩性与首领性格 (`SandboxScenarioManager.js`)**：随机地图种子，首领 4 大随机性格，万族/四国/起源 3 大沙盒模式。

---

## 三、 文档影响与同步更新矩阵 (Documentation Impact Matrix)

| 影响文档类别 | 文档路径 | 变更动作 | 版本号升级 | 变更内容概要 |
| :--- | :--- | :---: | :---: | :--- |
| **总策划案 (Master GDD)** | `docs/01_design/game_design_document.md` | 更新 | v2.2 $\rightarrow$ **v3.0** | 增补文明建立、动态领地潮汐、职业经济闭环、活体繁衍与多模态沙盒机制 |
| **系统需求规格 (SRS)** | `docs/01_design/system_requirements_specification.md` | 更新 | v1.1 $\rightarrow$ **v2.0** | 新增 `REQ-CIV-001` ~ `REQ-CIV-006` 核心需求条目与工业规格 |
| **技术设计规范 (TDS)** | `docs/01_design/technical_design_specification.md` | 更新 | v1.1 $\rightarrow$ **v2.0** | 增补 GranaryBuffer 内存布局、领地侵染算法、行为树 FSM 与索敌交火管线 |
| **工作分解结构 (WBS)** | `docs/01_design/work_breakdown_structure.md` | 更新 | v1.1 $\rightarrow$ **v2.0** | 增设 WBS 11 / Milestone 5 任务包 `WP-5.1` ~ `WP-5.6` |
| **需求追踪矩阵 (RTM)** | `docs/01_design/requirements_traceability_matrix.md` | 更新 | v3.0 $\rightarrow$ **v5.0** | 双向挂载 `REQ-CIV-001` ~ `006`，链接设计专册、WBS、契约与测试套件 |
| **技术契约说明书** | `docs/02_contracts/milestone_5_civilization_emergence_and_gameplay_overhaul.md` | 新建 | **SPEC-M5-v1.0** | 发布 M5 执行技术契约、TypedArray 步长偏移与守门断言 |

---

## 四、 质量安全与性能影响评估 (Impact & Risk Assessment)
* **性能与零 GC 风险**：
  - 索敌交火采用分帧（每 3~4 帧一检），复用预分配 `outBuffer`；
  - 粮仓采用扁平连续 `Float32Array(64)`；
  - 领地更新每秒仅处理边界瓦片，主渲染循环仍严格保持 **0 次 save/restore** 与千人 60 FPS 底线。
* **回归兼容性**：
  - 原有 45 个测试套件 355 项单元测试 100% 保持满绿通过。

---

## 五、 变更审批签署区 (Approval & Sign-off)

- **申请人 (Lead Orchestrator)**：`Antigravity Mother Agent`  
- **申请状态**：已提交评审  
- **审批意见 (CCB Review)**：待用户正式批示  
- **批准签字**：____________________ （待签署）  
- **生效日期**：批准即刻生效并启动 WBS 派工  
