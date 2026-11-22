# 数据字段自查说明（schema.md）

> 所有题库、双面镜、原型与跨卷规则均为**纯 JSON**，与 UI 代码完全解耦。
> 修改数据后执行 `npm run data`（即 `node scripts/build-data.js`）会重新生成
> `src/data/bundle.js`，UI 通过 ES 模块 `import` 读取，无需 `fetch`，因此也支持
> 直接用 `file://` 打开。

---

## 1. `dimensions.json` — 维度注册表

```jsonc
{
  "version": 4,
  "dims": [
    {
      "id": "sin_pride",        // 全局唯一；顺序 = HA4- 存档码的编码顺序，禁止重排
      "name": "傲慢驱力",        // 报告与图表展示名
      "volume": "vol1",          // 归属卷宗
      "category": "sin",         // sin|virtue|big5|dark|light|worldview|lifeview|value|cognitive|motive|attachment|defense
      "axis": "pride_humility",  // 同一心理轴的两极共用 axis，用于跨卷镜像撕裂度计算
      "negLabel": "审慎防备",     // 仅双极维度（polar）需要：低分侧语义
      "posLabel": "善意信任"      // 仅双极维度需要：高分侧语义
    }
  ],
  "values": [                    // Vol.4 价值金字塔的 8 个可选项
    { "id": "freedom", "name": "自由", "desc": "时间与身体由自己说了算" }
  ],
  "pressureStyles": [            // Vol.8 高压退行态四分类
    { "id": "burst", "name": "爆发攻击型", "desc": "…" }
  ]
}
```

**硬性约束**

| 约束 | 说明 |
| --- | --- |
| 维度总数 | 127（本源八卷 60 + 破圈八卷 67） |
| `id` 唯一 | 全局不可重复；存档码按此顺序按位编码 |
| `axis` | 同一轴的两极必须一致，否则 `mirrorTear` 无法配对 |
| `values` 长度 | 必须为 8，对应 `pyramid_top3` 题的 8 选 3 |

---

## 2. `volumes/volX.json` — 分卷题库

```jsonc
{
  "volume_id": "vol1",
  "index": 1,
  "title": "光影圣殿",
  "subtitle": "七大美德与七宗原罪",
  "theme_color": "#8C4A32",
  "estimated_minutes": 5,
  "intro": "卷首语（60–120 字，不评判、不诱导）",
  "dimensions": ["sin_pride", "..."],   // 本卷测绘的维度
  "questions": [ /* 见下表 */ ]
}
```

### 题量核对表

| 卷 | 题量 | 备注 |
| --- | --- | --- |
| vol1 | 22 | 七宗罪 × 七美德，共 14 维 |
| vol2 | 20 | 大五 10 个子维 |
| vol3 | 18 | 黑暗三角 + 光明三角 + 隐性掌控 |
| vol4 | 20 | 含 1 道 `pyramid_top3` |
| vol5 | 18 | 认知风格 6 维 |
| vol6 | 18 | 含 2 道 `budget_100` |
| vol7 | 18 | 依恋双轴 + 六大防御 |
| vol8 | 18 | 全部 `layer: "stealth"`，含 10+ 道跨卷镜像题 |
| vol9 | 20 | 荣格八维认知功能栈 |
| vol10 | 16 | D&D 九宫格阵营（双极 2 维） |
| vol11 | 20 | 八大哲学流派 + 六大道德基础 |
| vol12 | 22 | 九型核心恐惧 + 三副型 |
| vol13 | 18 | 十大早期图式 |
| vol14 | 18 | 四大金钱脚本 + 五种时间观 |
| vol15 | 16 | TKI 五种模式 + PAC 三态 |
| vol16 | 16 | HSP × HSS 四象限 |
| **合计** | **298** | |

### 题目字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✓ | 全局唯一，形如 `v1_q01` |
| `type` | ✓ | `forced_choice` \| `stealth_scale` \| `impulse_3s` \| `budget_100` \| `pyramid_top3` |
| `stealth_mode` | ✓ | `normalization` \| `projection` \| `ipsative` \| `impulse` \| `budget` \| `mirror` \| `pressure` |
| `layer` | ✓ | `explicit`（明线）\| `stealth`（暗线/高压） |
| `mirror_key` | ✓ | 跨卷镜像配对键；同一 key 下明线与暗线分数差 → `G_mirror` |
| `is_sensitive` | ✓ | 是否计入 `H_lat`（犹豫修饰度） |
| `weight` | ✓ | 抗伪装权重（迫选 1.4 / 直觉 1.2–1.3 / 量表 0.85） |
| `kind` |  | 仅 vol8 的 `"pressure"` 题使用，用于统计退行态分布 |
| `context` |  | 第三方投射或剧场题的微故事（60–90 字） |
| `prompt` | ✓ | 题干 |
| `options` | 条件 | `forced_choice` / `impulse_3s` 必填 |
| `scale` | 条件 | `stealth_scale` 必填 |
| `items` | 条件 | `budget_100` 必填 |
| `values` | 条件 | `pyramid_top3` 必填（8 项） |
| `effects` | 条件 | 量表题：`{ dim: [lowVal, highVal] }` |

### `options[]` 字段

| 字段 | 说明 |
| --- | --- |
| `key` | `A`/`B`/`C`/`D` |
| `text` | 选项文本；**同题各选项字数差 ≤ 30%** |
| `effects` | `{ dimId: number }`，正负表示推向该维的高低 |
| `social_desirability` | 0–3，越高越"体面"；用于 `D_sd` 与 `H_lat` |
| `style` | 仅 vol8 `pressure` 题：`burst`\|`cutoff`\|`cold`\|`collapse` |

### `scale` 字段（`stealth_scale`）

```jsonc
"scale": {
  "left": "把话讲透，哪怕要重复三遍",       // 1 分侧语义
  "right": "礼貌点头，把力气留给别处",       // 7 分侧语义
  "sdHigh": "left"                          // 哪一侧更"体面"（社会赞许方向）
}
```

> **注意**：`sdHigh` 必须显式声明。早期版本靠"分数越大越体面"推断，
> 会使语义反向的题目（右端才是谦虚）判定错误。

`effects` 用数组表示两端贡献：

```jsonc
"effects": { "sin_pride": [-2, 2], "virtue_humility": [2, -2] }
```

### `items` 字段（`budget_100`）

```jsonc
"items": [
  {
    "key": "autonomy",
    "label": "自己说了算的时间",
    "dim": "mot_autonomy",
    "base": -50,     // 任选点数的基准贡献（配合 gain 决定 0–100 映射）
    "gain": 2,       // 每点筹码的贡献倍率
    "effects": {}    // 可选：对其他维度的联动
  }
]
```

**校验规则**：`sum(values) === 100`，否则 `QuizRunner` 拒绝进入下一题。

### `values` 字段（`pyramid_top3`）

```jsonc
"values": [
  { "key": "freedom", "label": "自由", "effects": { "mot_autonomy": 1.4 } }
]
```

**校验规则**：必须恰好 8 项，用户按顺序选 3 项；排名权重 3 / 2 / 1。

---

## 3. `mirrors/volX.json` — 一维四面镜

键为维度 id，值为四面镜：

```jsonc
"sin_pride": {
  "name": "傲慢驱力",
  "volume": "vol1",
  "category": "sin",
  "polar": true,               // 可选：双极维度
  "negLabel": "…",             // 可选
  "posLabel": "…",             // 可选
  "high": {
    "label": "高门槛的孤傲主体",       // 高分侧人格速写
    "gift_title": "顶级审美与专业骨气",
    "gift_desc": "…",                 // 60–100 字
    "shadow_title": "孤岛效应与听不进劝",
    "shadow_desc": "…",
    "alchemy_tip": "…"                // 可执行的炼金处方
  },
  "low": { /* 同结构，低分侧 */ }
}
```

**校验**：60 个维度必须齐全，且 `high`/`low` 四组文案（gift / shadow / tip）均非空。
`tests/verify-engine.js` 的 TC6 会自动检查。

---

## 4. `archetypes.json` — 24 原型

```jsonc
{
  "archetypes": [
    {
      "id": "AR01",
      "name": "古典守门人",
      "latin": "The Classical Gatekeeper",
      "keywords": ["原则一致", "愤怒有据", "体面刚硬"],   // 3 个
      "verdict": "灵魂判词（60–120 字）",
      "weights": { "light_kant": 1.4, "val_moral": 1.3 },  // 正向权重
      "negWeights": { "dark_mach": -0.6 }                   // 负向权重（低分才贡献）
    }
  ]
}
```

匹配算法：`fit = Σ(score × w) / Σ|w|`，其中 `negWeights` 用 `(100 − score)` 计。
`weights` 中 |w| ≥ 0.9 的维度会作为「命中维度」显示在卡片的 `hits` 里。

---

## 5. `cross_rules.json` — 跨卷黄金规则

```jsonc
[
  {
    "id": "CR_01",
    "required_volumes": ["vol2", "vol3"],     // 必须先完成这些卷才会评估
    "conditions": [
      { "dim": "dark_mach", "op": ">=", "val": 62 },
      { "dim": "big5_compliance", "op": ">=", "val": 62 }
    ],
    "title": "丝绒手套里的棋手",
    "tag": "表里策略协同",
    "insight": "…",     // 80–140 字
    "advice": "…"       // 可执行建议
  }
]
```

**特殊维度**：`"dim": "mask"` 会取 `maskIndex.value` 而非普通维度分。

`op` 支持 `>=` `>` `<=` `<`。规则数量必须 ≥ 30（当前 35 条）。

---

## 6. `pair_rules.json` — 双人对比规则

```jsonc
{
  "coreDims": ["wv_nature", "val_moral"],          // 用于「价值观共振」
  "complementDims": ["big5_open", "cog_logic"],    // 用于「性格互补」
  "resonance": [
    { "id": "RS_01", "dims": ["wv_nature"], "op": "bothHigh", "threshold": 60,
      "title": "…", "text": "…" }
  ],
  "collisions": [
    { "id": "SC_01",
      "a": [{ "dim": "att_anxiety", "op": ">=", "val": 62 }],
      "b": [{ "dim": "att_avoidance", "op": ">=", "val": 62 }],
      "severity": "high",           // high | mid
      "title": "追逃死循环", "text": "…", "guide": "…" }
  ]
}
```

**方向性**：`collisions` 中 `a`/`b` 分别对应 A、B 两人，但引擎会自动尝试
反向匹配（B 命中 a 且 A 命中 b），命中后标记 `reversed: true`。

---

## 7. `UserSaveState` — localStorage 与存档码

```jsonc
{
  "version": "3.0",
  "nickname": "林深",
  "updatedAt": 1763726100000,
  "completedVolumes": ["vol1", "vol4"],
  "inProgress": { "vol2": { "currentIdx": 7, "updatedAt": 1763... } },
  "answersByVolume": {
    "vol2": { "v2_q01": { "value": "B", "ms": 5420, "changes": 1, "at": 1763... } }
  },
  "computedScores": { "sin_pride": 74 },
  "maskIndex": 58,
  "maskDetail": { "value": 58, "dsd": 71, "hlat": 44, "mirror": 61, "parts": [] },
  "topValues": ["freedom", "dignity", "ease"],
  "telemetry": { "v2_q01": { "ms": 5420, "readMs": 5300, "changes": 1 } },
  "pressureStyle": { "key": "cold", "share": 41.2, "distribution": {} }
}
```

### HA4- 存档码字节布局

| 偏移 | 长度 | 含义 |
| --- | --- | --- |
| 0 | 1 | 版本号（固定 `4`） |
| 1–2 | 2 | 已完成卷位掩码（uint16 LE，bit0 = vol1 … bit15 = vol16） |
| 3 | 1 | 年月戳高位（`year - 2000`），用于时间胶囊 |
| 4 | 1 | 年月戳低位（month 1–12） |
| 5 | 1 | 面具厚度 M（0–100，`255` = 未测） |
| 6–8 | 3 | Top3 价值索引（0–7，`255` = 空） |
| 9–n | 127 | 127 个维度分数（0–100，`255` = 未测，顺序 = `dimensions.dims`） |
| 其后 | ≤12 | 昵称 UTF-8 字节 |
| 末尾 | 1 | 校验和（`h = (h·31 + b) & 0xff`，初值 `0x1f`） |

编码为 **Base64url**（`-` `_`，无 padding），前缀 `HA4-`。
127 维 + 掩码 + 昵称的典型长度约 190 字符。

**向后兼容**：`HA3-` 老码仍可解码。因为注册表前 60 位就是本源八卷的维度、位序完全对齐，
老码按「60 维 + 1 字节卷掩码」读取即可，不需要迁移表。

---

## 8. 计分：为什么中心是「期望值」而不是「中位数」

`questionRange()` 返回 `{ lo, hi, center }`。`center` 不是 `(lo+hi)/2`，而是**该题选项上的期望值**。

这看起来是个细节，其实决定了整张表能不能用。举一个真实例子：

```json
// 某维度只出现在 4 个选项中的 1 个
"options": [
  { "key": "A", "effects": { "covert_control": 2 } },
  { "key": "B" },
  { "key": "C" },
  { "key": "D" }
]
```

- 若 `center = (0+2)/2 = 1`：选 A → `+1`，选 B/C/D → `−1`
- 均匀作答时该维度的期望得分是 `0.25×(+1) + 0.75×(−1) = −0.5`
- 也就是说，**所有「只在一个选项出现」的维度都会稳定偏向低分**，实测 `covert_control` 均值只有 32 分

改成期望值中心 `center = 0.5`、半程 1.5：

- 选 A → `(2−0.5)/1.5 = +1`（强正向证据）
- 选 B/C/D → `(0−0.5)/1.5 = −0.33`（轻微反向证据）

这才是「没提这件事」应有的分量——它不该等于强烈否认。修正后 `covert_control` 均值回到 48.6。

**振幅 `(hi − lo)` 仍然用于加权**，所以主测题（振幅 4.0）照旧压过附加题（0.8），BUG-04 的修复不受影响。

---

## 9. 修改数据后的自检清单

```bash
npm run data     # 重新编译 bundle，会打印缺漏的双面镜
npm test         # 数据契约 + 引擎全链路校验（78 项）
```

必过项：

1. `vol1..vol16` 题量分别为 22/20/18/20/18/18/18/18/20/16/20/22/18/18/16/16，合计 298。
2. 127 维双面镜四面文案齐全。
3. 36 原型、≥60 条跨卷规则。
4. 题目 id 全局唯一；5 种题型全部出现。
5. `vol8` 的 `layer: "stealth"` 题 ≥ 10。
6. 同题选项字数比 ≤ 1.7。
7. 空状态 / 半途 / 盲选 / 损坏存档码均不产生 `NaN` 或 `undefined`。
