// ============================================================
// Mock Data - 足球竞猜知识库原型数据
// ============================================================

// --- 知识库规则 ---
const MOCK_RULES = [
  {
    id: "R001",
    category: "odds_change",
    categoryName: "盘口变化",
    title: "临场升盘降水 — 利好上盘",
    condition: {
      pattern: "升盘+降水",
      trigger: {
        timeWindow: "临场前30分钟",
        handicapChange: "升盘（如半球→半一）",
        waterChange: "水位下降 ≥ 0.05"
      }
    },
    conclusion: "上盘赢盘概率显著提升",
    direction: "favor_upper",
    confidence: 0.72,
    evidenceCount: 156,
    source: "历史回测-2024赛季",
    tags: ["临场变化", "升盘", "降水", "高置信"],
    relatedRules: ["R002", "R015"],
    createdAt: "2025-01-15",
    updatedAt: "2026-06-20",
    status: "active"
  },
  {
    id: "R002",
    category: "odds_change",
    categoryName: "盘口变化",
    title: "临场降盘升水 — 警惕下盘",
    condition: {
      pattern: "降盘+升水",
      trigger: {
        timeWindow: "临场前30分钟",
        handicapChange: "降盘（如半一→半球）",
        waterChange: "水位上升 ≥ 0.05"
      }
    },
    conclusion: "下盘不败概率显著提升",
    direction: "favor_lower",
    confidence: 0.68,
    evidenceCount: 132,
    source: "历史回测-2024赛季",
    tags: ["临场变化", "降盘", "升水"],
    relatedRules: ["R001"],
    createdAt: "2025-01-15",
    updatedAt: "2026-06-20",
    status: "active"
  },
  {
    id: "R003",
    category: "institution_diff",
    categoryName: "机构差异",
    title: "澳门盘口初盘深开 — 诱盘嫌疑",
    condition: {
      pattern: "澳门初盘深度高于市场均值",
      trigger: {
        institution: "澳门",
        phase: "初盘",
        diffThreshold: "盘口深度差 ≥ 0.25（vs 市场均值）"
      }
    },
    conclusion: "需警惕诱盘，反向操作概率高",
    direction: "reversal",
    confidence: 0.65,
    evidenceCount: 89,
    source: "机构行为分析",
    tags: ["澳门", "初盘", "深开", "诱盘"],
    relatedRules: ["R004", "R008"],
    createdAt: "2025-03-10",
    updatedAt: "2026-05-15",
    status: "active"
  },
  {
    id: "R004",
    category: "institution_diff",
    categoryName: "机构差异",
    title: "多机构赔率同步异动 — 真实信号",
    condition: {
      pattern: "≥3家机构同步调赔",
      trigger: {
        institutionCount: "≥ 3家",
        timeWindow: "15分钟内",
        direction: "同向调整",
        magnitude: "赔率变化 ≥ 0.10"
      }
    },
    conclusion: "大概率反映真实信息，跟随方向",
    direction: "follow",
    confidence: 0.78,
    evidenceCount: 201,
    source: "历史回测-2024-2025赛季",
    tags: ["多机构", "同步", "高置信"],
    relatedRules: ["R003", "R008"],
    createdAt: "2025-02-20",
    updatedAt: "2026-04-10",
    status: "active"
  },
  {
    id: "R005",
    category: "sensitivity",
    categoryName: "数据敏感度",
    title: "赔率突变预警 — 15分钟内波动>0.05",
    condition: {
      pattern: "赔率快速剧烈波动",
      trigger: {
        timeWindow: "15分钟内",
        oddsChange: "> 0.05",
        volatility: "异常高"
      }
    },
    conclusion: "可能存在重大信息变化，暂停分析等待确认",
    direction: "warning",
    confidence: 0.85,
    evidenceCount: 47,
    source: "异常检测模型",
    tags: ["异常", "突变", "预警", "高风险"],
    relatedRules: [],
    createdAt: "2025-06-01",
    updatedAt: "2026-07-01",
    status: "active"
  },
  {
    id: "R006",
    category: "league_feature",
    categoryName: "联赛特征",
    title: "意甲小球偏好 — 深盘需谨慎",
    condition: {
      pattern: "意甲+深盘",
      trigger: {
        league: "意甲",
        handicapDepth: "≥ 一球/球半",
        avgGoals: "意甲场均进球偏低"
      }
    },
    conclusion: "深盘穿盘率低，关注小球/下盘",
    direction: "under",
    confidence: 0.70,
    evidenceCount: 178,
    source: "联赛统计-2023-2025",
    tags: ["意甲", "深盘", "小球", "联赛特征"],
    relatedRules: [],
    createdAt: "2025-04-10",
    updatedAt: "2026-03-01",
    status: "active"
  },
  {
    id: "R007",
    category: "odds_change",
    categoryName: "盘口变化",
    title: "初盘受注后维持不变 — 平衡信号",
    condition: {
      pattern: "盘口长期稳定",
      trigger: {
        timeWindow: "受注后至临场前1小时",
        handicapChange: "无变化",
        waterFluctuation: "水位波动 < 0.03"
      }
    },
    conclusion: "盘口平衡，基本面分析为主",
    direction: "neutral",
    confidence: 0.55,
    evidenceCount: 320,
    source: "历史统计",
    tags: ["稳定", "平衡", "基本面"],
    relatedRules: [],
    createdAt: "2025-05-01",
    updatedAt: "2026-01-15",
    status: "active"
  },
  {
    id: "R008",
    category: "institution_diff",
    categoryName: "机构差异",
    title: "威廉希尔与立博分歧大 — 谨慎参考",
    condition: {
      pattern: "头部机构分歧",
      trigger: {
        institutionA: "威廉希尔",
        institutionB: "立博",
        diffThreshold: "赔率差 ≥ 0.15"
      }
    },
    conclusion: "市场分歧大，不确定性高，降低投注权重",
    direction: "caution",
    confidence: 0.60,
    evidenceCount: 95,
    source: "机构行为分析",
    tags: ["威廉希尔", "立博", "分歧", "不确定性"],
    relatedRules: ["R003", "R004"],
    createdAt: "2025-03-20",
    updatedAt: "2026-02-28",
    status: "active"
  },
  {
    id: "R009",
    category: "sensitivity",
    categoryName: "数据敏感度",
    title: "水位异常偏离 — 凯利指数>1.05",
    condition: {
      pattern: "凯利指数异常",
      trigger: {
        indicator: "凯利指数",
        threshold: "> 1.05",
        institution: "任一机构"
      }
    },
    conclusion: "存在套利空间或数据异常，需人工复核",
    direction: "warning",
    confidence: 0.75,
    evidenceCount: 63,
    source: "风控模型",
    tags: ["凯利指数", "异常", "套利", "复核"],
    relatedRules: ["R005"],
    createdAt: "2025-07-15",
    updatedAt: "2026-06-01",
    status: "active"
  },
  {
    id: "R010",
    category: "league_feature",
    categoryName: "联赛特征",
    title: "英超半球盘 — 主场优势显著",
    condition: {
      pattern: "英超+半球盘+主场",
      trigger: {
        league: "英超",
        handicap: "半球",
        homeAway: "主队让球"
      }
    },
    conclusion: "主队赢盘率约58%，可适度倾向主队",
    direction: "favor_home",
    confidence: 0.66,
    evidenceCount: 210,
    source: "联赛统计-2023-2025",
    tags: ["英超", "半球盘", "主场优势"],
    relatedRules: [],
    createdAt: "2025-04-20",
    updatedAt: "2026-05-10",
    status: "active"
  },
  {
    id: "R011",
    category: "odds_change",
    categoryName: "盘口变化",
    title: "升盘不降水 — 诱盘信号",
    condition: {
      pattern: "升盘+水位不变/微升",
      trigger: {
        handicapChange: "升盘",
        waterChange: "水位不变或上升",
        timeWindow: "受注期"
      }
    },
    conclusion: "诱上盘概率高，反向操作",
    direction: "reversal",
    confidence: 0.63,
    evidenceCount: 78,
    source: "经验总结",
    tags: ["升盘", "诱盘", "反向"],
    relatedRules: ["R001", "R002"],
    createdAt: "2025-08-01",
    updatedAt: "2026-04-01",
    status: "active"
  },
  {
    id: "R012",
    category: "sensitivity",
    categoryName: "数据敏感度",
    title: "成交量异常放大 — 信息泄露信号",
    condition: {
      pattern: "成交量异常",
      trigger: {
        indicator: "成交量",
        threshold: "超过同联赛均值 200%",
        timeWindow: "赛前2小时"
      }
    },
    conclusion: "可能有内幕信息，跟随成交量方向",
    direction: "follow_volume",
    confidence: 0.71,
    evidenceCount: 54,
    source: "成交量分析",
    tags: ["成交量", "异常", "内幕", "跟随"],
    relatedRules: ["R005"],
    createdAt: "2025-09-10",
    updatedAt: "2026-06-15",
    status: "active"
  }
];

// --- 机构列表 ---
const MOCK_INSTITUTIONS = [
  { id: "macau", name: "澳门", region: "亚洲", weight: 0.95 },
  { id: "crown", name: "皇冠", region: "亚洲", weight: 0.90 },
  { id: "bet365", name: "Bet365", region: "欧洲", weight: 0.88 },
  { id: "williamhill", name: "威廉希尔", region: "欧洲", weight: 0.92 },
  { id: "ladbrokes", name: "立博", region: "欧洲", weight: 0.87 },
  { id: "pinnacle", name: "Pinnacle", region: "欧洲", weight: 0.85 },
  { id: "sbo", name: "利记", region: "亚洲", weight: 0.82 },
  { id: "ibc", name: "沙巴", region: "亚洲", weight: 0.80 }
];

// --- 模拟比赛数据 ---
const MOCK_MATCHES = [
  {
    id: "M001",
    league: "英超",
    homeTeam: "曼城",
    awayTeam: "利物浦",
    matchTime: "2026-08-15 23:00",
    status: "upcoming",
    odds: {
      macau: { initial: { handicap: "-0.75", upper: 0.92, lower: 0.94 }, current: { handicap: "-1.0", upper: 0.85, lower: 1.01 } },
      crown: { initial: { handicap: "-0.75", upper: 0.94, lower: 0.92 }, current: { handicap: "-1.0", upper: 0.88, lower: 0.98 } },
      bet365: { initial: { handicap: "-0.75", upper: 0.95, lower: 0.91 }, current: { handicap: "-1.0", upper: 0.86, lower: 1.00 } },
      williamhill: { initial: { handicap: "-0.75", upper: 0.93, lower: 0.93 }, current: { handicap: "-0.75", upper: 0.80, lower: 1.06 } }
    },
    alerts: ["R001", "R004"]
  },
  {
    id: "M002",
    league: "意甲",
    homeTeam: "AC米兰",
    awayTeam: "尤文图斯",
    matchTime: "2026-08-16 02:45",
    status: "upcoming",
    odds: {
      macau: { initial: { handicap: "-0.25", upper: 0.88, lower: 0.98 }, current: { handicap: "0", upper: 0.78, lower: 1.08 } },
      crown: { initial: { handicap: "-0.25", upper: 0.90, lower: 0.96 }, current: { handicap: "0", upper: 0.80, lower: 1.06 } },
      bet365: { initial: { handicap: "-0.25", upper: 0.91, lower: 0.95 }, current: { handicap: "0", upper: 0.82, lower: 1.04 } }
    },
    alerts: ["R002", "R006"]
  },
  {
    id: "M003",
    league: "西甲",
    homeTeam: "巴塞罗那",
    awayTeam: "皇家马德里",
    matchTime: "2026-08-16 22:00",
    status: "upcoming",
    odds: {
      macau: { initial: { handicap: "-0.5", upper: 0.95, lower: 0.91 }, current: { handicap: "-0.5", upper: 0.93, lower: 0.93 } },
      crown: { initial: { handicap: "-0.5", upper: 0.96, lower: 0.90 }, current: { handicap: "-0.5", upper: 0.94, lower: 0.92 } },
      bet365: { initial: { handicap: "-0.5", upper: 0.97, lower: 0.89 }, current: { handicap: "-0.5", upper: 0.95, lower: 0.91 } },
      williamhill: { initial: { handicap: "-0.5", upper: 0.94, lower: 0.92 }, current: { handicap: "-0.5", upper: 0.92, lower: 0.94 } }
    },
    alerts: ["R007", "R010"]
  },
  {
    id: "M004",
    league: "德甲",
    homeTeam: "拜仁慕尼黑",
    awayTeam: "多特蒙德",
    matchTime: "2026-08-17 00:30",
    status: "upcoming",
    odds: {
      macau: { initial: { handicap: "-1.25", upper: 0.90, lower: 0.96 }, current: { handicap: "-1.5", upper: 0.92, lower: 0.94 } },
      crown: { initial: { handicap: "-1.25", upper: 0.92, lower: 0.94 }, current: { handicap: "-1.5", upper: 0.94, lower: 0.92 } },
      bet365: { initial: { handicap: "-1.25", upper: 0.88, lower: 0.98 }, current: { handicap: "-1.5", upper: 0.90, lower: 0.96 } }
    },
    alerts: ["R003", "R011"]
  },
  {
    id: "M005",
    league: "英超",
    homeTeam: "阿森纳",
    awayTeam: "切尔西",
    matchTime: "2026-08-17 22:00",
    status: "upcoming",
    odds: {
      macau: { initial: { handicap: "-0.5", upper: 0.88, lower: 0.98 }, current: { handicap: "-0.5", upper: 0.72, lower: 1.14 } },
      crown: { initial: { handicap: "-0.5", upper: 0.90, lower: 0.96 }, current: { handicap: "-0.5", upper: 0.75, lower: 1.11 } },
      bet365: { initial: { handicap: "-0.5", upper: 0.89, lower: 0.97 }, current: { handicap: "-0.5", upper: 0.73, lower: 1.13 } },
      williamhill: { initial: { handicap: "-0.5", upper: 0.91, lower: 0.95 }, current: { handicap: "-0.5", upper: 0.76, lower: 1.10 } }
    },
    alerts: ["R005", "R009", "R012"]
  }
];

// --- 规则分类 ---
const RULE_CATEGORIES = [
  { id: "all", name: "全部规则" },
  { id: "odds_change", name: "盘口变化" },
  { id: "institution_diff", name: "机构差异" },
  { id: "sensitivity", name: "数据敏感度" },
  { id: "league_feature", name: "联赛特征" }
];

// --- 系统统计 ---
const MOCK_STATS = {
  totalRules: 12,
  activeRules: 12,
  rulesByCategory: {
    odds_change: 4,
    institution_diff: 3,
    sensitivity: 3,
    league_feature: 2
  },
  totalEvidence: 1623,
  avgConfidence: 0.69,
  recentMatches: 5,
  alertsTriggered: 8
};