# 《Milestone 2 种族特性、阶级分工与繁衍突变系统：系统技术详细设计与数据契约说明书》

> **文档代号**：SPEC-M2-CONTRACT-v1.0  
> **制定基线**：Master GDD v2.2, SRS v1.1, TDS v1.1, WBS v1.1, 研发管理宪法 v1.0, 策划专册 02/03/04, 经验教训登记册 (LL-001 ~ LL-007)  
> **文档性质**：Milestone 2 阶段所有子 Agent (`coder-systems`, `coder-rendering`, `qa-guardian`, `reviewer-architect`) 的**唯一硬性执行技术契约**。  
> **研发纪律**：
> 1. 母 Agent 严格恪守 PM 职责，绝对禁止私自编辑生产源码；
> 2. 所有代码变更实行代码所有权责任制，缺陷整改工单定向打回原作者；
> 3. 热路径物理/逻辑循环绝对**零 GC**（每帧 0 临时对象/数组/闭包创建）；
> 4. 视窗展现层拒绝假 Mock“两张皮”，必须原生 ESM 消费全部真实系统构件。

---

## 目录与必读参考文档清单 (Mandatory Reference Docs)

开发、渲染、测试与审查子 Agent 在动工或校验前，**必须查阅以下文档的对应章节**：
1. `docs/01_design/design_books/`：
   - `02_races_and_civilization.md`：§一 四大生存代谢范式、§二 12 基础种族全量物理参数与变异禁忌、§四 无机死灵权力交替与命匣继承、§五 质量碰撞反冲公式
   - `03_professions_and_multiclass.md`：§一 核心动作经济学控制、§二 四大恶性流派平衡阀门 (ICD $\ge 1.5$s, 税后反伤, 备用短刀, 单次殉道)、§三 复合多职业矩阵
   - `04_mutation_and_evolution_engine.md`：§一 动作通道仲裁协议 (三大正交轨道)、§二 CFG 语法文法与相容性张量过滤、§三 孟德尔双倍体显隐性与模式 A 基因驱动
2. `docs/01_design/system_requirements_specification.md`：
   - §4 12 魔幻种族与生存代谢范式需求矩阵 (`REQ-RACE-001` ~ `REQ-RACE-006`)
   - §5 双职业兼职与流派修复需求矩阵 (`REQ-CLS-001` ~ `REQ-CLS-003`)
   - §6 无预设突变引擎与孟德尔基因驱动需求矩阵 (`REQ-MUT-001` ~ `REQ-MUT-005`)
3. `docs/01_design/technical_design_specification.md`：
   - §2.1 12 基础种族物理参数字典 (`src/data/RaceData.js`)
   - §2.2 正交变异器官掩码库 (`src/data/MutationFlags.js`)
   - §3.2 高频物理与生理组件排布常量 (`ECS.js`)
   - §3.3 实体 32 位状态位掩码表 (`UnitStatusFlags.js`)
   - §5.2 全局领域事件枚举字典 (`DomainEvents.js`)
4. `docs/00_governance/lessons_learned_register.md`：
   - 严格对照 **LL-001 ~ LL-007** 纠正与预防措施 (CAPA)，执行前置闭环检查。

---

## 一、 12 始祖种族特异技能与状态标志位契约

### 1.1 12 种族特异技能矩阵 (`src/data/RaceSkillData.js`)
12 大始祖种族各拥有 1 个常驻特异被动特性与 1 个专属触发/主动技能。所有主动技能强制配备独立内置冷却时间 (ICD $\ge 1.5\text{s}$)，严禁高频连环震荡自激：

| 种族 ID | 种族全称 | 专属主动/触发技能 | 触发条件 / 释放效果 | 内置冷却 (ICD) / 持续时间 | 专属被动特性 | 物理/数值机制 |
| :---: | :--- | :--- | :--- | :---: | :--- | :--- |
| `ORC` | 绿皮菌兽 | **【战吼狂化】**<br/>`WAAAGH_ROAR` | 遭遇敌军或生命 $<50\%$ 时释放：移速 $+40\%$，攻击 $+30\%$ | ICD = $10.0\text{s}$<br/>持续 $4.0\text{s}$ | **【菌丝再生】**<br/>`MYCELIUM_REGEN` | 受到致死伤害时不立即死亡，锁定 1 HP 并以 $2.5\text{HP/s}$ 再生，持续 $3.0\text{s}$ (限单场 1 次) |
| `ELF` | 森灵树民 | **【自然愈合】**<br/>`NATURE_MENDING` | 自身或周边 3 格友军生命 $<60\%$ 时：为范围内友军恢复 $25\text{HP}$ | ICD = $8.0\text{s}$<br/>瞬发 | **【草木亲和】**<br/>`FLORA_AFFINITY` | 在平原/草地移速 $+25\%$；但受到火焰属性伤害额外加深 $+40\%$ |
| `HUMAN` | 人类帝国 | **【军纪战阵】**<br/>`PHALANX_FORM` | 进入交战状态且周边有友军：周边 2 格同伴护甲 $+10$，士气强制锁定 100 | ICD = $12.0\text{s}$<br/>持续 $6.0\text{s}$ | **【万金油适应】**<br/>`VERSATILITY` | 无任何变异禁忌掩码；职业觉醒与阶级晋升履历阈值降低 $30\%$ |
| `DWARF` | 高山矮人 | **【麦酒狂暴】**<br/>`ALE_FRENZY` | 受到暴击或被围攻：猛饮麦酒，获得霸体（免疫击退与硬直），反伤系数 $+30\%$ | ICD = $10.0\text{s}$<br/>持续 $5.0\text{s}$ | **【顽石重甲】**<br/>`STONE_BULWARK` | 常驻护甲 $+8.0$，钝击抗性 $+30\%$；禁忌薄翼（`OrganFlags.WING`） |
| `UNDEAD` | 墓园亡灵 | **【骸骨苏生】**<br/>`BONE_ANIMATION` | 身旁 2 格内存在尸体残骸：消耗 1 具尸体就地唤醒 1 具无意识骷髅仆从 | ICD = $15.0\text{s}$<br/>瞬发 | **【枯骨无畏】**<br/>`TERROR_IMMUNITY` | 完全免疫饥饿，士气恒为 $\infty$ (绝不溃散)；受到神圣属性伤害 $+50\%$ |
| `GOBLIN` | 狂躁地精 | **【顺手打落】**<br/>`DISARM_TRICK` | 贴身背刺敌方单位：$40\%$ 几率打落敌方兵器在地面，使其进入缴械态 $6.0\text{s}$ | ICD = $10.0\text{s}$<br/>持续 $6.0\text{s}$ | **【狡黠逃逸】**<br/>`CUNNING_ESCAPE` | 质量仅 26kg，受到致命攻击时有 $35\%$ 几率触发平地翻滚脱离交战 |
| `DEMON` | 深渊角魔 | **【地狱烈焰】**<br/>`INFERNAL_BREATH` | 正面朝向敌群：喷射 3 格扇形烈火，造成 $30$ 点火伤并点燃瓦片 | ICD = $8.0\text{s}$<br/>持续 $1.2\text{s}$ | **【焦土强躯】**<br/>`SCORCHED_FLESH` | 火焰抗性 $+50\%$，踏足岩浆不受伤害；但涉入水体移速降低 $30\%$ |
| `LIZARD` | 沼泽蜥蜴人 | **【毒镖飞刺】**<br/>`POISON_DART` | 距离目标 3~5 格：投掷带毒飞镖造成 $15$ 穿刺伤害并附加减速 $50\%$ 持续 $4\text{s}$ | ICD = $6.0\text{s}$<br/>瞬发 | **【湿滑冷血】**<br/>`SLICK_SCALE` | 在浅水与沼泽移速 $+40\%$，酸液抗性 $+60\%$；怕寒冷与地热 |
| `BEAST` | 荒原兽化人 | **【巨兽飞扑】**<br/>`FERAL_POUNCE` | 距离目标 2~4 格：向前飞扑撞击目标造成 $35$ 冲击伤害并击退 2 格 | ICD = $8.0\text{s}$<br/>持续 $0.5\text{s}$ | **【兽肌强袭】**<br/>`MUSCLE_IMPACT` | 质量 85kg，冲量对撞优势明显；饱腹度 $<20\%$ 时攻击力提升 $+20\%$ |
| `SPORE` | 孢子真菌人 | **【致幻毒孢】**<br/>`SPORE_BURST` | 自身受到近战攻击：向周围散播致幻孢子云，使敌人陷入眩晕/自相残杀 $3.0\text{s}$ | ICD = $12.0\text{s}$<br/>持续 $3.0\text{s}$ | **【腐殖反哺】**<br/>`FUNGAL_SYMBIOSIS` | 阵亡时尸体立即化为肥料，向所在瓦片注水注养 $+20.0$ 养分 |
| `GOLEM` | 晶石魔像 | **【地脉震击】**<br/>`EARTH_SHATTER` | 蓄力重砸地面：震裂周围 2 格地表，造成 $40$ 点钝击伤害并眩晕敌人 $1.5\text{s}$ | ICD = $14.0\text{s}$<br/>持续 $1.0\text{s}$ | **【硅基超重】**<br/>`SILICON_SUPERMASS` | 质量 180kg 绝对不可被击退，免疫流血、瓦斯与酸蚀；断能 180s 石化 |
| `ABERR` | 拟态魔眼 | **【灵能震爆】**<br/>`PSIONIC_BLAST` | 视线聚焦敌方核心目标：发射心灵冲击，削减目标 $40$ 点士气并强制定身 $2.0\text{s}$ | ICD = $9.0\text{s}$<br/>瞬发 | **【虚空浮游】**<br/>`VOID_LEVITATION` | 漂浮飞行无视地面泥泞与阻力；但穿刺与钝击抗性为 $-30\%$ |

### 1.2 动作通道仲裁协议 (Action Channel Protocol)
为根除“小人在地上躺着装死却像火箭一样贴地滑翔穿墙”的状态机冲突，所有实体行为严格受控于 **3 个独立正交的动作轨道（Channels）**：
```text
[轨道 1: 机动位移轨 (Locomotion Channel)] -> 正常奔跑 (RUN) / 冲刺飞扑 (DASH) / 击退硬直 (KNOCKBACK) / 强制静止 (STATIONARY)
[轨道 2: 姿势姿态轨 (Stance Channel)]    -> 直立作战 (STAND) / 倒地装死 (PRONE) / 钻入地底 (BURROW) / 滞空悬浮 (FLOAT)
[轨道 3: 释放喷射轨 (Emission Channel)]  -> 技能施法 (CAST) / 体液喷洒 (SPIT) / 战吼叫喊 (SHOUT) / 静默无动作 (IDLE)
```
* **互斥仲裁法则**：
  1. `Locomotion` 轨与 `Stance` 轨强约束：当实体处于 `PRONE`（倒地/装死）时，`Locomotion` 轨线速度矢量强制归零（$vx = 0, vy = 0$），禁止执行任何机动动作；
  2. 当处于 `KNOCKBACK`（击退弹射）状态时，强制打断当前 `Emission` 轨的施法动作，重置释放状态并进入技能冷却惩罚；
  3. `Emission` 轨技能释放时，若属于读条技能（如魔像地脉震击蓄力），`Locomotion` 轨强制降速至 $0$。

### 1.3 技能组件与连续内存排布 (`src/components/RaceSkillComponent.js`)
采用与 ECS 规范完全一致的平铺连续 TypedArray 内存池，总槽位数严格为 `TOTAL_SLOTS = 4097`：
```javascript
export const SKILL_STRIDE = 4;
export const SKILL_OFFSET_COOLDOWN = 0;   // 技能内置冷却倒计时 (秒, <= 0 可再次释放)
export const SKILL_OFFSET_DURATION = 1;   // 当前主动技能持续生效倒计时 (秒)
export const SKILL_OFFSET_CHANNEL = 2;    // 当前占用的动作轨道位掩码 (bit0: Locomotion, bit1: Stance, bit2: Emission)
export const SKILL_OFFSET_PARAM = 3;      // 技能特异参数缓冲 (如蓄力时间、充能计数)

export function createRaceSkillBuffer() {
  return new Float32Array(TOTAL_SLOTS * SKILL_STRIDE); // 4097 * 4 * 4B ≈ 65.5 KB
}
```

### 1.4 状态掩码扩充契约 (`src/components/UnitStatusFlags.js`)
在 32 位整型字高位无冲突扩充（利用 18 ~ 22 未占用位）：
```javascript
export const IS_SKILL_ACTIVE       = ((1 << 18) >>> 0); // 0x40000: 主动技能效果持续生效中
export const IS_CASTING            = ((1 << 19) >>> 0); // 0x80000: 正在施法读条中 (动作轨道占用)
export const IS_DISARMED           = ((1 << 20) >>> 0); // 0x100000: 处于缴械状态 (拔出备用短刀)
export const IS_GENE_DRIVEN        = ((1 << 21) >>> 0); // 0x200000: 携带模式 A 基因驱动显性偏向
export const IS_IMMOBILIZED        = ((1 << 22) >>> 0); // 0x400000: 处于定身状态 (机动轨锁死)
```

---

## 二、 四大社会阶级动态晋升与无环有限状态机 (FSM) 契约

### 2.1 四大阶级定义与职能划分
彻底驱逐声望、满意度等虚空属性，四大阶级 100% 依托实体物理身份、劳作产出与战斗履历：

| 阶级枚举 | 代码值 | 阶级名称 | 核心行为与社会职能 | 准入门槛与产生源头 |
| :--- | :---: | :--- | :--- | :--- |
| `CIVILIAN` | `0` | **平民** (Civilian) | 农耕播种、果实采集、基础物资搬运、幼崽繁育 | 种族新生儿默认初始阶级；战俘降级初始阶级 |
| `ARTISAN` | `1` | **工匠** (Artisan) | 农田水利建设、边境筑墙修垒、装备武器锻造、魔像方尖碑充能 | 平民劳作经验蓄满，且氏族工匠比例 $< 30\%$ 时自发晋升 |
| `SOLDIER` | `2` | **士兵** (Soldier) | 领地边境巡逻、敌军入侵交战、外出捕猎围歼、粮仓护卫防暴 | 平民承受外部伤害/击杀入侵者，或战时战备总动员晋升 |
| `LEADER` | `3` | **领袖** (Leader) | 阵营总督统率、士气稳定光环、决定宣战与停战、主导大分裂 | 阵营老领袖阵亡后，由功勋士兵/大工匠通过继承规则加冕 |

### 2.2 晋升有向无环图 (Acyclic DAG) 与转换判定
为杜绝 FSM 状态机出现 `平民 <-> 士兵` 在每一帧来回横跳振荡的死锁问题，推行**单向优先级与滞后防抖回线 (Hysteresis Loop)**：

```
       ┌────────────────────────┐
       │   新生儿出生 / 战俘流民  │
       └───────────┬────────────┘
                   ▼
       ┌────────────────────────┐
       │    【CIVILIAN 平民】    │◄─────────────────┐ (和平复员)
       └─────┬────────────┬─────┘                  │
             │ (劳作积累)  │ (遭受袭击/动员)         │
             ▼            ▼                        │
    ┌─────────────┐  ┌─────────────┐               │
    │【ARTISAN 工匠】│  │【SOLDIER 士兵】│───────────────┘
    └──────┬──────┘  └──────┬──────┘ (战备超 60s 且无外患)
           │ (战时动员)      │
           └──────► ◄───────┘
                    │ (老领袖驾崩 + 功勋结算)
                    ▼
           ┌─────────────────┐
           │ 【LEADER 领袖】  │
           └────────┬────────┘
                    ▼ (阵亡 / 命匣粉碎 / 断能石化)
              【NULL 墓碑】
```

#### 状态转换判据方程与门限表：
1. **平民 $\rightarrow$ 工匠 (`CIVILIAN -> ARTISAN`)**：
   - 条件：`laborCount >= 5`（完成 5 次收割、搬运或建造）且该阵营内 $\frac{\text{Artisans}}{\text{TotalPop}} < 0.30$；
   - 动作：阶级变更为 `ARTISAN`，派发 `EVT_CASTE_PROMOTED`；
2. **平民 $\rightarrow$ 士兵 (`CIVILIAN -> SOLDIER`)**：
   - 条件：`damageTaken >= 50.0`（承受战斗伤害）或 `kills >= 1`，或阵营处于战争状态且 $\frac{\text{Soldiers}}{\text{TotalPop}} < 0.40$；
   - 动作：阶级变更为 `SOLDIER`，移速由平民步长切入巡逻/迎战步长；
3. **工匠 $\rightarrow$ 士兵 (`ARTISAN -> SOLDIER`)**：
   - 条件：阵营遭遇灭国级入侵（敌军深入图腾 5 格），开启全员动员；
4. **士兵 $\rightarrow$ 工匠 (`SOLDIER -> ARTISAN`)**：
   - 条件：阵营进入和平状态超 $60.0\text{s}$，且士兵过剩（$> 50\%$），触发退伍复员；
5. **任意阶级 $\rightarrow$ 领袖 (`ANY -> LEADER`)**：
   - 唯一性硬性约束：**每个阵营同时存活的领袖数量严格 $\le 1$**；
   - 触发时机：老王驾崩（`EVT_RULER_DIED`）或阵营创始建国；
   - 继承仲裁：根据政体与种族特性（亡灵死气决斗、魔像算力主脑、兽人质量对决、帝国世袭），选出第一候选人，晋升为 `LEADER` 并置位 `IS_LEADER` 状态掩码，向总线广播关键事务 `EVT_HEIR_CROWNED`；
6. **防振荡滞后锁 (Anti-Oscillation Cooldown)**：
   - 每次阶级跃迁瞬间，强制写入 `promotionCooldown = 15.0` 秒；
   - 在该倒计时归零前，**绝对禁止再次改变阶级**（即使外部条件反复跨越阈值）。

### 2.3 阶级组件连续内存排布 (`src/components/SocialCasteComponent.js`)
```javascript
export const CASTE_STRIDE = 4;
export const CASTE_OFFSET_TYPE = 0;       // 阶级枚举: 0=CIVILIAN, 1=ARTISAN, 2=SOLDIER, 3=LEADER
export const CASTE_OFFSET_EXP_LABOR = 1;  // 劳作经验积累 (浮点数)
export const CASTE_OFFSET_EXP_COMBAT = 2; // 战斗经验积累 (承伤+击杀)
export const CASTE_OFFSET_COOLDOWN = 3;   // 15s 晋升防振荡冷却倒计时 (秒)

export function createSocialCasteBuffer() {
  return new Float32Array(TOTAL_SLOTS * CASTE_STRIDE); // 4097 * 4 * 4B ≈ 65.5 KB
}
```

---

## 三、 孟德尔遗传算法与随机突变位图管线契约

### 3.1 双倍体等位基因模型 (Diploid Allele Representation)
废除旧有粗暴的单值突变，全面实行双倍体群体遗传学建模：
* 每个小人在 `GeneticsComponent` 中携带一对等位基因：$\langle \text{Allele}_{\text{maternal}}, \text{Allele}_{\text{paternal}} \rangle$；
* 等位基因取值为 `MutationFlags.js` 中的 9 大正交器官位掩码（`OrganFlags`）；
* **显隐性表达法则**：
  - 野生隐性基底（Wild Type Allele，代码 `0`，显性度 $d = 0.2$）；
  - 突变器官等位基因为不完全显性（Mutant Allele，显性度 $D = 0.7$）；
  - **表型表达掩码**：
    $$\text{PhenotypeMask} = \text{Allele}_{\text{maternal}} \mid \text{Allele}_{\text{paternal}}$$
    只要有一条染色体携带突变器官位，且通过种族禁忌过滤，该器官即在小人肉体上表达！

### 3.2 孟德尔杂交确定性算法 (`src/mutation/MendelianGeneticsSystem.js`)
当两个小人完成交配繁衍（或单性出芽/死灵拼装）产下后代实体时，执行确定性配子组合：
1. **减数分裂与配子分离**：
   - 母本减数分裂：调用 `PRNG.nextFloat() < 0.5`，决定母本配子遗传 $\text{Allele}_{\text{maternal}}$ 还是 $\text{Allele}_{\text{paternal}}$；
   - 父本减数分裂：同样调用 `PRNG.nextFloat() < 0.5`，决定父本配子传递哪一条等位基因；
2. **结合为受精卵**：
   - 子代 $\text{Allele}_{\text{maternal}} \leftarrow$ 母本配子；
   - 子代 $\text{Allele}_{\text{paternal}} \leftarrow$ 父本配子；
   - **理论分离比断言**：双杂合子亲本 ($Aa \times Aa$) 杂交，子代基因型比例严格收敛于 $AA : Aa : aa = 1 : 2 : 1$，表型显隐比严格收敛于 $3 : 1$。
3. **随机突变扰动**：
   - 基础繁殖突变率 $P_{\text{base}} = 0.05$；
   - 当受到环境辐射、沃土刺激或上帝神力照射时，突变率动态提升至 $0.20 \sim 0.35$；
   - 若命中突变，由 `PRNG.nextInt(0, 9)` 随机抽取 1 个候选器官位掩码，异或注入其中一条等位基因。

### 3.3 种族变异禁忌掩码拦截与语义重映射契约 (`src/mutation/TabooFilter.js`)
任何突变位掩码在注入实体前，**必须经过严格的种族禁忌过滤与语义重映射**，绝不允许直接生搬硬套导致种族自杀或穿模：
* 校验入口：`isOrganTaboo(raceId, organMask)`；
* 若命中禁忌位，执行**保底语义重映射 (Semantic Remapping Table)**：

| 种族 ID | 违禁触发器官 | 语义重映射替换器官 | 替换理由与策划自洽解释 |
| :---: | :--- | :--- | :--- |
| `ELF` | `FLAME` (烈焰) 或 `GAS` (瓦斯) | $\rightarrow$ `GAS` (重映射为【剧毒孢子囊】) | 森灵无法喷火自焚，降级为草木相容的孢子毒气 |
| `DWARF` | `WING` (轻盈昆虫薄翼) | $\rightarrow$ `GRANITE` (花岗岩厚重骨刺) | 90kg 密实矮人长翅膀穿模违和，重写为坚韧岩刺 |
| `GOBLIN` | `GRANITE` (沉重花岗岩甲) | $\rightarrow$ `MERCURY` (水银轻盈流体) | 26kg 地精背负沉重岩石导致移速归零，转为水银卸力 |
| `UNDEAD` | `HOLY` (圣灵光环) 或 `FLESH` (鲜肉) | $\rightarrow$ `GRANITE` (白骨钙化坚壳) | 亡灵遇圣灵自灼自毁，重映射为坚硬白骨盾 |
| `DEMON` | `AQUATIC` (水栖腮) | $\rightarrow$ `FLAME` (地狱熔火核心) | 深渊角魔无法长出水生鱼鳃，重写为加深火焰 |
| `GOLEM` | `FLESH` (肉质器官) 或 `WING` | $\rightarrow$ `GRANITE` (晶晶石外骨骼) | 硅基生命拒绝一切血肉组织 |

### 3.4 模式 A 基因驱动渐进演化模型 (The Gene Drive Model)
当英雄弑君加冕、图腾神火共鸣激活【模式 A 基因驱动】时：
1. 赋予该主导变异等位基因**驱动偏向 (Drive Bias)**，使其向配子传递概率由 $50\%$ 强制跃升至 **$85\% \sim 95\%$**；
2. **平滑扩散代际更替**：
   - 经历第 1 代繁衍：族群渗透率由初始的 $\approx 8\%$ 提升至 $35\%$；
   - 经历第 2 代繁衍：族群渗透率突破 $70\%$；
   - 经历第 3 代繁衍：全族完成同化，劣质突变被自然选择自然淘汰；
3. **杜绝全族同帧暴力覆写**：严禁在登基 Tick 遍历全图实体强行覆写基因，彻底消除生态骤停与瞬间暴毙断代！

### 3.5 实体物理与战斗属性动态聚合管线 (`src/systems/EntityPhysicalAggregator.js`)
突变器官必须在底层的真实物理和战斗属性中即时生效，打通数据断路：
$$\text{EffectiveMass} = \text{BaseMass} \times \left(1.0 + \sum \text{Organ.MassModifier}\right)$$
$$\text{EffectiveArmor} = \text{clamp}\left(\text{BaseArmor} + \sum \text{Organ.ArmorBonus}, -40.0, 120.0\right)$$
$$\text{EffectiveSpeed} = \text{BaseSpeed} \times \left(1.0 + \sum \text{Organ.SpeedModifier}\right)$$
* 任何时候护甲下限死锁在 $-40.0$，绝对不触碰 $-50.0$ 导致的除零异常；
* 质量变化即时同步更新 `PhysicsComponent.invMass = 1.0 / effectiveMass`，直接驱动冲量碰撞系统。

### 3.6 遗传组件连续内存排布 (`src/components/GeneticsComponent.js`)
```javascript
export const GENETICS_STRIDE = 4;
export const GEN_OFFSET_MATERNAL = 0;   // 母系等位基因器官掩码 (Uint16)
export const GEN_OFFSET_PATERNAL = 1;   // 父系等位基因器官掩码 (Uint16)
export const GEN_OFFSET_PHENOTYPE = 2;  // 表型表达位掩码 (计算缓存)
export const GEN_OFFSET_GENERATION = 3; // 实体代数 (从第 1 代始祖递增)

export function createGeneticsBuffer() {
  return new Uint32Array(TOTAL_SLOTS * GENETICS_STRIDE); // 4097 * 4 * 4B ≈ 65.5 KB
}
```

---

## 四、 领域事件字典扩充契约 (`src/data/DomainEvents.js`)

在保持 M1 已交付事件不变的前提下，为 M2 阶段增补以下领域事件枚举：

```javascript
// 关键事务通道 (0x8000 起始，绝对不丢包)
EVT_CASTE_PROMOTED:       0x8010, // 实体社会阶级晋升 (Param1: entityId, Param2: newCaste)
EVT_HEIR_CROWNED:         0x8003, // [已存在] 新王加冕统治 (Param1: leaderId, Param2: factionId)
EVT_GENE_ASSIMILATED:     0x8011, // 模式 A 基因驱动全族同化完成 (Param1: factionId, Param2: organMask)

// 瞬态表现通道 (0x0001 起始，供视窗与音频消费)
EVT_RACE_SKILL_TRIGGERED: 0x0010, // 种族主动/被动特技激活 (Param1: entityId, Param2: skillId)
EVT_WEAPON_DISARMED:      0x0011, // 实体兵器被打落缴械 (Param1: victimId, Param2: attackerId)
EVT_ORGAN_MUTATED:        0x0003, // [已存在] 产生新变异器官 (Param1: entityId, Param2: organMask)
EVT_ACTION_MUTEX_BLOCKED: 0x0012  // 动作轨道互斥阻断打断 (Param1: entityId, Param2: blockedChannel)
```

---

## 五、 渲染视窗与展现层契约 (`src/rendering/MiniRenderer.js` & `index.html`)

### 5.1 展现层无 Mock 真实消费铁律 (LL-003)
* 渲染视窗 `index.html` 必须原生 `import` 真实的 M2 领域系统（`RaceSkillData`, `SocialCasteComponent`, `MendelianGeneticsSystem`, `EntityPhysicalAggregator`）；
* 严禁手写假技能动画或本地 Mock 阶级数组，演示即验收。

### 5.2 阶级与突变器官视觉映射契约
为了在极简像素下直观展现阶级分工与变异特征：
1. **四大阶级头部标牌 (Caste Badge, 3x3 像素)**：
   - `CIVILIAN`: 无标牌或浅褐色圆点；
   - `ARTISAN`: 铁灰色方块（表示手持铁锤/角尺）；
   - `SOLDIER`: 暗红色三角（表示战盔/长枪）；
   - `LEADER`: **亮金色 24px 外发光圈与金色王冠描边**（`#ffd700`，由 `IS_LEADER` 掩码驱动）；
2. **突变器官像素点缀 (10% 突变色着色)**：
   - 携带 `OrganFlags.FLAME`：身体边缘带橙红微光；
   - 携带 `OrganFlags.GRANITE`：身体带灰色岩石斑块；
   - 携带 `OrganFlags.WING`：背部两侧绘制一对 2 像素薄翼；
   - 携带 `OrganFlags.HOLY`：头顶带淡金圣环；
3. **渲染零 GC 与 0 次 `ctx.save()` / `ctx.restore()` 铁律**：
   - 依然严格维持状态机式重置，颜色均使用预分配常量调色板，主循环 0 临时字符串拼接。

---

## 六、 质量守门断言契约 (Shift-Left QA Guardrails & DoD)

### 6.1 TC-EDGE-04: 孟德尔遗传确定性分布守门测试套件
* **文件路径**：`tests/guardrails/TC-EDGE-04.test.js`
* **前置依赖**：`PRNG.js`, `MendelianGeneticsSystem.js`, `MutationFlags.js`, `TabooFilter.js`
* **机器可执行硬断言**：
  1. **固定种子确定性可重现断言**：
     - 给定固定种子 `seed = 0xDEADBEEF`，执行 1,000 次杂交与突变计算；
     - 记录产出子代的全部基因数组，重置相同种子再次执行，两轮结果的每一项位掩码必须严格一致（重现率 $100.0\%$）；
  2. **孟德尔 $1:2:1$ 分离比卡方拟合优度检验断言**：
     - 构建 $10,000$ 对杂合子亲本 ($Aa \times Aa$) 进行受精繁衍；
     - 统计子代基因型出现频次：$O_{AA}, O_{Aa}, O_{aa}$；
     - 理论期望频次：$E_{AA} = 2500, E_{Aa} = 5000, E_{aa} = 2500$；
     - 计算卡方统计量：$$\chi^2 = \sum \frac{(O_i - E_i)^2}{E_i}$$
     - 硬断言：在自由度为 2 时，$\chi^2 < 5.991$（显著性水平 $p > 0.05$），证明算法在统计上完全符合孟德尔第一定律；
  3. **变异禁忌掩码 0 穿透与语义重映射断言**：
     - 对全 12 种族各生成 1,000 次随机突变（共 12,000 次采样）；
     - 检索生成的表达掩码：触犯种族禁忌的违禁词条穿透率严格为 **$0.0\%$**；
     - 所有被拦截词条必须 100% 存在合法重映射替换记录；
  4. **基因驱动模式 A 三代平滑同化断言**：
     - 激活基因驱动后，追踪三代族群更替；
     - 断言：显性基因渗透率单调递增，第 3 代渗透率达到 $75\% \sim 95\%$；且三代之间无任何 1 帧发生全族大面积猝死或断代。

### 6.2 TC-EDGE-05: 阶级晋升无环有限状态机 (FSM) 守门测试套件
* **文件路径**：`tests/guardrails/TC-EDGE-05.test.js`
* **前置依赖**：`SocialCasteComponent.js`, `CareerSystem.js`, `DomainEventBus.js`
* **机器可执行硬断言**：
  1. **FSM 拓扑无死循环震荡断言**：
     - 构建 1,000 个平民实体，向其施加高频随机波动的外部刺激（交替注入劳作与受创事件）；
     - 运行 10,000 个物理 Tick，监控每个实体的阶级跃迁历史；
     - 断言：任何实体在任意 15.0 秒（900 Tick）窗口内，阶级跃迁次数严格 $\le 1$（防振荡冷却锁有效拦截高频抖动）；
  2. **领袖唯一性排他约束断言**：
     - 对 16 个阵营施加极端混乱的刺杀与继承压力测试（每 10 秒随机斩首 1 名领袖）；
     - 在 10,000 帧全生命周期内，断言：每个阵营处于 `IS_LEADER` 状态的活跃实体数在任意一帧严格满足 $0 \le N_{\text{leader}} \le 1$；
     - 领袖阵亡后，合法新领袖在 $3.0\text{s} \sim 5.0\text{s}$ 内完成选举即位，系统从不陷入永久无主死锁；
  3. **战俘奴隶绝嗣与晋升熔断断言**：
     - 将 50 个实体置位 `IS_SLAVE`（战俘奴隶）；
     - 注入海量劳作与受创履历，断言其阶级永远锁死在 `CIVILIAN`，晋升触发次数恒为 0；
  4. **零 GC 内存安全断言**：
     - 连续驱动阶级状态机与技能系统 1,000 帧，堆内存无不可控逃逸。

---

## 七、 Milestone 2 任务包分解与子 Agent 派发表 (WBS & Task Assignment)

根据研发管理宪法，所有代码与测试编写严禁母 Agent 亲自下场，必须按以下任务包定向委派：

```
                    ┌────────────────────────────────────────────────────────┐
                    │       Milestone 2 核心攻关任务包 (WP-2.1 ~ WP-2.7)      │
                    └───────────────────────────┬────────────────────────────┘
                                                │
         ┌──────────────────────────────────────┼──────────────────────────────────────┐
         ▼                                      ▼                                      ▼
【coder-systems】                      【coder-rendering】                    【qa-guardian】
• WP-2.1 种族技能与动作仲裁             • WP-2.5 阶级标牌与特异视觉展现          • WP-2.6 TC-EDGE-04 孟德尔测试
• WP-2.2 阶级分工晋升 FSM                                                      • WP-2.6 TC-EDGE-05 无环FSM测试
• WP-2.3 孟德尔遗传突变管线
• WP-2.4 实体物理属性动态聚合
```

| 任务包编号 | 任务名称 | 责任子 Agent | 交付物文件路径 | 前置依赖 | 核心工期 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **`WP-2.1`** | 12 始祖种族特异技能与动作通道仲裁系统 | `coder-systems` | `src/data/RaceSkillData.js`<br/>`src/components/RaceSkillComponent.js`<br/>`src/race/RaceSkillSystem.js`<br/>`tests/race/RaceSkillSystem.test.js` | M1 封版基线 | 2.5 pd |
| **`WP-2.2`** | 四大社会阶级动态晋升与领袖继承 FSM 系统 | `coder-systems` | `src/components/SocialCasteComponent.js`<br/>`src/profession/SocialCasteSystem.js`<br/>`tests/profession/SocialCasteSystem.test.js` | `WP-2.1` | 3.0 pd |
| **`WP-2.3`** | 双倍体孟德尔遗传算法与随机突变位图管线 | `coder-systems` | `src/components/GeneticsComponent.js`<br/>`src/mutation/MendelianGeneticsSystem.js`<br/>`src/mutation/TabooFilter.js`<br/>`tests/mutation/MendelianGeneticsSystem.test.js` | `WP-2.1` | 3.0 pd |
| **`WP-2.4`** | 实体物理与战斗属性动态聚合管线 | `coder-systems` | `src/systems/EntityPhysicalAggregator.js`<br/>`tests/systems/EntityPhysicalAggregator.test.js` | `WP-2.3` | 2.0 pd |
| **`WP-2.5`** | 视窗端到端集成：阶级标牌、变异着色与技能反馈 | `coder-rendering` | `src/rendering/MiniRenderer.js`<br/>`index.html`<br/>`tests/rendering/MiniRenderer.test.js` | `WP-2.2`<br/>`WP-2.4` | 2.5 pd |
| **`WP-2.6`** | 守门测试套件 TC-EDGE-04 与 TC-EDGE-05 落地 | `qa-guardian` | `tests/guardrails/TC-EDGE-04.test.js`<br/>`tests/guardrails/TC-EDGE-05.test.js` | `WP-2.2`<br/>`WP-2.3` | 2.5 pd |
| **`WP-2.7`** | Tier 2 专家联合评审与零 GC 巡检结项 | `reviewer-architect`<br/>母 Agent (PM) | `docs/03_reviews/milestone_2_acceptance_report.md` | 全量通过 | 1.0 pd |

---

## 八、 组织过程资产与经验教训前置检查清单 (LL-001 ~ LL-007 Pre-Flight Checklist)

开工前必须逐条核实《经验教训登记册》中的纠正与预防措施 (CAPA)，严禁重蹈覆辙：

- [x] **LL-001 (契约先行)**：本说明书已正式编写并发布于 `docs/02_contracts/milestone_2_technical_design_and_contracts.md`，彻底杜绝无契约盲目施工；
- [x] **LL-002 (母 Agent 纯粹性)**：所有 WP 任务已划归 `coder-systems`, `coder-rendering`, `qa-guardian`，母 Agent 严格履行 PM 调度职责，绝不下场改代码；
- [x] **LL-003 (视窗防两张皮)**：`WP-2.5` 明确规定 `index.html` 必须作为真实系统的唯一消费者，原生 ESM 驱动全部 M2 构件，杜绝本地 Mock 假演化；
- [x] **LL-004 (数值量纲同构)**：技能数值（如伤害、治疗、护甲增减、晋升阈值）已全部与 M0/M1 基础量纲（HP 基准 100、护甲下限 -40、Tick 步长 16.666ms）拉齐；
- [x] **LL-005 (分层文档工程)**：契约与后续评审报告严格存放于 `docs/02_contracts/` 与 `docs/03_reviews/`，保持清晰工程目录树；
- [x] **LL-006 (接口鲁棒与 Fallback)**：所有新增方法签名显式声明形参默认值与判空保护，消灭 `ReferenceError` 与 `Cannot read properties of undefined`；
- [x] **LL-007 (CI 防抖动工程设计)**：TC-EDGE-04 与 TC-EDGE-05 测试中，微基准测试与大样本卡方检验配置充足的预热轮次与合理的置信区间，避免并发环境下的调度抖动。

---
**契约说明书发布完毕！M2 正式具备施工前置许可！**
