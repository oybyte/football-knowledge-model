// ============================================================
// App Logic - 足球竞猜知识库管理系统
// ============================================================

const App = {
  state: {
    currentPage: 'dashboard',
    currentCategory: 'all',
    searchQuery: '',
    rules: [...MOCK_RULES],
    matches: [...MOCK_MATCHES],
    stats: { ...MOCK_STATS },
    selectedRule: null,
    editingRule: null,
    showModal: false,
    modalMode: 'create' // 'create' | 'edit'
  },

  init() {
    this.bindNavigation();
    this.renderDashboard();
    this.renderRules();
    this.renderMatches();
    this.renderSensitivity();
    this.showToast('系统初始化完成', 'info');
  },

  // --- Navigation ---
  bindNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const page = item.dataset.page;
        this.navigateTo(page);
      });
    });
  },

  navigateTo(page) {
    this.state.currentPage = page;
    this.state.selectedRule = null;
    this.state.searchQuery = '';
    this.state.currentCategory = 'all';

    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Update topbar
    const titles = {
      dashboard: '仪表盘',
      rules: '规则库管理',
      matches: '比赛分析',
      sensitivity: '数据敏感度监控'
    };
    document.querySelector('.topbar-title').textContent = titles[page] || '';

    // Show page
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const pageEl = document.getElementById('page-' + page);
    if (pageEl) pageEl.classList.add('active');

    // Render
    if (page === 'dashboard') this.renderDashboard();
    if (page === 'rules') this.renderRules();
    if (page === 'matches') this.renderMatches();
    if (page === 'sensitivity') this.renderSensitivity();
  },

  // --- Dashboard ---
  renderDashboard() {
    const s = this.state.stats;
    const catDistribution = s.rulesByCategory;
    const catNames = { odds_change: '盘口变化', institution_diff: '机构差异', sensitivity: '数据敏感度', league_feature: '联赛特征' };

    document.getElementById('dashboard-content').innerHTML = `
      <div class="stats-grid">
        <div class="stat-card accent-blue">
          <div class="stat-label">规则总数</div>
          <div class="stat-value">${s.totalRules}</div>
          <div class="stat-change up">全部激活</div>
        </div>
        <div class="stat-card accent-green">
          <div class="stat-label">平均置信度</div>
          <div class="stat-value">${(s.avgConfidence * 100).toFixed(0)}%</div>
          <div class="stat-change up">基于 ${s.totalEvidence} 条证据</div>
        </div>
        <div class="stat-card accent-yellow">
          <div class="stat-label">监控比赛</div>
          <div class="stat-value">${s.recentMatches}</div>
          <div class="stat-change">${s.alertsTriggered} 条规则触发</div>
        </div>
        <div class="stat-card accent-purple">
          <div class="stat-label">证据总量</div>
          <div class="stat-value">${s.totalEvidence}</div>
          <div class="stat-change up">历史回测数据</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">规则分类分布</div>
              <div class="card-subtitle">各类别规则数量</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${Object.entries(catDistribution).map(([cat, count]) => `
              <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:12px;min-width:80px;color:var(--text-secondary);">${catNames[cat]}</span>
                <div class="confidence-bar" style="flex:1;">
                  <div class="bar-track">
                    <div class="bar-fill high" style="width:${(count / s.totalRules * 100).toFixed(0)}%"></div>
                  </div>
                </div>
                <span style="font-family:var(--font-mono);font-size:12px;font-weight:600;">${count}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <div class="card-title">最近触发规则</div>
              <div class="card-subtitle">当前监控比赛的规则匹配</div>
            </div>
          </div>
          <div>
            ${this.state.matches.slice(0, 3).flatMap(m => m.alerts.map(aid => {
              const rule = this.state.rules.find(r => r.id === aid);
              if (!rule) return '';
              return `
                <div class="alert-item">
                  <div class="alert-icon ${rule.direction === 'warning' ? 'warning' : 'info'}">${rule.direction === 'warning' ? '⚠' : '📊'}</div>
                  <div class="alert-content">
                    <div class="alert-title">${rule.title}</div>
                    <div class="alert-desc">${m.homeTeam} vs ${m.awayTeam} · ${m.league}</div>
                    <div class="alert-meta">置信度: ${(rule.confidence * 100).toFixed(0)}% · 证据: ${rule.evidenceCount}条</div>
                  </div>
                </div>
              `;
            })).join('')}
          </div>
        </div>
      </div>
    `;
  },

  // --- Rules ---
  renderRules() {
    const cat = this.state.currentCategory;
    const q = this.state.searchQuery.toLowerCase();

    let filtered = this.state.rules;
    if (cat !== 'all') filtered = filtered.filter(r => r.category === cat);
    if (q) filtered = filtered.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.tags.some(t => t.toLowerCase().includes(q)) ||
      r.conclusion.toLowerCase().includes(q)
    );

    const catNames = { odds_change: '盘口变化', institution_diff: '机构差异', sensitivity: '数据敏感度', league_feature: '联赛特征' };
    const dirNames = {
      favor_upper: '利好上盘', favor_lower: '利好下盘', favor_home: '利好主队',
      reversal: '反向操作', follow: '跟随方向', warning: '预警',
      neutral: '中性', caution: '谨慎', under: '倾向小球', follow_volume: '跟随成交量'
    };

    document.getElementById('rules-content').innerHTML = `
      <div class="search-bar">
        <div class="search-input-wrapper">
          <span class="search-icon">🔍</span>
          <input class="form-input" id="rule-search" type="text" placeholder="搜索规则标题、标签、结论..." value="${this.state.searchQuery}">
        </div>
        <select class="form-select" id="rule-category-filter" style="width:auto;min-width:140px;">
          <option value="all" ${cat === 'all' ? 'selected' : ''}>全部类别</option>
          <option value="odds_change" ${cat === 'odds_change' ? 'selected' : ''}>盘口变化</option>
          <option value="institution_diff" ${cat === 'institution_diff' ? 'selected' : ''}>机构差异</option>
          <option value="sensitivity" ${cat === 'sensitivity' ? 'selected' : ''}>数据敏感度</option>
          <option value="league_feature" ${cat === 'league_feature' ? 'selected' : ''}>联赛特征</option>
        </select>
        <button class="btn btn-primary" onclick="App.openRuleModal('create')">+ 新建规则</button>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>类别</th>
              <th>规则标题</th>
              <th>方向</th>
              <th>置信度</th>
              <th>证据数</th>
              <th>标签</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.length === 0 ? `
              <tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted);">未找到匹配的规则</td></tr>
            ` : filtered.map(r => `
              <tr id="rule-row-${r.id}" class="rule-row" style="cursor:pointer;" onclick="App.toggleRuleDetail('${r.id}')">
                <td><span style="font-family:var(--font-mono);font-size:12px;color:var(--accent-blue);">${r.id}</span></td>
                <td>${catNames[r.category] || r.categoryName}</td>
                <td style="font-weight:500;">${r.title}</td>
                <td><span class="direction ${r.direction}">${dirNames[r.direction] || r.direction}</span></td>
                <td>
                  <div class="confidence-bar">
                    <div class="bar-track">
                      <div class="bar-fill ${r.confidence >= 0.7 ? 'high' : r.confidence >= 0.6 ? 'medium' : 'low'}" style="width:${(r.confidence * 100).toFixed(0)}%"></div>
                    </div>
                    <span class="bar-value">${(r.confidence * 100).toFixed(0)}%</span>
                  </div>
                </td>
                <td style="font-family:var(--font-mono);">${r.evidenceCount}</td>
                <td>
                  ${r.tags.slice(0, 3).map(t => `<span class="tag tag-blue">${t}</span>`).join('')}
                  ${r.tags.length > 3 ? `<span class="tag tag-blue">+${r.tags.length - 3}</span>` : ''}
                </td>
                <td>
                  <button class="btn btn-sm" onclick="event.stopPropagation();App.openRuleModal('edit','${r.id}')">编辑</button>
                  <button class="btn btn-sm" style="color:var(--accent-red);" onclick="event.stopPropagation();App.deleteRule('${r.id}')">删除</button>
                </td>
              </tr>
              <tr id="rule-detail-${r.id}" style="display:none;">
                <td colspan="8">
                  <div class="rule-detail-panel">
                    <div class="detail-row"><span class="detail-label">触发条件</span><span class="detail-value">${r.condition.pattern}</span></div>
                    <div class="detail-row"><span class="detail-label">详细参数</span><span class="detail-value">${JSON.stringify(r.condition.trigger, null, 2)}</span></div>
                    <div class="detail-row"><span class="detail-label">结论</span><span class="detail-value">${r.conclusion}</span></div>
                    <div class="detail-row"><span class="detail-label">来源</span><span class="detail-value">${r.source}</span></div>
                    <div class="detail-row"><span class="detail-label">关联规则</span><span class="detail-value">${r.relatedRules.length > 0 ? r.relatedRules.join(', ') : '无'}</span></div>
                    <div class="detail-row"><span class="detail-label">创建时间</span><span class="detail-value">${r.createdAt}</span></div>
                    <div class="detail-row"><span class="detail-label">更新时间</span><span class="detail-value">${r.updatedAt}</span></div>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Bind events
    document.getElementById('rule-search').addEventListener('input', (e) => {
      this.state.searchQuery = e.target.value;
      this.renderRules();
    });
    document.getElementById('rule-category-filter').addEventListener('change', (e) => {
      this.state.currentCategory = e.target.value;
      this.renderRules();
    });
  },

  toggleRuleDetail(id) {
    const detailRow = document.getElementById('rule-detail-' + id);
    if (detailRow) {
      const isVisible = detailRow.style.display !== 'none';
      detailRow.style.display = isVisible ? 'none' : 'table-row';
      if (!isVisible) {
        detailRow.classList.add('highlight-row');
        setTimeout(() => detailRow.classList.remove('highlight-row'), 2000);
      }
    }
  },

  openRuleModal(mode, ruleId) {
    this.state.modalMode = mode;
    if (mode === 'edit' && ruleId) {
      this.state.editingRule = this.state.rules.find(r => r.id === ruleId);
    } else {
      this.state.editingRule = null;
    }
    this.state.showModal = true;
    this.renderRuleModal();
  },

  closeRuleModal() {
    this.state.showModal = false;
    this.state.editingRule = null;
    document.getElementById('rule-modal').innerHTML = '';
  },

  renderRuleModal() {
    const rule = this.state.editingRule;
    const isEdit = this.state.modalMode === 'edit';

    document.getElementById('rule-modal').innerHTML = `
      <div class="modal-overlay" onclick="App.closeRuleModal()">
        <div class="modal" onclick="event.stopPropagation()">
          <div class="modal-header">
            <span class="modal-title">${isEdit ? '编辑规则' : '新建规则'}</span>
            <button class="modal-close" onclick="App.closeRuleModal()">x</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">规则ID</label>
                <input class="form-input" id="form-rule-id" value="${isEdit ? rule.id : ''}" ${isEdit ? 'readonly' : 'placeholder="自动生成"'} >
              </div>
              <div class="form-group">
                <label class="form-label">类别</label>
                <select class="form-select" id="form-category">
                  <option value="odds_change" ${isEdit && rule.category === 'odds_change' ? 'selected' : ''}>盘口变化</option>
                  <option value="institution_diff" ${isEdit && rule.category === 'institution_diff' ? 'selected' : ''}>机构差异</option>
                  <option value="sensitivity" ${isEdit && rule.category === 'sensitivity' ? 'selected' : ''}>数据敏感度</option>
                  <option value="league_feature" ${isEdit && rule.category === 'league_feature' ? 'selected' : ''}>联赛特征</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">规则标题</label>
              <input class="form-input" id="form-title" value="${isEdit ? rule.title : ''}" placeholder="例如：临场升盘降水 — 利好上盘">
            </div>
            <div class="form-group">
              <label class="form-label">触发模式</label>
              <input class="form-input" id="form-pattern" value="${isEdit ? rule.condition.pattern : ''}" placeholder="例如：升盘+降水">
            </div>
            <div class="form-group">
              <label class="form-label">触发条件 (JSON)</label>
              <textarea class="form-textarea" id="form-trigger" rows="4">${isEdit ? JSON.stringify(rule.condition.trigger, null, 2) : '{\n  "timeWindow": "",\n  "threshold": ""\n}'}</textarea>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">结论</label>
                <input class="form-input" id="form-conclusion" value="${isEdit ? rule.conclusion : ''}" placeholder="规则结论">
              </div>
              <div class="form-group">
                <label class="form-label">方向</label>
                <select class="form-select" id="form-direction">
                  <option value="favor_upper" ${isEdit && rule.direction === 'favor_upper' ? 'selected' : ''}>利好上盘</option>
                  <option value="favor_lower" ${isEdit && rule.direction === 'favor_lower' ? 'selected' : ''}>利好下盘</option>
                  <option value="favor_home" ${isEdit && rule.direction === 'favor_home' ? 'selected' : ''}>利好主队</option>
                  <option value="reversal" ${isEdit && rule.direction === 'reversal' ? 'selected' : ''}>反向操作</option>
                  <option value="follow" ${isEdit && rule.direction === 'follow' ? 'selected' : ''}>跟随方向</option>
                  <option value="warning" ${isEdit && rule.direction === 'warning' ? 'selected' : ''}>预警</option>
                  <option value="neutral" ${isEdit && rule.direction === 'neutral' ? 'selected' : ''}>中性</option>
                  <option value="caution" ${isEdit && rule.direction === 'caution' ? 'selected' : ''}>谨慎</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">置信度 (0-1)</label>
                <input class="form-input" id="form-confidence" type="number" min="0" max="1" step="0.01" value="${isEdit ? rule.confidence : '0.70'}">
              </div>
              <div class="form-group">
                <label class="form-label">证据数量</label>
                <input class="form-input" id="form-evidence" type="number" min="0" value="${isEdit ? rule.evidenceCount : '0'}">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">标签（逗号分隔）</label>
              <input class="form-input" id="form-tags" value="${isEdit ? rule.tags.join(', ') : ''}" placeholder="例如：临场变化, 升盘, 降水">
            </div>
            <div class="form-group">
              <label class="form-label">来源</label>
              <input class="form-input" id="form-source" value="${isEdit ? rule.source : ''}" placeholder="例如：历史回测-2024赛季">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="App.closeRuleModal()">取消</button>
            <button class="btn btn-primary" onclick="App.saveRule('${isEdit ? rule.id : ''}')">${isEdit ? '保存修改' : '创建规则'}</button>
          </div>
        </div>
      </div>
    `;
  },

  saveRule(ruleId) {
    const data = {
      id: document.getElementById('form-rule-id').value || 'R' + String(this.state.rules.length + 1).padStart(3, '0'),
      category: document.getElementById('form-category').value,
      categoryName: { odds_change: '盘口变化', institution_diff: '机构差异', sensitivity: '数据敏感度', league_feature: '联赛特征' }[document.getElementById('form-category').value],
      title: document.getElementById('form-title').value,
      condition: {
        pattern: document.getElementById('form-pattern').value,
        trigger: JSON.parse(document.getElementById('form-trigger').value)
      },
      conclusion: document.getElementById('form-conclusion').value,
      direction: document.getElementById('form-direction').value,
      confidence: parseFloat(document.getElementById('form-confidence').value),
      evidenceCount: parseInt(document.getElementById('form-evidence').value),
      tags: document.getElementById('form-tags').value.split(',').map(t => t.trim()).filter(Boolean),
      source: document.getElementById('form-source').value,
      relatedRules: [],
      createdAt: new Date().toISOString().slice(0, 10),
      updatedAt: new Date().toISOString().slice(0, 10),
      status: 'active'
    };

    if (this.state.modalMode === 'edit') {
      const idx = this.state.rules.findIndex(r => r.id === ruleId);
      if (idx >= 0) {
        data.id = ruleId;
        data.createdAt = this.state.rules[idx].createdAt;
        data.relatedRules = this.state.rules[idx].relatedRules;
        this.state.rules[idx] = data;
      }
      this.showToast('规则已更新', 'success');
    } else {
      this.state.rules.push(data);
      this.state.stats.totalRules = this.state.rules.length;
      this.state.stats.rulesByCategory[data.category] = (this.state.stats.rulesByCategory[data.category] || 0) + 1;
      this.showToast('规则已创建', 'success');
    }

    this.closeRuleModal();
    this.renderRules();
    this.renderDashboard();
  },

  deleteRule(ruleId) {
    if (!confirm('确定删除规则 ' + ruleId + '？此操作不可撤销。')) return;
    const idx = this.state.rules.findIndex(r => r.id === ruleId);
    if (idx >= 0) {
      const cat = this.state.rules[idx].category;
      this.state.rules.splice(idx, 1);
      this.state.stats.totalRules = this.state.rules.length;
      this.state.stats.rulesByCategory[cat] = Math.max(0, (this.state.stats.rulesByCategory[cat] || 1) - 1);
      this.showToast('规则已删除', 'success');
      this.renderRules();
      this.renderDashboard();
    }
  },

  // --- Matches ---
  renderMatches() {
    document.getElementById('matches-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">当前监控比赛</div>
            <div class="card-subtitle">基于机构盘口赔率数据差异分析</div>
          </div>
          <div>
            <span style="font-size:12px;color:var(--text-muted);margin-right:8px;">共 ${this.state.matches.length} 场比赛</span>
            <button class="btn btn-sm" onclick="App.runMatchAnalysis()">🔄 刷新分析</button>
          </div>
        </div>
        ${this.state.matches.map(m => this.renderMatchCard(m)).join('')}
      </div>
    `;
  },

  renderMatchCard(m) {
    const dirNames = {
      favor_upper: '利好上盘', favor_lower: '利好下盘', favor_home: '利好主队',
      reversal: '反向操作', follow: '跟随方向', warning: '预警',
      neutral: '中性', caution: '谨慎', under: '倾向小球', follow_volume: '跟随成交量'
    };

    const matchedRules = m.alerts.map(aid => this.state.rules.find(r => r.id === aid)).filter(Boolean);

    return `
      <div class="match-card" id="match-${m.id}">
        <div class="match-header">
          <div>
            <div class="match-teams">${m.homeTeam} vs ${m.awayTeam}</div>
            <div style="margin-top:4px;">
              <span class="match-league">${m.league}</span>
              <span class="match-time" style="margin-left:10px;">${m.matchTime}</span>
            </div>
          </div>
          <div>
            <span style="font-size:12px;color:var(--text-muted);">匹配 ${matchedRules.length} 条规则</span>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">机构盘口赔率对比</div>
          <div class="odds-grid">
            ${Object.entries(m.odds).map(([instId, data]) => {
              const inst = MOCK_INSTITUTIONS.find(i => i.id === instId);
              const hChange = data.initial.handicap !== data.current.handicap;
              return `
                <div class="odds-item">
                  <div class="inst-name">${inst ? inst.name : instId}</div>
                  <div class="odds-row">
                    <span>盘口</span>
                    <span style="color:${hChange ? 'var(--accent-yellow)' : 'var(--text-primary)'}">
                      ${data.initial.handicap} → ${data.current.handicap}
                      ${hChange ? '<span class="odds-change up">变</span>' : ''}
                    </span>
                  </div>
                  <div class="odds-row">
                    <span>上盘</span>
                    <span>
                      ${data.initial.upper} → ${data.current.upper}
                      <span class="odds-change ${data.current.upper < data.initial.upper ? 'down' : 'up'}">
                        ${data.current.upper < data.initial.upper ? '↓' : '↑'}
                      </span>
                    </span>
                  </div>
                  <div class="odds-row">
                    <span>下盘</span>
                    <span>
                      ${data.initial.lower} → ${data.current.lower}
                      <span class="odds-change ${data.current.lower < data.initial.lower ? 'down' : 'up'}">
                        ${data.current.lower < data.initial.lower ? '↓' : '↑'}
                      </span>
                    </span>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <div style="border-top:1px solid var(--border);padding-top:12px;">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">匹配规则分析</div>
          ${matchedRules.length === 0 ? `
            <div style="color:var(--text-muted);font-size:12px;">暂无匹配规则</div>
          ` : matchedRules.map(r => `
            <div class="alert-item" style="padding:8px 0;">
              <div class="alert-icon ${r.direction === 'warning' ? 'warning' : 'info'}">
                ${r.direction === 'warning' ? '⚠' : r.direction === 'reversal' ? '↩' : '✓'}
              </div>
              <div class="alert-content">
                <div class="alert-title">${r.title}</div>
                <div class="alert-desc">${r.conclusion}</div>
                <div class="alert-meta">
                  置信度: ${(r.confidence * 100).toFixed(0)}% ·
                  证据: ${r.evidenceCount}条 ·
                  方向: <span class="direction ${r.direction}" style="font-size:11px;">${dirNames[r.direction]}</span>
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  },

  runMatchAnalysis() {
    this.showToast('正在重新分析比赛数据...', 'info');
    setTimeout(() => {
      this.showToast('分析完成，规则匹配已更新', 'success');
      this.renderMatches();
    }, 800);
  },

  // --- Sensitivity ---
  renderSensitivity() {
    const indicators = [
      {
        id: 'volatility',
        title: '赔率波动率',
        metric: '0.042',
        threshold: '0.05',
        status: 'normal',
        statusText: '正常',
        detail: '当前最大波动来自Bet365-曼城vs利物浦，15分钟内赔率变化0.042，未触及0.05阈值'
      },
      {
        id: 'kelly',
        title: '凯利指数',
        metric: '1.08',
        threshold: '1.05',
        status: 'danger',
        statusText: '异常',
        detail: '阿森纳vs切尔西，威廉希尔凯利指数=1.08，超过1.05阈值，触发R009规则预警'
      },
      {
        id: 'volume',
        title: '成交量异常',
        metric: '245%',
        threshold: '200%',
        status: 'warning',
        statusText: '预警',
        detail: '阿森纳vs切尔西成交量较联赛均值高245%，超过200%阈值，触发R012规则'
      },
      {
        id: 'sync',
        title: '多机构同步率',
        metric: '3/4',
        threshold: '≥3家',
        status: 'normal',
        statusText: '正常',
        detail: '曼城vs利物浦4家机构同向调整，符合R004多机构同步规则，方向一致'
      },
      {
        id: 'handicap',
        title: '盘口深度偏差',
        metric: '0.25',
        threshold: '0.25',
        status: 'warning',
        statusText: '预警',
        detail: '拜仁vs多特蒙德，澳门初盘深度高于市场均值0.25，触发R003诱盘预警'
      },
      {
        id: 'timewindow',
        title: '临场变化窗口',
        metric: '活跃',
        threshold: '赛前30min',
        status: 'normal',
        statusText: '监控中',
        detail: '当前2场比赛处于临场30分钟窗口期，正在监控盘口水位变化'
      }
    ];

    document.getElementById('sensitivity-content').innerHTML = `
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">数据敏感度实时监控</div>
            <div class="card-subtitle">基于机构盘口赔率数据的异常检测</div>
          </div>
          <button class="btn btn-sm" onclick="App.refreshSensitivity()">🔄 刷新</button>
        </div>
        <div class="sensitivity-grid">
          ${indicators.map(ind => `
            <div class="sensitivity-card ${ind.status}">
              <div class="sens-header">
                <span class="sens-title">${ind.title}</span>
                <span class="sens-status ${ind.status}">${ind.statusText}</span>
              </div>
              <div class="sens-metric">
                ${ind.metric}
                <span style="font-size:12px;color:var(--text-muted);font-weight:400;">/ ${ind.threshold}</span>
              </div>
              <div class="sens-detail">${ind.detail}</div>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <div class="card-header">
          <div class="card-title">敏感度规则触发记录</div>
          <span style="font-size:12px;color:var(--text-muted);">近24小时</span>
        </div>
        ${this.state.rules.filter(r => r.category === 'sensitivity').map(r => `
          <div class="alert-item">
            <div class="alert-icon ${r.direction === 'warning' ? 'warning' : 'danger'}">⚠</div>
            <div class="alert-content">
              <div class="alert-title">${r.title}</div>
              <div class="alert-desc">${r.conclusion}</div>
              <div class="alert-meta">置信度: ${(r.confidence * 100).toFixed(0)}% · 证据: ${r.evidenceCount}条 · 来源: ${r.source}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  refreshSensitivity() {
    this.showToast('正在刷新敏感度数据...', 'info');
    setTimeout(() => {
      this.showToast('敏感度数据已更新', 'success');
      this.renderSensitivity();
    }, 600);
  },

  // --- Toast ---
  showToast(msg, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }
};

// --- Init ---
document.addEventListener('DOMContentLoaded', () => App.init());