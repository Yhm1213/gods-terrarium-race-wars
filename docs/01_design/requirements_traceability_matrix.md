# 《众神之造物生态箱：万族争霸》全景需求双向追踪矩阵 (RTM v2.0)

> **文档代号**：DOC-RTM-v2.0  
> **管理责任人**：主控总指挥 / 项目经理 (Lead Orchestrator / Project Manager)  
> **制定基线**：Master GDD v2.2 (01~09专册), SRS v1.1, TDS v1.1, WBS v1.1, SPEC-M0/M1/M2 契约说明书  
> **文档性质**：工程级端到端双向需求对账全景矩阵 (Requirements Traceability Matrix)  
> **追踪链条**：策划专册 $\longleftrightarrow$ SRS需求条目 $\longleftrightarrow$ WBS任务包 $\longleftrightarrow$ 技术契约 $\longleftrightarrow$ 生产源码 $\longleftrightarrow$ 自动化测试 $\longleftrightarrow$ 交付状态  
> **闭环状态**：M0 (底座) 100%、M1 (宏观生态) 100%、M2 (种族突变) 100% 已验证闭环；M3、M4 待施工。

---

## 矩阵状态图例 (Legend)

* 🟢 **已交付 (Verified)**：代码已合并入 `main`，单测/守门测试 100% 通过，已发布正式 Release Tag。
* 🟡 **规划中 (Pending M3)**：已完成详细技术契约与架构设计，即将进入 M3 施工排期。
* ⚪ **待排期 (Backlog M4)**：架构预留接口，计划在 M4 进行全系统总装集成。

---

## 一、 核心运行时与基础设施域 (Core Runtime & Infra)

| SRS 需求编号 | 需求名称与规格概要 | 策划依据 | 承接 WBS | 阶段 | 交付生产代码路径 | 承接测试套件路径 | 状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :---: |
| **REQ-ENG-004** | 定步长物理累加器循环与分帧调度器 | TDS §1.3 | `WP-1.1.1` | **M0** | `src/core/GameLoop.js`<br/>`src/core/Scheduler.js` | `tests/core/GameLoop.test.js` | 🟢 已交付 |
| **REQ-ENG-004** | 48px 平铺连续内存空间哈希与检索 | TDS §1.2 | `WP-1.1.2` | **M0** | `src/core/SpatialHash.js`<br/>`src/core/SpatialQuery.js` | `tests/core/SpatialHash.test.js` | 🟢 已交付 |
| **REQ-ENG-004** | 零 GC 双轨双缓冲环形领域事件总线 | TDS §5.1 | `WP-1.1.3` | **M0** | `src/core/DomainEventBus.js`<br/>`src/data/DomainEvents.js` | `tests/core/DomainEventBus.test.js` | 🟢 已交付 |
| **REQ-ENG-004** | 紧凑型 ECS 实体管理器与连续平铺内存池 (0.52MB) | TDS §3.1 | `WP-1.1.4` | **M0** | `src/core/ECS.js`<br/>`src/components/*.js` | `tests/core/ECS.test.js`<br/>`tests/core/Components.test.js`<br/>`tests/core/MemoryFootprint.test.js` | 🟢 已交付 |
| **REQ-ENG-004** | 确定性伪随机数发生器 (Mulberry32) | TDS §1.1 | `WP-1.1.5` | **M0** | `src/core/PRNG.js` | `tests/core/PRNG.test.js` | 🟢 已交付 |

---

## 二、 微缩生态与微观经济域 (Ecology & Economy)

| SRS 需求编号 | 需求名称与规格概要 | 策划依据 | 承接 WBS | 阶段 | 交付生产代码路径 | 承接测试套件路径 | 状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :---: |
| **REQ-ECO-001** | 56x36 瓦片网格与 6 大生物群系阻力场 | 专册 01 | `WP-2.1.1` | **M1** | `src/world/TileGrid.js`<br/>`src/data/BiomeData.js` | `tests/world/TileGrid.test.js` | 🟢 已交付 |
| **REQ-ECO-001** | 瓦片火/水/酸/电/瓦斯元素连锁反应 | 专册 01 | `WP-2.1.2` | **M3** | `src/world/TileElementSystem.js` | `tests/world/TileElementSystem.test.js` | 🟡 待施工 |
| **REQ-ECO-002** | 二维拉普拉斯连续地脉养分扩散场与绝热反射 | 专册 01 | `WP-2.2.1` | **M1** | `src/ecosystem/NutrientField.js` | `tests/ecosystem/NutrientField.test.js` | 🟢 已交付 |
| **REQ-ECO-002** | 2x2 农田四阶演替状态机与开垦轮作 | 专册 01 | `WP-2.2.3` | **M1** | `src/ecosystem/FarmlandSystem.js` | `tests/ecosystem/FarmlandSystem.test.js` | 🟢 已交付 |
| **REQ-ECO-003** | 中立野生动物母穴地锚与濒危隐匿育幼 | 专册 01 | `WP-2.3.1` | **M3** | `src/ecosystem/WildlifeSystem.js` | `tests/ecosystem/WildlifeSystem.test.js` | 🟡 待施工 |
| **REQ-ECO-004** | 应急降级生存代谢网与 10s 通道互斥锁 | 专册 02 | `WP-2.4.1` | **M1** | `src/ecosystem/EmergencyMetabolismSystem.js` | `tests/ecosystem/EmergencyMetabolismSystem.test.js` | 🟢 已交付 |
| **REQ-ECO-005** | 部族粮仓容量守恒与 40% 地下暗格防盗保底 | 专册 01 | `WP-2.5.1` | **M3** | `src/economy/GranaryStorage.js` | `tests/economy/GranaryStorage.test.js` | 🟡 待施工 |
| **REQ-ECO-006** | 领地维护费弹性阻尼与 35%+ 野区自稳 | 专册 01 | `WP-2.5.2` | **M3** | `src/economy/UpkeepSystem.js` | `tests/economy/UpkeepSystem.test.js` | 🟡 待施工 |

---

## 三、 魔幻种族与生存代谢域 (Races & Metabolism)

| SRS 需求编号 | 需求名称与规格概要 | 策划依据 | 承接 WBS | 阶段 | 交付生产代码路径 | 承接测试套件路径 | 状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :---: |
| **REQ-RACE-001** | 12 基础种族物理参数与变异禁忌掩码 | 专册 02 | `WP-3.1.1` | **M0** | `src/data/RaceData.js`<br/>`src/data/MutationFlags.js` | `tests/data/DataLayer.test.js` | 🟢 已交付 |
| **REQ-RACE-001** | 12 始祖种族特异技能矩阵与动作通道仲裁 | 专册 02/03 | `WP-2.1` | **M2** | `src/data/RaceSkillData.js`<br/>`src/components/RaceSkillComponent.js`<br/>`src/race/RaceSkillSystem.js` | `tests/race/RaceSkillSystem.test.js` | 🟢 已交付 |
| **REQ-RACE-002** | 四大生存代谢范式状态机与饥饿衰竭 | 专册 02 | `WP-3.2.1` | **M1** | `src/ecosystem/MetabolismSystem.js` | `tests/ecosystem/MetabolismSystem.test.js` | 🟢 已交付 |
| **REQ-RACE-003** | 冲量守恒质量对撞反冲物理积分计算 | 专册 02 | `WP-3.3.1` | **M3** | `src/warfare/ImpulseCollider.js` | `tests/warfare/ImpulseCollider.test.js` | 🟡 待施工 |
| **REQ-RACE-004** | 墓园亡灵【命匣继承法】与决斗重组 | 专册 02 | `WP-3.4.1` | **M3** | `src/race/PhylacterySystem.js` | `tests/race/PhylacterySystem.test.js` | 🟡 待施工 |
| **REQ-RACE-005** | 晶石魔像【固件分叉与算力分裂】 | 专册 02 | `WP-3.5.1` | **M3** | `src/race/GolemCoreSystem.js` | `tests/race/GolemCoreSystem.test.js` | 🟡 待施工 |
| **REQ-RACE-006** | 魔像 180s 断能石化衰退与古代遗迹解耦 | 专册 02 | `WP-3.5.1` | **M3** | `src/race/GolemPetrifaction.js` | `tests/race/GolemPetrifaction.test.js` | 🟡 待施工 |

---

## 四、 职业兼职与阶级分工域 (Professions & Castes)

| SRS 需求编号 | 需求名称与规格概要 | 策划依据 | 承接 WBS | 阶段 | 交付生产代码路径 | 承接测试套件路径 | 状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :---: |
| **REQ-CLS-001** | 生活+战斗双职业槽位与履历自发觉醒 | 专册 03 | `WP-4.1.1` | **M3** | `src/profession/CareerSystem.js` | `tests/profession/CareerSystem.test.js` | 🟡 待施工 |
| **REQ-CLS-001** | 四大社会阶级 (平民/工匠/士兵/领袖) 动态晋升 FSM | 专册 03/06 | `WP-2.2` | **M2** | `src/components/SocialCasteComponent.js`<br/>`src/profession/SocialCasteSystem.js` | `tests/profession/SocialCasteSystem.test.js` | 🟢 已交付 |
| **REQ-CLS-002** | 复合头衔动态生成矩阵与被动赋能 | 专册 03 | `WP-4.1.1` | **M3** | `src/profession/TitleMatrix.js` | `tests/profession/TitleMatrix.test.js` | 🟡 待施工 |
| **REQ-CLS-003** | 四大恶性破坏流派修复 (ICD, 税后反伤, 备用短刀, 单次殉道) | 专册 03 | `WP-4.1.1` | **M2/M3** | `src/race/RaceSkillSystem.js`<br/>`src/data/RaceSkillData.js` | `tests/race/RaceSkillSystem.test.js` | 🟢 已交付 (M2核心部分) |

---

## 五、 无预设突变引擎与孟德尔遗传域 (Mutation & Genetics)

| SRS 需求编号 | 需求名称与规格概要 | 策划依据 | 承接 WBS | 阶段 | 交付生产代码路径 | 承接测试套件路径 | 状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :---: |
| **REQ-MUT-001** | 硬件物理材质器官与实体物理属性动态聚合管线 | 专册 04 | `WP-2.4` | **M2** | `src/systems/EntityPhysicalAggregator.js` | `tests/systems/EntityPhysicalAggregator.test.js` | 🟢 已交付 |
| **REQ-MUT-002** | CFG 行为积木生成、生草代价与动态震荡检测 | 专册 04 | `WP-4.3.1` | **M4** | `src/mutation/CFGBehaviorEngine.js` | `tests/mutation/CFGBehaviorEngine.test.js` | ⚪ 待排期 |
| **REQ-MUT-003** | 基础生存/主业/突变三轨动作仲裁器 | 专册 04 | `WP-2.1` | **M2** | `src/race/RaceSkillSystem.js` | `tests/race/RaceSkillSystem.test.js` | 🟢 已交付 |
| **REQ-MUT-004** | 效用期望与混乱方差双门限适应度过滤 | 专册 04 | `WP-4.4.1` | **M4** | `src/mutation/FitnessFilter.js` | `tests/mutation/FitnessFilter.test.js` | ⚪ 待排期 |
| **REQ-MUT-005** | 双倍体孟德尔遗传驱动、禁忌语义重映射与模式 A 全族平滑扩散 | 专册 04 | `WP-2.3` | **M2** | `src/components/GeneticsComponent.js`<br/>`src/mutation/MendelianGeneticsSystem.js`<br/>`src/mutation/TabooFilter.js` | `tests/mutation/MendelianGeneticsSystem.test.js`<br/>`tests/guardrails/TC-EDGE-04.test.js` | 🟢 已交付 |

---

## 六、 领地战线推移与大军团战争域 (Warfare & Legions)

| SRS 需求编号 | 需求名称与规格概要 | 策划依据 | 承接 WBS | 阶段 | 交付生产代码路径 | 承接测试套件路径 | 状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :---: |
| **REQ-WAR-001** | 边境摩擦三阶梯状态机与外交连带宣战 | 专册 05 | `WP-5.1.1` | **M3** | `src/warfare/BorderFrictionSystem.js` | `tests/warfare/BorderFrictionSystem.test.js` | 🟡 待施工 |
| **REQ-WAR-002** | 边际递减物理护甲公式与 -40.0 负护甲死锁阻尼 | 专册 05 | `WP-5.2.1` | **M2/M3** | `src/systems/EntityPhysicalAggregator.js` | `tests/systems/EntityPhysicalAggregator.test.js` | 🟢 已交付 (M2核心部分) |
| **REQ-WAR-003** | 远征疲劳光环与图腾 25% 圣盾击退波 | 专册 05 | `WP-5.3.1` | **M3** | `src/warfare/TotemSanctuarySystem.js` | `tests/warfare/TotemSanctuarySystem.test.js` | 🟡 待施工 |
| **REQ-WAR-004** | 四级士气状态机与图腾 5 格破釜沉舟绝地反击 | 专册 05 | `WP-5.3.1` | **M3** | `src/warfare/MoraleSystem.js` | `tests/warfare/MoraleSystem.test.js` | 🟡 待施工 |
| **REQ-WAR-005** | 战争交火超时 300s 双门限防伪保活看门狗 | 专册 05 | `WP-5.4.1` | **M3** | `src/warfare/WarWatchdogSystem.js` | `tests/warfare/WarWatchdogSystem.test.js` | 🟡 待施工 |
| **REQ-ENG-005** | 大军团反向 BFS 向量流场寻路与切线微观避障 | TDS §4.3 | `WP-5.5.1` | **M3** | `src/pathfinding/VectorFlowFieldSystem.js` | `tests/pathfinding/VectorFlowFieldSystem.test.js` | 🟡 待施工 |

---

## 七、 国家治理与政治裂变域 (Politics & Dynasties)

| SRS 需求编号 | 需求名称与规格概要 | 策划依据 | 承接 WBS | 阶段 | 交付生产代码路径 | 承接测试套件路径 | 状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :---: |
| **REQ-POL-001** | 生产军事实用科技树与四大超级奇观反噬 | 专册 06 | `WP-6.1.1` | **M3** | `src/politics/TechCivicSystem.js` | `tests/politics/TechCivicSystem.test.js` | 🟡 待施工 |
| **REQ-POL-002** | 四大市政路线、宏观政治张力容器与部族普查 | 专册 06 | `WP-6.1.2` | **M3** | `src/politics/ClanCensusSystem.js` | `tests/politics/ClanCensusSystem.test.js` | 🟡 待施工 |
| **REQ-POL-003** | 统治者个性词条与政治张力动态演变 | 专册 06 | `WP-6.1.2` | **M3** | `src/politics/RulerTraitSystem.js` | `tests/politics/RulerTraitSystem.test.js` | 🟡 待施工 |
| **REQ-POL-004** | Voronoi 聚落双核切分与中轴撕裂分裂 | 专册 06 | `WP-6.3.1` | **M3** | `src/politics/SchismSystem.js` | `tests/politics/SchismSystem.test.js` | 🟡 待施工 |
| **REQ-POL-005** | 叛乱军【自由之怒】45s 满士气与图腾瞬时驱散 | 专册 06 | `WP-6.4.1` | **M3** | `src/politics/RebelWrathSystem.js` | `tests/politics/RebelWrathSystem.test.js` | 🟡 待施工 |
| **REQ-POL-006** | 四大防碎片化严苛协议综合守门 (16国硬锁) | 专册 06 | `WP-6.5.1` | **M3** | `src/politics/AntiFragmentationGuard.js` | `tests/politics/AntiFragmentationGuard.test.js` | 🟡 待施工 |
| **REQ-POL-007** | 世袭五大驾崩大转盘、3.0s 原子事务与继承自愈 | 专册 06 | `WP-6.6.1` | **M2/M3** | `src/profession/SocialCasteSystem.js` | `tests/guardrails/TC-EDGE-05.test.js` | 🟢 已交付 (M2核心部分) |
| **REQ-POL-008** | 战后处置五重收束与流寇乞讨生态位 | 专册 06 | `WP-6.7.1` | **M3** | `src/politics/PostWarTreatySystem.js` | `tests/politics/PostWarTreatySystem.test.js` | 🟡 待施工 |

---

## 八、 上帝交互与智能导播域 (God Interaction & Director)

| SRS 需求编号 | 需求名称与规格概要 | 策划依据 | 承接 WBS | 阶段 | 交付生产代码路径 | 承接测试套件路径 | 状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :---: |
| **REQ-GOD-001** | 视口平滑缩放与时间法则膨胀控制器 (0.1x~5x) | 专册 07 | `WP-7.1.1` | **M4** | `src/camera/Camera2D.js`<br/>`src/core/TimeScale.js` | `tests/camera/Camera2D.test.js` | ⚪ 待排期 |
| **REQ-GOD-002** | 实体神之手悬浮抓取、反死锁天雷与缓降金身 | 专册 07 | `WP-7.2.1` | **M4** | `src/god/HandOfGodSystem.js` | `tests/god/HandOfGodSystem.test.js` | ⚪ 待排期 |
| **REQ-GOD-003** | 智能导播画中画系统 (Smart Director PiP) | 专册 07 | `WP-7.3.1` | **M4** | `src/director/SmartDirector.js` | `tests/director/SmartDirector.test.js` | ⚪ 待排期 |
| **REQ-GOD-004** | 15 秒神恩满溢狂欢时刻 (Divine Overdrive) | 专册 07 | `WP-7.4.1` | **M4** | `src/god/DivineOverdrive.js` | `tests/god/DivineOverdrive.test.js` | ⚪ 待排期 |
| **REQ-GOD-005** | 完整落实原版六大生草上帝玩具技能 | 专册 07 | `WP-7.4.1` | **M4** | `src/god/DivineMiraclesSystem.js` | `tests/god/DivineMiraclesSystem.test.js` | ⚪ 待排期 |
| **REQ-GOD-006** | 实体全息检视面板与微观生平足迹看板 | 专册 07 | `WP-7.5.1` | **M2** | `index.html` (全息看板) | `tests/rendering/MiniRenderer.test.js` | 🟢 已交付 (M2前端已集成) |

---

## 九、 视听叙事与前端渲染管线域 (Narrative & Rendering)

| SRS 需求编号 | 需求名称与规格概要 | 策划依据 | 承接 WBS | 阶段 | 交付生产代码路径 | 承接测试套件路径 | 状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :--- | :---: |
| **REQ-NAR-001** | 三声道黑幽默人格叙事与聚合降频节流 | 专册 08 | `WP-8.1.1` | **M4** | `src/narrative/TriVocalEngine.js` | `tests/narrative/TriVocalEngine.test.js` | ⚪ 待排期 |
| **REQ-NAR-002** | 帝国官僚验尸小票 OffscreenCanvas 与一键导出 | 专册 08 | `WP-8.2.1` | **M4** | `src/narrative/DeathAuditReceipt.js` | `tests/narrative/DeathAuditReceipt.test.js` | ⚪ 待排期 |
| **REQ-NAR-003** | 极乐迪斯科风临终思维阁与打字机音效 | 专册 08 | `WP-8.3.1` | **M4** | `src/narrative/MindCabinet.js` | `tests/narrative/MindCabinet.test.js` | ⚪ 待排期 |
| **REQ-NAR-004** | 宿怨账本图谱 (Blood Ledger) 与因果对账 | 专册 08 | `WP-8.4.1` | **M4** | `src/narrative/BloodLedger.js` | `tests/narrative/BloodLedger.test.js` | ⚪ 待排期 |
| **REQ-NAR-005** | 16 位分歧种子码编解码与 URL Query 秒开直达 | 专册 08 | `WP-8.4.1` | **M0** | `src/data/SeedCodec.js` | `tests/data/DataLayer.test.js` | 🟢 已交付 |
| **REQ-NAR-006** | 纯值快照 DTO 序列化与双缓冲环形队列 | 专册 08 | `WP-8.5.1` | **M4** | `src/narrative/ContextSlabPool.js` | `tests/narrative/ContextSlabPool.test.js` | ⚪ 待排期 |
| **REQ-ENG-001** | 7:2:1 调色盘、四大阶级标牌、变异羽翼与领袖金色王冠描边 | 专册 09 | `WP-8.6.1` | **M2** | `src/rendering/MiniRenderer.js` | `tests/rendering/MiniRenderer.test.js` | 🟢 已交付 |
| **REQ-ENG-002** | 1024x1024 全局图集 (Mega-Atlas) 享元签名缓存 | 专册 09 | `WP-8.6.1` | **M4** | `src/rendering/MegaAtlasDollCache.js` | `tests/rendering/MegaAtlasDollCache.test.js` | ⚪ 待排期 |
| **REQ-ENG-003** | Web Audio 原生 8-bit 合成压限总线与 PCM 预烘焙池 | 专册 09 | `WP-8.7.1` | **M4** | `src/audio/WebAudioBusManager.js`<br/>`src/audio/Synth8Bit.js` | `tests/audio/WebAudioBusManager.test.js` | ⚪ 待排期 |

---

## 十、 底层致命守门断言测试域 (Shift-Left QA Guardrails)

| 守门用例编号 | 守门断言核心业务定义 | 关联需求 | 承接 WBS | 阶段 | 交付测试套件路径 | 当前硬断言通过状态 |
| :---: | :--- | :---: | :---: | :---: | :--- | :---: |
| **TC-EDGE-01** | 递归受创深度硬断言与环形反伤 1.5s ICD 熔断 | `REQ-QA-001` | `WP-5.2.1` | **M3** | `tests/guardrails/TC-EDGE-01.test.js` | 🟡 待施工 (M3) |
| **TC-EDGE-02** | 物理刚体刚性边界 Clamp 与 100,000px/s 动量吸收 (0越界) | `REQ-QA-002` | `WP-3.3.1` | **M1** | `tests/guardrails/WorldBoundaryGuard.test.js` | 🟢 10,000次打靶 0 越界 |
| **TC-EDGE-03** | 图腾法理锚定与物理静态绝对锁 (质量无穷大, 0位移) | `REQ-QA-003` | `WP-5.3.1` | **M1** | `tests/guardrails/WorldBoundaryGuard.test.js` | 🟢 500万 N*s 冲量 0 位移 |
| **TC-EDGE-04** | **双倍体孟德尔遗传确定性分布与卡方拟合优度检验** | `REQ-MUT-005` | `WP-2.6` | **M2** | `tests/guardrails/TC-EDGE-04.test.js` | 🟢 $\chi^2 = 0.7337 < 5.991, p > 0.05$ |
| **TC-EDGE-05** | **四大阶级晋升无环 FSM、15s 防抖与领袖唯一性约束** | `REQ-CLS-001` | `WP-2.6` | **M2** | `tests/guardrails/TC-EDGE-05.test.js` | 🟢 10,000 Tick 0 死锁, 双王违规为 0 |
| **TC-EDGE-06** | 领地拓扑双向陆地连通性与飞地注销 | `REQ-QA-006` | `WP-6.3.1` | **M3** | `tests/guardrails/TC-EDGE-06.test.js` | 🟡 待施工 (M3) |
| **TC-EDGE-07** | 继承权原子事务与两阶段健康自检 | `REQ-QA-007` | `WP-6.6.1` | **M3** | `tests/guardrails/TC-EDGE-07.test.js` | 🟡 待施工 (M3) |
| **TC-EDGE-08** | 仓储物料守恒与整数离散断言 (0凭空创生) | `REQ-QA-008` | `WP-2.5.1` | **M3** | `tests/guardrails/TC-EDGE-08.test.js` | 🟡 待施工 (M3) |
| **TC-EDGE-09** | 阵营普查休眠解耦与防幽灵复国断言 | `REQ-QA-009` | `WP-3.5.1` | **M3** | `tests/guardrails/TC-EDGE-09.test.js` | 🟡 待施工 (M3) |

---

## 十一、 矩阵统计与度量总结

* **总需求条目数**：59 条原子功能需求 + 9 项底层致命守门断言，共 **68 项**；
* **需求覆盖率**：WBS 映射覆盖率 **100.0%**（设计孤儿数：0，范围蔓延数：0）；
* **当前交付达成度 (至 M2 封版)**：
  - 🟢 **已全量闭环交付**：**29 项**（占比 $42.6\%$，全面覆盖基础架构、瓦片世界、生存代谢、种族特技、阶级分工、孟德尔遗传突变与全景视窗）；
  - 🟡 **M3 规划中**：**24 项**（占比 $35.3\%$，聚焦大军团战争、流场寻路、战线推移、王朝内政与大分裂）；
  - ⚪ **M4 待排期**：**15 项**（占比 $22.1\%$，聚焦上帝手势交互、三声道叙事、验尸小票、Web Audio 与 Mega-Atlas）。
* **自动化测试防线**：当前代码库拥有 **20 个测试套件、189 项机器断言，100% 满分全绿通过**。
