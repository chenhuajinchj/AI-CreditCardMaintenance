import { getNextBillDate, getLastBillDate, getPeriodBounds, computeRepaymentStrategy, selfTestRepaymentStrategy, calcCardPeriodStats, calcBestCardSuggestion, buildMonthlySeries, computeCardStats, computeStats, normalizeAllRecords, normalizeRecType, normalizeChannel, computeMerchantMetrics, computeSceneMetrics, getBillingCycleRange } from "./calc.js";
import { seededRandom, clamp as clampNumber } from "./utils/random.js";
import { showToast, setButtonLoading } from "./ui.js";
// --- State & Constants ---
        const supabaseUrl = 'https://kcjlvxbffaxwpcrrxkbq.supabase.co';
        const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtjamx2eGJmZmF4d3BjcnJ4a2JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5Mjc1ODAsImV4cCI6MjA4MDUwMzU4MH0.pVvLKUAWoWrQL2nWC9W4eOO_XrbOl_fJW75Z75WbCoY';
        const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

        let appState = { cards: [], records: [], dark: false, feePresets: [], limitEvents: [] };
        let offlineMode = false;
        let spendChart = null;
        let currentUser = null;
        let suggestionFactorByCard = {}; // 存储每张卡的建议扰动因子
        let suggestionSeedByCard = {}; // 存储每张卡当前建议的种子（同日固定）
let recFilterCard = 'ALL';
let showChart = false;
let activeRecCard = null;
let recTypeFilter = 'ALL';
let recordsMode = 'summary'; // 'summary' | 'detail'
let activeRecordCardName = null;
let editingPresetId = null;
let editingCardIndex = null;
let periodOffset = 0; // 0 本期，1 上一期，2 上上期
let scrollPosByRoute = {};
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

        function ensureValidDay(dayStr, label = '日期') {
            const day = parseInt(dayStr, 10);
            if (!Number.isInteger(day) || day < 1 || day > 31) {
                showToast(`${label}需为 1-31 的整数`, 'error');
                return null;
            }
            return day;
        }

        function ensureValidDueDay(dayStr, label = '到期还款日') {
            const day = parseInt(dayStr, 10);
            if (!Number.isInteger(day) || day < 1 || day > 28) {
                showToast(`${label}需为 1-28 的整数`, 'error');
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
                if (!c.currentUsedPeriod) {
                    mutated = true;
                    c = { ...c, currentUsedPeriod: 'current' };
                }
                if (!Number.isInteger(c.dueDay) || c.dueDay < 1 || c.dueDay > 28) {
                    const billDay = Number.isInteger(c.billDay) && c.billDay >= 1 ? c.billDay : 1;
                    const suggested = ((billDay + 20 - 1) % 28) + 1;
                    mutated = true;
                    c = { ...c, dueDay: suggested };
                }
                // 养卡策略默认值
                if (typeof c.targetUsageRate !== 'number' || Number.isNaN(c.targetUsageRate)) {
                    mutated = true;
                    c = { ...c, targetUsageRate: 0.65 };
                }
                if (!Number.isInteger(c.targetTxMin) || c.targetTxMin <= 0) {
                    mutated = true;
                    c = { ...c, targetTxMin: 13 };
                }
                if (!Number.isInteger(c.targetTxMax) || c.targetTxMax < c.targetTxMin) {
                    mutated = true;
                    c = { ...c, targetTxMax: Math.max(18, c.targetTxMin || 13) };
                }
                if (typeof c.minIntervalDays !== 'number' || Number.isNaN(c.minIntervalDays) || c.minIntervalDays < 0) {
                    mutated = true;
                    c = { ...c, minIntervalDays: 1 };
                }
                if (typeof c.merchantMaxShare !== 'number' || Number.isNaN(c.merchantMaxShare) || c.merchantMaxShare <= 0) {
                    mutated = true;
                    c = { ...c, merchantMaxShare: 0.25 };
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

        function ensureLimitEventsDefaults() {
            if (!Array.isArray(appState.limitEvents)) {
                appState.limitEvents = [];
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
                } else if (status === 'offline') {
                    miniDot.style.background = '#94a3b8';
                    miniText.textContent = '离线模式';
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
                    const empty = { cards: [], records: [], dark: false, feePresets: [], limitEvents: [] };
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
                    feePresets: content.feePresets || [],
                    limitEvents: content.limitEvents || []
                };
                if (appState.dark) {
                    document.body.classList.add('dark');
                    const darkSwitch = document.getElementById('dark-switch');
                    if (darkSwitch) darkSwitch.checked = true;
                }
                ensureRecordIds();
                ensureCardDefaults();
                ensureLimitEventsDefaults();
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
                        if (!appState.limitEvents) appState.limitEvents = [];
                        appState.records = normalizeAllRecords(appState.records || []);
                        if (appState.dark) {
                            document.body.classList.add('dark');
                            const darkSwitch = document.getElementById('dark-switch');
                            if (darkSwitch) darkSwitch.checked = true;
                        }
                        ensureRecordIds();
                        ensureCardDefaults();
                        ensureLimitEventsDefaults();
                        normalizeRecordsInState({ stopOnError: false });
                        if (recordsMode !== 'detail') recordsMode = 'summary';
                        renderPresetList();
                        refreshAllSummary();
                        populateRecCardFilter();
                    } catch (parseError) {
                        console.error('Failed to parse backup data', parseError);
                        appState = { cards: [], records: [], dark: false, feePresets: [], limitEvents: [] };
                        recordsMode = 'summary';
                        renderPresetList();
                        refreshAllSummary();
                        populateRecCardFilter();
                    }
                } else {
                    appState = { cards: [], records: [], dark: false, feePresets: [], limitEvents: [] };
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
                // 离线也落本地，避免用户误以为已保存却刷新丢失
                try { localStorage.setItem('creditcardapp_backup', JSON.stringify(appState)); } catch (e) {}
                showToast('已保存到本地（离线模式）', 'warn');
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
            const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
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

        function getDailySeedKey(date = new Date()) {
            return date.toISOString().slice(0,10); // YYYY-MM-DD
        }

        function getLocalDateString(date = new Date()) {
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        }

        function ensureSuggestionSeeds() {
            // 确保每卡有一个默认种子，按日期变换
            const todayKey = getDailySeedKey();
            (appState.cards || []).forEach(c => {
                if (!suggestionSeedByCard[c.name]) {
                    suggestionSeedByCard[c.name] = { key: todayKey, version: 0 };
                } else if (suggestionSeedByCard[c.name].key !== todayKey) {
                    suggestionSeedByCard[c.name] = { key: todayKey, version: 0 };
                }
            });
        }

        function calcSuggestedAmount(card, perStats, today = new Date()) {
            const limit = Number(card.limit) || 0;
            const cardId = card.id || card.name || 'card';
            const fallbackCycleRaw = ((perStats?.periodExpense || 0) - (perStats?.periodRefund || 0));
            const cycleUsedRaw = Number(perStats?.cycleUsedRaw ?? fallbackCycleRaw ?? 0);
            const cycleUsed = Math.max(0, Number(perStats?.cycleUsed ?? cycleUsedRaw) || 0);
            const cycleUsageRate = Number(perStats?.cycleUsageRate || 0);
            const daysLeftInCycle = Math.max(1, Number(perStats?.daysLeftInCycle) || 1);
            const netUsed = Number(perStats?.netUsed ?? perStats?.usedAmount ?? 0) || 0;
            const todayStr = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD 本地日期，避免跨平台解析偏差
            let cycleStart = perStats?.cycleStart instanceof Date && !Number.isNaN(perStats.cycleStart.getTime())
                ? perStats.cycleStart
                : null;
            if (!cycleStart) {
                const fallbackCycle = getBillingCycleRange(card.billDay, today);
                cycleStart = fallbackCycle.cycleStart;
            }
            const cycleStartISO = cycleStart ? cycleStart.toISOString() : '';

            if (limit <= 0) {
                return {
                    amount: 0,
                    finalSuggestion: 0,
                    targetRemain: 0,
                    plannedDaily: 0,
                    executableDaily: 0,
                    limitedByAvailability: false,
                    realAvailable: 0,
                    cycleUsed,
                    cycleUsageRate,
                    daysLeftInCycle,
                    dailyCap: 0,
                    targetRate: 0,
                    targetAmount: 0
                };
            }

            // 周期目标率：同卡同周期固定（0.60-0.75）
            const rateSeed = `${cardId}_${cycleStartISO}_rate`;
            const targetRate = 0.60 + seededRandom(rateSeed) * 0.15;
            const targetAmount = limit * targetRate;
            const targetRemain = Math.max(0, targetAmount - cycleUsed);

            // 今日建议：确定性随机 + 双重兜底
            const dailyCap = limit * 0.5;
            const d = Math.max(1, daysLeftInCycle);
            const baseAvg = targetRemain / d;
            const factor = d === 1
                ? 1
                : 0.2 + seededRandom(`${cardId}_${cycleStartISO}_${todayStr}_factor`) * 2.6;
            let plan = baseAvg * factor;
            if (d === 1) {
                plan = Math.min(targetRemain, dailyCap);
            }
            plan = Math.min(plan, targetRemain, dailyCap);
            const todayPlan = Math.floor(plan);

            // 真实可用额度兜底
            const netUsedSafe = clampNumber(netUsed, 0, limit);
            const realAvailable = Math.max(0, limit - netUsedSafe);
            const todaySuggestion = Math.min(todayPlan, realAvailable);
            const limitedByAvailability = realAvailable < todayPlan - 1e-9;

            return {
                amount: todaySuggestion,
                finalSuggestion: todaySuggestion,
                todayPlan,
                targetRemain,
                targetRate,
                targetAmount,
                plannedDaily: baseAvg,
                executableDaily: todaySuggestion,
                limitedByAvailability,
                realAvailable,
                cycleUsed,
                cycleUsageRate,
                daysLeftInCycle,
                dailyCap
            };
        }

        function calcSuggestedRange(card, perStats, today = new Date()) {
            const info = calcSuggestedAmount(card, perStats, today);
            const amt = Math.max(0, Math.floor(info.finalSuggestion ?? info.amount ?? 0));
            return {
                min: amt,
                max: amt,
                plannedDaily: info.plannedDaily || 0,
                executableDaily: info.executableDaily || 0,
                limitedByAvailability: info.limitedByAvailability,
                targetRemain: info.targetRemain || 0,
                realAvailable: info.realAvailable || 0,
                daysLeftInCycle: info.daysLeftInCycle || 1
            };
        }

        async function copyTextToClipboard(text) {
            const str = String(text || '').trim();
            if (!str) return;
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(str);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = str;
                    ta.style.position = 'fixed';
                    ta.style.opacity = '0';
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
                showToast('已复制', 'success');
            } catch (e) {
                showToast('复制失败：' + (e.message || '未知错误'), 'error');
            }
        }

        function initDensity() {
            const saved = localStorage.getItem('ui_density') || 'compact';
            document.body.classList.toggle('density-comfort', saved === 'comfort');
        }

        function toggleDensity() {
            const next = document.body.classList.contains('density-comfort') ? 'compact' : 'comfort';
            document.body.classList.toggle('density-comfort', next === 'comfort');
            try { localStorage.setItem('ui_density', next); } catch (e) {}
            refreshAllSummary();
        }

        function setRoute(path) {
            const p = String(path || '').trim();
            const normalized = p.startsWith('/') ? p : '/' + p;
            const next = '#'+normalized;
            if (location.hash !== next) location.hash = next;
        }

        function parseRoute() {
            const raw = location.hash || '';
            if (!raw || raw === '#') return { path: '/home', params: new URLSearchParams() };
            if (raw.startsWith('#/')) {
                const h = raw.slice(1);
                const [p, qs = ''] = h.split('?');
                return { path: p || '/home', params: new URLSearchParams(qs) };
            }
            // 兼容旧 hash：#home
            const legacy = raw.startsWith('#') ? raw.slice(1) : raw;
            return { path: '/' + (legacy || 'home'), params: new URLSearchParams() };
        }

        function refreshCardSuggestion(cardIndex) {
            const cards = appState.cards || [];
            const recs = appState.records || [];
            if (cardIndex < 0 || cardIndex >= cards.length) return;
            
            const c = cards[cardIndex];
            const today = new Date();
            ensureSuggestionSeeds();
            const stats = computeStats(cards, recs, today, periodOffset);
            const per = (stats.perCard || []).find(pc => pc.cardName === c.name) || {};
            // 刷新种子版本，保证“点击刷新”触发新随机
            const seedInfo = suggestionSeedByCard[c.name] || { key: getDailySeedKey(today), version: 0 };
            suggestionSeedByCard[c.name] = { key: getDailySeedKey(today), version: seedInfo.version + 1 };
            
            refreshAllSummary();
            showToast('建议金额已刷新', 'success');
        }

        // --- 核心：渲染仪表盘 ---
        function renderDashboard(statsOverride) {
            const cards = appState.cards || [];
            const recs = appState.records || [];
            const div = document.getElementById('card-dashboard');
            if (!div) return;
            
            if(!cards.length) {
                div.innerHTML = '<p style="text-align:center;color:#999;margin-top:50px;">点击底部 "添加" 添加第一张卡片</p>';
                return;
            }

            const today = new Date();
            ensureSuggestionSeeds();
            const stats = statsOverride || computeStats(cards, recs, today, periodOffset);
            const monthlyFee = (stats.overview || {}).totalFeeEstimate || 0;
            const merchantMetrics = computeMerchantMetrics(cards, recs, today, periodOffset);
            const sceneMetrics = computeSceneMetrics(cards, recs, today, periodOffset);
            const todayStr = getLocalDateString(today);

            let html = '';
            cards.forEach((c, idx) => {
                const per = (stats.perCard || []).find(pc => pc.cardName === c.name) || { periodExpense:0, netUsed:0, usedAmount:0, usedCount:0, remaining:0, usageRate:0 };
                const billDay = c.billDay || 1;
                const daysLeft = Math.max(1, per.daysLeftInCycle || Math.ceil((getNextBillDate(billDay, today) - today) / 86400000));
                const targetRate = typeof c.targetUsageRate === 'number' ? c.targetUsageRate : 0.65;
                const target = c.limit * targetRate;
                const outstanding = per.netUsed ?? per.usedAmount ?? 0;
                const suggestInfo = calcSuggestedAmount(c, per, today);
                const suggest = suggestInfo.finalSuggestion ?? suggestInfo.amount ?? 0;
                const hasTodayExpense = (recs || []).some(r => r.cardName === c.name && normalizeRecType(r.type) === '消费' && r.date === todayStr);
                const m = merchantMetrics[c.name] || { topShare: 0, uniqueMerchants: 0, avgIntervalDays: null };
                const s = sceneMetrics[c.name] || { uniqueScenes: 0, topSceneShare: 0 };
                const txMin = c.targetTxMin || 13;
                const txMax = c.targetTxMax || 18;
                const txCount = per.usedCount || 0;
                const txOk = txCount >= txMin && txCount <= txMax;
                const intervalGoal = typeof c.minIntervalDays === 'number' ? c.minIntervalDays : 1;
                const intervalOk = m.avgIntervalDays == null ? true : m.avgIntervalDays >= intervalGoal;
                const merchantShareGoal = typeof c.merchantMaxShare === 'number' ? c.merchantMaxShare : 0.25;
                const merchantOk = m.topShare <= merchantShareGoal + 1e-6;
                const sceneShare = s.topSceneShare || 0;
                const sceneOk = s.uniqueScenes >= 3 && sceneShare <= 0.6;

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
                            <span class="stat-label">本期进度</span>
                            <span class="stat-val">¥${(per.cycleUsed || 0).toLocaleString()}（${((per.cycleUsageRate || 0)*100).toFixed(0)}%）</span>
                        </div>
                        <div class="stat-item" style="text-align:right;">
                            <span class="stat-label">今日建议</span>
                            <span class="stat-val highlight-val">
                                ${hasTodayExpense ? (iconSparkle + '今天已刷') : (suggest>1 ? `¥${suggest.toFixed(0)}（日 ¥${Math.max(0, Math.floor(suggestInfo.executableDaily || 0)).toLocaleString()}）` : iconSparkle + '无需刷')}
                                <button class="refresh-btn" onclick="refreshCardSuggestion(${idx})" title="刷新建议">${iconRefresh}</button>
                            </span>
                            ${suggestInfo.limitedByAvailability ? `<div style="font-size:12px; color:var(--danger); margin-top:4px;">受可用额度限制，建议金额已下调</div>` : ''}
                        </div>
                        <div class="stat-item" style="grid-column:1 / span 2;">
                            <span class="stat-label">已刷笔数</span>
                            <span class="stat-val">已刷 ${per.usedCount || 0} 笔</span>
                        </div>
                        <div class="stat-item" style="grid-column:1 / span 2; color:var(--sub-text); font-size:13px;">
                            <span class="stat-label">当前欠款/已用</span>
                            <span class="stat-val">¥${(per.netUsed ?? per.usedAmount ?? 0).toLocaleString()}（剩余 ¥${((per.realAvailable ?? per.remaining) || 0).toLocaleString()}）</span>
                        </div>
                    </div>

                    <div class="suggest-pill">
                        <span>${iconCalendar}</span>
                        <span>距账单日 <b>${daysLeft}</b> 天 · 本期使用率 <b>${((per.cycleUsageRate || 0)*100).toFixed(0)}%</b> · 目标 <b>${(targetRate*100).toFixed(0)}%</b>（¥${target.toLocaleString()}）</span>
                    </div>

                    <div class="dashboard-card" style="margin-top:12px; padding:12px 14px; box-shadow:none;">
                        <div style="font-size:13px; color:var(--sub-text); margin-bottom:6px;">养卡指标（本期）</div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:13px;">
                            <div>消费笔数：<b style="color:${txOk ? 'var(--text)' : 'var(--danger)'};">${txCount}</b> / ${txMin}-${txMax}</div>
                            <div>平均间隔：<b style="color:${intervalOk ? 'var(--text)' : 'var(--danger)'};">${m.avgIntervalDays == null ? '-' : m.avgIntervalDays.toFixed(1)+'天'}</b>（目标 ≥${intervalGoal}天）</div>
                            <div>单商户占比：<b style="color:${merchantOk ? 'var(--text)' : 'var(--danger)'};">${(m.topShare*100).toFixed(0)}%</b>（目标 ≤${(merchantShareGoal*100).toFixed(0)}%）</div>
                            <div>商户数：<b>${m.uniqueMerchants}</b></div>
                            <div>场景数：<b style="color:${sceneOk ? 'var(--text)' : 'var(--danger)'};">${s.uniqueScenes}</b>（建议 ≥3）</div>
                            <div>单场景占比：<b style="color:${sceneOk ? 'var(--text)' : 'var(--danger)'};">${(sceneShare*100).toFixed(0)}%</b>（建议 ≤60%）</div>
                        </div>
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
                <div class="dashboard-card summary-card">
                    <div class="summary-title">${iconWallet} 总资产概览</div>
                    <div class="summary-grid">
                        <div class="summary-item">
                            <span class="summary-label">总额度</span>
                            <span class="summary-val">¥${((stats.overview?.totalLimit || 0)/10000).toFixed(1)}万</span>
                        </div>
                        <div class="summary-item">
                            <span class="summary-label">本期消费</span>
                            <span class="summary-val">¥${(stats.overview?.totalExpense || 0).toLocaleString()}</span>
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

        function renderHomeView(statsOverride) {
            const cards = appState.cards || [];
            const recs = appState.records || [];
            const kpiEl = document.getElementById('home-kpi');
            const recoEl = document.getElementById('home-today-reco');
            const repayEl = document.getElementById('home-repay-reco');
            const listEl = document.getElementById('home-card-list');
            if (!kpiEl || !recoEl || !repayEl || !listEl) return;

            const today = new Date();
            ensureSuggestionSeeds();
            const stats = statsOverride || computeStats(cards, recs, today, periodOffset);
            const ov = stats.overview || {};
            const perCardStats = stats.perCard || [];

            const fmtMoney = (n, digits = 0) => {
                const num = Number(n) || 0;
                return '¥' + num.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
            };
            const fmtPct = (p) => `${((Number(p) || 0) * 100).toFixed(0)}%`;

            const totalLimit = ov.totalLimit || 0;
            const totalUsedThisPeriod = ov.totalCycleUsed ?? ((ov.totalExpense || 0) - (ov.totalRefund || 0));
            const totalDebt = ov.totalNetUsed || 0;

            kpiEl.innerHTML = `
                <div class="kpi-item">
                    <div class="kpi-label">总额度</div>
                    <div class="kpi-value">${fmtMoney(totalLimit)}</div>
                    <div class="kpi-sub">${(totalLimit / 10000).toFixed(1)} 万</div>
                </div>
                <div class="kpi-item">
                    <div class="kpi-label">本期进度</div>
                    <div class="kpi-value">${fmtMoney(totalUsedThisPeriod)}</div>
                    <div class="kpi-sub">消费-退款</div>
                </div>
                <div class="kpi-item">
                    <div class="kpi-label">当前欠款</div>
                    <div class="kpi-value">${fmtMoney(totalDebt)}</div>
                    <div class="kpi-sub">净占用</div>
                </div>
                <div class="kpi-item">
                    <div class="kpi-label">总使用率</div>
                    <div class="kpi-value">${fmtPct(ov.usageRate || 0)}</div>
                    <div class="kpi-sub">欠款/总额度</div>
                </div>
            `;

            // 今日刷卡推荐（列出所有卡）
            const todaySuggestions = (cards || []).map(c => {
                const per = perCardStats.find(pc => pc.cardName === c.name) || {};
                const info = calcSuggestedAmount(c, per, today);
                const nextBill = getNextBillDate(c.billDay, today);
                const daysToNextBill = Math.max(0, Math.ceil((nextBill - today) / 86400000));
                const freeDays = daysToNextBill + GRACE_DAYS;
                const finalSuggestion = Math.max(0, Math.floor(info.finalSuggestion ?? info.amount ?? 0));
                const daily = Math.max(0, Math.floor(info.executableDaily || 0));
                const canSwipe = finalSuggestion > 0;
                return {
                    cardName: c.name,
                    tail: c.tailNum ? `(${c.tailNum})` : '',
                    finalSuggestion,
                    daily,
                    canSwipe,
                    usageRate: per.usageRate || 0,
                    daysToNextBill,
                    freeDays,
                    limited: info.limitedByAvailability,
                    targetRemain: info.targetRemain || 0,
                    realAvailable: info.realAvailable || 0
                };
            }).sort((a, b) => b.freeDays - a.freeDays);
            const best = todaySuggestions.find(s => s.canSwipe) || todaySuggestions[0] || null;
            if (best) best.isBest = true;

            let todaySuggestText = todaySuggestions.length ? '今日不需要刷卡' : '暂无推荐（请先添加卡片）';
            let todayCopyText = '';
            if (best) {
                if (best.canSwipe) {
                    todaySuggestText = `${best.cardName} · 建议 ¥${best.finalSuggestion.toLocaleString()}（日 ¥${best.daily.toLocaleString()}，免息期约 ${best.freeDays} 天）`;
                    todayCopyText = `今日刷卡建议：${best.cardName} ¥${best.finalSuggestion.toLocaleString()}，日均 ¥${best.daily.toLocaleString()}（距账单日 ${best.daysToNextBill} 天）`;
                    if (best.limited) {
                        todaySuggestText += ' · 受可用额度限制已下调';
                        todayCopyText += '。受可用额度限制，建议金额已下调';
                    }
                } else {
                    todaySuggestText = `${best.cardName} · 今日不刷（额度接近上限或需控额）`;
                    todayCopyText = todaySuggestText;
                }
            }
            const todayRecoHtml = (todaySuggestions || []).map(s => {
                const amtLabel = s.canSwipe ? `¥${s.finalSuggestion.toLocaleString()}（日 ¥${s.daily.toLocaleString()}）` : '今日不刷';
                const subNote = s.canSwipe ? `免息期约 ${s.freeDays} 天 · 距账单日 ${s.daysToNextBill} 天${s.limited ? ' · 受额度限制' : ''}` : '额度接近上限或无需刷';
                return `
                        <div class="today-reco-row ${s.isBest ? 'is-best' : ''}">
                            <div>
                                <div class="today-reco-name">${s.cardName} ${s.tail}</div>
                                <div class="today-reco-sub">使用率 ${fmtPct(s.usageRate)} · ${subNote}</div>
                            </div>
                            <div class="today-reco-amt ${s.canSwipe ? '' : 'muted'}">${amtLabel}</div>
                        </div>
                        `;
            }).join('');
            recoEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                    <div style="font-weight:800;">今日刷卡推荐</div>
                    <button class="btn btn-sm btn-outline" id="btn-copy-today-reco" type="button">一键复制建议</button>
                </div>
                <div style="font-size:14px; color:var(--text-main); font-weight:600;">${todaySuggestText}</div>
                <div style="font-size:12px; color:var(--text-secondary); margin-top:6px;">复制后可粘贴到记账备注</div>
                ${todaySuggestions.length ? `<div class="today-reco-list">${todayRecoHtml}</div>` : ''}
            `;
            const copyBtn = document.getElementById('btn-copy-today-reco');
            if (copyBtn) copyBtn.onclick = () => copyTextToClipboard(todayCopyText || todaySuggestText);

            // 还款策略（下一次动作 + 每卡可展开）
            let nextRepay = null;
            const repayItems = (cards || []).map(c => {
                const per = (stats.perCard || []).find(pc => pc.cardName === c.name) || {};
                const used = per.netUsed ?? per.usedAmount ?? 0;
                const dueDay = Number.isInteger(c.dueDay) ? c.dueDay : (((c.billDay || 1) + 20 - 1) % 28) + 1;
                const plan = computeRepaymentStrategy({ billDay: c.billDay, dueDay, today, currentUsed: used, limit: c.limit });
                const na = plan?.recommendedPlan?.nextAction || { date: '', amount: 0 };
                if (na.date && na.amount > 0) {
                    if (!nextRepay || na.date < nextRepay.date) nextRepay = { cardName: c.name, ...na, reason: plan.recommendedPlan.reason };
                }
                return { card: c, plan };
            });

            let repaySummary = '暂无建议（当前欠款为 0 或未设置卡片）';
            if (nextRepay) {
                repaySummary = `${nextRepay.cardName} · ${nextRepay.date} 还款 ${fmtMoney(nextRepay.amount)}（${nextRepay.reason}）`;
            }
            repayEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:10px;">
                    <div style="font-weight:800;">建议还款时间/策略</div>
                    <button class="btn btn-sm btn-secondary" type="button" id="btn-open-cards">查看卡片</button>
                </div>
                <div style="font-size:14px; color:var(--text-main); font-weight:600; margin-bottom:10px;">${repaySummary}</div>
                <details style="margin:0;">
                    <summary style="cursor:pointer; color:var(--text-secondary); font-size:12px;">展开查看各卡完整计划</summary>
                    <div style="margin-top:10px;">
                        ${(repayItems || []).map(({ card, plan }) => {
                            const rp = plan?.recommendedPlan;
                            const stages = rp?.stages || [];
                            const due = plan?.nextDueDate || '';
                            const stmt = plan?.nextStatementDate || '';
                            return `
                                <details style="margin:8px 0;">
                                    <summary style="cursor:pointer; color:var(--text-main); font-weight:700;">${card.name} · 账单 ${stmt} · 到期 ${due}</summary>
                                    <div style="margin-top:8px; font-size:12px; color:var(--text-secondary);">${rp?.reason || ''}</div>
                                    <div style="margin-top:8px; display:flex; flex-direction:column; gap:8px;">
                                        ${stages.map(s => `
                                            <div style="display:flex; justify-content:space-between; gap:10px; background:rgba(0,0,0,0.03); padding:10px 12px; border-radius:12px;">
                                                <div>
                                                    <div style="font-weight:700; color:var(--text-main);">${s.title}</div>
                                                    <div style="font-size:12px; color:var(--text-secondary);">${s.date}${s.note ? ' · ' + s.note : ''}</div>
                                                </div>
                                                <div style="font-weight:800; color:var(--text-main);">${fmtMoney(s.amount)}</div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </details>
                            `;
                        }).join('')}
                    </div>
                </details>
            `;
            const openCardsBtn = document.getElementById('btn-open-cards');
            if (openCardsBtn) openCardsBtn.onclick = () => setRoute('/cards');

            // 各卡概览列表
            const densityBtn = document.getElementById('btn-density-toggle');
            if (densityBtn) densityBtn.textContent = document.body.classList.contains('density-comfort') ? '舒适模式' : '紧凑模式';
            if (densityBtn) densityBtn.onclick = () => toggleDensity();

            if (!cards.length) {
                listEl.innerHTML = '<div style="color:var(--text-secondary); font-size:13px;">暂无卡片，先去“卡片”添加</div>';
                return;
            }
            const maxRows = 5;
            const rows = (cards || []).slice(0, maxRows);
            const more = (cards || []).length > maxRows;
            listEl.innerHTML = rows.map(c => {
                const per = (stats.perCard || []).find(pc => pc.cardName === c.name) || {};
                const tail = c.tailNum ? `(${c.tailNum})` : '';
                const usage = per.usageRate || 0;
                const spent = per.cycleUsed ?? ((per.periodExpense || 0) - (per.periodRefund || 0));
                const repaid = per.periodRepay || 0;
                const txCount = per.usedCount || 0;
                return `
                    <div class="card-row" data-card-name="${c.name}">
                        <div>
                            <div class="card-row-title">${c.name} ${tail}</div>
                            <div class="card-row-sub">本期进度 ${fmtMoney(spent)} · 已还 ${fmtMoney(repaid)} · 笔数 ${txCount}</div>
                        </div>
                        <div class="card-row-metrics">
                            <div class="big">${fmtPct(usage)}</div>
                            <div class="small">使用率</div>
                        </div>
                    </div>
                `;
            }).join('') + (more ? `
                <div class="card-row" data-card-name="" style="justify-content:center; text-align:center;">
                    <div style="grid-column:1 / -1; text-align:center; font-weight:700; color:var(--primary);">查看更多卡片</div>
                </div>
            ` : '');
            listEl.querySelectorAll('.card-row').forEach(row => {
                row.addEventListener('click', () => {
                    const name = row.getAttribute('data-card-name');
                    if (name) setRoute(`/cards?name=${encodeURIComponent(name)}`);
                    else setRoute('/cards');
                });
            });
        }

        function renderCardsView(statsOverride, routeParams = new URLSearchParams()) {
            const listEl = document.getElementById('cards-list');
            const detailEl = document.getElementById('cards-detail-content');
            if (!listEl || !detailEl) return;

            const cards = appState.cards || [];
            const recs = appState.records || [];
            const today = new Date();
            const stats = statsOverride || computeStats(cards, recs, today, periodOffset);

            const fmtMoney = (n, digits = 0) => {
                const num = Number(n) || 0;
                return '¥' + num.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
            };
            const fmtPct = (p) => `${((Number(p) || 0) * 100).toFixed(0)}%`;

            if (!cards.length) {
                listEl.innerHTML = '<div style="color:var(--text-secondary); font-size:13px;">暂无卡片，先新增</div>';
                detailEl.innerHTML = '<div style="color:var(--text-secondary);">暂无卡片</div>';
                return;
            }

            listEl.innerHTML = (cards || []).map(c => {
                const per = (stats.perCard || []).find(pc => pc.cardName === c.name) || {};
                const usage = per.usageRate || 0;
                const tail = c.tailNum ? `(${c.tailNum})` : '';
                return `
                    <div class="card-row" data-card-name="${c.name}">
                        <div>
                            <div class="card-row-title">${c.name} ${tail}</div>
                            <div class="card-row-sub">使用率 ${fmtPct(usage)} · 欠款 ${fmtMoney(per.netUsed ?? per.usedAmount ?? 0)}</div>
                        </div>
                        <div class="card-row-metrics">
                            <div class="big">${fmtMoney(per.periodExpense || 0)}</div>
                            <div class="small">本期消费</div>
                        </div>
                    </div>
                `;
            }).join('');
            listEl.querySelectorAll('.card-row').forEach(row => {
                row.addEventListener('click', () => {
                    const name = row.getAttribute('data-card-name');
                    if (name) setRoute(`/cards?name=${encodeURIComponent(name)}`);
                });
            });

            const selectedName = routeParams.get('name') || '';
            const card = (cards || []).find(c => c.name === selectedName) || null;
            if (!card) {
                detailEl.innerHTML = '<div style="color:var(--text-secondary);">选择一张卡查看详情</div>';
                return;
            }
            const idx = (cards || []).findIndex(c => c.name === card.name);
            const per = (stats.perCard || []).find(pc => pc.cardName === card.name) || {};
            const used = per.netUsed ?? per.usedAmount ?? 0;
            const dueDay = Number.isInteger(card.dueDay) ? card.dueDay : (((card.billDay || 1) + 20 - 1) % 28) + 1;
            const plan = computeRepaymentStrategy({ billDay: card.billDay, dueDay, today, currentUsed: used, limit: card.limit });
            const stages = plan?.recommendedPlan?.stages || [];
            const limitOpen = getLimitPanelOpen(card.name);
            const limitSummary = getLimitSummary(card.name);
            const todayStr = getLocalDateString();

            detailEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px; margin-bottom:14px;">
                    <div>
                        <div style="font-size:20px; font-weight:800;">${card.name}${card.tailNum ? ` (${card.tailNum})` : ''}</div>
                        <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">额度 ${fmtMoney(card.limit)} · 账单日 ${card.billDay} · 到期 ${dueDay}</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:12px; color:var(--text-secondary);">使用率</div>
                        <div style="font-size:22px; font-weight:900;">${fmtPct(per.usageRate || 0)}</div>
                    </div>
                </div>

                <div class="kpi-grid" style="grid-template-columns:repeat(2, minmax(0,1fr)); margin-bottom:16px;">
                    <div class="kpi-item">
                        <div class="kpi-label">当前欠款</div>
                        <div class="kpi-value">${fmtMoney(used)}</div>
                        <div class="kpi-sub">净占用</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">剩余额度</div>
                        <div class="kpi-value">${fmtMoney((per.realAvailable ?? per.remaining) || 0)}</div>
                        <div class="kpi-sub">可用</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">本期进度</div>
                        <div class="kpi-value">${fmtMoney(per.cycleUsed || 0)}</div>
                        <div class="kpi-sub">消费-退款 · 使用率 ${((per.cycleUsageRate || 0)*100).toFixed(0)}%</div>
                    </div>
                    <div class="kpi-item">
                        <div class="kpi-label">本期已还</div>
                        <div class="kpi-value">${fmtMoney(per.periodRepay || 0)}</div>
                        <div class="kpi-sub">还款</div>
                    </div>
                </div>

                <div class="dashboard-card compact-card" style="padding:16px; margin-bottom:16px;">
                    <div style="font-weight:800; margin-bottom:10px;">建议还款时间/策略</div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">下次账单 ${plan.nextStatementDate} · 到期 ${plan.nextDueDate}</div>
                    <div style="display:flex; flex-direction:column; gap:8px;">
                        ${stages.map(s => `
                            <div style="display:flex; justify-content:space-between; gap:10px; background:rgba(0,0,0,0.03); padding:10px 12px; border-radius:12px;">
                                <div>
                                    <div style="font-weight:700; color:var(--text-main);">${s.title}</div>
                                    <div style="font-size:12px; color:var(--text-secondary);">${s.date}${s.note ? ' · ' + s.note : ''}</div>
                                </div>
                                <div style="font-weight:900; color:var(--text-main);">${fmtMoney(s.amount)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="dashboard-card" style="padding:12px; margin-bottom:16px;">
                    <div id="limit-toggle" style="display:flex; justify-content:space-between; align-items:center; cursor:pointer; gap:8px;">
                        <div>
                            <div style="font-weight:800;">额度变化</div>
                            <div id="limit-summary-text" style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${limitSummary}</div>
                        </div>
                        <svg id="limit-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition:transform 0.2s ease; ${limitOpen ? 'transform: rotate(90deg);' : ''}">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                    <div id="limit-body" style="margin-top:12px; ${limitOpen ? '' : 'display:none;'}">
                        <div class="form-grid">
                            <input type="date" id="l-date" value="${todayStr}">
                            <select id="l-type">
                                <option value="固额">固额</option>
                                <option value="临额">临额</option>
                            </select>
                            <div class="row-inputs">
                                <input type="number" id="l-before" placeholder="原额度">
                                <input type="number" id="l-after" placeholder="新额度">
                            </div>
                        </div>
                        <input type="text" id="l-note" placeholder="备注（选填）">
                        <div style="display:flex; justify-content:flex-end; margin:10px 0 12px;">
                            <button class="btn btn-outline" id="btn-add-limit-event" type="button">添加记录</button>
                        </div>
                        <div id="limit-event-list" class="list-stack"></div>
                    </div>
                </div>

                <div style="display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;">
                    <button class="btn btn-sm btn-secondary" type="button" id="btn-card-add-rec">记一笔</button>
                    <button class="btn btn-sm btn-outline" type="button" id="btn-card-edit">编辑</button>
                    <button class="btn btn-sm btn-danger-outline" type="button" id="btn-card-del">删除</button>
                </div>
            `;

            const btnAddRec = document.getElementById('btn-card-add-rec');
            if (btnAddRec) btnAddRec.onclick = () => {
                activeRecordCardName = card.name;
                recordsMode = 'detail';
                setRoute('/records/add');
            };
            const btnEdit = document.getElementById('btn-card-edit');
            if (btnEdit) btnEdit.onclick = () => setRoute(`/cards/edit?name=${encodeURIComponent(card.name)}`);
            const btnDel = document.getElementById('btn-card-del');
            if (btnDel) btnDel.onclick = () => delCard(idx);
            const limitToggle = document.getElementById('limit-toggle');
            const limitBody = document.getElementById('limit-body');
            const limitArrow = document.getElementById('limit-arrow');
            const updateOpen = (open) => {
                if (limitBody) limitBody.style.display = open ? 'block' : 'none';
                if (limitArrow) limitArrow.style.transform = open ? 'rotate(90deg)' : 'rotate(0deg)';
                setLimitPanelOpen(card.name, open);
            };
            updateOpen(limitOpen);
            if (limitToggle) {
                limitToggle.onclick = () => {
                    const open = limitBody?.style.display !== 'none';
                    updateOpen(!open);
                };
            }
            const btnAddLimit = document.getElementById('btn-add-limit-event');
            if (btnAddLimit) btnAddLimit.onclick = () => addLimitEvent(card.name);
            renderLimitEvents(card.name, { updateSummary: false });
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
            const stats = statsOverride || computeStats(cards, recs, new Date(), periodOffset);
            let html = '';
            cards.forEach(c => {
                const per = (stats.perCard || []).find(pc => pc.cardName === c.name) || { periodExpense:0, netUsed:0, usedCount:0, usageRate:0, feeEstimate:0 };
                const spent = per.periodExpense || 0;
                const netUsed = per.netUsed ?? per.usedAmount ?? 0;
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
	                            <span class="stat-label">本期消费</span>
	                            <span class="stat-val">¥${spent.toLocaleString()}</span>
	                        </div>
	                        <div class="stat-item">
	                            <span class="stat-label">笔数</span>
	                            <span class="stat-val">${txCount}</span>
	                        </div>
	                        <div class="stat-item">
	                            <span class="stat-label">当前欠款</span>
	                            <span class="stat-val">¥${netUsed.toLocaleString()}</span>
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
                const scene = r.scene ? ` · ${r.scene}` : '';
                return `<option value="${r.id}">${r.date} · ${channel} · ${r.merchant || ''}${scene} · ¥${r.amount}</option>`;
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
            showEl(document.getElementById('scene-group'), showConsumeFields);
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
                        <span>${r.date} · ${channel} · ${r.merchant || ''}${r.scene ? ' · ' + r.scene : ''}</span>
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
            const cards = appState.cards || [];
            const card = cards.find(c => c.name === activeRecordCardName);
            const { start, end } = card ? { ...getPeriodBounds(card, new Date(), periodOffset) } : { start: null, end: null };
            let recs = (appState.records || []).filter(r => r.cardName === activeRecordCardName);
            if (start && end) {
                recs = recs.filter(r => {
                    const rd = new Date(`${r.date}T00:00:00`);
                    return rd >= start && rd < end;
                });
            }
            recs = recs.slice().sort((a,b) => (b.ts||0)-(a.ts||0));
            renderRecs({ records: recs, targetId: 'record-detail-list' });
        }

        function refreshAllSummary(routeParams = new URLSearchParams()) {
            const stats = computeStats(appState.cards || [], appState.records || [], new Date(), periodOffset);
            const { path } = parseRoute();
            const base = (path || '/home').split('/')[1] || 'home';

            if (base === 'home') {
                renderHomeView(stats);
                const chartEl = document.getElementById('chartCard');
                const chartBtn = document.getElementById('toggleChartBtn');
                if (chartEl) chartEl.style.display = showChart ? 'block' : 'none';
                if (chartBtn) chartBtn.textContent = showChart ? '收起趋势' : '查看趋势';
                if (showChart) renderSpendChart();
            } else if (base === 'records') {
                renderRecCardsList(stats);
                renderRecordsPage();
            } else if (base === 'cards') {
                renderCardsView(stats, routeParams);
            } else if (base === 'presets') {
                renderPresetList();
                populatePresetSelect();
            }
        }

        function showRecordDetail(cardName) {
            activeRecordCardName = cardName;
            recordsMode = 'detail';
            setRoute(`/records?name=${encodeURIComponent(cardName)}`);
        }

        function backToRecordSummary() {
            recordsMode = 'summary';
            activeRecordCardName = null;
            setRecordsMode('summary');
            renderRecCardsList();
            setRoute('/records');
        }

        // --- 逻辑函数 ---
        async function doAddCard() {
            const name=id('c-name').value, limit=id('c-limit').value, bill=id('c-bill').value;
            const due = (document.getElementById('c-due') || {}).value;
            const currentUsedVal = parseFloat(id('c-current-used').value || '0');
            const currentUsedPeriod = (document.getElementById('c-current-used-period') || {}).value || 'current';
            const tailNum = id('c-tail').value.trim();
            const targetUsagePct = parseFloat((document.getElementById('c-target-usage') || {}).value || '65');
            const txMin = parseInt((document.getElementById('c-tx-min') || {}).value || '13', 10);
            const txMax = parseInt((document.getElementById('c-tx-max') || {}).value || '18', 10);
            const minIntervalDays = parseInt((document.getElementById('c-min-interval') || {}).value || '1', 10);
            const merchantMaxSharePct = parseFloat((document.getElementById('c-merchant-max-share') || {}).value || '25');
            if(!name) return showToast('请填写卡片名称', 'error');
            const billDay = ensureValidDay(bill, '账单日');
            if (billDay === null) return;
            let dueDay = null;
            if ((due || '').trim() !== '') {
                dueDay = ensureValidDueDay(due, '到期还款日');
                if (dueDay === null) return;
            } else {
                dueDay = ((billDay + 20 - 1) % 28) + 1;
            }
            const limitVal = parseFloat(limit);
            if (Number.isNaN(limitVal)) return showToast('请填写额度', 'error');
            const targetUsageRate = Math.min(0.95, Math.max(0.01, (Number.isFinite(targetUsagePct) ? targetUsagePct : 65) / 100));
            const safeTxMin = Number.isInteger(txMin) && txMin > 0 ? txMin : 13;
            const safeTxMax = Number.isInteger(txMax) && txMax >= safeTxMin ? txMax : Math.max(18, safeTxMin);
            const safeMinInterval = Number.isInteger(minIntervalDays) && minIntervalDays >= 0 ? minIntervalDays : 1;
            const merchantMaxShare = Math.min(1, Math.max(0.05, (Number.isFinite(merchantMaxSharePct) ? merchantMaxSharePct : 25) / 100));
            
            const btn = document.getElementById('btn-add-card');
            setButtonLoading(btn, true, '保存');
            
            try {
                const isEdit = Number.isInteger(editingCardIndex) && editingCardIndex >= 0 && editingCardIndex < (appState.cards || []).length;
                const existingIndex = (appState.cards || []).findIndex((c, i) => i !== editingCardIndex && c.name === name);
                if (existingIndex >= 0) {
                    showToast('卡片名称已存在，请换一个名称', 'error');
                    return;
                }

                const newCard = {
                    name,
                    limit:limitVal,
                    billDay,
                    dueDay,
                    currentUsed: Number.isNaN(currentUsedVal) ? 0 : currentUsedVal,
                    currentUsedPeriod,
                    targetUsageRate,
                    targetTxMin: safeTxMin,
                    targetTxMax: safeTxMax,
                    minIntervalDays: safeMinInterval,
                    merchantMaxShare
                };
                if (tailNum) {
                    newCard.tailNum = tailNum;
                }
                if (isEdit) {
                    appState.cards[editingCardIndex] = { ...appState.cards[editingCardIndex], ...newCard };
                } else {
                    appState.cards.push(newCard);
                }
                await saveData();
                populateRecCardFilter();
                refreshAllSummary();
                showToast(isEdit ? '卡片已更新' : '卡片添加成功', 'success');
                editingCardIndex = null;
                setRoute(`/cards?name=${encodeURIComponent(name)}`);
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
                const sceneSelect = document.getElementById('r-scene');
                let sceneVal = (sceneSelect && sceneSelect.value) ? sceneSelect.value : '';
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
                    const originalAmt = Number(target.amount) || 0;
                    const refundedSoFar = (appState.records || [])
                        .filter(r => normalizeRecType(r.type) === '退款' && r.refundForId === refundSource)
                        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
                    const maxRefundable = Math.max(0, originalAmt - refundedSoFar);
                    const desired = Number.isFinite(amt) && amt > 0 ? amt : maxRefundable;
                    if (desired <= 0) return showToast('该消费已无可退金额', 'warn');
                    if (desired > maxRefundable + 1e-6) return showToast(`退款金额不能超过可退 ¥${maxRefundable.toFixed(2)}`, 'error');
                    amountVal = desired;
                    const amtInput = document.getElementById('r-amt');
                    if (amtInput) amtInput.value = amountVal;
                    fee = 0;
                    rate = 0;
                    channel = normalizeChannel(target.channel);
                    merchantVal = target.merchant || '退款';
                    sceneVal = target.scene || '';
                } else {
                    if (!amt) return showToast('请填写金额', 'error');
                    fee = 0;
                    rate = 0;
                    merchantVal = '';
                    channel = '刷卡';
                    amountVal = amt;
                    sceneVal = '';
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
                    scene: sceneVal,
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
            const name = appState.cards[i]?.name || '';
            if(confirm(`确定删除卡片${name ? '「' + name + '」' : ''}？对应流水也会一起删除。`)) {
                const removed = appState.cards[i]?.name;
                appState.cards.splice(i,1);
                if (removed) {
                    appState.records = (appState.records||[]).filter(r=>r.cardName !== removed);
                    // 删除对应的扰动因子
                    delete suggestionFactorByCard[removed];
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
            if(confirm('确定删除这条流水？')) {
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

        // --- 额度变化记录 ---
        const limitPanelKey = (cardName) => `limit-panel-${cardName || 'unknown'}`;

        function getLimitPanelOpen(cardName) {
            try {
                return localStorage.getItem(limitPanelKey(cardName)) === '1';
            } catch (e) {
                return false;
            }
        }

        function setLimitPanelOpen(cardName, open) {
            try {
                localStorage.setItem(limitPanelKey(cardName), open ? '1' : '0');
            } catch (e) {}
        }

        function getLimitEventsForCard(cardName) {
            return (appState.limitEvents || [])
                .filter(e => e.cardName === cardName)
                .slice()
                .sort((a,b)=> (b.ts||0)-(a.ts||0));
        }

        function getLimitSummary(cardName) {
            const events = getLimitEventsForCard(cardName);
            if (!events.length) return '暂无记录';
            const latest = events[0];
            const after = Number(latest.after) || 0;
            return `${latest.date} · 新额度 ¥${after.toLocaleString()}`;
        }

        function renderLimitEvents(cardName, { updateSummary = false } = {}) {
            const list = document.getElementById('limit-event-list');
            if (!cardName) {
                if (list) list.innerHTML = '<p style="font-size:12px; color:var(--sub-text);">请选择卡片</p>';
                return;
            }
            if (!list) return;
            const events = getLimitEventsForCard(cardName);
            if (!events.length) {
                list.innerHTML = '<p style="font-size:12px; color:var(--sub-text);">暂无记录</p>';
                if (updateSummary) {
                    const summaryEl = document.getElementById('limit-summary-text');
                    if (summaryEl) summaryEl.textContent = '暂无记录';
                }
                return;
            }
            let html = '';
            events.forEach(e => {
                const delta = (Number(e.after)||0) - (Number(e.before)||0);
                const sign = delta >= 0 ? '+' : '';
                html += `
                <div class="dashboard-card" style="padding:12px; margin-bottom:8px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div>
                            <div style="font-weight:600;">${e.cardName} · ${e.type}</div>
                            <div style="font-size:12px; color:var(--sub-text);">${e.date} · ¥${e.before} → ¥${e.after}（${sign}${delta}）</div>
                            ${e.note ? `<div style="font-size:12px; color:var(--sub-text); margin-top:4px;">${e.note}</div>` : ''}
                        </div>
                        <button class="btn btn-outline limit-del-btn" data-limit-id="${e.id}" style="width:auto; padding:6px 10px; margin-top:0;">删除</button>
                    </div>
                </div>`;
            });
            list.innerHTML = html;
            list.querySelectorAll('.limit-del-btn').forEach(btn => {
                btn.addEventListener('click', () => delLimitEvent(btn.dataset.limitId, cardName));
            });
            if (updateSummary) {
                const summaryEl = document.getElementById('limit-summary-text');
                if (summaryEl) summaryEl.textContent = getLimitSummary(cardName);
            }
        }

        async function addLimitEvent(cardName) {
            ensureLimitEventsDefaults();
            if (!cardName) return showToast('请先选择卡片', 'error');
            const date = (document.getElementById('l-date') || {}).value;
            const dateRes = normalizeDateInput(date);
            if (dateRes.error) return showToast(dateRes.error, 'error');
            const type = (document.getElementById('l-type') || {}).value || '固额';
            const before = parseFloat((document.getElementById('l-before') || {}).value || '');
            const after = parseFloat((document.getElementById('l-after') || {}).value || '');
            if (!Number.isFinite(before) || !Number.isFinite(after)) return showToast('请填写原/新额度', 'error');
            const note = ((document.getElementById('l-note') || {}).value || '').trim();
            const ev = {
                id: genId(),
                cardName,
                date: dateRes.value,
                type,
                before,
                after,
                note,
                ts: new Date(`${dateRes.value}T00:00:00`).getTime()
            };
            appState.limitEvents.unshift(ev);
            await saveData();
            renderLimitEvents(cardName, { updateSummary: true });
            showToast('额度记录已添加', 'success');
        }

        async function delLimitEvent(idVal, cardName) {
            if (!idVal) return;
            if (!confirm('确定删除该额度记录？')) return;
            appState.limitEvents = (appState.limitEvents || []).filter(e => e.id !== idVal);
            await saveData();
            renderLimitEvents(cardName, { updateSummary: true });
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
            const amtVal = parseFloat(id('r-amt').value) || 0;
            const rateVal = parseFloat(id('r-rate').value) || 0;
            id('r-fee').value = (amtVal * rateVal / 100).toFixed(2);
        }
        
        // --- Routing & Events ---
        function nav(p) {
            const key = normalizePage(p);
            if (key === 'add-card') return setRoute('/cards/new');
            if (key === 'add-rec') return setRoute('/records/add');
            return setRoute('/' + key);
        }
        function showAddRecord() { setRoute('/records/add'); }
        function showAddCard() { setRoute('/cards/new'); }
        function openRecsForCard(cardName){
            activeRecordCardName = cardName;
            recordsMode = 'detail';
            setRoute(`/records?name=${encodeURIComponent(cardName)}`);
        }

        function prepareAddCardForm({ mode = 'new', cardName = '' } = {}) {
            const cards = appState.cards || [];
            const isEdit = mode === 'edit' && cardName;
            editingCardIndex = isEdit ? cards.findIndex(c => c.name === cardName) : null;

            const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
            if (!isEdit || editingCardIndex == null || editingCardIndex < 0) {
                setVal('c-name', '');
                setVal('c-limit', '');
                setVal('c-bill', '');
                setVal('c-due', '10');
                setVal('c-tail', '');
                setVal('c-current-used', '');
                setVal('c-current-used-period', 'current');
                setVal('c-target-usage', '65');
                setVal('c-tx-min', '13');
                setVal('c-tx-max', '18');
                setVal('c-min-interval', '1');
                setVal('c-merchant-max-share', '25');
                return;
            }
            const c = cards[editingCardIndex];
            setVal('c-name', c.name || '');
            setVal('c-limit', String(c.limit ?? ''));
            setVal('c-bill', String(c.billDay ?? ''));
            setVal('c-due', String(c.dueDay ?? ''));
            setVal('c-tail', c.tailNum || '');
            setVal('c-current-used', String(c.currentUsed ?? 0));
            setVal('c-current-used-period', c.currentUsedPeriod || 'current');
            setVal('c-target-usage', String(Math.round(((c.targetUsageRate ?? 0.65) * 100))));
            setVal('c-tx-min', String(c.targetTxMin ?? 13));
            setVal('c-tx-max', String(c.targetTxMax ?? 18));
            setVal('c-min-interval', String(c.minIntervalDays ?? 1));
            setVal('c-merchant-max-share', String(Math.round(((c.merchantMaxShare ?? 0.25) * 100))));
        }

        function prepareAddRecForm({ cardName = '' } = {}) {
            id('r-date').value = new Date().toISOString().split('T')[0];
            id('r-amt').value = '';
            id('r-fee').value = '';
            let opts = '';
            (appState.cards || []).forEach((c, i) => opts += `<option value="${i}">${c.name}</option>`);
            id('r-card').innerHTML = opts;
            populatePresetSelect();
            const expenseRadio = document.querySelector('input[name="r-type"][value="消费"]');
            if (expenseRadio) expenseRadio.checked = true;
            document.querySelectorAll('input[name="r-type"]').forEach(r => { r.onchange = updateRecFormByType; });
            const chosen = cardName || activeRecordCardName;
            if (chosen) {
                const idx = (appState.cards || []).findIndex(c => c.name === chosen);
                if (idx >= 0) id('r-card').value = String(idx);
            }
            const channelSel = document.getElementById('r-channel');
            if (channelSel) channelSel.value = '刷卡';
            const sceneSel = document.getElementById('r-scene');
            if (sceneSel) sceneSel.value = '';
            populateRefundSources();
            updateRecFormByType();
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
            on('cards-add-card-btn', 'click', showAddCard);
            on('dark-switch', 'change', toggleDark);
            on('period-offset', 'change', (e) => {
                periodOffset = Number(e.target.value) || 0;
                refreshAllSummary();
            });
            document.querySelectorAll('.nav-btn[data-nav]').forEach(el => {
                el.addEventListener('click', () => nav(el.dataset.nav));
            });
            document.querySelectorAll('.tab-item[data-page]').forEach(el => {
                el.addEventListener('click', () => {
                    const page = el.dataset.page;
                    if (!page) return;
                    setRoute('/' + page);
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
            if(confirm('确定清空所有卡片与流水？此操作不可恢复。')) { 
                appState = { cards: [], records: [], dark: false, feePresets: [], limitEvents: [] };
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

        const validPages = new Set(['home','records','cards','presets','settings','add-card','add-rec']);
        function normalizePage(p) {
            return validPages.has(p) ? p : 'home';
        }
        function switchPage(p, opts = {}) {
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
            appState = { cards: [], records: [], dark: false, feePresets: [], limitEvents: [] };
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

        function getScrollContainer() {
            const mc = document.querySelector('.main-content');
            if (!mc) return window;
            const style = getComputedStyle(mc);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') return mc;
            return window;
        }

        function getScrollTop() {
            const c = getScrollContainer();
            if (c === window) return window.scrollY || document.documentElement.scrollTop || 0;
            return c.scrollTop || 0;
        }

        function setScrollTop(top) {
            const c = getScrollContainer();
            if (c === window) window.scrollTo(0, top);
            else c.scrollTop = top;
        }

        function saveScrollForRoute(path) {
            if (!path) return;
            if (path !== '/records') return;
            scrollPosByRoute[path] = getScrollTop();
        }

        function restoreScrollForRoute(path) {
            if (!path) return;
            if (path !== '/records') return;
            const top = scrollPosByRoute[path] || 0;
            setTimeout(() => setScrollTop(top), 0);
        }

        function syncNavActive(routePath) {
            const base = (routePath || '/home').split('/')[1] || 'home';
            document.querySelectorAll('.tab-item[data-page]').forEach(e => e.classList.remove('active'));
            const tab = document.querySelector(`.tab-item[data-page="${base}"]`);
            if (tab) tab.classList.add('active');
        }

        function syncViewToRoute() {
            const { path, params } = parseRoute();
            const routePath = path || '/home';

            // scroll save/restore
            if (window.__currentRoutePath && window.__currentRoutePath !== routePath) {
                saveScrollForRoute(window.__currentRoutePath);
            }
            window.__currentRoutePath = routePath;

            // sub-routes
            if (routePath === '/cards/new') {
                switchPage('add-card');
                prepareAddCardForm({ mode: 'new' });
                syncNavActive('/cards');
                return;
            }
            if (routePath === '/cards/edit') {
                switchPage('add-card');
                prepareAddCardForm({ mode: 'edit', cardName: params.get('name') || '' });
                syncNavActive('/cards');
                return;
            }
            if (routePath === '/records/add') {
                switchPage('add-rec');
                prepareAddRecForm({ cardName: params.get('card') || '' });
                syncNavActive('/records');
                return;
            }

            // top-level
            const base = routePath.split('/')[1] || 'home';
            const pageKey = normalizePage(base);
            if (pageKey === 'records') {
                const name = params.get('name') || '';
                if (name) {
                    activeRecordCardName = decodeURIComponent(name);
                    recordsMode = 'detail';
                } else {
                    recordsMode = 'summary';
                    activeRecordCardName = null;
                }
            }
            switchPage(pageKey);
            syncNavActive(routePath);

            refreshAllSummary(params);
            restoreScrollForRoute(routePath);
        }

        // --- 初始化 ---
        bindDomEvents();
        window.addEventListener('hashchange', () => syncViewToRoute());

        initAuth().then((loggedIn) => {
            if (!loggedIn) return;
            initDensity();
            // self-tests (optional): open with ?selftest=1
            try {
                const url = new URL(location.href);
                if (url.searchParams.get('selftest') === '1') {
                    const results = selfTestRepaymentStrategy();
                    const bad = results.filter(r => !r.ok);
                    console.groupCollapsed(`[selftest] repaymentStrategy: ${results.length - bad.length}/${results.length} passed`);
                    results.forEach(r => console.log(r.name, r.ok ? 'OK' : 'FAIL', r.out));
                    console.groupEnd();
                    if (bad.length) showToast(`自测失败：${bad.map(b=>b.name).join('、')}`, 'error');
                }
            } catch (e) {}
            if (!location.hash || location.hash === '#') setRoute('/home');
            syncViewToRoute();
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
