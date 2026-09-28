# 《Milestone 1 宏观世界与生存代谢原型：系统技术详细设计与数据契约说明书》

> **文档代号**：SPEC-M1-CONTRACT-v1.0  
> **制定基线**：Master GDD v2.2, SRS v1.1, TDS v1.1, WBS v1.1, 研发管理宪法 v1.0  
> **文档性质**：Milestone 1 阶段所有子 Agent (`coder-systems`, `coder-rendering`, `qa-guardian`, `reviewer-architect`) 的**唯一硬性执行技术契约**。  
> **研发纪律**：任何代码实现严禁私自增改字段或篡改签名；所有热路径必须遵守**物理零 GC 纪律**（每帧 0 临时对象/数组/闭包创建）。

---

## 目录与必读参考文档清单 (Mandatory Reference Docs)

开发与测试子 Agent 在动工或校验前，**必须查阅以下文档的对应章节**：
1. `docs/system_requirements_specification.md`：
   - §3.1 生态与经济域需求（`REQ-ECO-001` ~ `REQ-ECO-004`）
   - §3.2 种族与代谢域需求（`REQ-RACE-001` ~ `REQ-RACE-002`）
   - §12 底层致命守门断言（`TC-EDGE-02`, `TC-EDGE-03`）
2. `docs/technical_design_specification.md`：
   - §1.3 确定性单向帧序执行管线（物理 Tick 编排时序）
   - §2.1 12 基础种族物理参数字典（`RaceData.js`）
   - §2.3 6 大生物群系阻力与地貌字典（`BiomeData.js`）
   - §2.6 领域事件总线双轨枚举字典（`DomainEvents.js`）
3. `docs/work_breakdown_structure.md`：
   - §2.1 `WP-2.1.1` 56x36 瓦片网格与 6 大生物群系阻力场
   - §2.2 `WP-2.2.1` 二维拉普拉斯连续地脉养分扩散场与 Neumann 绝热反射
   - §2.2 `WP-2.2.3` 2x2 农田四阶演替状态机与开垦轮作
   - §2.4 `WP-2.4.1` 应急降级生存代谢网与 10s 通道互斥锁
   - §3.1 `WP-3.1.1` 基础主干代谢与饥饿系统
   - §8.1 `WP-8.1.1` 极简 60 FPS 渲染管线与宏观世界视窗
   - §9.1 `WP-9.1.1` 物理刚体刚性边界与图腾绝对锚定守门测试套件
4. `docs/development_workflow_and_qa_specification.md`：
   - §2 单元测试覆盖率红线与无头 Node 运行纪律
   - §5 静态代码评审卡点（ES2022+、无循环依赖、无运行时垃圾）
   - §6.2 Milestone 1 验收标准与演示门禁

---

## 一、 地图与瓦片网格数据契约 (`src/world/TileGrid.js`)

### 1.1 物理几何与拓扑规格
* **网格尺寸**：宽 $W_{\text{tile}} = 56$，高 $H_{\text{tile}} = 36$，总瓦片数 $N_{\text{tiles}} = 2016$；
* **瓦片物理步长**：$S_{\text{tile}} = 24.0\text{px}$；
* **全局世界尺寸**：$1344.0\text{px} \times 864.0\text{px}$（与空间哈希 28x18 桶按 48px/桶 呈 $2:1$ 整数拓扑嵌套）；
* **坐标与索引双向纯数学映射**：
  $$\text{tileIndex} = y \times 56 + x \quad (0 \le x < 56, 0 \le y < 36)$$
  $$\text{worldCenterX} = (x + 0.5) \times 24.0, \quad \text{worldCenterY} = (y + 0.5) \times 24.0$$
  $$\text{tileX} = \lfloor \text{worldX} / 24.0 \rfloor, \quad \text{tileY} = \lfloor \text{worldY} / 24.0 \rfloor$$

### 1.2 纯 SoA TypedArray 平铺内存排布
`TileGrid` 实例内存总占用严格收敛在 **~22 KB**，全部为定长平铺连续内存：
```javascript
this.tileTypes = new Uint8Array(2016);          // 群系类型 ID [0, 6] (2,016 B)
this.moveCost = new Float32Array(2016);         // 移动阻力倍率 (8,064 B)
this.elevation = new Float32Array(2016);        // 海拔高度 [-1.0, 1.0] (8,064 B)
this.hazardDamage = new Float32Array(2016);     // 瓦片每秒环境伤害 (8,064 B)
this.hazardType = new Uint8Array(2016);         // 0=无, 1=灼烧, 2=腐蚀, 3=神圣 (2,016 B)
```

### 1.3 6 大生物群系参数强拉齐契约 (`src/data/BiomeData.js`)
| 群系 ID | 枚举名称 | 中文名称 | moveCostMultiplier | 基础底温 nutrientFloor | 灾害类型 | 伤害 hazardDps | 默认地貌颜色 |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `0` | `PLAINS` | 温带平原 | `1.0` | `0.30` | `0` (无) | `0.0` | `#4a7c59` |
| `1` | `MOUNTAIN`| 高山岩矿 | `1.5` | `0.05` | `0` (无) | `0.0` | `#7a7a7a` |
| `2` | `SHALLOW_WATER` | 浅水滩涂 | `1.4` | `0.20` | `0` (无) | `0.0` | `#3b7a9e` |
| `3` | `DEEP_WATER` | 深水绝壁 | `999.0` (不可通行)| `0.10` | `0` (无) | `0.0` | `#163854` |
| `4` | `SWAMP` | 腐蚀沼泽 | `1.8` | `0.40` | `2` (腐蚀) | `1.0` (真伤/s) | `#2a4436` |
| `5` | `VOLCANO` | 地热熔岩 | `2.2` | `0.00` | `1` (灼烧) | `2.0` (火伤/s) | `#932200` |
| `6` | `HOLY_SPRING` | 神圣泉眼 | `0.9` | `0.85` | `3` (神愈) | `-2.0` (愈合/s)| `#ffd700` |

### 1.4 API 方法契约
- `getTile(x, y)`: 读取瓦片类型，带 Clamp 边界防护，绝不越界或抛出 RangeError；
- `setTile(x, y, biomeId)`: 原子写入类型并同步刷新 `moveCost`, `elevation`, `hazardDamage`；
- `worldToTile(wx, wy)`: 物理浮点坐标转为 `[x, y]`（带 `Math.floor` 与 Clamp 阻尼）；
- `tileToWorld(tx, ty)`: 瓦片坐标转为物理中心点坐标；
- `isWalkable(x, y)`: `moveCost[idx] < 100.0`。

---

## 二、 二维拉普拉斯连续地脉养分扩散场契约 (`src/ecosystem/NutrientField.js`)

### 2.1 偏微分数学模型与数值求解
$$N_{i,j}^{t+\Delta t} = N_{i,j}^t + \alpha \cdot \Delta t \cdot \nabla^2 N_{i,j} + S_{i,j} - D_{i,j}$$
* 扩散系数：$\alpha = 0.05$；
* 离散五点拉普拉斯算子：
  $$\nabla^2 N_{i,j} = N_{i+1,j} + N_{i-1,j} + N_{i,j+1} + N_{i,j-1} - 4 N_{i,j}$$
* 积分时间步长：默认单帧 $\Delta t = 1.0$（按 1/60s 标定）；
* **冯·诺伊曼 (Neumann) 绝热反射边界条件**（能量不向外界逸散）：
  - 当 $i-1 < 0$ 时，左邻居镜像取自身：$N_{-1, j} \equiv N_{0, j}$；
  - 当 $i+1 \ge 56$ 时，右邻居镜像取自身：$N_{56, j} \equiv N_{55, j}$；
  - 当 $j-1 < 0$ 时，上邻居镜像取自身：$N_{i, -1} \equiv N_{i, 0}$；
  - 当 $j+1 \ge 36$ 时，下邻居镜像取自身：$N_{i, 36} \equiv N_{i, 35}$。
* **群系底温保底硬约束**：
  $$N_{i,j} = \max(N_{i,j}, \text{BiomeData}[T_{i,j}].\text{nutrientFloor} \times 50.0)$$

### 2.2 内存连续性
* 双缓冲 `Float32Array(2016)`：`bufferA` 与 `bufferB`（各 8,064 字节，共 16.1 KB）；
* `update(dt)` 执行 Ping-Pong 双缓冲原子指针置换，**每帧零内存分配**。

---

## 三、 2x2 农田四阶演替状态机契约 (`src/ecosystem/FarmlandSystem.js`)

### 3.1 农田几何与状态枚举
* 农田由 $2 \times 2$ 共 4 个瓦片复合而成（左上角为基准锚点）；
* **四阶演替状态**：
  ```javascript
  export const FarmlandPhase = Object.freeze({
    SPROUT: 0,    // 幼苗期 (生长期 15.0s，持续从地脉汲取 0.2/s 养分)
    MATURE: 1,    // 成熟期 (产出 40 单位粮食储备，等待农民收割)
    HARVESTED: 2, // 枯黄期 (被收割后扣减瓦片地脉 5 点养分)
    FALLOW: 3     // 休耕期 (锁闭 20.0s，地脉养分自然回流至 15.0 以上重启循环)
  });
  ```
### 3.2 损毁与反作弊惩罚
* 战火点燃或被外力践踏：强制中断当前期，直接跃迁至 `FALLOW`，扣除当前 4 个瓦片各 10.0 点地脉养分。

---

## 四、 12 种族主干生存代谢与饥饿系统契约 (`src/ecosystem/MetabolismSystem.js`)

### 4.1 核心数据结构与组件绑定
* 严格绑定 `src/components/PhysiologyComponent.js`：
  - `hunger`：`Float32Array(4097)`，范围 $[0.0, 100.0]$，默认初始值 `0.0`；
  - `emergencyLockTimer`：`Float32Array(4097)`，倒计时秒数；
* 严格绑定 `src/components/HealthComponent.js`：
  - `hp`：生命值；
* 种族数据源：`src/data/RaceData.js` 中的 `metabolicRate` 与 `metabolicType`。

### 4.2 代谢数学方程
* 单帧饥饿增量：
  $$\Delta \text{Hunger} = \text{metabolicRate} \times \Delta t \times 1.0$$
  - 特殊免饥饿规则：亡灵 (`UNDEAD`) 与魔像 (`GOLEM`) 的 `metabolicRate === 0.0`，恒定不消耗；
  - 魔眼 (`BEHOLDER`)：驻留在神圣泉眼或沃土上时光合作用直接冲抵饥饿；
* **饥饿惩罚与生命衰竭**：
  - 当 $\text{hunger} \ge 80.0$ 时，触发重度饥饿状态：
    $$\text{hp} = \max(0.0, \text{hp} - 0.5 \times \Delta t)$$
    并在士气组件 `MoraleComponent` 中持续施加崩溃减益；
  - 当 $\text{hp} \le 0.0$ 时：
    - 派发关键事务领域事件 `DomainEvents.EVT_DEATH_STARVATION` (0x8001)；
    - 载荷参数：`srcId = entityId, targetId = 0, p1 = tileIndex, p2 = raceId`；
    - 实体通过 `ECS.freeEntity(entityId)` 安全回收；
    - 当前瓦片养分沉降骨粉：$\text{NutrientField.addNutrient}(tx, ty, 15.0)$。
* **墓碑安全防护**：
  - 对 `entityId === 0 (NULL_ENTITY)` 严禁执行任何饥饿结算。

---

## 五、 应急降级生存网与 10s 通道互斥锁契约 (`src/ecosystem/EmergencyMetabolismSystem.js`)

### 5.1 降级策略分支表
当 `hunger >= 80.0` 且其归属阵营无粮食仓储、周边无成熟农田时触发：
1. **农耕种族 (`metabolicType === 0`)**：
   - 动作：就地啃食杂草/树皮；
   - 效果：$\text{hunger} = \max(0, \text{hunger} - 15.0)$，$\text{hp} = \max(1, \text{hp} - 5.0)$，$\text{morale} -= 20.0$；
2. **捕猎种族 (`metabolicType === 1`)**：
   - 动作：食用腐肉残渣；
   - 效果：$\text{hunger} = \max(0, \text{hunger} - 25.0)$；
   - 确定性致病判定：调用 `PRNG.nextFloat() < 0.50`，若命中则状态位置位 `IS_POISONED`，移动减速 50% 持续 8.0s；
3. **掠夺种族 (`metabolicType === 2`)**：
   - 动作：同伴互殴抢夺口粮；
   - 效果：向最近同伴派发 `EVT_BRAWL_RATION`，掠夺其 20 点饱腹度。

### 5.2 10 秒独占通道互斥锁 (Channel Mutex)
* **激活**：切入应急动作瞬间，写入 `PhysiologyComponent.emergencyLockTimer = 10.0`，并在 `UnitStatusFlags` 置位 `IS_EMERGENCY_LOCK`；
* **锁闭约束**：在 10 秒倒计时未归零前，**行为树与外部寻路绝对不可打断该实体当前的应急动作**（即使身旁突然成熟了农田）；
* **释放**：
  $$\text{emergencyLockTimer} \le 0.0 \quad \text{AND} \quad \text{hunger} < 50.0 \implies \text{清除 } \text{IS_EMERGENCY_LOCK}$$
  彻底消灭 10 帧来回抖动的抽搐死锁！

---

## 六、 渲染管线与视窗数据契约 (`src/rendering/MiniRenderer.js` & `index.html`)

### 6.1 渲染无分配 (Zero Allocation) 铁律
* 主渲染循环中**禁止 `new Object()`, `new Array()`, 字符串拼接 `rgba(...)`**；
* 预分配颜色查表（Palette Lookup Table）：针对 6 群系与 12 种族预分配常量字符串；
* **0 次 `ctx.save()` / `ctx.restore()`**：纯状态机式复位 `fillStyle` / `globalAlpha`，避免 GPU 状态栈开销。

### 6.2 视图层与逻辑层数据单向隔离
* `MiniRenderer` 仅对 `TileGrid`, `NutrientField`, `ECS` 进行只读访问；
* 严禁在渲染器内部修改实体的物理或生理状态。

---

## 七、 质量守门断言契约 (Guardrails & DoD)

| 测试文件 | 目标构件 | 机器可执行硬断言 |
| :--- | :--- | :--- |
| `tests/world/TileGrid.test.js` | `TileGrid.js` | `grid.cols === 56`, `grid.rows === 36`, `grid.tileTypes.length === 2016`；坐标 `(-1, 0)` Clamp 不崩溃。 |
| `tests/ecosystem/NutrientField.test.js` | `NutrientField.js` | 封闭系统 1000 步扩散前后总能量浮点误差 $< 10^{-4}$；边界逸散通量为 0；$N_{i,j} \ge \text{Floor}$。 |
| `tests/ecosystem/FarmlandSystem.test.js` | `FarmlandSystem.js` | 幼苗 $\rightarrow$ 成熟(40粮) $\rightarrow$ 枯黄 $\rightarrow$ 休耕；遭受战火即刻跳入休耕扣减 10 养分。 |
| `tests/ecosystem/MetabolismSystem.test.js` | `MetabolismSystem.js` | 12 种族饥饿损耗速率对齐配表；`hunger > 80` 每秒掉血 0.5 HP；`hp <= 0` 派发死亡事件且 0 号墓碑免受影响。 |
| `tests/ecosystem/EmergencyMetabolismSystem.test.js` | `EmergencyMetabolismSystem.js` | 实体切入应急状态，`emergencyLockTimer` 10s 内不响应重寻路；100 次食用腐肉致病率收敛于 50%。 |
| `tests/guardrails/WorldBoundaryGuard.test.js` | TC-EDGE-02, TC-EDGE-03 | 10,000 次极限速度 ($100,000\text{px/s}$) 投掷越界率为 0.0%；图腾质量无穷大，受击位移恒为 0。 |
