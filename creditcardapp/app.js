import { getNextBillDate, getLastBillDate, calcCardPeriodStats, calcBestCardSuggestion, buildMonthlySeries, computeCardStats, computeStats, normalizeAllRecords } from "./calc.js";
import { showToast, setButtonLoading } from "./ui.js";
// --- State & Constants ---
        const supabaseUrl = 'https://kcjlvxbffaxwpcrrxkbq.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtjamx2eGJmZmF4d3BjcnJ4a2JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5Mjc1ODAsImV4cCI6MjA4MDUwMzU4MH0.pVvLKUAWoWrQL2nWC9W4eOO_XrbOl_fJW75Z75WbCoY';
        const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

        let appState = { cards: [], records: [], dark: false, feePresets: [] };
        let offlineMode = false;
        let spendChart = null;
        let currentUser = null;
        let cardSuggestions = {}; // 存储每张卡片的建议金额（带随机因子）
        let recFilterCard = 'ALL';
        let showChart = false;
        let activeRecCard = null;
        let recTypeFilter = 'ALL';
        let recordsMode = 'summary'; // 'summary' | 'detail'
        let activeRecordCardName = null;
        let editingPresetId = null;
        const GRACE_DAYS = 20;
        const id = x => document.getElementById(x);
        const genId = () => (crypto.randomUUID ? crypto.randomUUID() : `rec_${Date.now()}_${Math.random().toString(16).slice(2)}`);
        const iconRefresh = `<svg class="icon icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v5h5"/><path d="M20 20v-5h-5"/><path d="M5 9a7 7 0 0 1 12-3l1 1"/><path d="M19 15a7 7 0 0 1-12 3l-1-1"/></svg>`;
        const iconCalendar = `<svg class="icon icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="16" height="14" rx="3"/><path d="M8 3v3m8-3v3M4 10h16"/></svg>`;
        const iconSparkle = `<svg class="icon icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l1.4 3.2 3.4.3-2.6 2.3.8 3.3-3-1.7-3 1.7.8-3.3-2.6-2.3 3.4-.3z"/><path d="M6 3l.7 1.6 1.7.1-1.3 1.2.4 1.7-1.5-.9-1.5.9.4-1.7-1.3-1.2 1.7-.1z"/><path d="M18 15l.7 1.6 1.7.1-1.3 1.2.4 1.7-1.5-.9-1.5.9.4-1.7-1.3-1.2 1.7-.1z"/></svg>`;
        const iconWallet = `<svg class="icon icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><path d="M16 12h2.5"/><path d="M7 5V4a1 1 0 0 1 1-1h7.5"/></svg>`;

        // 日期格式化与校验：只接受 YYYY-MM-DD，支持 8 位数字自动插入 -
        function normalizeDateInput(raw) {
            const str = (raw || '').trim();
            if (!str) return { error: '请填写日期' };
            if (/^\d{6}$/.test(str)) {
                return { error: '需要具体到日' };
            }
            let candidate = str;
            if (/^\d{8}$/.test(str)) {
                candidate = `${str.slice(0,4)}-${str.slice(4,6)}-${str.slice(6,8)}`;
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
                return { error: '日期格式需为 YYYY-MM-DD' };
            }
            const [year, month, day] = candidate.split('-').map(n => parseInt(n, 10));
            if (month < 1 || month > 12 || day < 1 || day > 31) {
                return { error: '日期不存在' };
            }
            const dt = new Date(`${candidate}T00:00:00`);
            if (dt.getFullYear() !== year || dt.getMonth() + 1 !== month || dt.getDate() !== day) {
                return { error: '日期不存在' };
            }
            return { value: candidate };
        }

        // 确保 records 中的日期都被标准化存储
        function normalizeRecordsInState({ stopOnError = true } = {}) {
            let mutated = false;
            let firstError = null;
            appState.records = (appState.records || []).map(r => {
                if (!r.date) return r;
                const amountNum = Number(r.amount ?? r.amountNum ?? 0);
                const res = normalizeDateInput(r.date);
                if (res.error) {
                    if (!firstError) firstError = { value: r.date, reason: res.error };
                    return r;
                }
                const next = { ...r, date: res.value };
                next.amountNum = Number.isFinite(amountNum) ? amountNum : 0;
                const normType = normalizeRecType(next.type);
                next.type = normType;
                next.channel = normalizeChannel(next.channel);
                if (!next.refundForId) next.refundForId = '';
                if (!r.ts || Number.isNaN(r.ts)) {
                    next.ts = new Date(`${res.value}T00:00:00`).getTime();
                }
                if (res.value !== r.date || next.ts !== r.ts) mutated = true;
                return next;
            });
            if (firstError && stopOnError) {
                throw new Error(`日期格式错误：${firstError.value}（${firstError.reason}）`);
            }
            if (mutated) {
                try { localStorage.setItem('creditcardapp_backup', JSON.stringify(appState)); } catch (e) {}
            }
            return { mutated, error: firstError };
        }

        function normalizeRecType(t) {
            if (t === 'expense' || t === 'cash' || t === '消费') return '消费';
            if (t === 'repayment' || t === '还款') return '还款';
            if (t === '退款') return '退款';
            return '消费';
        }
        function normalizeChannel(ch) {
            return ch || '刷卡';
        }

        function ensureValidDay(dayStr, label = '日期') {
            const day = parseInt(dayStr, 10);
            if (!Number.isInteger(day) || day < 1 || day > 31) {
                showToast(`${label}需为 1-31 的整数`, 'error');
                return null;
            }
            return day;
        }

        // --- Date & Strategy Calculations ---
// moved to calc.js
// --- Storage & Sync ---
        function ensureRecordIds() {
            if (!appState.records) appState.records = [];
            let mutated = false;
            appState.records = appState.records.map(r => {
                if (!r.id) {
                    mutated = true;
                    return { ...r, id: genId() };
                }
                return r;
            });
            if (mutated) {
                try {
                    localStorage.setItem('creditcardapp_backup', JSON.stringify(appState));
                } catch (e) {
                    console.warn('Failed to persist backup after id patch', e);
                }
            }
        }

        function ensureCardDefaults() {
            if (!appState.cards) appState.cards = [];
            let mutated = false;
            appState.cards = appState.cards.map(c => {
                if (typeof c.currentUsed !== 'number' || Number.isNaN(c.currentUsed)) {
                    mutated = true;
                    return { ...c, currentUsed: 0 };
                }
                return c;
            });
            if (mutated) {
                try {
                    localStorage.setItem('creditcardapp_backup', JSON.stringify(appState));
                } catch (e) {
                    console.warn('Failed to persist backup after card patch', e);
                }
            }
        }

        function setSyncStatus(status) {
            // 更新设置页面的迷你状态显示
            const miniDot = document.getElementById('sync-status-mini-dot');
            const miniText = document.getElementById('sync-status-mini-text');
            if (miniDot && miniText) {
                if (status === 'syncing') {
                    miniDot.style.background = '#f97316';
                    miniText.textContent = '同步中...';
                } else if (status === 'error') {
                    miniDot.style.background = '#ef4444';
                    miniText.textContent = '连接失败';
                    showToast('同步失败，请检查网络连接', 'error');
                } else {
                    miniDot.style.background = '#22c55e';
                    miniText.textContent = '已连接';
                }
            }
        }

        async function loadData() {
            if (!currentUser) {
                showAuthPage();
                return;
            }
            setSyncStatus('syncing');
            try {
                const { data, error } = await supabase
                    .from('user_data')
                    .select('id, content')
                    .eq('user_id', currentUser.id)
                    .maybeSingle();
                if (error) throw error;
                if (!data) {
                    // 首次用户，插入空数据
                    const empty = { cards: [], records: [], dark: false, feePresets: [] };
                    const { error: insertError } = await supabase
                        .from('user_data')
                        .insert({ user_id: currentUser.id, content: empty });
                    if (insertError) throw insertError;
                    appState = empty;
                    populateRecCardFilter();
                    setSyncStatus('synced');
                    recordsMode = 'summary';
                    renderPresetList();
                    refreshAllSummary();
                    return;
                }
                const content = (data && data.content) || {};
                appState = {
                    cards: content.cards || [],
                    records: normalizeAllRecords(content.records || []),
                    dark: content.dark || false,
                    feePresets: content.feePresets || []
                };
                if (appState.dark) {
                    document.body.classList.add('dark');
                    const darkSwitch = document.getElementById('dark-switch');
                    if (darkSwitch) darkSwitch.checked = true;
                }
                ensureRecordIds();
                ensureCardDefaults();
                normalizeRecordsInState({ stopOnError: false });
                // 同步回写一次归一化后的数据，迁移旧结构
                const before = JSON.stringify(content.records || []);
                const after = JSON.stringify(appState.records || []);
                localStorage.setItem('creditcardapp_backup', JSON.stringify(appState));
                if (before !== after && !offlineMode) {
                    try {
                        await saveData();
                    } catch (e) {
                        console.warn('migration save failed', e);
                    }
                }
                if (recordsMode !== 'detail') recordsMode = 'summary';
                renderPresetList();
                refreshAllSummary();
                populateRecCardFilter();
                offlineMode = false;
                setSyncStatus('synced');
            } catch (e) {
                console.error('loadData error', e);
                const backup = localStorage.getItem('creditcardapp_backup');
                offlineMode = true;
                setSyncStatus('offline');
                showToast('云端加载失败，已使用本地备份（离线模式）', 'warn');
                if (backup) {
                    try {
                        appState = JSON.parse(backup);
                        if (!appState.feePresets) appState.feePresets = [];
                        appState.records = normalizeAllRecords(appState.records || []);
                        if (appState.dark) {
                            document.body.classList.add('dark');
                            const darkSwitch = document.getElementById('dark-switch');
                            if (darkSwitch) darkSwitch.checked = true;
                        }
                        ensureRecordIds();
                        ensureCardDefaults();
                        normalizeRecordsInState({ stopOnError: false });
                        if (recordsMode !== 'detail') recordsMode = 'summary';
                        renderPresetList();
                        refreshAllSummary();
                        populateRecCardFilter();
                    } catch (parseError) {
                        console.error('Failed to parse backup data', parseError);
                        appState = { cards: [], records: [], dark: false, feePresets: [] };
                        recordsMode = 'summary';
                        renderPresetList();
                        refreshAllSummary();
                        populateRecCardFilter();
                    }
                } else {
                    appState = { cards: [], records: [], dark: false, feePresets: [] };
                    recordsMode = 'summary';
                    renderPresetList();
                    refreshAllSummary();
                    populateRecCardFilter();
                }
                setSyncStatus('error');
            }
        }

        async function saveData() {
            if (offlineMode) {
                showToast('当前为离线模式：暂不自动同步到云端（避免覆盖）', 'warn');
                return;
            }
            if (!currentUser) {
                showAuthPage();
                return;
            }
            try {
                appState.records = normalizeAllRecords(appState.records || []);
                normalizeRecordsInState({ stopOnError: true });
            } catch (e) {
                setSyncStatus('error');
                showToast(e.message || '日期格式需为 YYYY-MM-DD', 'error');
                return;
            }
            setSyncStatus('syncing');
            try {
                const { error } = await supabase
                    .from('user_data')
                    .upsert({ user_id: currentUser.id, content: appState }, { onConflict: 'user_id' });
                if (error) throw error;
                setSyncStatus('synced');
                localStorage.setItem('creditcardapp_backup', JSON.stringify(appState));
            } catch (e) {
                console.error('saveData error', e);
                setSyncStatus('error');
            }
        }

        // --- UI Renderers ---
        // moved to ui.js
// moved to ui.js
function populateRecCardFilter() {
            const sel = document.getElementById('recCardFilter');
            if (!sel) return;

            const opts = ['<option value="ALL">全部</option>']
                .concat((appState.cards || []).map(c => `<option value="${c.name}">${c.name}</option>`));

            sel.innerHTML = opts.join('');
            if (!(appState.cards || []).some(c => c.name === recFilterCard)) {
                recFilterCard = 'ALL';
            }
            sel.value = recFilterCard;

            sel.onchange = () => {
                recFilterCard = sel.value;
                renderRecCardsList();
            };
        }

        function toggleChart() {
            showChart = !showChart;
            const el = document.getElementById('chartCard');
            const btn = document.getElementById('toggleChartBtn');
            if (el) el.style.display = showChart ? 'block' : 'none';
            if (btn) btn.textContent = showChart ? '收起趋势' : '查看趋势';
            if (showChart) renderSpendChart();
        }

        function renderSpendChart() {
            const canvas = document.getElementById('spendChart');
            if (!canvas || typeof Chart === 'undefined') return;
            const ctx = canvas.getContext('2d');
            const { labels, data } = buildMonthlySeries(appState.records || []);

            const isDark = document.body.classList.contains('dark');
            const textColor = isDark ? '#E5E7EB' : '#4B5563';
            const gridColor = isDark ? 'rgba(148,163,184,0.35)' : 'rgba(148,163,184,0.4)';
            const borderColor = '#3B82F6';
            const bgColor = 'rgba(59,130,246,0.12)';

            if (spendChart) {
                spendChart.data.labels = labels;
                spendChart.data.datasets[0].data = data;
                spendChart.options.scales.x.ticks.color = textColor;
                spendChart.options.scales.y.ticks.color = textColor;
                spendChart.options.scales.y.grid.color = gridColor;
                spendChart.update();
                return;
            }

            spendChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        data,
                        borderColor,
                        backgroundColor: bgColor,
                        borderWidth: 2.5,
                        tension: 0.35,
                        fill: true,
                        pointRadius: 0,
                        pointHitRadius: 10
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            mode: 'index',
                            intersect: false,
                            callbacks: {
                                label: (ctx) => ' ¥' + (ctx.parsed.y || 0).toLocaleString()
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: {
                                color: textColor,
                                maxTicksLimit: 8
                            },
                            grid: {
                                display: false
                            }
                        },
                        y: {
                            ticks: {
                                color: textColor,
                                callback: (val) => '¥' + val
                            },
                            grid: {
                                color: gridColor
                            }
                        }
                    }
                }
            });
        }

        // 刷新单个卡片的建议金额（应用随机因子）
        function refreshCardSuggestion(cardIndex) {
            const cards = appState.cards || [];
            const recs = appState.records || [];
            if (cardIndex < 0 || cardIndex >= cards.length) return;
            
            const c = cards[cardIndex];
            const today = new Date();
            const stats = calcCardPeriodStats(c, recs, today);
            // 重新计算基础建议值
            let billDay = c.billDay || 1;
            let daysLeft = (today.getDate() < billDay ? billDay - today.getDate() : (30 - today.getDate() + billDay));
            let target = c.limit * 0.65;
            const outstanding = Math.max(0, stats.netChange);
            let baseSuggest = Math.max(0, (target - outstanding) / daysLeft);
            
            // 应用随机因子
            if (baseSuggest > 0) {
                const randomFactor = 0.9 + Math.random() * 0.2; // 0.9 ~ 1.1
                cardSuggestions[c.name] = baseSuggest * randomFactor;
            } else {
                cardSuggestions[c.name] = 0;
            }
            
            refreshAllSummary();
            showToast('建议金额已刷新', 'success');
        }

        // --- 核心：渲染仪表盘 ---
        function renderDashboard(statsOverride) {
            const cards = appState.cards || [];
            const recs = appState.records || [];
            const div = document.getElementById('card-dashboard');
            
            if(!cards.length) {
                div.innerHTML = '<p style="text-align:center;color:#999;margin-top:50px;">点击底部 "添加" 添加第一张卡片</p>';
                return;
            }

            const today = new Date();
            const stats = statsOverride || computeStats(cards, recs, today);
            const monthlyFee = (stats.overview || {}).totalFeeEstimate || 0;

            let html = '';
            cards.forEach((c, idx) => {
                const per = (stats.perCard || []).find(pc => pc.cardName === c.name) || { usedAmount:0, usedCount:0, remaining:0, usageRate:0 };
                const billDay = c.billDay || 1;
                const daysLeft = Math.max(0, Math.ceil((getNextBillDate(billDay, today) - today) / 86400000));
                const target = c.limit * 0.65;
                const outstanding = per.usedAmount || 0;
                const baseSuggest = Math.max(0, (target - outstanding) / Math.max(1, daysLeft));

                if (!(c.name in cardSuggestions)) {
                    cardSuggestions[c.name] = baseSuggest;
                }
                const suggest = cardSuggestions[c.name];

                const percent = Math.min(100, (per.usageRate || 0) * 100);
                let color = '#007AFF';
                if(percent > 80) color = '#FF3B30'; // 红色警戒
                else if(percent > 60) color = '#FF9500'; // 黄色注意
                const tailNumDisplay = c.tailNum ? ` (${c.tailNum})` : '';

                html += `
                <div class="dashboard-card">
                    <div class="card-header">
                        <span class="card-name">${c.name}${tailNumDisplay}</span>
                        <span class="card-limit">额度 ¥${(c.limit/10000).toFixed(1)}万</span>
                    </div>
                    
                    <div class="progress-bg">
                        <div class="progress-bar" style="width:${percent}%; background:${color}"></div>
                    </div>
                    
                    <div class="stat-grid">
                        <div class="stat-item">
                            <span class="stat-label">本期已刷</span>
                            <span class="stat-val">¥${(per.usedAmount || 0).toLocaleString()}</span>
                        </div>
                        <div class="stat-item" style="text-align:right;">
                            <span class="stat-label">今日建议</span>
                            <span class="stat-val highlight-val">
                                ${suggest>1 ? '¥'+suggest.toFixed(0) : iconSparkle + '无需刷'}
                                <button class="refresh-btn" onclick="refreshCardSuggestion(${idx})" title="刷新建议">${iconRefresh}</button>
                            </span>
                        </div>
                        <div class="stat-item" style="grid-column:1 / span 2;">
                            <span class="stat-label">已刷笔数</span>
                            <span class="stat-val">已刷 ${per.usedCount || 0} 笔</span>
                        </div>
                        <div class="stat-item" style="grid-column:1 / span 2; color:var(--sub-text); font-size:13px;">
                            <span class="stat-label">当前已用/欠款</span>
                            <span class="stat-val">¥${(per.usedAmount || 0).toLocaleString()}（剩余 ¥${(per.remaining || 0).toLocaleString()}）</span>
                        </div>
                    </div>

                    <div class="suggest-pill">
                        <span>${iconCalendar}</span>
                        <span>距离账单日还有 <b>${daysLeft}</b> 天，建议本期控制在 ¥${target.toLocaleString()}</span>
                    </div>
                    
                    <div style="text-align:right; margin-top:10px; display:flex; justify-content:flex-end; gap:10px;">
                        <button class="btn btn-outline dash-rec-btn" data-card-name="${c.name}" style="width:auto; padding:6px 10px; font-size:12px;">查看流水</button>
                        <button class="btn btn-outline dash-del-btn" data-card-idx="${idx}" style="width:auto; padding:6px 10px; font-size:12px; color:#ccc; border-color:#ccc;">删除卡片</button>
                    </div>
                </div>`;
            });
            
            // 在顶部插入总览卡片
            const best = calcBestCardSuggestion(appState.cards || [], new Date(), GRACE_DAYS);
            const bestCardHtml = `
                <div class="dashboard-card">
                    <div class="card-header">
                        <span class="card-name">今日最佳刷卡</span>
                        <span class="card-limit" style="color:var(--sub-text)">免息期优先推荐</span>
                    </div>
                    ${!best ? '<div style="color:var(--sub-text);">请先添加信用卡</div>' : `
                    <div style="font-size:22px; font-weight:700; margin-bottom:8px;">${best.cardName}</div>
                    <div style="display:flex; gap:12px; color:var(--sub-text); font-size:13px;">
                        <span>免息期约 <b style="color:var(--text);">${best.freeDays}</b> 天</span>
                        <span>距下次账单日 <b style="color:var(--text);">${best.daysToNextBill}</b> 天</span>
                    </div>
                    `}
                </div>
            `;
            const summaryHtml = `
                <div class="summary-card">
                    <div class="summary-title">${iconWallet} 总资产概览</div>
                    <div class="summary-grid">
                        <div class="summary-item">
                            <span class="summary-label">总额度</span>
                            <span class="summary-val">¥${((stats.overview?.totalLimit || 0)/10000).toFixed(1)}万</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">本期已刷</span>
                            <span class="summary-val">¥${(stats.overview?.totalUsed || 0).toLocaleString()}</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">剩余额度</span>
                            <span class="summary-val">¥${(stats.overview?.totalRemaining || 0).toLocaleString()}</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">使用率</span>
                            <span class="summary-val">${((stats.overview?.usageRate || 0)*100).toFixed(1)}%</span>
                        </div>
                        <div class="summary-item" style="grid-column:1 / span 2;">
                            <span class="summary-label">本月预估手续费</span>
                            <span class="summary-val">¥${monthlyFee.toFixed(2)}</span>
                        </div>
                    </div>
                </div>
            `;
            
            div.innerHTML = summaryHtml + bestCardHtml + html;
            const chartEl = document.getElementById('chartCard');
            const chartBtn = document.getElementById('toggleChartBtn');
            if (chartEl) chartEl.style.display = showChart ? 'block' : 'none';
            if (chartBtn) chartBtn.textContent = showChart ? '收起趋势' : '查看趋势';
            if (showChart) renderSpendChart();
            div.querySelectorAll('.dash-rec-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const name = btn.getAttribute('data-card-name');
                    openRecsForCard(name);
                });
            });
            div.querySelectorAll('.dash-del-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const idx = parseInt(btn.getAttribute('data-card-idx'), 10);
                    delCard(idx);
                });
            });
        }
        
        // --- 记账与流水 ---
        function renderRecCardsList(statsOverride) {
            const container = document.getElementById('rec-card-list');
            if (!container) return;
            const cards = appState.cards || [];
            const recs = appState.records || [];
            if (!cards.length) {
                container.innerHTML = '<p style="text-align:center;color:#999;">请先添加卡片</p>';
                return;
            }
            const stats = statsOverride || computeStats(cards, recs, new Date());
            let html = '';
            cards.forEach(c => {
                const per = (stats.perCard || []).find(pc => pc.cardName === c.name) || { usedAmount:0, usedCount:0, usageRate:0, feeEstimate:0 };
                const spent = per.usedAmount || 0;
                const feeSum = per.feeEstimate || 0;
                const txCount = per.usedCount || 0;
                const nextBill = getNextBillDate(c.billDay, new Date());
                const daysLeft = Math.max(0, Math.ceil((nextBill - new Date()) / 86400000));
                html += `
                <div class="dashboard-card rec-card" data-card-name="${c.name}">
                    <div class="card-header">
                        <span class="card-name">${c.name}</span>
                        <span class="card-limit" style="color:var(--sub-text);">距账单日 ${daysLeft} 天</span>
                    </div>
                    <div class="stat-grid">
                        <div class="stat-item">
                            <span class="stat-label">本期已刷</span>
                            <span class="stat-val">¥${spent.toLocaleString()}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">笔数</span>
                            <span class="stat-val">${txCount}</span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">手续费</span>
                            <span class="stat-val">¥${feeSum.toFixed(2)}</span>
                        </div>
                    </div>
                </div>`;
            });
            container.innerHTML = html;
            container.querySelectorAll('.rec-card').forEach(cardEl => {
                const name = cardEl.getAttribute('data-card-name');
                cardEl.addEventListener('click', () => openRecsForCard(name));
            });
        }

        function renderPresetList() {
            const list = document.getElementById('preset-list');
            if (!list) return;
            const presets = appState.feePresets || [];
            if (!presets.length) {
                list.innerHTML = '<p style="font-size:12px; color:var(--sub-text);">暂无预设</p>';
                return;
            }
            let html = '';
            presets.forEach(p => {
                html += `
                <div class="dashboard-card preset-item" data-preset-id="${p.id}" style="padding:12px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:600;">${p.name}</div>
                            <div style="font-size:12px; color:var(--sub-text);">${p.merchantName || ''} · 费率 ${p.feeRate}%</div>
                        </div>
                        <button data-preset-id="${p.id}" class="btn btn-outline preset-del-btn" style="width:auto; padding:8px 12px; margin-top:0;">删除</button>
                    </div>
                </div>`;
            });
            list.innerHTML = html;
            list.querySelectorAll('.preset-del-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const pid = btn.getAttribute('data-preset-id');
                    delFeePreset(pid);
                });
            });
            list.querySelectorAll('.preset-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target && e.target.classList.contains('preset-del-btn')) return;
                    const pid = item.getAttribute('data-preset-id');
                    startEditPreset(pid);
                });
            });
        }

        function populatePresetSelect() {
            const sel = document.getElementById('r-preset');
            if (!sel) return;
            const presets = appState.feePresets || [];
            const opts = ['<option value="">不使用预设</option>']
                .concat(presets.map(p => `<option value="${p.id}">${p.name}</option>`));
            sel.innerHTML = opts.join('');
            sel.value = '';
        }

        function populateRefundSources(setAmountFromSelection = false) {
            const sel = document.getElementById('r-refund-src');
            if (!sel) return;
            const cardIdx = Number((document.getElementById('r-card') || {}).value || 0);
            const cardName = (appState.cards || [])[cardIdx]?.name;
            const refundedIds = new Set((appState.records || []).filter(r => normalizeRecType(r.type) === '退款' && r.refundForId).map(r => r.refundForId));
            const records = (appState.records || []).filter(r => r.cardName === cardName && normalizeRecType(r.type) === '消费' && !refundedIds.has(r.id));
            const opts = ['<option value="">不关联</option>'].concat(records.map(r => {
                const channel = normalizeChannel(r.channel);
                return `<option value="${r.id}">${r.date} · ${channel} · ${r.merchant || ''} · ¥${r.amount}</option>`;
            }));
            sel.innerHTML = opts.join('');
            sel.value = '';
            if (setAmountFromSelection) {
                const amountInput = document.getElementById('r-amt');
                const handler = () => {
                    const selectedId = sel.value;
                    if (!selectedId) {
                        if (amountInput) amountInput.value = '';
                        return;
                    }
                    const target = records.find(r => r.id === selectedId);
                    if (target && amountInput) {
                        amountInput.value = target.amount;
                    }
                };
                sel.removeEventListener('change', sel._refundHandler || (()=>{}));
                sel.addEventListener('change', handler);
                sel._refundHandler = handler;
            }
        }

        function applyFeePreset(presetId) {
            if (!presetId) return;
            const preset = (appState.feePresets || []).find(p => p.id === presetId);
            if (!preset) return;
            const merchInput = document.getElementById('r-merch');
            const rateInput = document.getElementById('r-rate');
            if (merchInput) merchInput.value = preset.merchantName || '';
            if (rateInput) {
                rateInput.value = preset.feeRate ?? '';
                calc();
            }
        }

        function showEl(el, show) {
            if (!el) return;
            el.style.display = show ? '' : 'none';
        }

        function updateRecFormByType() {
            const typeInput = document.querySelector('input[name="r-type"]:checked');
            const recType = typeInput ? typeInput.value : '消费';
            const feeSection = document.getElementById('fee-section');
            const presetSelect = document.getElementById('r-preset');
            const rateInput = document.getElementById('r-rate');
            const feeInput = document.getElementById('r-fee');
            const merchInput = document.getElementById('r-merch');
            const channelSelect = document.getElementById('r-channel');
            const refundSection = document.getElementById('refund-section');
            const refundSelect = document.getElementById('r-refund-src');
            const amountInput = document.getElementById('r-amt');
            const isRefund = recType === '退款';
            const isRepay = recType === '还款';
            const showFee = recType === '消费';

            // 显示/隐藏区块
            if (feeSection) feeSection.style.display = (showFee || isRefund) ? 'block' : 'none';
            const showRefund = isRefund;
            const showConsumeFields = showFee;
            showEl(document.querySelector('label[for="r-channel"]')?.parentElement ?? channelSelect?.previousElementSibling, showConsumeFields);
            showEl(channelSelect, showConsumeFields);
            showEl(document.querySelector('label[for="r-preset"]')?.parentElement ?? presetSelect?.previousElementSibling, showConsumeFields);
            showEl(presetSelect, showConsumeFields);
            showEl(document.getElementById('fee-group'), showConsumeFields);
            showEl(document.getElementById('merchant-group'), showConsumeFields);
            showEl(refundSection, showRefund);

            // 控件禁用状态
            if (presetSelect) presetSelect.disabled = !showConsumeFields;
            if (channelSelect) channelSelect.disabled = !showConsumeFields;
            if (refundSelect) refundSelect.disabled = !showRefund;

            if (isRefund) {
                if (rateInput) rateInput.value = '0';
                if (feeInput) feeInput.value = '0.00';
                if (merchInput) merchInput.value = '';
                populateRefundSources(true);
                if (amountInput) {
                    amountInput.value = '';
                    amountInput.readOnly = true;
                }
            } else if (isRepay) {
                if (rateInput) rateInput.value = '0';
                if (feeInput) feeInput.value = '0.00';
                if (merchInput) merchInput.value = '';
                if (refundSelect) refundSelect.value = '';
                if (amountInput) amountInput.readOnly = false;
            } else {
                if (refundSelect) refundSelect.value = '';
                if (amountInput) {
                    amountInput.readOnly = false;
                }
                calc();
            }
        }

        function renderRecs(opts = {}) {
            const { records, targetId = 'record-list' } = opts;
            const div = document.getElementById(targetId);
            if (!div) return;
            let recs = records !== undefined ? records : (appState.records || []);
            if (records === undefined && recFilterCard !== 'ALL') {
                recs = recs.filter(r => r.cardName === recFilterCard);
            }
            if(!recs.length) {
                div.innerHTML = '<p style="text-align:center;color:#999;">暂无流水</p>';
                return;
            }
            
            let html = '';
            const refundedSourceIds = new Set();
            recs.forEach(r => {
                if (r.refundForId) refundedSourceIds.add(r.refundForId);
            });
            recs.forEach((r) => {
                const t = normalizeRecType(r.type);
                const feeVal = Number(r.fee || 0);
                const isRepay = t === '还款';
                const isRefund = t === '退款';
                const amountSign = (isRepay || isRefund) ? '+ ' : '- ';
                const amountColor = (isRepay || isRefund) ? 'var(--success)' : 'var(--text)';
                const feeText = t === '消费' ? `手续费 ¥${feeVal.toFixed(2)}` : '无手续费';
                const feeColor = t === '消费' ? 'var(--danger)' : 'var(--sub-text)';
                const channel = normalizeChannel(r.channel);
                const isRefundedSource = refundedSourceIds.has(r.id);
                const classes = ['dashboard-card','rec-item'];
                if (isRefund) classes.push('record--refund','record-refund-pair');
                if (isRefundedSource) classes.push('record--refunded-source','record-refund-pair');
                const refundTag = isRefund ? ' · 退款' : (isRefundedSource ? ' · 已退款' : '');
                html += `
                <div class="${classes.join(' ')}" data-rec-id="${r.id}" style="padding:15px; margin-bottom:10px;">
                    <div style="display:flex; justify-content:space-between;">
                        <span style="font-weight:600">${r.cardName} · ${t}${refundTag}</span>
                        <span class="amount-text" style="font-weight:bold; font-size:18px; color:${amountColor};">${amountSign}${r.amount}</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; margin-top:5px; font-size:12px; color:#888;">
                        <span>${r.date} · ${channel} · ${r.merchant || ''}</span>
                        <span style="color:${feeColor}">${feeText}</span>
                    </div>
                    <div style="text-align:right; margin-top:5px;"><button class="btn btn-outline rec-del-btn" data-rec-id="${r.id}" style="width:auto; padding:6px 10px; font-size:12px;">删除</button></div>
                </div>`;
            });
            div.innerHTML = html;
            div.querySelectorAll('.rec-del-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.getAttribute('data-rec-id');
                    delRec(id);
                });
            });
        }

        function openRecModal(cardName) {
            // legacy modal entry: redirect to detail view
            showRecordDetail(cardName);
        }

        function closeRecModal() {
            const modal = document.getElementById('rec-modal');
            if (modal) {
                modal.classList.add('hidden');
                modal.classList.remove('show');
            }
            activeRecCard = null;
        }

        function onRecTypeFilterChange(val) {
            recTypeFilter = val || 'ALL';
            renderRecModalList();
        }

        function renderRecModalList() {
            if (!activeRecCard) return;
            let recs = (appState.records || []).filter(r => r.cardName === activeRecCard);
            if (recTypeFilter !== 'ALL') {
                recs = recs.filter(r => normalizeRecType(r.type) === recTypeFilter);
            }
            renderRecs({ records: recs, targetId: 'rec-modal-list' });
        }

        function setRecordsMode(mode) {
            recordsMode = mode;
            const summaryView = document.getElementById('records-summary-view');
            const detailView = document.getElementById('records-detail-view');
            if (summaryView) summaryView.style.display = mode === 'summary' ? 'block' : 'none';
            if (detailView) detailView.style.display = mode === 'detail' ? 'block' : 'none';
        }

        function renderRecordsPage() {
            if (recordsMode === 'summary') {
                setRecordsMode('summary');
                renderRecCardsList();
                const fab = document.getElementById('fab-add-record');
                if (fab) fab.style.display = 'flex';
                const detailFab = document.getElementById('fab-detail-add');
                if (detailFab) detailFab.style.display = 'none';
                return;
            }
            // detail
            setRecordsMode('detail');
            const fab = document.getElementById('fab-add-record');
            if (fab) fab.style.display = 'none';
            const detailFab = document.getElementById('fab-detail-add');
            if (detailFab) detailFab.style.display = 'flex';
            const title = document.getElementById('record-detail-title');
            if (title) title.textContent = activeRecordCardName || '流水明细';
            let recs = (appState.records || []).filter(r => r.cardName === activeRecordCardName);
            recs = recs.slice().sort((a,b) => (b.ts||0)-(a.ts||0));
            renderRecs({ records: recs, targetId: 'record-detail-list' });
        }

        function refreshAllSummary() {
            const stats = computeStats(appState.cards || [], appState.records || [], new Date());
            renderDashboard(stats);
            renderRecCardsList(stats);
            if (recordsMode === 'detail') {
                renderRecordsPage();
            }
            if (showChart) renderSpendChart();
        }

        function showRecordDetail(cardName) {
            activeRecordCardName = cardName;
            recordsMode = 'detail';
            renderRecordsPage();
        }

        function backToRecordSummary() {
            recordsMode = 'summary';
            activeRecordCardName = null;
            setRecordsMode('summary');
            renderRecCardsList();
        }

        // --- 逻辑函数 ---
        async function doAddCard() {
            const name=id('c-name').value, limit=id('c-limit').value, bill=id('c-bill').value;
            const currentUsedVal = parseFloat(id('c-current-used').value || '0');
            const tailNum = id('c-tail').value.trim();
            if(!name) return showToast('请填写卡片名称', 'error');
            const billDay = ensureValidDay(bill, '账单日');
            if (billDay === null) return;
            const limitVal = parseFloat(limit);
            if (Number.isNaN(limitVal)) return showToast('请填写额度', 'error');
            
            const btn = document.getElementById('btn-add-card');
            setButtonLoading(btn, true, '保存');
            
            try {
                const newCard = {name, limit:limitVal, billDay, currentUsed: Number.isNaN(currentUsedVal) ? 0 : currentUsedVal};
                if (tailNum) {
                    newCard.tailNum = tailNum;
                }
                appState.cards.push(newCard);
                await saveData();
                populateRecCardFilter();
                refreshAllSummary();
                showToast('卡片添加成功', 'success');
                nav('home');
            } catch (e) {
                showToast('保存失败：' + (e.message || '未知错误'), 'error');
            } finally {
                setButtonLoading(btn, false, '保存');
            }
        }
        async function doAddRec() {
            const idx=id('r-card').value, amt=parseFloat(id('r-amt').value), date=id('r-date').value;
            if(!date) return showToast('请填写完整信息', 'error');

            const dateResult = normalizeDateInput(date);
            if (dateResult.error) return showToast(dateResult.error, 'error');
            const normalizedDate = dateResult.value;
            id('r-date').value = normalizedDate;
            
            const btn = document.getElementById('btn-add-rec');
            setButtonLoading(btn, true, '确认');
            
            try {
                let cards = appState.cards;
                let recs = appState.records;
                let rate = parseFloat(id('r-rate').value) || 0;
                const typeInput = document.querySelector('input[name="r-type"]:checked');
                const recType = typeInput ? typeInput.value : '消费';
                let fee = 0;
                let merchantVal = id('r-merch').value;
                let channel = normalizeChannel((document.getElementById('r-channel') || {}).value);
                const refundSource = (document.getElementById('r-refund-src') || {}).value || '';
                let amountVal = amt;
                if (recType === '消费') {
                    if (!amt) return showToast('请填写金额', 'error');
                    fee = amt * rate / 100;
                    amountVal = amt;
                } else if (recType === '退款') {
                    if (!refundSource) return showToast('请选择要退款的消费记录', 'warn');
                    const target = (appState.records || []).find(r => r.id === refundSource);
                    if (!target) return showToast('关联消费不存在', 'error');
                    amountVal = Number(target.amount) || 0;
                    const amtInput = document.getElementById('r-amt');
                    if (amtInput) amtInput.value = amountVal;
                    fee = 0;
                    rate = 0;
                    channel = normalizeChannel(target.channel);
                    merchantVal = target.merchant || '退款';
                } else {
                    if (!amt) return showToast('请填写金额', 'error');
                    fee = 0;
                    rate = 0;
                    merchantVal = '';
                    channel = '刷卡';
                    amountVal = amt;
                }
                recs.unshift({
                    id: genId(),
                    cardName: cards[idx].name,
                    amount: amountVal,
                    amountNum: amountVal,
                    fee,
                    rate,
                    type: recType,
                    date: normalizedDate,
                    channel,
                    merchant: recType === '还款' ? '' : (merchantVal || (recType === '退款' ? '退款' : '消费')),
                    refundForId: recType === '退款' ? refundSource : '',
                    ts: new Date(`${normalizedDate}T00:00:00`).getTime()
                });
                recs.sort((a,b)=>b.ts-a.ts);
                await saveData();
                refreshAllSummary();
                showToast('记账成功', 'success');
                nav('records');
            } catch (e) {
                showToast('保存失败：' + (e.message || '未知错误'), 'error');
            } finally {
                setButtonLoading(btn, false, '确认');
            }
        }
        async function delCard(i) {
            if(confirm('删?')) {
                const removed = appState.cards[i]?.name;
                appState.cards.splice(i,1);
                if (removed) {
                    appState.records = (appState.records||[]).filter(r=>r.cardName !== removed);
                    // 删除对应的建议值
                    delete cardSuggestions[removed];
                    if (recFilterCard === removed) {
                        recFilterCard = 'ALL';
                    }
                    if (activeRecCard === removed) {
                        closeRecModal();
                    }
                    if (activeRecordCardName === removed) {
                        backToRecordSummary();
                    }
                }
                await saveData();
                populateRecCardFilter();
                refreshAllSummary();
            }
        }
        async function delRec(recId) {
            if(confirm('删?')) {
                const idx = (appState.records || []).findIndex(r => r.id === recId);
                if (idx === -1) return;
                appState.records.splice(idx,1);
                await saveData();
                renderRecModalList();
                refreshAllSummary();
                showToast('已删除', 'success');
            }
        }
        function fillPresetForm(preset) {
            const nameEl = document.getElementById('preset-name');
            const merchEl = document.getElementById('preset-merchant');
            const rateEl = document.getElementById('preset-rate');
            if (nameEl) nameEl.value = preset?.name || '';
            if (merchEl) merchEl.value = preset?.merchantName || '';
            if (rateEl) rateEl.value = preset?.feeRate ?? '';
            const btn = document.getElementById('btn-add-preset');
            if (btn) btn.textContent = preset ? '保存修改' : '新增预设';
        }

        function startEditPreset(pid) {
            const preset = (appState.feePresets || []).find(p => p.id === pid);
            if (!preset) return;
            editingPresetId = pid;
            fillPresetForm(preset);
        }

        function resetPresetForm() {
            editingPresetId = null;
            fillPresetForm(null);
        }

        async function addFeePreset() {
            const name = (document.getElementById('preset-name') || {}).value.trim();
            const merchantName = (document.getElementById('preset-merchant') || {}).value.trim();
            const rateStr = (document.getElementById('preset-rate') || {}).value;
            const feeRate = parseFloat(rateStr);
            if (!name) return showToast('请输入预设名称', 'error');
            if (Number.isNaN(feeRate)) return showToast('请输入费率%', 'error');
            appState.feePresets = appState.feePresets || [];
            if (editingPresetId) {
                const idx = appState.feePresets.findIndex(p => p.id === editingPresetId);
                if (idx >= 0) {
                    appState.feePresets[idx] = { ...appState.feePresets[idx], name, merchantName, feeRate };
                }
            } else {
                const dupIdx = appState.feePresets.findIndex(p => p.name === name);
                if (dupIdx >= 0) {
                    appState.feePresets[dupIdx] = { ...appState.feePresets[dupIdx], name, merchantName, feeRate };
                } else {
                    appState.feePresets.push({ id: genId(), name, merchantName, feeRate });
                }
            }
            await saveData();
            renderPresetList();
            populatePresetSelect();
            refreshAllSummary();
            showToast(editingPresetId ? '预设已更新' : '预设已保存', 'success');
            resetPresetForm();
        }
        async function delFeePreset(presetId) {
            appState.feePresets = (appState.feePresets || []).filter(p => p.id !== presetId);
            if (editingPresetId === presetId) {
                resetPresetForm();
            }
            await saveData();
            renderPresetList();
            populatePresetSelect();
            refreshAllSummary();
            showToast('预设已删除', 'success');
        }
        function calc() {
            const typeInput = document.querySelector('input[name="r-type"]:checked');
            const recType = typeInput ? typeInput.value : '消费';
            if (recType === '还款') {
                id('r-fee').value = '0.00';
                return;
            }
            id('r-fee').value = (id('r-amt').value * id('r-rate').value / 100).toFixed(2);
        }
        
        // --- Routing & Events ---
        function nav(p, opts = {}) {
            const { fromHistory = false, replace = false } = opts;
            p = normalizePage(p);
            document.querySelectorAll('.tab-item').forEach(e=>e.classList.remove('active'));
            switchPage(p, { fromHistory, replace });
            if (p !== 'records') {
                closeRecModal();
                const detailFab = document.getElementById('fab-detail-add');
                if (detailFab) detailFab.style.display = 'none';
                const fab = document.getElementById('fab-add-record');
                if (fab) fab.style.display = 'none';
            }
            if(p==='home') refreshAllSummary();
            if(p==='records') {
                recordsMode = recordsMode || 'summary';
                if (!activeRecordCardName) recordsMode = 'summary';
                renderRecordsPage();
            }
            if(p==='add-card') { id('c-name').value=''; id('c-limit').value=''; id('c-bill').value=''; id('c-tail').value=''; id('c-current-used').value=''; }
            if(p==='add-rec') { 
                id('r-date').value = new Date().toISOString().split('T')[0];
                id('r-amt').value=''; id('r-fee').value='';
                let opts=''; (appState.cards||[]).forEach((c,i)=>opts+=`<option value="${i}">${c.name}</option>`);
                id('r-card').innerHTML = opts;
                populatePresetSelect();
                // 默认选择“消费”
                const expenseRadio = document.querySelector('input[name="r-type"][value="消费"]');
                if (expenseRadio) expenseRadio.checked = true;
                document.querySelectorAll('input[name="r-type"]').forEach(r => {
                    r.onchange = updateRecFormByType;
                });
                // 如果从明细进入，默认选中当前卡片
                if (activeRecordCardName) {
                    const idx = (appState.cards||[]).findIndex(c => c.name === activeRecordCardName);
                    if (idx >= 0) id('r-card').value = String(idx);
                }
                const channelSel = document.getElementById('r-channel');
                if (channelSel) channelSel.value = '刷卡';
                populateRefundSources();
                updateRecFormByType();
            }
            const tab = document.querySelector(`.tab-item[data-page="${p}"]`);
            if (tab) tab.classList.add('active');
            const newHash = '#'+p;
            if (!fromHistory && location.hash !== newHash) {
                const method = replace ? 'replaceState' : 'pushState';
                history[method]({ page: p }, '', newHash);
            }
        }
        function showAddRecord() { nav('add-rec'); }
        function showAddCard() { nav('add-card'); }
        function openRecsForCard(cardName){
            activeRecordCardName = cardName;
            recordsMode = 'detail';
            nav('records');
        }

        function bindDomEvents() {
            const on = (id, ev, handler) => {
                const el = document.getElementById(id);
                if (el) el.addEventListener(ev, handler);
            };
            on('btn-login', 'click', handleLogin);
            on('btn-register', 'click', handleRegister);
            on('toggleChartBtn', 'click', toggleChart);
            on('btn-record-back', 'click', backToRecordSummary);
            on('fab-add-record', 'click', showAddRecord);
            on('btn-export', 'click', exportData);
            on('btn-clear', 'click', clearData);
            on('btn-logout', 'click', handleLogout);
            on('btn-add-preset', 'click', addFeePreset);
            on('btn-add-card', 'click', doAddCard);
            on('btn-add-rec', 'click', doAddRec);
            on('home-add-card-btn', 'click', showAddCard);
            on('records-add-card-btn', 'click', showAddCard);
            on('dark-switch', 'change', toggleDark);
            document.querySelectorAll('.nav-btn[data-nav]').forEach(el => {
                el.addEventListener('click', () => nav(el.dataset.nav));
            });
            document.querySelectorAll('.tab-item[data-page]').forEach(el => {
                el.addEventListener('click', () => {
                    const page = el.dataset.page;
                    if (page === 'add-card') showAddCard(); else nav(page);
                });
            });
            document.querySelectorAll('.rec-modal-backdrop, .rec-modal-close').forEach(el => {
                el.addEventListener('click', closeRecModal);
            });
            const recTypeFilter = document.getElementById('rec-type-filter');
            if (recTypeFilter) {
                recTypeFilter.addEventListener('change', e => onRecTypeFilterChange(e.target.value));
            }
            const presetSelect = document.getElementById('r-preset');
            if (presetSelect) {
                presetSelect.addEventListener('change', e => applyFeePreset(e.target.value));
            }
            const amtInput = document.getElementById('r-amt');
            if (amtInput) amtInput.addEventListener('input', calc);
            const rateInput = document.getElementById('r-rate');
            if (rateInput) rateInput.addEventListener('input', calc);
            const cardSelect = document.getElementById('r-card');
            if (cardSelect) cardSelect.addEventListener('change', () => {
                const recType = document.querySelector('input[name=\"r-type\"]:checked')?.value;
                populateRefundSources(recType === '退款');
            });
            document.querySelectorAll('input[name="r-type"]').forEach(r => {
                r.addEventListener('change', updateRecFormByType);
            });
            const detailFab = document.getElementById('fab-detail-add');
            if (detailFab) detailFab.addEventListener('click', showAddRecord);
        }
        async function toggleDark() { 
            const enabled = document.body.classList.toggle('dark'); 
            const darkSwitch = document.getElementById('dark-switch');
            if (darkSwitch) darkSwitch.checked = enabled;
            appState.dark = enabled;
            // 切换主题时更新图表文字和网格颜色
            if (showChart) renderSpendChart();
            await saveData();
        }
        async function exportData() {
            try {
                const dataStr = JSON.stringify(appState);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(dataStr);
                    showToast('数据已复制', 'success');
                } else {
                    // 降级方案：创建临时文本区域
                    const textArea = document.createElement('textarea');
                    textArea.value = dataStr;
                    textArea.style.position = 'fixed';
                    textArea.style.opacity = '0';
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    showToast('数据已复制', 'success');
                }
            } catch (e) {
                showToast('复制失败：' + e.message, 'error');
            }
        }
        async function clearData() { 
            if(confirm('清空?')) { 
                appState = { cards: [], records: [], dark: false, feePresets: [] };
                document.body.classList.remove('dark');
                const darkSwitch = document.getElementById('dark-switch');
                if (darkSwitch) darkSwitch.checked = false;
                recFilterCard = 'ALL';
                closeRecModal();
                await saveData();
                refreshAllSummary();
                populateRecCardFilter();
                if (showChart) renderSpendChart();
            } 
        }

        const validPages = new Set(['home','records','settings','add-card','add-rec']);
        function normalizePage(p) {
            return validPages.has(p) ? p : 'home';
        }
        function switchPage(p, opts = {}) {
            const { fromHistory = false, replace = false } = opts;
            const targetId = 'page-' + p;
            const current = document.querySelector('.page.active');
            const next = document.getElementById(targetId);
            if (!next) return;

            if (current && current !== next) {
                current.classList.remove('active');
                current.classList.add('leaving');
                setTimeout(() => {
                    current.classList.remove('leaving');
                    current.style.display = 'none';
                }, 260);
            }

            // 确保立即显示后再触发过渡
            next.style.display = 'block';
            requestAnimationFrame(() => {
                next.classList.add('active');
            });

            const newHash = '#' + p;
            if (!fromHistory && location.hash !== newHash) {
                const method = replace ? 'replaceState' : 'pushState';
                history[method]({ page: p }, '', newHash);
            }
        }

        // --- 登录与认证 ---
        function showAuthPage() {
            // 隐藏所有应用页面
            document.querySelectorAll('.page').forEach(p => {
                p.classList.remove('active');
            });
            // 显示登录页
            const authPage = document.getElementById('page-auth');
            if (authPage) {
                authPage.classList.remove('hidden');
            }
            // 隐藏导航栏
            const tabBar = document.getElementById('tab-bar');
            if (tabBar) tabBar.style.display = 'none';
            // 防止body滚动
            document.body.style.overflow = 'hidden';
        }
        function showAppPages() {
            // 隐藏登录页
            const authPage = document.getElementById('page-auth');
            if (authPage) {
                authPage.classList.add('hidden');
            }
            const tabBar = document.getElementById('tab-bar');
            if (tabBar) tabBar.style.display = 'flex';
            document.body.style.overflow = '';
        }

        async function handleLogin() {
            const email = (document.getElementById('login-email')||{}).value;
            const password = (document.getElementById('login-password')||{}).value;
            if(!email || !password) return showToast('请填写邮箱和密码', 'error');
            
                const btn = document.getElementById('btn-login');
            setButtonLoading(btn, true, '登录');
            setSyncStatus('syncing');
            
            try {
                const { data, error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) { 
                    setSyncStatus('error'); 
                    return;
                }
                currentUser = data.user;
                showAppPages();
                showToast('欢迎回来', 'success');
                await loadData();
                const hashPage = normalizePage((location.hash || '').replace('#','') || 'home');
                nav(hashPage, { replace: true });
            } catch (e) {
                setSyncStatus('error');
            } finally {
                setButtonLoading(btn, false, '登录');
            }
        }

        async function handleRegister() {
            const email = (document.getElementById('login-email')||{}).value;
            const password = (document.getElementById('login-password')||{}).value;
            if(!email || !password) return showToast('请填写邮箱和密码', 'error');
            
            const btn = document.getElementById('btn-register');
            setButtonLoading(btn, true, '注册');
            setSyncStatus('syncing');
            
            try {
                const { data, error } = await supabase.auth.signUp({ email, password });
                if (error) { 
                    setSyncStatus('error'); 
                    return;
                }
                setSyncStatus('synced');
                showToast('注册成功，请登录', 'success');
                // 清空密码框，让用户重新输入密码登录
                document.getElementById('login-password').value = '';
            } catch (e) {
                setSyncStatus('error');
            } finally {
                setButtonLoading(btn, false, '注册');
            }
        }

        async function handleLogout() {
            await supabase.auth.signOut();
            currentUser = null;
            appState = { cards: [], records: [], dark: false };
            showAuthPage();
            location.reload();
        }

        async function initAuth() {
            const { data: { session }, error } = await supabase.auth.getSession();
            if (error || !session || !session.user) {
                showAuthPage();
                return false;
            }
            currentUser = session.user;
            showAppPages();
            setSyncStatus('syncing');
            await loadData();
            return true;
        }

        // --- 初始化 ---
        function handlePopState() {
            const pageFromHash = normalizePage((location.hash || '').replace('#','') || 'home');
            nav(pageFromHash, { fromHistory: true, replace: true });
        }
        window.addEventListener('popstate', handlePopState);
        bindDomEvents();

        initAuth().then((loggedIn) => {
            if (!loggedIn) return;
            const initialPage = normalizePage((location.hash || '').replace('#','') || 'home');
            nav(initialPage, { replace: true });
            const tabBar = document.getElementById('tab-bar');
            if (tabBar) tabBar.style.display = 'flex';
            document.body.style.overflow = '';
        });

        Object.assign(window, {
            handleLogin,
            handleRegister,
            toggleChart,
            showAddRecord,
            showAddCard,
            nav,
            refreshCardSuggestion,
            delCard,
            delRec,
            toggleDark,
            exportData,
            clearData,
            handleLogout,
            doAddCard,
            doAddRec,
            addFeePreset,
            delFeePreset,
            onRecTypeFilterChange,
            closeRecModal,
            showRecordDetail,
            backToRecordSummary,
            openRecsForCard,
            applyFeePreset,
            calc,
            startEditPreset
        });

        console.log('[boot] app.js loaded');
        console.assert(typeof window.handleLogin === 'function', 'handleLogin not exposed on window');
        console.assert(typeof window.nav === 'function', 'nav not exposed on window');
        console.assert(typeof window.openRecsForCard === 'function', 'openRecsForCard not exposed on window');
        if (typeof window.nav !== 'function' || typeof window.openRecsForCard !== 'function') {
            try { showToast('脚本未正确加载或路径错误', 'warn'); } catch (e) {}
        }
