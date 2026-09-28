# 众神之造物生态箱：万族争霸 (Gods' Terrarium: Race Wars)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-79%20passed%20(100%25)-brightgreen.svg)](tests/)
[![Performance](https://img.shields.io/badge/FPS-60%20(1000%2B%20Units)-orange.svg)]()
[![RAM](https://img.shields.io/badge/Static%20RAM-0.53%20MB-success.svg)]()
[![Architecture](https://img.shields.io/badge/Architecture-Pure%20SoA%20ECS%20%7C%20Zero--GC-purple.svg)]()

> 一款基于纯原生 JavaScript、追求极致性能的 **2D 像素风沙盒上帝模拟与万族自走棋争霸** 独立游戏。  
> 玩家化身造物主，在微观生态箱中干涉群系环境、引导种族繁衍与杂交突变、煽动宗教圣战，观察千人同屏文明演化与荒诞涌现。

---

## 🌟 核心特色与世界观

- **千人同屏，万族争霸**：支持 1000+ 个体在 $1344 \times 864$ 沙盒生态箱中自由生存、繁衍、劳作与军团碰撞。
- **12 大非对称种族**：人类、兽人、精灵、矮人、亡灵、鼠人、蜥蜴人、半人马、角魔、真菌人、魔像、魔眼，各具独特的代谢机制与战术特性。
- **生草涌现与器官突变**：9 大正交器官突变、杂交遗传、饥荒引发的同类相食与自噬异化、战后摄政与流血政变。
- **神之干预与四大战略超武**：神之手抓取抛掷、神罚天火、天降甘霖、深渊裂隙与基因裂解光束。
- **多 Agent 研发与严苛测试驱动**：全工程遵照严苛的系统规范与软件架构宪法构建，具备完备的测试用例与自动化流水线。

---

## ⚡ 底层性能架构与技术底座 (Milestone 0)

本项目自研了专为千人同屏设计的无垃圾回收 (Zero-GC) 纯连续内存架构：

| 核心组件 | 技术规格与实现原理 | 性能表现 / 质量指标 |
| :--- | :--- | :--- |
| **ECS 连续内存池** | 4097 槽位纯 SoA 平铺连续 `TypedArray`，`NULL_ENTITY = 0` 墓碑物理隔离，绝不产生段错误。 | 遍历零空洞，删除 $O(1)$ Swap-and-Pop 置换 |
| **静态内存开销** | 全系统核心组件与网格采用固定静态内存池，彻底杜绝高频内存抖动与内存泄漏。 | **常驻仅 0.5308 MB (543 KB)**，优于 0.65MB 门限 |
| **48px 空间哈希网格** | 504 连续桶，采用**双趟前缀和计数排序 (Counting Sort)** 算法，连续内存切片排布。 | 4096 满载实体重构仅 **0.03ms** (指标 `< 0.2ms`) |
| **零 GC 空间检索** | 圆形 (`queryRadius`) 与矩形 (`queryRect`) 纯静态纯函数检索，注入式复用外部接收缓冲。 | 单次查询 0 闭包、0 对象生成，支持溢出防截断 |
| **双轨双缓冲事件总线** | 5 整型字长定长事件流。关键事务通道 (0x8000) 512 容量**绝对零丢包**；瞬态通道 3584 容量环形 FIFO 覆盖。 | 单帧并发派发 50,000 事件耗时 **0.7ms**，重入隔离排入下帧 |
| **确定性伪随机数发生器** | 32 位 Mulberry32 确定性 PRNG，支持倒带、区间采样、倒置自动纠偏与独立分支衍生。 | 50,000 次采样均值收敛于 0.500 (误差 < 0.005) |

---

## 📁 目录结构 (Clean Architecture)

```text
├── docs/                      # 完备的软件工程设计规范文档
│   ├── game_design_document.md                   # 游戏总体设计文档 (GDD v2.2)
│   ├── system_requirements_specification.md      # 需求规格说明书 (SRS v1.1)
│   ├── technical_design_specification.md         # 架构设计规格书 (TDS v1.1)
│   ├── work_breakdown_structure.md               # 全量工作分解说明书 (WBS v1.1)
│   └── development_workflow_and_qa_specification.md # 研发管理宪法与QA规范说明书
├── src/                       # 核心业务源代码 (纯 ESM)
│   ├── core/                  # 基础设施 (ECS, SpatialHash, SpatialQuery, DomainEventBus, PRNG, GameLoop)
│   ├── components/            # SoA 平铺连续内存组件切片 (Transform, Physics, Health, CombatStats...)
│   └── data/                  # 不变平衡性配表、枚举字典、位掩码与种子编解码器
├── tests/                     # 自动化测试套件 (Vitest 驱动)
│   ├── core/                  # 基础设施单元测试与常驻内存足迹核算测试
│   └── data/                  # 数据层契约与平衡性测试
├── server.js                  # 轻量零依赖 ESM 静态预览服务器
└── package.json               # 项目包配置与测试脚本
```

---

## 🚀 快速上手 (Quick Start)

### 1. 环境准备
确保已安装 [Node.js](https://nodejs.org/) (推荐 Node 18+ 或 20+)。

### 2. 安装开发依赖
```bash
git clone https://github.com/Yhm1213/gods-terrarium-race-wars.git
cd gods-terrarium-race-wars
npm install
```

### 3. 运行自动化测试套件
```bash
npm test
```
*当前全量测试套件覆盖率：**7 个测试套件，79 个用例 100% 绿灯 PASS** (耗时 ~500ms)。*

### 4. 启动本地静态服务器
```bash
npm run serve
# 访问 http://localhost:3000/
```

---

## 🗺️ 研发路线图 (Roadmap)

- [x] **Milestone 0 (M0): 基础设施与 ECS 连续内存底座** (已完成并通过 Tier 2 评审)
  - 纯 SoA TypedArray ECS、0 号墓碑隔离与 Swap-and-Pop 稠密栈
  - 48px 平铺连续网格空间哈希与零 GC 检索
  - 双轨定长事件总线与确定性 PRNG
  - 核心内存精算 (0.53MB) 与 79 项单元测试闭环
- [ ] **Milestone 1 (M1): 极简宏观世界与生存代谢原型** (进行中)
  - $1344 \times 864$ 瓦片地图与 6 大群系养分底温矩阵生成
  - 种族专属代谢方程与饥饿损耗系统
  - 极端饥荒下的自噬变异与应急代谢互斥锁
  - 极简 60 FPS 渲染管线与无头帧推进集成
- [ ] **Milestone 2 (M2): 阵营政治、领地扩张与军团交锋**
- [ ] **Milestone 3 (M3): 宗教信仰、神圣干涉与异化突变**
- [ ] **Milestone 4 (M4): 历史编年史、四大战略超武与终极混沌演化**

---

## 🤝 贡献指南 (Contributing)

欢迎任何形式的 Issue 与 PR！提交代码前请确保：
1. 运行 `npm test` 并保证所有用例 100% 通过；
2. 保持热路径**绝对零 GC 纪律**（不得在单帧循环中分配临时 Object/Array/闭包）；
3. 遵循单向无环架构依赖规范。

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源。
