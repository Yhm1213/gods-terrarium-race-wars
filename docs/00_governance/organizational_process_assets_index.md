# 《神之蛐蛐缸：万族争霸》组织过程资产总目录与管理规程 (OPA Index & Governance Guidelines)

> **发布版本**：v1.0  
> **归口部门**：项目管理办公室 (PMO) & 架构治理委员会 (CCB)  
> **归档日期**：2026-09-29  
> **遵循体系**：CMMI Level 3 / PMBOK 7th Edition 组织过程资产沉淀标准

---

## 一、 资产管理总则与第一性原理

组织过程资产（Organizational Process Assets, OPA）是项目团队在全生命周期中积累的具有战略指导意义的制度、规程、知识库与技术沉淀。为杜绝“局部修改、遗漏全局”、“单测自嗨、系统孤岛”等严重工程缺陷，本项目确立**五大核心工程治理公理**：

```
                    ┌──────────────────────────────────────────────┐
                    │      神之蛐蛐缸：五大工程治理公理 (Axioms)   │
                    └──────────────────────┬───────────────────────┘
                                           │
    ┌──────────────────┬───────────────────┼───────────────────┬──────────────────┐
    ▼                  ▼                   ▼                   ▼                  ▼
【1. 涌现闭环公理】 【2. 族国解耦公理】 【3. 实体行为公理】 【4. 零GC性能公理】 【5. 潮汐地缘公理】
杜绝单测孤岛自嗨   生物种族与政治实体  双职业直接驱动      热路径绝对零GC      领地随人口与断粮
代码必在主循环闭环 正交解耦/一族多国   生产入仓与战术动作  千人 60FPS 稳锁     潮汐扩张与退耕还林
```

1. **生态涌现与闭环公理 (Emergent Closed Loop Axiom)**：单元测试全绿绝不等于交付。任何功能模块必须在主仿真循环与视窗中形成完整的因果输入与产出闭环，严禁无外部交互的孤岛系统。
2. **种族与政权正交解耦公理 (Race-Faction Decoupling Axiom)**：生物物种（`RaceId` 0~11）定义基因型、代谢与特技；政治实体（`FactionId` 1~16）定义法理主权、旗帜、领地、粮仓与外交。同一个种族可拥有多个独立敌对的王国/公国，内战分裂产生同族新政权。
3. **双职业微观行为物理闭环公理 (Physical Dual-Class Loop Axiom)**：职业绝不能是空的数值或 Enum 标签。生产主职必须实际采集麦/石/木/药并背负入库；战斗副职必须驱动盾墙抗线、狂暴近战、潜行刺杀、远程抛射等真实战术位移与技能。
4. **零 GC 与数据驱动高性能公理 (Zero-GC DOD Performance Axiom)**：主仿真与主渲染循环绝对禁止在热路径中创建临时对象/数组/闭包。主渲染循环热路径严格 **0 次调用 `ctx.save()` / `ctx.restore()`**。
5. **动态地缘潮汐与资源代谢公理 (Territory Tide & Metabolism Axiom)**：领地不是静态圆圈，而是随工匠立碑侵染扩张、随断粮饥荒自然退耕还林收缩的潮汐地缘流场，保证 35% 荒野生态安全缓冲。

---

## 二、 组织过程资产分类清单 (OPA Catalog)

### 2.1 过程、政策与规程资产 (Processes, Policies & Procedures)

| 资产编号 | 资产名称 | 存储路径 | 责任主体 | 状态 | 核心价值 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **OPA-PROC-01** | 开发工作流与质量验收规范 | [`development_workflow_and_qa_specification.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/00_governance/development_workflow_and_qa_specification.md) | QA Architect / PM | 现行有效 | 规范 5 级质量门禁、单测/守门断言基准、验收标准 |
| **OPA-PROC-02** | 变更控制与 CCB 审批规程 | [`engineering_change_orders/`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/00_governance/engineering_change_orders/) | CCB / PM | 现行有效 | 规范 Level 1 架构级工程变更的立项、穿透分析与呈报签署 |
| **OPA-PROC-03** | 阶段契约先行发布制度 (Step 0) | [`docs/02_contracts/`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/02_contracts/) | Lead Orchestrator | 现行有效 | 杜绝未批先写代码，强硬规范内存步长、方法签名与无歧义协议 |

### 2.2 组织知识库与历史经验 (Corporate Knowledge Base)

| 资产编号 | 资产名称 | 存储路径 | 责任主体 | 状态 | 核心价值 |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **OPA-KB-01** | 经验教训登记册 (LL Register) | [`lessons_learned_register.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/00_governance/lessons_learned_register.md) | 全体研发团队 | 持续增补 (LL-001~011) | 记录系统孤岛、接口断裂、并发抖动、种族政权解耦等历史复盘 |
| **OPA-KB-02** | 专家评审与里程碑验收报告集 | [`docs/03_reviews/`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/03_reviews/) | 外部评审专家团 | 归档 (M1~M4) | 汇集沙盒专家、数值平衡专家、QA 破坏者与前端专家的历史评测建议 |

### 2.3 策划设计与业务规则专册 (Design Books Library)

| 专册编号 | 专册名称 | 存储路径 | 关联领域 | 核心机制 |
| :--- | :--- | :--- | :---: | :--- |
| **OPA-DB-01** | 01 世界与生态 | [`docs/01_design/design_books/01_world_and_ecology.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/01_design/design_books/01_world_and_ecology.md) | 环境与热力学 | 50x50 瓦片双缓冲、温度/肥力场、荒野自然蔓延 |
| **OPA-DB-02** | 02 种族大百科与文明生态 | [`docs/01_design/design_books/02_races_and_civilization.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/01_design/design_books/02_races_and_civilization.md) | 生物种族与政权 | 12 始祖物种、四大代谢模型、**种族与王国正交解耦、一族多国模型** |
| **OPA-DB-03** | 03 职业与多职业兼职系统 | [`docs/01_design/design_books/03_professions_and_multiclass.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/01_design/design_books/03_professions_and_multiclass.md) | 职业经济与战术 | **生产主职运粮入仓、战斗副职战场战术动作、复合职业称号与动员转换** |
| **OPA-DB-04** | 04 突变与进化引擎 | [`docs/01_design/design_books/04_mutation_and_evolution_engine.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/01_design/design_books/04_mutation_and_evolution_engine.md) | 孟德尔遗传 | 64 位二倍体染色体、显隐性重组、变异禁忌过滤 |
| **OPA-DB-05** | 05 领地扩张、摩擦与全面战争 | [`docs/01_design/design_books/05_territory_and_warfare.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/01_design/design_books/05_territory_and_warfare.md) | 领地潮汐与战争 | 动态侵染推移、退耕还林、32px 索敌交火、边境摩擦与宣战 |
| **OPA-DB-06** | 06 战后处置、国家治理树与分裂内战 | [`docs/01_design/design_books/06_post_war_and_internal_politics.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/01_design/design_books/06_post_war_and_internal_politics.md) | 政治内政与大分裂 | 治理树、双核 Voronoi 大分裂、**同族叛军政权独立建国与内战** |
| **OPA-DB-07** | 07 神明权能与干预系统 | [`docs/01_design/design_books/07_god_powers_and_interaction.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/01_design/design_books/07_god_powers_and_interaction.md) | 上帝交互 | 降水、落雷、降粮、神恩消耗与信仰回馈 |
| **OPA-DB-08** | 08 编年史与宏观叙事 | [`docs/01_design/design_books/08_chronicle_and_narrative.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/01_design/design_books/08_chronicle_and_narrative.md) | 历史记录 | 环形事件日志缓冲区、史诗级英雄战役与王朝兴衰叙事 |
| **OPA-DB-09** | 09 美术、音效与技术参数规范 | [`docs/01_design/design_books/09_art_audio_and_technical_spec.md`](file:///Users/yuhaomiao/Documents/antigravity/Game/docs/01_design/design_books/09_art_audio_and_technical_spec.md) | 展现与视听 | 微像素调色板、Web Audio 拟真音效、HUD 排行榜与沙盒重玩器 |

---

## 三、 组织过程资产维护与变更控制流程 (OPA Governance Protocol)

```
[用户需求/缺陷反馈] ──► [立项 ECR-xxxx] ──► [CCB 审查批准]
                                                │
       ┌────────────────────────────────────────┴────────────────────────────────────────┐
       ▼                                                                                 ▼
【上层总体设计同步】                                                             【底层执行契约与资产库同步】
• Master GDD (总策划案)                                                          • SPEC 阶段技术契约
• Design Books 01~09 (细化设计专册)                                              • Lessons Learned (经验教训)
• SRS (系统需求规格)                                                             • OPA 资产清单更新
• TDS (系统架构技术设计)                                                         • WBS 研发工序 & RTM 矩阵
       │                                                                                 │
       └────────────────────────────────────────┬────────────────────────────────────────┘
                                                ▼
                                    【子 Agent 研发与守门验收】
                                    严格遵循 LL-002 派工与双盲验收
```

1. **严禁“局部修改、遗漏全局”**：任何修改必须从 ECR 贯穿至 Design Books、SRS、TDS、WBS、RTM、SPEC 与 OPA；
2. **全生命周期闭环更新**：每次发布新版本或通过阶段验收后，必须在 24 小时内更新本索引与经验教训登记册；
3. **长期知识沉淀**：任何由用户、专家指出的深层次问题，必须提炼为至少 1 条通用经验教训（LL-xxx），写入资产库指导后续迭代。
