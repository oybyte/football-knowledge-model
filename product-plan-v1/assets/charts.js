(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var accent3 = style.getPropertyValue('--accent3').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg = style.getPropertyValue('--bg').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();
  var bg3 = style.getPropertyValue('--bg3').trim();
  var purple = style.getPropertyValue('--purple').trim();
  var success = style.getPropertyValue('--success').trim();
  var danger = style.getPropertyValue('--danger').trim();

  // --- Chart: System Architecture ---
  var chartArch = echarts.init(document.getElementById('chart-arch'), null, { renderer: 'svg' });
  chartArch.setOption({
    animation: false,
    tooltip: { show: false },
    series: [{
      type: 'graph',
      layout: 'none',
      roam: false,
      symbolSize: [280, 52],
      symbol: 'roundRect',
      label: {
        show: true,
        position: 'inside',
        color: ink,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'InstrumentSans, sans-serif'
      },
      edgeSymbol: ['none', 'arrow'],
      edgeSymbolSize: [0, 10],
      lineStyle: {
        color: rule,
        width: 2,
        opacity: 0.8,
        curveness: 0
      },
      itemStyle: {
        color: bg2,
        borderColor: rule,
        borderWidth: 1,
        borderRadius: 6
      },
      data: [
        { name: '预测链层', x: 400, y: 80, itemStyle: { color: 'rgba(88,166,255,0.12)', borderColor: accent } },
        { name: '知识库引擎层', x: 400, y: 200, itemStyle: { color: 'rgba(57,210,192,0.12)', borderColor: accent2 } },
        { name: '数据接入层', x: 400, y: 320, itemStyle: { color: 'rgba(240,136,62,0.12)', borderColor: accent3 } },
        { name: '工程治理层（横切）', x: 400, y: 440, itemStyle: { color: 'rgba(163,113,247,0.12)', borderColor: purple } }
      ],
      links: [
        { source: '数据接入层', target: '知识库引擎层' },
        { source: '知识库引擎层', target: '预测链层' }
      ],
      emphasis: { disabled: true }
    }],
    graphic: [
      {
        type: 'text', left: 70, top: 68,
        style: { text: '规则推理 · 统计模型 · 异常检测 · 融合决策', fill: muted, fontSize: 11, fontFamily: 'JetBrainsMono, monospace' }
      },
      {
        type: 'text', left: 70, top: 188,
        style: { text: '规则版本化 · DSL 检索 · 冲突仲裁 · 证据快照', fill: muted, fontSize: 11, fontFamily: 'JetBrainsMono, monospace' }
      },
      {
        type: 'text', left: 70, top: 308,
        style: { text: '机构赔率采集 · 比赛基本面 · 历史结果 · 时间戳注入', fill: muted, fontSize: 11, fontFamily: 'JetBrainsMono, monospace' }
      },
      {
        type: 'text', left: 70, top: 428,
        style: { text: '实验沙箱 · 回测框架 · 审计追踪 · 时间泄漏校验', fill: muted, fontSize: 11, fontFamily: 'JetBrainsMono, monospace' }
      }
    ]
  });
  window.addEventListener('resize', function() { chartArch.resize(); });
})();