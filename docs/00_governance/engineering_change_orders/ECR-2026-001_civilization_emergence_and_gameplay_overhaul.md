# 工程变更申请单 (Engineering Change Request - ECR)

**变更单编号**：`ECR-2026-001`  
**变更主题**：活体文明涌现、一族多国解耦、双职业实体闭环与组织过程资产全量大重构 (Milestone 5 Emergence Overhaul)  
**发起人**：主控总指挥 / 项目经理 (Lead Orchestrator / PM)  
**提交日期**：2026-09-29  
**变更影响级别**：一级架构变更 (Level 1 - Core Architecture & Gameplay Overhaul)  
**变更委员会 (CCB) / 批准人**：用户 (Lead Architect & Product Owner)  
**当前状态**：**待批准 (PENDING APPROVAL)**  

---

## 一、 变更背景与问题陈述 (Problem Statement)

在完成 Milestone 0 ~ Milestone 4 后，尽管底层基础设施、连续内存池、空间哈希、遗传算法、减伤公式、Web Audio、渲染管线全部通过了 45 个测试套件和 355 项单元断言，但在端到端视窗实际游玩体验中，暴露出严重的“系统孤岛 (Siloed Engineering)”与“毫无游戏性”的致命缺陷：
1. **国土僵死与无建立感**：机械硬编码 4x3 矩阵画出 12 个固定圆圈，国土终身不扩张、不收缩、不被占领；文明不是被建立的，缺乏原始营火奠基的生长感；
2. **种族与政权机械绑死 (Race=Faction)**：将生物物种与政治王国等同，完全丢失了“同种族多个互相对抗的王国/部落（如人类帝国 vs 人类公国）”、以及大分裂内战产生同族反叛军的深邃地缘历史乐趣；
3. **职业系统架空假兼职**：双职业沦为空洞的 Enum 标签，平民不割麦运粮、工匠不采石立界碑、士兵不列阵抗线，缺乏生产入仓与战术动作的真实物理闭环与平战动员转换；
4. **活体繁衍缺失**：遗传系统仅在开局调用一次，世界内没有活体繁衍，二倍体显隐性突变器官无法在世代中肉眼可见地扩散；
5. **交火断路**：`DamageCalculator` 和 `SpatialHash` 虽有完整代码但物理帧未接入，小人两两穿透，战争永远打不起来；
6. **重玩性归零**：每一局都是固定种子 42、固定位置、固定 12 族，千篇一律；
7. **组织过程资产未全量同步**：此前设计仅更新了总案与规格书，遗漏了具体设计专册（Design Books）、多王国解耦、双职业实体闭环与项目管理 OPA 知识库，存在“上改下未改”的工程隐患。

---

## 二、 变更方案与范围 (Scope of Change)

本变更将彻底打通散落的引擎系统，构建生机勃勃的活体文明：
1. **群系自适应营火选址 (`BiomeAffinitySettlementSystem.js`)**：依据自然生态群系选址，建立原始先祖营火与法理图腾（初始半径 $R=2$，人口 4~6 人）；
2. **种族与政权正交解耦与一族多王国支持 (`FactionRegistry.js`)**：`RaceId` (0~11) 仅定义生物表型特技，`FactionId` (1~16) 定义独立政权；支持同一生物种族在大陆建立多个敌对/同盟王国，大分裂内战时叛军分配新 Faction 槽位插旗建国；
3. **双职业实体物理闭环与军民平战动员 (`DualClassStateMachine.js` & `CasteBehaviorSystem.js`)**：
   - 生产主职驱动微观经济：农夫割麦背入图腾粮仓（+10 粮食）、石工采石立界碑拓地、伐木砍柴修营、药师炼药救治重伤员；
   - 战斗副职驱动具象战术：重盾卫士抗线举盾（格挡 50% 投射物）、狂战士濒死狂暴突脸、暗影刺客隐身潜行刺杀敌酋/烧粮、神射长弓手 48px 抛射；
   - 平战动态动员与复合身份：遭遇外敌或警报拉响，平民瞬间由生产态切换为战斗态，【暴怒民兵】、【重岩壁垒】具象化涌现；
4. **部落粮仓物理库存 (`GranaryBuffer`)**：连续平铺 Float32Array 维护食物、木料、石料与药剂物理储备；
5. **领地动态潮汐推移与弹簧退耕还林 (`DynamicTerritorySystem.js`)**：国土随人口侵染扩张，断粮时退耕还林恢复中立荒野（恒久确保 $\ge 35\%$ 荒野），战时士兵前沿推进实时吞并；
6. **活体繁衍与世代孟德尔演进 (`LiveReproductionSystem.js`)**：粮足繁衍生子，显隐性突变器官真实世代重组扩散；
7. **空间实时索敌交火与自发宣战 (`SpatialCombatSystem.js`)**：`SpatialHash` 32px 索敌，士兵主动拔刀，调用 `DamageCalculator`，摩擦飙升至 70 触发全面战争；
8. **程序化重玩性与首领性格 (`SandboxScenarioManager.js`)**：随机地图种子，首领 4 大随机性格，万族争霸/四国鼎立/单族起源 3 大沙盒模式；
9. **组织过程资产 (OPA) 全量同步沉淀**：编制全景 OPA 索引，增补 LL-008~LL-011，修订全套设计专册与研发质保规程。

---

## 三、 文档影响与同步更新矩阵 (Documentation Impact Matrix)

| 影响文档类别 | 文档路径 | 变更动作 | 版本号升级 | 变更内容概要 |
| :--- | :--- | :---: | :---: | :--- |
| **总策划案 (Master GDD)** | `docs/01_design/game_design_document.md` | 更新 | v2.2 $\rightarrow$ **v3.0** | 增补第十三章：营火建立、领地潮汐、双职业全物理闭环、活体繁衍、一族多国解耦 |
| **设计专册 02 (种族与文明)**| `docs/01_design/design_books/02_races_and_civilization.md` | 更新 | v2.1 $\rightarrow$ **v2.2** | 增补第三章：生物种族与政治政权正交解耦、一族多王国机制、异族战俘奴隶经济 |
| **设计专册 03 (职业与兼职)**| `docs/01_design/design_books/03_professions_and_multiclass.md` | 更新 | v2.0 $\rightarrow$ **v2.2** | 增补第四/五/六章：生产主职运粮入仓、战斗副职战术动作、平战动员转换与复合身份涌现 |
| **设计专册 06 (战后与内政)**| `docs/01_design/design_books/06_post_war_and_internal_politics.md` | 更新 | v2.1 $\rightarrow$ **v2.2** | 增补大分裂与图腾裂变中同族叛军新政权 FactionId 槽位分配与仇恨锁定 200 |
| **系统需求规格 (SRS)** | `docs/01_design/system_requirements_specification.md` | 更新 | v1.1 $\rightarrow$ **v2.0** | 新增第十四章 `REQ-CIV-001` ~ `REQ-CIV-008` 全量工业需求与验收基线 |
| **技术设计规范 (TDS)** | `docs/01_design/technical_design_specification.md` | 更新 | v1.1 $\rightarrow$ **v2.0** | 增补第八章：GranaryBuffer、DynamicTerritory、FactionRegistry、DualClassStateMachine |
| **工作分解结构 (WBS)** | `docs/01_design/work_breakdown_structure.md` | 更新 | v1.1 $\rightarrow$ **v2.0** | 增设 WBS 11.0 活体文明涌现任务包 `WP-5.1` ~ `WP-5.6`（含一族多国与双职业物理闭环） |
| **需求追踪矩阵 (RTM)** | `docs/01_design/requirements_traceability_matrix.md` | 更新 | v3.0 $\rightarrow$ **v5.1** | 全量双向挂载 78 项需求（含 REQ-CIV-001~008 与 TC-EDGE-10/11），覆盖率 100.0% |
| **阶段技术契约 (SPEC)** | `docs/02_contracts/milestone_5_civilization_emergence_and_gameplay_overhaul.md` | 新建 | **SPEC-M5-v1.0** | 发布 M5 施工强硬技术契约（含 §2.3 族国解耦契约与 §4.3 双职业实体闭环契约） |
| **组织过程资产索引 (OPA)**| `docs/00_governance/organizational_process_assets_index.md` | 新建 | **v1.0** | 正式确立五大工程治理公理、归档过程资产、设计专册库与变更控制制度 |
| **经验教训登记册 (OPA)** | `docs/00_governance/lessons_learned_register.md` | 更新 | **持续更新** | 深度增补 LL-008 (系统孤岛)、LL-009 (族国解耦)、LL-010 (双职业实体化)、LL-011 (OPA全量同步) |
| **研发与质量规范 (OPA)** | `docs/00_governance/development_workflow_and_qa_specification.md` | 更新 | **v1.2** | 明确 Milestone M5 验收门禁（含一族多国与双职业闭环客观验证要求） |

---

## 四、 质量安全与性能影响评估 (Impact & Risk Assessment)

* **性能与零 GC 风险**：
  - 索敌交火采用分帧（每 3~4 帧一检），复用预分配 `outBuffer`；
  - 粮仓采用扁平连续 `Float32Array(64)`；
  - 双职业状态机采用扁平连续 `Float32Array(TOTAL_SLOTS * 6)`，状态转移仅位运算与修改属性，热路径 0 临时对象；
  - 领地更新每秒仅处理边界瓦片，主渲染循环仍严格保持 **0 次 save/restore** 与千人 60 FPS 底线。
* **回归兼容性**：
  - 原有 45 个测试套件 355 项单元测试 100% 保持满绿通过。

---

## 五、 变更审批签署区 (Approval & Sign-off)

- **申请人 (Lead Orchestrator)**：`Antigravity Mother Agent`  
- **申请状态**：**已完成全文档体系编制，呈请 CCB 评审**  
- **审批意见 (CCB Review)**：待用户正式批示签署  
- **批准签字**：____________________ （待签署）  
- **生效日期**：批准即刻生效并启动 WBS 派工  
