export function getNextBillDate(billDay = 1, today = new Date()) {
    const day = billDay || 1;
    let next = new Date(today.getFullYear(), today.getMonth(), day);
    if (today.getDate() >= day) {
        next = new Date(today.getFullYear(), today.getMonth() + 1, day);
    }
    return next;
}

export function getLastBillDate(billDay = 1, today = new Date()) {
    const day = billDay || 1;
    let last = new Date(today.getFullYear(), today.getMonth(), day);
    if (today.getDate() < day) {
        last = new Date(today.getFullYear(), today.getMonth() - 1, day);
    }
    return last;
}

const formatLocalYMD = (dt) => {
    if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
};

const daysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();

const clampDayInMonth = (year, monthIndex, day) => {
    const dim = daysInMonth(year, monthIndex);
    const d = Math.max(1, Math.min(dim, Number(day) || 1));
    return d;
};

const addDaysLocal = (dt, days) => {
    const d = new Date(dt);
    d.setDate(d.getDate() + days);
    return d;
};

const normalizeDueDay = (dueDay) => {
    const d = parseInt(dueDay, 10);
    if (!Number.isInteger(d) || d < 1) return 1;
    return Math.min(28, d);
};

const normalizeBillDay = (billDay) => {
    const d = parseInt(billDay, 10);
    if (!Number.isInteger(d) || d < 1) return 1;
    return Math.min(31, d);
};

const nextOccurrenceOfDay = (day, today = new Date(), { includeToday = true } = {}) => {
    const d = normalizeBillDay(day);
    const y = today.getFullYear();
    const m = today.getMonth();
    const thisMonthDay = clampDayInMonth(y, m, d);
    const candidate = new Date(y, m, thisMonthDay);
    const cmp = includeToday ? (today.getDate() <= d) : (today.getDate() < d);
    if (cmp) return candidate;
    const ny = m === 11 ? y + 1 : y;
    const nm = (m + 1) % 12;
    const nextMonthDay = clampDayInMonth(ny, nm, d);
    return new Date(ny, nm, nextMonthDay);
};

const firstOccurrenceOfDueDayAfter = (dueDay, afterDate) => {
    const d = normalizeDueDay(dueDay);
    const y = afterDate.getFullYear();
    const m = afterDate.getMonth();
    const thisMonthDay = clampDayInMonth(y, m, d);
    const candidate = new Date(y, m, thisMonthDay);
    if (candidate > afterDate) return candidate;
    const ny = m === 11 ? y + 1 : y;
    const nm = (m + 1) % 12;
    const nextMonthDay = clampDayInMonth(ny, nm, d);
    return new Date(ny, nm, nextMonthDay);
};

export function computeRepaymentStrategy({
    billDay,
    dueDay,
    today = new Date(),
    currentUsed = 0,
    limit = 0
} = {}) {
    const bill = normalizeBillDay(billDay);
    const due = normalizeDueDay(dueDay);
    const used = Math.max(0, Number(currentUsed) || 0);
    const lim = Math.max(0, Number(limit) || 0);

    const nextStatementDate = nextOccurrenceOfDay(bill, today, { includeToday: true });
    const nextDueDate = firstOccurrenceOfDueDayAfter(due, nextStatementDate);

    const safetyPadDate = addDaysLocal(nextStatementDate, 2);
    const clearDate = addDaysLocal(nextDueDate, -2);

    const usage = lim > 0 ? used / lim : 0;
    const targetLow = lim * 0.60;
    const targetHigh = lim * 0.70;
    const targetOutstanding = lim * 0.65;

    let stage1Amount = 0;
    if (lim > 0 && usage > 0.70 + 1e-9) {
        stage1Amount = Math.max(0, used - targetHigh);
    }
    stage1Amount = Math.min(stage1Amount, used);
    const remainingAfterStage1 = Math.max(0, used - stage1Amount);
    const stage2Amount = remainingAfterStage1;

    const stages = [];
    const makeStage = (date, amount, title, note = '') => ({
        title,
        date: formatLocalYMD(date),
        amount: Math.max(0, Math.round((Number(amount) || 0) * 100) / 100),
        note
    });

    if (lim <= 0) {
        stages.push(makeStage(clearDate, 0, '清零', '额度为 0，无法计算使用率'));
    } else if (used <= 0) {
        stages.push(makeStage(clearDate, 0, '清零', '当前欠款为 0'));
    } else if (clearDate <= safetyPadDate) {
        stages.push(makeStage(clearDate, used, '一次性清零', '账期太短，建议一次性在到期日前完成还款'));
    } else {
        stages.push(
            makeStage(
                safetyPadDate,
                stage1Amount,
                '安全垫还款',
                stage1Amount > 0
                    ? `将使用率压到约 60%-70%（目标欠款 ¥${Math.round(targetOutstanding).toLocaleString()}）`
                    : `当前使用率约 ${(usage * 100).toFixed(0)}%，可跳过第一段`
            )
        );
        stages.push(makeStage(clearDate, stage2Amount, '到期前清零', '到期日前 2 天清零避免息差风险'));
    }

    const nextAction = stages
        .filter(s => s.amount > 0)
        .find(s => {
            const dt = parseLocalDate(s.date);
            const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            return dt >= t0;
        }) || stages.find(s => s.amount > 0) || stages[0];

    const reason =
        lim <= 0 ? '额度为 0，无法给出还款建议' :
        used <= 0 ? '当前欠款为 0，无需还款' :
        usage > 0.70 + 1e-9 ? `当前使用率 ${(usage * 100).toFixed(0)}%，先压到 60%-70% 更利于养卡` :
        `按到期日前 2 天清零，保持免息`;

    return {
        nextStatementDate: formatLocalYMD(nextStatementDate),
        nextDueDate: formatLocalYMD(nextDueDate),
        recommendedPlan: {
            safetyPadDate: formatLocalYMD(safetyPadDate),
            clearDate: formatLocalYMD(clearDate),
            target: {
                low: Math.round(targetLow * 100) / 100,
                high: Math.round(targetHigh * 100) / 100
            },
            stages,
            nextAction: nextAction ? { date: nextAction.date, amount: nextAction.amount } : { date: '', amount: 0 },
            reason
        }
    };
}

export function selfTestRepaymentStrategy() {
    const cases = [
        {
            name: '月底跨月',
            input: { billDay: 28, dueDay: 10, today: new Date('2025-01-27T00:00:00'), currentUsed: 7000, limit: 10000 }
        },
        {
            name: 'billDay>dueDay',
            input: { billDay: 17, dueDay: 7, today: new Date('2025-12-17T00:00:00'), currentUsed: 8000, limit: 10000 }
        },
        {
            name: '2月处理',
            input: { billDay: 31, dueDay: 20, today: new Date('2025-02-10T00:00:00'), currentUsed: 5000, limit: 10000 }
        },
        {
            name: '今天刚好账单日/到期日',
            input: { billDay: 10, dueDay: 30, today: new Date('2025-03-10T00:00:00'), currentUsed: 3000, limit: 10000 }
        },
        {
            name: 'limit=0',
            input: { billDay: 10, dueDay: 20, today: new Date('2025-03-05T00:00:00'), currentUsed: 3000, limit: 0 }
        },
        {
            name: 'currentUsed=0',
            input: { billDay: 10, dueDay: 20, today: new Date('2025-03-05T00:00:00'), currentUsed: 0, limit: 10000 }
        }
    ];

    const results = cases.map(c => {
        const out = computeRepaymentStrategy(c.input);
        const okDates = Boolean(out.nextStatementDate) && Boolean(out.nextDueDate);
        const okOrder = out.nextStatementDate <= out.nextDueDate;
        const okStages = Array.isArray(out.recommendedPlan?.stages) && out.recommendedPlan.stages.length >= 1;
        const ok = okDates && okOrder && okStages;
        return { name: c.name, ok, out };
    });

    return results;
}

export const normalizeRecType = (t) => {
    if (t === 'expense' || t === 'cash' || t === '消费') return '消费';
    if (t === 'repayment' || t === '还款') return '还款';
    if (t === '退款') return '退款';
    return '消费';
};

export const normalizeChannel = (ch) => ch || '刷卡';

const amountOf = (r) => {
    const raw = r?.amountNum ?? r?.amount ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
};

const parseLocalDate = (dateStr) => {
    if (!dateStr) return new Date(NaN);
    return new Date(`${dateStr}T00:00:00`);
};

export function computeMerchantMetrics(cards = [], records = [], today = new Date(), periodOffset = 0) {
    const res = {};
    (cards || []).forEach(card => {
        const ref = new Date(today);
        ref.setMonth(ref.getMonth() - periodOffset);
        const start = getLastBillDate(card.billDay, ref);
        const end = getNextBillDate(card.billDay, ref);

        const expenseRecs = (records || []).filter(r => {
            if (r.cardName !== card.name) return false;
            if (normalizeRecType(r.type) !== '消费') return false;
            const d = parseLocalDate(r.date);
            if (Number.isNaN(d.getTime())) return false;
            return d >= start && d < end;
        });

        const byMerchantAmt = new Map();
        let totalAmt = 0;
        const tsList = [];
        expenseRecs.forEach(r => {
            const merch = (r.merchant || '').trim() || '未知商户';
            const amt = amountOf(r);
            totalAmt += amt;
            byMerchantAmt.set(merch, (byMerchantAmt.get(merch) || 0) + amt);
            const t = parseLocalDate(r.date).getTime();
            if (!Number.isNaN(t)) tsList.push(t);
        });

        let topShare = 0;
        if (totalAmt > 0) {
            for (const v of byMerchantAmt.values()) {
                topShare = Math.max(topShare, v / totalAmt);
            }
        }
        tsList.sort((a,b)=>a-b);
        let avgIntervalDays = null;
        if (tsList.length >= 2) {
            let sum = 0;
            for (let i = 1; i < tsList.length; i++) {
                sum += (tsList[i] - tsList[i-1]) / 86400000;
            }
            avgIntervalDays = sum / (tsList.length - 1);
        }

        res[card.name] = {
            topShare,
            uniqueMerchants: byMerchantAmt.size,
            avgIntervalDays
        };
    });
    return res;
}

export function computeSceneMetrics(cards = [], records = [], today = new Date(), periodOffset = 0) {
    const res = {};
    (cards || []).forEach(card => {
        const ref = new Date(today);
        ref.setMonth(ref.getMonth() - periodOffset);
        const start = getLastBillDate(card.billDay, ref);
        const end = getNextBillDate(card.billDay, ref);
        const expenseRecs = (records || []).filter(r => {
            if (r.cardName !== card.name) return false;
            if (normalizeRecType(r.type) !== '消费') return false;
            const d = parseLocalDate(r.date);
            if (Number.isNaN(d.getTime())) return false;
            return d >= start && d < end;
        });
        const bySceneAmt = new Map();
        let totalAmt = 0;
        expenseRecs.forEach(r => {
            const scene = (r.scene || '').trim() || '未标注';
            const amt = amountOf(r);
            totalAmt += amt;
            bySceneAmt.set(scene, (bySceneAmt.get(scene) || 0) + amt);
        });
        let topSceneShare = 0;
        if (totalAmt > 0) {
            for (const v of bySceneAmt.values()) {
                topSceneShare = Math.max(topSceneShare, v / totalAmt);
            }
        }
        res[card.name] = {
            uniqueScenes: bySceneAmt.size,
            topSceneShare
        };
    });
    return res;
}

// 旧数据归一化：将早期版本的记录结构映射到当前统一格式
// 观察到的差异（示例）：旧记录可能只有 type: "消费"/"还款" 或英文 "expense"/"repay"，没有 amountNum/channel/refundForId 字段
// 新记录：携带 amountNum、channel、refundForId，type 已标准化为中文
export function normalizeRecord(raw = {}) {
    const r = { ...raw };
    // 类型统一为中文口径，无法判断时按消费处理
    const t = r.type || r.kind || r.category;
    const flagRefund = r.isRefund === true || r.refund === true;
    const amtVal = amountOf(r);
    if (t === true || t === 'repay' || t === 'repayment' || t === '还款' || r.isRepay) {
        r.type = '还款';
    } else if (t === 'refund' || t === '退款' || flagRefund) {
        r.type = '退款';
    } else {
        r.type = '消费';
    }
    // 数值字段统一为 Number
    let amt = amtVal;
    // 兼容早期用负数表示退款/还款的场景：转为正数并依赖 type 方向
    if (amt < 0 && (r.type === '退款' || r.type === '还款')) {
        amt = Math.abs(amt);
    }
    r.amount = amt;
    r.amountNum = amt;
    const fee = Number(r.fee ?? 0);
    r.fee = Number.isFinite(fee) ? fee : 0;
    // 补齐字段
    r.channel = normalizeChannel(r.channel);
    r.refundForId = r.refundForId || '';
    r.scene = r.scene || '';
    if (!r.cardName && r.card) r.cardName = r.card;
    return r;
}

export function normalizeAllRecords(records = []) {
    return (records || []).map(normalizeRecord);
}

export function getPeriodBounds(card, today = new Date(), periodOffset = 0) {
    // 使用参考时间（向前滚 periodOffset 个月）计算账单期上下界
    const ref = new Date(today);
    ref.setMonth(ref.getMonth() - periodOffset);
    const start = getLastBillDate(card.billDay, ref);
    const end = getNextBillDate(card.billDay, ref);
    return { start, end };
}

export function calcCardPeriodStats(card, recs, today = new Date(), periodOffset = 0) {
    const { start: lastBill, end: nextBill } = getPeriodBounds(card, today, periodOffset);
    let periodSpend = 0; // 消费-退款
    let netChange = 0;   // 消费-退款-还款
    let feeSum = 0;      // 只对消费计手续费
    let txCount = 0;     // 只计算消费笔数
    (recs || []).forEach(r => {
        if (r.cardName !== card.name) return;
        if (!r.date) return;
        const rd = parseLocalDate(r.date);
        if (Number.isNaN(rd.getTime())) return;
        if (rd < lastBill || rd >= nextBill) return;
        const amt = amountOf(r);
        const fee = Number(r.fee) || 0;
        const t = normalizeRecType(r.type);
        if (t === '还款') {
            netChange -= amt;
        } else if (t === '退款') {
            periodSpend -= amt;
            netChange -= amt;
        } else {
            periodSpend += amt;
            netChange += amt;
            feeSum += fee;
            txCount += 1;
        }
    });
    return { periodSpend, netChange, feeSum, txCount, lastBill };
}

export function calcBestCardSuggestion(cards, today = new Date(), graceDays = 20) {
    let best = null;
    (cards || []).forEach(card => {
        const nextBill = getNextBillDate(card.billDay, today);
        const daysToNextBill = Math.max(0, Math.ceil((nextBill - today) / 86400000));
        const freeDays = daysToNextBill + graceDays;
        if (!best || freeDays > best.freeDays) {
            best = {
                cardName: card.name || '未命名卡片',
                freeDays,
                daysToNextBill
            };
        }
    });
    return best;
}

export function buildMonthlySeries(records = [], today = new Date()) {
    const year = today.getFullYear();
    const month = today.getMonth(); // 0-11
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const daily = new Array(daysInMonth).fill(0);

    records.forEach(r => {
        if (!r.date) return;
        const d = parseLocalDate(r.date);
        if (d.getFullYear() !== year || d.getMonth() !== month) return;
        const t = normalizeRecType(r.type);
        const day = d.getDate(); // 1..daysInMonth
        const amt = amountOf(r);
        if (t === '消费') {
            daily[day - 1] += amt;
        } else if (t === '退款') {
            daily[day - 1] -= amt;
        }
    });

    const labels = [];
    const data = [];
    let acc = 0;
    for (let i = 0; i < daysInMonth; i++) {
        acc += daily[i];
        labels.push((i + 1).toString());
        data.push(acc);
    }
    return { labels, data };
}

export function computeCardStats(cards = [], records = [], today = new Date(), periodOffset = 0) {
    const perCard = (cards || []).map(card => {
        const limit = Number(card.limit) || 0;
        const includeBase = periodOffset === 0 && card.currentUsedPeriod !== 'previous';
        const baseUsed = includeBase ? (Number(card.currentUsed) || 0) : 0;
        let used = baseUsed;
        let usedCount = 0;
        const { start: lastBill, end: nextBill } = getPeriodBounds(card, today, periodOffset);
        (records || []).forEach(r => {
            if (r.cardName !== card.name) return;
            const t = normalizeRecType(r.type);
            const amt = amountOf(r);
            const rd = parseLocalDate(r.date);
            if (Number.isNaN(rd.getTime())) return;
            // 账单期判断：使用账单日
            if (rd < lastBill || rd >= nextBill) return;
            if (t === '消费') {
                used += amt;
                usedCount += 1;
            } else if (t === '退款' || t === '还款') {
                used -= amt;
            }
        });
        const remain = Math.max(0, limit - used);
        const rate = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
        return {
            cardName: card.name,
            limit,
            used,
            usedCount,
            remain,
            rate
        };
    });
    const totalLimit = perCard.reduce((s,c)=>s+c.limit,0);
    const totalUsed = perCard.reduce((s,c)=>s+c.used,0);
    const totalRemain = Math.max(0, totalLimit - totalUsed);
    const usageRate = totalLimit > 0 ? Math.min(1, totalUsed / totalLimit) : 0;
    return { totalLimit, totalUsed, totalRemain, usageRate, perCard };
}

// 统一统计：概览 + 单卡
export function computeStats(cards = [], records = [], today = new Date(), periodOffset = 0) {
    const perCard = (cards || []).map(card => {
        const limit = Number(card.limit) || 0;
        const includeBase = periodOffset === 0 && card.currentUsedPeriod !== 'previous';
        const baseUsed = includeBase ? (Number(card.currentUsed) || 0) : 0;
        let netUsed = baseUsed;     // 欠款/净占用（消费-退款-还款）
        let periodExpense = 0;      // 消费额
        let periodRefund = 0;       // 退款额
        let periodRepay = 0;        // 还款额
        let usedCount = 0;          // 只计消费笔数
        let feeEstimate = 0;        // 账单期内手续费（消费）
        const { start: lastBill, end: nextBill } = getPeriodBounds(card, today, periodOffset);
        (records || []).forEach(r => {
            if (r.cardName !== card.name) return;
            const t = normalizeRecType(r.type);
            const rd = parseLocalDate(r.date);
            if (Number.isNaN(rd.getTime())) return;
            if (rd < lastBill || rd >= nextBill) return;
            const amt = amountOf(r);
            if (t === '消费') {
                netUsed += amt;
                periodExpense += amt;
                usedCount += 1;
                feeEstimate += Number(r.fee || 0);
            } else if (t === '退款') {
                netUsed -= amt;
                periodRefund += amt;
            } else if (t === '还款') {
                netUsed -= amt;
                periodRepay += amt;
            }
        });
        const remaining = Math.max(0, limit - netUsed);
        const usageRate = limit > 0 ? Math.min(1, Math.max(0, netUsed / limit)) : 0;
        return {
            cardName: card.name,
            limit,
            // 旧字段（兼容 UI）：usedAmount 表示净占用
            usedAmount: netUsed,
            // 新字段
            netUsed,
            periodExpense,
            periodRefund,
            periodRepay,
            usedCount,
            remaining,
            feeEstimate,
            usageRate
        };
    });

    const totalLimit = perCard.reduce((s,c)=>s + c.limit, 0);
    const totalNetUsed = perCard.reduce((s,c)=>s + (c.netUsed || 0), 0);
    const totalExpense = perCard.reduce((s,c)=>s + (c.periodExpense || 0), 0);
    const totalRefund = perCard.reduce((s,c)=>s + (c.periodRefund || 0), 0);
    const totalRepay = perCard.reduce((s,c)=>s + (c.periodRepay || 0), 0);
    const totalFeeEstimate = perCard.reduce((s,c)=>s + (c.feeEstimate || 0), 0);
    const totalRemaining = Math.max(0, totalLimit - totalNetUsed);
    const usageRate = totalLimit > 0 ? Math.min(1, totalNetUsed / totalLimit) : 0;

    return {
        overview: {
            totalLimit,
            totalExpense,
            totalRefund,
            totalRepay,
            totalNetUsed,
            // 旧字段兼容
            totalUsed: totalNetUsed,
            totalRemaining,
            totalFeeEstimate,
            usageRate
        },
        perCard
    };
}
