# 项目进度评估 · 2026-10-10

> 状态：`assessment`（实测快照，供决策）。全部数字来自 2026-10-10 对**运行中的真实后端**
> （真实 DB `server/data/odds-edge.db` + 人工盘赔源）的探测，非估算，非凭记忆。
> 上游文档：`docs/current-status.md`（能力清单）、`docs/system-review-2026-09-03.md`（模块状态）、
> `docs/design/fusion-decision-layer/fusion-decision-layer.md`（融合层定义）。
>
> **后续变更（同日）**：2026-10-10 分析路线转为 **AI 驱动 + 复盘沉淀**，规则手册体系停用、生产注册表置空。
> 本文的「88 条规则 / 4.5% 可求值」等数字是**转向之前**的实测快照，用于解释当时为何要转；
> 当前状态以 `docs/current-status.md` 与 `docs/decisions.md` 为准。

---

## 一、一句话结论

**工程骨架已完成，瓶颈不在代码，在知识层**：

88 条规则中仅 **4 条可求值**（4.5%），其中**没有任何一条产出让球方向** → 融合决策 100% 落入
`fusion_decision_rejected`（`final_direction = null`）。全链路目前唯一能产出的方向结论是
**总进球轴**（S25 → `over`/`under`）。

---

## 二、分层进度

| 层 | 状态 | 关键证据（2026-10-10 实测） |
|---|---|---|
| **工程** | ✅ 完成度高 | 后端 11 路由族；`npm test` **465 用例 / 463 通过 / 0 失败 / 2 跳过**；TLS + 鉴权 + 限流 + Redis 三件套接线；规则 append-only 版本化（不可变触发器）；三级信任隔离；前端 13 页（3 页已接真实端点）；全仓 0 处 TODO/FIXME |
| **数据** | ✅ 通 | 合并池 **343 场**（`schedule_total=59 / manual_total=343 / aligned=0 / manual_only=343`）；人工盘赔源 **1026** 份 `盘口数据.md`；历史场带赛果；期号锚定机制在（当日无在售窗口 → `aligned=0` 属预期） |
| **知识（规则）** | ⚠️ **4.5%** | 88 条规则 **85 条 `insufficient_data`**；涉及 **196 个未实现输入字段**；`unknown`（算子未实现）**= 0** |
| **产出（方向）** | ❌ **0%** | 实测前 12 场：`final_direction` 非空 **0/12**；`fusion_decision_rejected` 100% |
| **治理（转正）** | ⚠️ 未验收 | 88 条全部 `status=active` + `trust_level=provisional` + `evidence_count=0` → **从未真正转正** |

---

## 三、断点定位（实测证据链）

### 3.1 方向为什么出不来

```
88 条规则
 └─ 85 条 insufficient_data（196 个输入字段未实现）
     └─ 11 条「方向型规则」100% 不可求值
         └─ v97ToRuleOutput().direction = null        （fusion/v97_input.js）
             └─ fuse(): hasOriented = false            （fusion/fuse.js:81）
                 └─ final_direction = null → fusion_decision_rejected
```

**注意**：命中的规则（E14 / S25 / R01 / R13）声明的维度**只有 `gate` 和 `total_goals_signal`**，
本来就不含方向型维度。规则自身的 note 写得很明确：

> `V9.7 命中规则无方向型维度（仅门禁/权重/信号）→ 方向弃判，维度结论见 dimensions`

即：这**不是 bug，是设计使然**（门禁≠方向，绝不臆造）——但它使「让球方向」这一产品输出恒为空。

### 3.2 排除的假设

| 假设 | 实测结论 |
|---|---|
| 「融合层把 provisional 规则排除了」 | ❌ 否。`v97_input.js:111` **硬编码 `trust: 'trusted'`**，rule 流是 active 的（`weights={rule:1, model:0, anomaly:0}`） |
| 「custom 算子未实现卡住了求值」 | ❌ 否。88 条规则的 `unknown` 计数 **= 0** |
| 「是某一场的数据不足」 | ❌ 否。跨 20 场并集，85 条恒为 `insufficient_data` |
| 「字段算不出是因为缺数据源」 | ⚠️ **部分否**。见 3.3 |

### 3.3 196 个字段缺口的分布特征

缺口**极度分散**——多数字段只影响 1–3 条规则，不存在「补几个字段全盘活」的捷径。
但按「解锁规则数」排序存在明显头部（贪心最优）：

| 序 | 字段 | 解锁规则数 | 解锁哪些 |
|---|---|---|---|
| 1 | `classification` | **+9** | R02,R03,R10,R11,R40,E03,E04,E06,E07 |
| 2 | `league_stability_class` | +6 | S07,S10,S13,S19,S23,S24 |
| 3 | `league_tier` | +5 | R17,R25,R26,E09,E10 |
| 4 | `phase` | +4 | R04,R12,R31,E05 |
| 5 | `competition_format` | +4 | S26,S27,S29,S30 |
| 6 | **`water_change`** | **+3** | R05, **R07**, **E01** |
| 7 | `league_id` | +3 | S05,S06,S14 |
| … | 前 12 个字段累计 | **44（50%）** | |

### 3.4 两个高杠杆单点

**① `water_change` —— 方向链上的临门一脚**

- `E01`（R07 阻诱规则统一释义规范）**只差 `water_change` 一个字段**
- `E01` 是 **4 条方向型规则共同指向的上游**：`R06 direction="按E01释义"`、`R07="E01释义结论"`、
  `E01 direction="E01四象限结论"`
- `water_change`（让球盘水位变化：初盘→即盘）**与已实现的 `line_change` 完全同模式**，
  属**盘口可推导**字段（现有 `water_level` 提供水位值，缺的是变化量）

**② `classification` —— 规则链断裂**

- `classification` 被 9 条规则需要，而它**正是 R01 的产出维度**
  （`R01.1 effects = [{dimension:"classification", value:"极致平权盘"}]`）
- 即：V9.7 手册设计的是**规则链**（R01 定盘性 → R02/R03 消费），但引擎未把
  「上游规则的 effect 输出」回灌为「下游规则的输入字段」→ 链路断开
- 若确认 `depends_on` 语义即此意，**一次机制改动可能解锁 9+ 条**

### 3.5 方向语义的最后一层

即使 `E01` 变为可求值，其 effect 取值仍是**文本**（`"E01四象限结论"`），
与 `fusion/v97_input.js` 的 `mapDirection()` 中文正则（`上盘|下盘|主让|客让|平|走盘`）**不匹配**
→ 仍将返回 `null`。

**结论**：「四象限结论 → 上盘/下盘」的映射属于**领域语义**，必须由规则手册定义或人工确认，
不得由代码臆造（AGENTS.md 零假数据原则）。

---

## 四、后续优先级建议

### A 档 · 可立即执行（不依赖决策）

1. **转正闭环验收**：`POST /api/rules/:id/promote` 与 `scripts/s25-promote.js` 均已就绪，
   但 DB 中 0 条 trusted。需实跑一次并验证「转正后跨重启存活」（seed 为 `INSERT` 且按
   `version_id` 去重，理论不覆盖，但**未经验证**）。这是「规则自我生长」的最终验收。
2. **`water_change` 字段实现**：与 `line_change` 同模式，解锁 `E01`+`R07`+`R05`（见 §3.4）。

### B 档 · 需大人拍板（高杠杆）

3. **规则链桥接是否成立**：确认手册 `depends_on` / `cross_refs` 的语义是否等于
   「上游 effect → 下游 field」。若是，这是**架构级**改进（潜在 +9 条）。
4. **字段补齐优先级**：按 §3.3 表，大人判定哪些字段**可从盘口推导**、哪些**必须新数据源**
   （如 `value_gap_ratio` 身价差已确认不可推导；`key_player_confirmed`/`tactical_style`
   属非盘口）。我可按此清单逐项实现可推导的那部分。
5. **方向映射语义**：`E01` 四象限 → 上盘/下盘 的映射规则（见 §3.5）。

### C 档 · 排后

6. **前端剩余页收口**：`pipeline`（25 处 mock）/ `dsl`（9）/ `ingest`（9）。
   建议排在融合层形态确定之后——`pipeline` 页的可视化内容依赖它，先做易返工。

---

## 五、与既有认知的差异（本次更正）

| 既有表述 | 实测更正 |
|---|---|
| 「custom 算子 13 处未实现」是主要缺口 | 求值器 `unknown` 计数 **= 0** → 算子不是当前瓶颈，**字段缺失**才是 |
| 「196 字段多数卡在非盘口输入」 | **部分成立**：方向型规则最接近的几个字段（`water_change`）与规则链字段（`classification`）属**盘口可推导**，只是未实现 |
| 「S25 已 re-certify 为 active+trusted」 | 当前 DB 中 88 条 **全部 `provisional`、`evidence_count=0`** → 转正成果**未沉淀到此 DB**（试点可能在测试环境完成） |

---

## 六、附录：实测方法

- 服务：`createService({ dbPath: server/data/odds-edge.db })` + `OE_SPORTTERY_ANCHOR=odds` +
  `OE_MANUAL_ODDS_ROOT=F:/ocr_python_data/FootballScreenshotOcr/output`
- 端点：`GET /api/sources/merged`（池）、`GET /api/merged/analysis/:id`（v97 块 + fusion 块）、
  `GET /api/rules`（88 条状态）
- 注册表：`F:/ocr_python_data/doc/workbench/current/rule_registry.json`（88 条 / 157 atoms /
  208 字段词表）
- 样本：合并池前 12–40 场（跨样本并集）
- 探测脚本为一次性产物，已清理；原始数据见本文档 §3 各表。
