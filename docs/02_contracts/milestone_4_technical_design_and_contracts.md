# 《Milestone 4 上帝交互、多模态视听叙事与全系统总装结项：系统技术详细设计与数据契约说明书》

> **文档代号**：SPEC-M4-CONTRACT-v1.0  
> **制定基线**：Master GDD v2.2, SRS v1.1, TDS v1.1, WBS v1.1, RTM v3.0, 研发管理宪法 v1.0, 策划专册 06/07/08/09, 经验教训登记册 (LL-001 ~ LL-007)  
> **文档性质**：Milestone 4 终局阶段所有子 Agent (`coder_systems`, `coder_rendering`, `qa_guardian`, `reviewer_architect`) 的**唯一硬性执行技术契约**。  
> **研发纪律**：
> 1. 母 Agent 严格恪守 PM 调度职责，绝对禁止私自编辑生产源码；
> 2. 所有代码变更贯彻代码所有权责任制，缺陷整改工单定向打回原作者；
> 3. 热路径物理/逻辑循环绝对**零 GC**（每帧 0 临时对象/数组/闭包创建）；
> 4. 视窗展现层拒绝假 Mock“两张皮”，必须原生 ESM 消费全部真实系统构件；
> 5. 主渲染循环热路径内部**绝对 0 次调用 `ctx.save()` / `ctx.restore()`**。

---

## 目录与必读参考文档清单 (Mandatory Reference Docs)

开发、渲染、测试与审查子 Agent 在动工或校验前，**必须查阅以下文档的对应章节**：
1. `docs/01_design/design_books/`：
   - `07_god_powers_and_interaction.md`：§二 视口漫游与时间膨胀、§三 上帝之手五大物理边界与天命悬空防死锁、§四 智能导播画中画 PiP、§五 六大上帝玩具技能、§六 15 秒神恩满溢狂欢时刻、§七 全息检视器
   - `08_chronicle_and_narrative.md`：§二 三声道人格叙事、§三 宿怨账本图谱、§四 帝国官僚验尸小票与极乐迪斯科临终思维阁、§五 16 位分歧点基因种子码
   - `09_art_audio_and_technical_spec.md`：§二 7:2:1 视觉面积律与 1024x1024 离屏图集 (Mega-Atlas)、§三 Web Audio 8-Bit 合成与压限拓扑总线、§五 9 大底层致命守门断言 (`TC-EDGE-08`, `TC-EDGE-09`)
2. `docs/01_design/system_requirements_specification.md`：
   - §8 上帝交互与智能导播域 (`REQ-GOD-001` ~ `REQ-GOD-006`)
   - §9 视听叙事与前端渲染管线域 (`REQ-NAR-001` ~ `REQ-NAR-006`, `REQ-ENG-002`, `REQ-ENG-003`)
   - §12 底层致命守门断言 (`TC-EDGE-08`, `TC-EDGE-09`)
3. `docs/00_governance/lessons_learned_register.md`：
   - 严格对照 **LL-001 ~ LL-007** 纠正与预防措施 (CAPA)，执行前置闭环检查。

---

## 一、 上帝之手、视口漫游与时间法则控制契约 (`src/camera/`, `src/core/`, `src/god/`)

### 1.1 2D 摄像机与视口变换矩阵 (`src/camera/Camera2D.js`)
* **核心职责**：管理世界画布与屏幕视口映射、平滑缩放、双击聚焦与平移。
* **参数与缩放范围**：
  - 缩放比例：`zoom` ∈ [0.35, 3.0]，默认 1.0；
  - 视口尺寸：`viewportWidth`, `viewportHeight`；
  - 世界尺寸：W = 56 * 24 = 1344, H = 36 * 24 = 864；
  - 视口偏移：`x`, `y`（世界坐标锚点）；
* **API 签名契约**：
  ```javascript
  export class Camera2D {
    constructor(viewportWidth = 1344, viewportHeight = 864, worldWidth = 1344, worldHeight = 864);
    setViewportSize(w, h);
    pan(dx, dy);                                // 鼠标拖拽/键盘平移视口
    zoomAt(screenX, screenY, zoomFactor);       // 以鼠标光标屏幕坐标为锚点等比平滑缩放
    smoothPanTo(targetWorldX, targetWorldY, speed = 1200); // 平滑巡航 (1200px/s)
    screenToWorld(screenX, screenY, out = { x: 0, y: 0 }); // 屏幕坐标转世界坐标 (复用传参对象零 GC)
    worldToScreen(worldX, worldY, out = { x: 0, y: 0 }); // 世界坐标转屏幕坐标
    update(dt);                                 // 驱动 LERP 巡航与视口 Clamp
    applyTransform(ctx);                        // 对 canvas 上下文应用 translate 和 scale
  }
  ```
* **零 GC 约束**：`screenToWorld` 与 `worldToScreen` 必须接受可选的 `out` 传参对象，禁止每帧 `return {x, y}`。

### 1.2 时间法则控制器 (`src/core/TimeScale.js`)
* **核心职责**：管理全局时间膨胀、定格与快进。
* **时间倍率状态枚举**：
  ```javascript
  export const TimeScaleMode = Object.freeze({
    PAUSED: 0.0,
    SLOW_MO: 0.2,    // 0.2x 绝杀慢动作
    NORMAL: 1.0,     // 1.0x 标准速度
    FAST_2X: 2.0,
    FAST_5X: 5.0,
    FAST_10X: 10.0
  });
  ```
* **API 签名契约**：
  ```javascript
  export class TimeScale {
    constructor();
    setScale(scale);                            // 设置倍率 (0.0 ~ 10.0)
    togglePause();                              // 切换暂停/恢复
    isPaused();                                 // 返回 boolean
    triggerCinematicFreeze(durationSec = 1.2);  // 触发首领斩杀或绝杀瞬间 1.2s 0.2x 慢动作
    update(rawDt);                              // 驱动定格计时器衰减，返回 scaledDt
  }
  ```

### 1.3 上帝之手物理交互系统 (`src/god/HandOfGodSystem.js`)
* **状态机**：
  ```text
  [IDLE 空闲] ──(鼠标左键命中单位)──> [HOVERING 捏起悬空]
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
     [原地松开: 垂直下落轻柔着陆]                    [甩动释放: 动量飞掠与冲击波]
  ```
* **六大硬性安全边界契约**：
  1. **图腾绝对不可抓取锁 (Totem Anchor Lock)**：
     - 若目标实体的 `statusFlags & StatusFlags.IS_ANCHOR` 或 `isTotem === true`，强行拦截 `pickup`；
     - 触发事件 `EVT_DIVINE_ACTION_BLOCKED (0x8016)`，产生金色锁链震颤光效，阻断任何位移。
  2. **世界边缘刚性截断 (TC-EDGE-02)**：
     - 抓取与投掷位移计算时，强制执行坐标 Clamp：
       X_clamped = max(12, min(W_world - 12, X))
       Y_clamped = max(12, min(H_world - 12, Y))
     - 杜绝坐标为负数或 NaN。
  3. **防穿模回弹 (No-clip BFS Fallback)**：
     - 实体落地帧若位于不可通行的深山石壁或建筑中心，执行即时 3x3 BFS 自动推挤至最近合法平地瓦片。
  4. **基于质量 (Mass) 的投掷冲击波与伤害**：
     - 记录最后 3 帧鼠标瞬时速度矢量 (vx, vy)，释放时赋予实体初速度；
     - 冲击波半径：radius = max(1, floor(Mass / 40)) 瓦片；
     - 落地产生击退冲量与眩晕状态 (`StatusFlags.IS_IMMOBILIZED` 0.8s)；
     - 下落伤害：damage = max(0, (V_impact - 30.0) * 0.5 * (Mass / 50.0))。
  5. **动作打断与幽灵判定清理**：
     - 捏起瞬间，强制清空该单位当前技能与攻击判定，赋予落地后 0.5s ICD。
  6. **天命悬空防死锁 (TC-EDGE-07 协同)**：
     - 若老皇帝咽气、继承事务启动时，所选定的王位继承人正被玩家悬浮抓取在空中；
     - 若持续滞空抓取时间 > 5.0 秒，系统触发【神威反噬 (Divine Backfire)】；
     - 广播事件 `EVT_DIVINE_BACKFIRE (0x8017)`，强制震脱玩家上帝之手；
     - 赋予继承人 1.5 秒不可抓取的【金身霸体 (`SACRED_BODY`)】与轻柔重力缓降，安全落地于图腾前完成加冕，彻底消灭滞空卡死死锁！

---

## 二、 六大上帝玩具技能与 15 秒神恩狂欢契约 (`src/god/`)

### 2.1 信仰神恩池与积累机制 (`DivineMiraclesSystem.js`)
* **神恩值 (Fervor)**：全局浮点数，范围 [0.0, 100.0]，默认 30.0；
* **累积途径**：
  - 平民在图腾/祭坛祈祷：+2.0 / 次；
  - 发生首领斩杀或史诗击杀：+5.0 / 次；
  - 成功施放神迹且波及目标：+10.0 / 次；
* **六大上帝玩具技能规格表**：

| 技能标识 | 神恩消耗 | 冷却 (s) | 作用机制与物理表现 | 诱发生态与变异反应 | 领域事件 |
| :--- | :---: | :---: | :--- | :--- | :--- |
| **DIVINE_RAIN**<br/>(生机甘霖) | 20 | 12.0 | 范围半径 4 格，持续 8 秒圣雨。熄灭火灾、瓦片养分提升、农田生长提速 300%，范围内生物每秒回血 6% 最大生命。 | 长期淋雨单位有 15% 几率诱发【水栖】(`AQUATIC`) 或【草木回春】变异。 | `EVT_MIRACLE_RAIN` |
| **HOLY_FRUIT**<br/>(神圣果实) | 35 | 18.0 | 在光标瓦片空投发光金苹果。邻近饥饿生物争夺。吃下者 HP 全满、质量变大 1.3 倍。 | **强制触发 1 次受文法与禁忌约束的高阶定向突变**。 | `EVT_MIRACLE_FRUIT` |
| **HOLY_THUNDER**<br/>(神圣天雷) | 40 | 15.0 | 轰击光标点，半径 2 格。造成 200 点毁灭真伤，地面留下焦黑雷坑。 | 幸存者有 40% 几率觉醒【雷劫遗孤】(`ELEC`) 带电体质。 | `EVT_MIRACLE_THUNDER` |
| **WAR_HORN**<br/>(狂暴圣战) | 50 | 30.0 | 吹响苍凉圣战号角，强制指定交火双方清除停战冷却，全员战意拉满，立刻发起战线对冲！ | 快速打破僵持和平局面，拉满大军团对冲。 | `EVT_MIRACLE_WAR_HORN` |
| **PAX_DIVINA**<br/>(神圣休战) | 50 | 30.0 | 降下柔和白光，全图所有阵营进入 20 秒神圣休战，仇恨清零，全军各自归营休养生息。 | 救下濒危文明，强制重启战后重建。 | `EVT_PAX_DIVINA_FORCED` |
| **METEOR_CATACLYSM**<br/>(灭世陨石) | 90 | 60.0 | 呼唤燃烧陨石自天际轰砸，造成半径 5 格 400 点毁灭伤害，地面瓦片化为熔岩池，焚毁一切建筑。 | 制造大灭绝瓶颈 (Bottleneck Event)，迫使幸存残族加速突变同化。 | `EVT_MIRACLE_METEOR` |

### 2.2 15 秒神恩满溢狂欢时刻 (`src/god/DivineOverdrive.js`)
* **激活条件**：神恩值 Fervor >= 100.0，用户点击 UI 狂欢按钮或键盘快捷键 `[O]` 激活。
* **15 秒狂欢超载状态机**：
  1. **无限神力**：所有六大上帝技能冷却时间硬清零，施法消耗降为 0；
  2. **全图黄金圣光滤镜**：全图生物获得【狂喜 (`ECSTASY`)】状态，移动速度 +50%，劳作/采集速度 +100%，饱食度消耗定格为 0；
  3. **生草事故狂欢**：小人生草技能（滑铲、喷火、飞艇起飞）触发几率提升 200%；
  4. **终末神圣烟花与结算**：15 秒倒计时结束瞬间，全屏绽放像素神圣礼花，并生成一份《狂欢纪元快报》。

---

## 三、 智能导播画中画系统契约 (`src/director/SmartDirector.js`)

### 3.1 导播热点威胁传感器 (Director Threat Sensor)
* **采样频率**：每 1.0 秒扫描一次全图状态（纯只读遍历，零 GC）；
* **高潮事件触发判定（且事件发生于当前摄像机视口外部时触发）**：
  1. **首领绝地交火**：任意存活领袖 HP < 30% 且处于交火状态；
  2. **图腾濒危**：任意阵营图腾受到攻击且生命值首次跌破 50% 或 20%；
  3. **神级突变诞生**：某小人突变出传说级（`HOLY` 或 `FLAME | ELEC`）稀有器官组合；
  4. **超级武器点火**：哥布林自爆飞艇点火起飞、矮人轨道巨炮填装完毕。
* **画中画呈现规范**：
  - 屏幕右上角平滑滑出 160 x 120 像素离屏特写 Canvas；
  - 特写视口中心动态锁定事件核心主角；
  - 10.0 秒内若事态平息，画中画自动淡出收起。
* **交互联动**：
  - 玩家点击画中画视口：摄像机调用 `Camera2D.smoothPanTo(targetX, targetY, 1200)` 平滑巡航至事发点，并将主检视光标聚焦至主角身上。

---

## 四、 矮人要塞三声道叙事、验尸小票与思维阁契约 (`src/narrative/`)

### 4.1 三声道人格叙事引擎 (`src/narrative/TriVocalEngine.js`)
* **三大声道架构**：
  - **【声道 A: 解剖学法医 (The Anatomist)】**：冰冷解剖学词汇，记录受创骨骼粉碎、失血量与体液喷溅（如“右胫骨粉碎性骨折，失血超 1800ml，脑干反射丧失”）；
  - **【声道 B: 崇高虚无诗人 (The Melancholic Bard)】**：史诗神话与悲剧宿命笔触，哀叹英雄陨落与帝国更迭（如“苍穹重铁撕裂晨曦，泥泞接纳了又一缕归于尘土的战魂”）；
  - **【声道 C: 冷酷官僚审计员 (The Bureaucratic Auditor)】**：无情公文核销、人头税扣除、工伤免责与违约债务注脚（如“损坏锁子甲一套，死者欠缴过境税 3 个铜币，已从抚恤金中扣除”）。
* **高信噪比降频节流器 (Signal-to-Noise Throttle)**：
  - 普通平砍伤害自动静默折叠；
  - 唯有**关键暴击、断肢、弑君、突变诞生、内战分裂与神迹**才触发战报生成；
  - 聚合队列：最近 2.0 秒内的多个连续碎事件自动聚合为单条复合战报。

### 4.2 宿怨账本图谱 (`src/narrative/BloodLedger.js`)
* **容量约束**：每个活体单位维护一个固定容量为 3 条的 `BloodLedger` 环形队列：
  ```javascript
  { targetId: number, eventType: number, timestamp: number }
  ```
* **触发机制**：小人遭遇断肢、家园被毁或目睹血亲战死时记录仇敌；
* **宿命对账**：战场感知范围内检测到仇敌时，激活【宿仇狂暴 (`VENDETTA_FRENZY`)】，战报系统打出带金框的黑幽默对账文本。

### 4.3 极乐迪斯科风濒死思维阁 (`src/narrative/MindCabinet.js`)
* **触发时机**：阵营领袖被刺杀或战死断气前的最后一瞬；
* **四大潜意识声音**：
  - **【古老爬行脑】**：“好冷，腹部的破洞正在冒热气。别挣扎了，躺在烂泥里挺舒服的。”
  - **【野心意志】**：“废物！你的战斧还在三步之外！爬起来，用牙齿咬断篡位者的气管！”
  - **【食欲本能】**：“……其实昨晚地窖里那罐蓝莓甜酒，我还没来得及喝完呢。”
  - **【骨骼与肌肉】**：“报告长官，第四颈椎断成三截，我们已经尽力了。下班了，朋友。”
* **输出规范**：结构化 DTO 输出，UI 面板支持逐字打字机字符特效呈现。

### 4.4 帝国官僚验尸小票系统 (`src/narrative/DeathAuditReceipt.js`)
* **核心功能**：为重要角色（皇帝、将军、功勋工匠）阵亡时生成一张盖有鲜红印章与血手印的打字机风格验尸单。
* **数据内容**：
  - 死者身份、终局时辰、致命成因（基于受创物理参数与击杀者武器）；
  - 遗留物资清点（残值核算与归公入库）；
  - 财政债务核算（抚恤金冲抵、透支干粮扣缴与经手公证官印章戳记）。
* **绘制与导出**：
  - 使用独立 Canvas / OffscreenCanvas 绘制像素羊皮纸发黄褶皱效果；
  - 提供 `exportAsPngDataUrl()` 方法，支持前端点击一键下载保存。

### 4.5 纯值快照 DTO 环形缓冲池 (`src/narrative/ContextSlabPool.js`)
* **容量**：预分配 256 槽位纯值对象池；
* **零 GC 约束**：战报事件产生时从池中租借 Slab，事件消费后原地 `reset()` 归还，禁止每条战报 `new Object()`。

---

## 五、 前端渲染管线、Mega-Atlas 图集与 Web Audio 压限总线契约 (`src/rendering/`, `src/audio/`)

### 5.1 1024x1024 全局图集享元签名缓存 (`src/rendering/MegaAtlasDollCache.js`)
* **技术痛点**：千人同屏时每帧动态绘制 4 层小人部件（骨骼、材质、阶级装备、变异器官）导致 20,000+ Canvas API 调用，耗时超 22ms。
* **享元架构设计**：
  - 建立 1024 x 1024 离屏 Canvas，按 24 x 24 像素网格划分为 42 x 42 = 1764 个分桶槽位；
  - 外观签名哈希：
    Key = (raceId << 20) | (casteId << 16) | (phenotypeMask & 0xFFFF)
  - 整个世界的外观组合收敛在 150 种高频模型内；
  - 仅在初次遇到该签名时，在离屏图集分桶内烘焙一次小人 4 层像素；
  - 主渲染循环中：**单次 `ctx.drawImage` 直接将图集切片贴至主画布**！
* **性能指标**：千人渲染总耗时骤降至 **< 1.8ms**，主循环调用彻底收敛。

### 5.2 Web Audio 8-Bit 原生合成与压限拓扑总线 (`src/audio/WebAudioBusManager.js` & `Synth8Bit.js`)
* **零外置依赖铁律**：绝对不加载任何外部 `.mp3` 或 `.wav` 文件，纯靠 Web Audio API 数学振荡器（Oscillator）与伪随机白噪声生成。
* **信号拓扑图**：
  ```text
  [SFX Bus] ──┐
  [Voice Bus] ─┼──> [侧链闪避 Ducking (-12dB)] ──> [末端安全压限器] ──> [AudioContext.destination]
  [God Bus] ──┘                                           ▲
                                                          │
  [Ambient Bus (粉红白噪音 -28dB)] ────────────────────────┘
  ```
* **压限器安全参数**：
  - `threshold = -12.0` dB；
  - `knee = 30.0`；
  - `ratio = 12.0`；
  - `attack = 0.003` s；
  - `release = 0.25` s；
  - **数学级防爆音**：从声学物理上彻底杜绝多发天雷并发或爆炸引起的数字硬削波破音！
* **16 轨复音池与抢占调度 (Voice Stealing)**：
  - 活跃 Oscillator 节点严格 <= 16 个；
  - 满载抢占时施加 **8ms 极速指数淡出 (Exponential Ramp)**，杜绝产生 Click 咔哒切断杂音。
* **音高动态抖动 (Pitch Jitter)**：每次发声振荡频率随机浮动 ±4%，消除机械听觉疲劳。

### 5.3 MiniRenderer 升级与 0 次 save/restore 铁律 (`src/rendering/MiniRenderer.js`)
* **视口结合**：主渲染循环根据 `Camera2D` 的变换矩阵进行平移与缩放；
* **外层包裹**：在全帧渲染前执行一次 `ctx.setTransform(...)`，主循环内部热路径（瓦片、流场、实体、标牌、神圣粒子、金身光环）**绝对 0 次调用 `ctx.save()` / `ctx.restore()`**；
* **狂欢圣光与像素烟花**：狂欢激活时叠加全图淡金呼吸光晕，神圣礼花采用预分配静态粒子池复用，保持零 GC。

---

## 六、 表现层全系统原生 ESM 总装视窗契约 (`index.html`)

### 6.1 彻底贯彻 LL-003 防“两张皮”铁律
* `index.html` 必须作为全量系统的唯一真实消费者（Real Consumer）；
* 原生 `import` 并驱动：
  - `Camera2D`, `TimeScale`；
  - `HandOfGodSystem`, `DivineMiraclesSystem`, `DivineOverdrive`；
  - `SmartDirector`, `TriVocalEngine`, `BloodLedger`, `MindCabinet`, `DeathAuditReceipt`；
  - `WebAudioBusManager`, `MegaAtlasDollCache`；
  - 既有 M0~M3 全量系统（`TileGrid`, `NutrientField`, `FarmlandSystem`, `MetabolismSystem`, `SocialCasteSystem`, `RaceSkillSystem`, `MendelianGeneticsSystem`, `EntityPhysicalAggregator`, `BorderFrictionSystem`, `VectorFlowFieldSystem`, `SchismSystem`, `DynastySuccessionSystem`, `WarWatchdogSystem`, `MiniRenderer`）。

### 6.2 视窗界面增强布局与交互契约
1. **时间控制面板**：顶部提供 `[⏸ 暂停]`, `[0.2x 绝杀]`, `[1.0x 正常]`, `[2.0x]`, `[5.0x]`, `[10.0x 快进]` 切换按钮，绑定快捷键；
2. **神恩狂欢指示器**：顶部神圣神环显示 `Fervor (0~100)` 进度条，满额时爆发出金色呼吸辉光并激活 `[⚡ 开启神恩满溢狂欢]` 按钮；
3. **六大上帝神迹玩具栏**：左侧/底部折叠抽屉，显示生机甘霖、神圣果实、神圣天雷、狂暴圣战、神圣休战、灭世陨石技能图标、神恩消耗与冷却进度遮罩，点击选中后光标化为神圣瞄准星；
4. **上帝之手交互体验**：鼠标直接抓取小人（手舞足蹈问号光效与金色牵引线），支持轻柔下落与高速甩飞，长按继承人 5s 触发天雷反噬震撼光效；
5. **智能导播画中画视窗 (PiP)**：右上角浮动 160 x 120 动态特写窗，标明高光事件标题，点击平滑漫游至主角；
6. **矮人要塞三声道滚动战报**：右侧多栏滚动日志，带【法医】/【诗人】/【审计员】微型角标与差异化色彩分级；
7. **帝国官僚验尸小票与思维阁弹窗**：点击战报关键阵亡条目，弹出带血手印的打字机验尸单，点击 `[📥 导出小票为图片]` 直接下载；领袖驾崩特写触发极乐迪斯科思维阁潜意识打字机碎碎念；
8. **音效总控**：右上角提供 Web Audio 静音开关与主音量滑块。

---

## 七、 质量守门套件与混沌大压测契约 (`tests/guardrails/`, `tests/chaos/`)

### 7.1 TC-EDGE-08 守门套件：仓储物料守恒与整数离散断言 (`tests/guardrails/TC-EDGE-08.test.js`)
* **核心断言 1 (领地大分裂物资守恒)**：
  - 模拟 100 次图腾裂变与领地双核切分；
  - 断言原阵营与新叛乱阵营的粮食总和、矿石总和在分裂后与分裂前完全守恒：
    ∑Food_new === ∑Food_old, ∑Ore_new === ∑Ore_old
  - 0 浮点舍入截断丢失，0 凭空克隆。
* **核心断言 2 (战后缴获与打砸抢守恒)**：
  - 模拟工匠/士兵掠夺敌方粮仓 1,000 次；
  - 扣除量与掠夺者背包增加量严格一致，下限锁死为 0，绝对不发生负数库存。
* **核心断言 3 (整数离散性断言)**：
  - 仓储数据均为有效非负有限整数，绝无 NaN 或无穷大。

### 7.2 TC-EDGE-09 守门套件：阵营普查休眠解耦与防幽灵复国断言 (`tests/guardrails/TC-EDGE-09.test.js`)
* **核心断言 1 (石化与沉寂实体解耦)**：
  - 石化魔像与沉寂古代遗迹标记为 `isDormant = true`；
  - 普查系统将其完全从活跃阵营人口与 16 国硬锁额度中剔除；
* **核心断言 2 (防幽灵复国与无主飞地消除)**：
  - 图腾彻底坍塌覆灭的阵营（`IS_DESTROYED`），领地瓦片全部释放，存活残兵转为流寇；
  - 即使后续有流寇经过旧图腾遗迹，绝对不再触发原阵营死者复生或非法政治决议；
  - 普查容器内该阵营状态位永久锁定为已覆灭。

### 7.3 10,000 帧千人同屏混沌总压测 (`tests/chaos/TenThousandFramesChaos.test.js`)
* **测试场景**：
  - 初始化 56x36 完整世界，投放 12 大种族、1,000 名存活实体；
  - 以极速无头逻辑推进 **10,000 帧**；
  - 持续施加高烈度扰动：每 100 帧随机上帝之手甩飞单位、随机触发六大神迹轰炸、注入政治分裂与领袖刺杀；
* **硬性验收红线**：
  1. **零崩溃异常**：连续 10,000 帧无任何未捕获异常抛出；
  2. **坐标与物理刚性**：10,000 帧内全量实体坐标绝无 NaN 或越界溢出；
  3. **堆内存防腐断言 (Zero-GC Heap Assertion)**：
     - 在 50 帧充分 JIT 预热后记录 `baseHeap`，在 10,000 帧结束后测量 `finalHeap`；
     - 断言：ΔHeap < 500 KB，证明业务热路径完全零临时对象逃逸！

---

## 八、 里程碑完成定义 (DoD) 与工单分派拓扑

### 8.1 Milestone 4 完成定义 (Definition of Done)
1. **系统构件齐备**：`src/camera/`, `src/god/`, `src/director/`, `src/narrative/`, `src/rendering/`, `src/audio/` 目录下所有 M4 模块全部编写并交付；
2. **测试全量满分通过**：全量测试套件（既有 29 套件 + 新增全部套件）运行通过率 **100% (0 failed, 0 flaky)**；
3. **守门与混沌验收**：`TC-EDGE-08`, `TC-EDGE-09` 守门套件与 10,000 帧千人混沌大压测全部通过；
4. **视窗全真总装**：`index.html` 视窗原生集成消费所有系统，无假 Mock，操作丝滑；
5. **文档与代码库封版**：RTM 矩阵更新至 100% 闭环，完成 Release Tag 打标与推送。

### 8.2 子 Agent 任务分派矩阵

```text
[Step 0: 母 Agent 编制发布契约说明书] (已完成)
                 │
                 ├──> [批次 1: WP-4.1 & WP-4.3] -> coder_systems
                 │    (Camera, TimeScale, GodHand, Miracles, Narrative, Receipts, Slabs)
                 │
                 ├──> [批次 2: WP-4.4 & WP-4.2] -> coder_rendering
                 │    (MegaAtlas, WebAudio, Synth, SmartDirector, MiniRenderer升级)
                 │
                 ├──> [批次 3: WP-4.5] -> qa_guardian
                 │    (TC-EDGE-08, TC-EDGE-09, 10,000帧千人混沌大压测)
                 │
                 └──> [批次 4: WP-4.6] -> coder_rendering
                      (index.html 全真全系统原生总装与交互体验打通)
```
