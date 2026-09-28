# 《Milestone 0 基础设施与底层架构：系统技术详细设计与数据契约说明书》

> **文档代号**：SPEC-M0-CONTRACT-v1.0 (Retrofit / 规范追溯补齐)  
> **制定基线**：Master GDD v2.2, SRS v1.1, TDS v1.1, WBS v1.1, 研发管理宪法 v1.0  
> **文档性质**：Milestone 0 阶段各子 Agent (`coder-core`, `qa-guardian`, `reviewer-architect`) 的**唯一硬性执行技术契约**。  
> **研发纪律**：锁死 `EntityID = 0` 墓碑隔离；纯 SoA 连续 TypedArray 平铺排布；热路径绝对物理零 GC。

---

## 目录与必读参考文档清单 (Mandatory Reference Docs)

开发与测试子 Agent 在动工或校验前，必须查阅：
1. `docs/system_requirements_specification.md`：
   - §3.8 核心基础设施引擎架构（`REQ-CORE-001` ~ `REQ-CORE-004`）
   - §12 底层致命守门断言（`TC-EDGE-01` ~ `TC-EDGE-09` 契约总览）
2. `docs/technical_design_specification.md`：
   - §1.1 纯面向数据 (DOD) 架构原则
   - §1.2 物理目录树与分层边界
   - §2 静态数值配表与数据字典规范（`RaceData`, `BiomeData`, `FactionData`, `MutationFlags`, `DomainEvents`）
   - §3 核心基础设施与 ECS 连续平铺内存池规范
3. `docs/work_breakdown_structure.md`：
   - §1.1 `WP-1.1.1` ~ `WP-1.1.4` (ECS 连续内存、48px 空间哈希、双轨事件总线、确定性随机)
4. `docs/development_workflow_and_qa_specification.md`：
   - §1.2 任务包派发与阶段契约先行动态规则
   - §2.1 ~ 2.4 Vitest 运行环境与覆盖率红线
   - §6.1 Milestone 0 验收标准

---

## 一、 ECS 连续平铺内存池契约 (`src/core/ECS.js` & `src/components/`)

### 1.1 实体容量与 0 号墓碑
* **规格**：`MAX_ENTITIES = 4096, TOTAL_SLOTS = 4097`；
* **0 号墓碑 (`NULL_ENTITY = 0`) 物理隔离**：
  - `freeStack` 初始化仅入栈 `[1, 4096]`，0 号槽位永不进入分配栈；
  - `allocateEntity()` 池满时严格返回 `0`；
  - `freeEntity(id)` 当 `id <= 0 || id > 4096` 直接防御拦截并返回 `false`；
  - `isAlive(0)` 恒为 `false`，组件 0 号切片锁死为墓碑，读写绝不抛出越界异常。

### 1.2 Swap-and-Pop 稠密栈管理
* `denseEntities`: `Uint16Array(4097)`，存储存活实体的紧密排布；
* `sparseIndices`: `Uint16Array(4097)`，实体 ID 到稠密栈索引的双向映射；
* 释放实体时，将稠密栈末尾实体置换至空缺槽位，迭代零空洞，删除复杂度严格 $O(1)$。

### 1.3 8 大组件纯 SoA 平铺切片规范
| 组件名称 | 连续 TypedArray 定义 | 步长 | 字段连续排布偏移 | 字节数 (Bytes) |
| :--- | :--- | :---: | :--- | :--- |
| **Transform** | `Float32Array(4097 * 4)` | 4 | `[x, y, rotation, scale]` (默认缩放 1.0) | 65,552 B |
| **Physics** | `Float32Array(4097 * 4)` | 4 | `[vx, vy, mass, invMass]` (锚点 invMass=0.0) | 65,552 B |
| **Health** | `Float32Array(4097 * 4)` | 4 | `[hp, maxHp, lastSrcId, lastDamageTick]` | 65,552 B |
| **CombatStats** | `Float32Array(4097 * 4)` | 4 | `[armor, bluntResist, pierceResist, reflectRatio]` | 65,552 B |
| **Physiology** | `Float32Array(4097 * 4)` | 4 | `[hunger, emergencyLockTimer, holdTimer, sacredBodyTimer]` | 65,552 B |
| **Morale** | `Float32Array(4097 * 2)` | 2 | `[morale, panicTimer]` | 32,776 B |
| **StatusFlags** | `Uint32Array(4097)` | 1 | 32 位无符号状态掩码 (`IS_ALIVE`, `IS_HELD` 等) | 16,388 B |
| **Identities** | `Uint32Array(4097 * 3)` | 3 | `[factionId, prodJobId, combatJobId]` | 49,164 B |
| **稠密/稀疏/空闲栈** | 3 $\times$ `Uint16Array(4097)` | 1 | 管理实体生命周期映射 | 24,582 B |

---

## 二、 48px 平铺连续网格与零 GC 空间哈希 (`src/core/SpatialHash.js` & `SpatialQuery.js`)

### 2.1 网格参数与计数排序前缀和
* **规格**：$1344 \times 864$ 物理世界，48px 桶宽，共 28 列 $\times$ 18 行 = **504 连续桶**；
* **双趟前缀和 (Prefix-Sum Counting Sort)**：
  - Pass 1：统计 504 桶活跃实体数至 `cellCounts` (Int16Array)；
  - 前缀和：计算切片起始偏移量至 `cellOffsets` (Int32Array)；
  - Pass 2：顺序填入 `compactEntityIds` (Int16Array)；
* **性能指标**：4096 活跃实体全量重构单次耗时严格 $< 0.2\text{ms}$，物理零 GC。

### 2.2 空间检索纯函数与防溢出截断 (`SpatialQuery.js`)
* `queryRadius(hashInstance, cx, cy, radius, outResults, maxCapacity = 512)`
* `queryRect(hashInstance, minX, minY, maxX, maxY, outResults, maxCapacity = 512)`
* **截断防溢出**：`cap = Math.min(maxCapacity, outResults.length)`，达到容量强制截断退出；
* **边界防御**：`Math.floor` 边界映射与超界检测，视口外部完全阻断不发生冗余遍历。

---

## 三、 双轨双缓冲环形事件总线 (`src/core/DomainEventBus.js`)

### 3.1 双轨分流与内存分配
* 单条事件定长 5 个 32 位整型：`[eventType, srcId, targetId, p1, p2]`；
* **关键事务通道 (`eventType & 0x8000 !== 0`)**：
  - 容量 512 槽位，满载时抛出严重异常，**100% 绝对零丢包**；
* **瞬态表现通道 (`eventType & 0x8000 === 0`)**：
  - 容量 3584 槽位，采用环形 FIFO 覆盖平稳降频；
* **双缓冲 Ping-Pong 架构**：
  - `bufferA` (80KB) 主写缓冲 + `bufferB` (10KB) 重入缓冲；
  - `flush()` 消费事件期间派发的新事件自动排入 `bufferB`，消费完毕平移回主通道，彻底消除递归调用栈溢出。

---

## 四、 32 位确定性随机系统 (`src/core/PRNG.js`)

* **算法**：Mulberry32 纯 32 位算法；
* **接口**：`next()`, `nextFloat()` [0.0, 1.0), `nextInt(min, max)` 闭区间采样（带 `floorMin > floorMax` 自动置换两极纠偏）；
* **倒带与衍生**：`reset()` 支持相同种子序列 100% 幂等复现，`fork()` 生成独立 PRNG 实例。

---

## 五、 M0 阶段常驻内存与质量守门门禁

* **静态常驻 TypedArray 内存上限**：全系统常驻内存严格 $\le 0.65\text{MB}$（实测精算为 **0.5308 MB / 543.53 KB**）；
* **无头单元测试门禁**：`npm test` 7 大测试套件、用例数 $\ge 50$ 且 100% 绿灯 PASS。
