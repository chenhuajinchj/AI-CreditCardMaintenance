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

const normalizeType = (t) => {
    if (t === 'expense' || t === 'cash' || t === '消费') return '消费';
    if (t === 'repayment' || t === '还款') return '还款';
    if (t === '退款') return '退款';
    return '消费';
};

const amountOf = (r) => {
    const raw = r?.amountNum ?? r?.amount ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
};

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
    r.channel = r.channel || '刷卡';
    r.refundForId = r.refundForId || '';
    if (!r.cardName && r.card) r.cardName = r.card;
    return r;
}

export function normalizeAllRecords(records = []) {
    return (records || []).map(normalizeRecord);
}

function getPeriodBounds(card, today = new Date(), periodOffset = 0) {
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
        const rd = new Date(r.date);
        if (Number.isNaN(rd.getTime())) return;
        if (rd < lastBill || rd >= nextBill) return;
        const amt = amountOf(r);
        const fee = Number(r.fee) || 0;
        const t = normalizeType(r.type);
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
        const d = new Date(r.date);
        if (d.getFullYear() !== year || d.getMonth() !== month) return;
        const t = normalizeType(r.type);
        const day = d.getDate(); // 1..daysInMonth
        const amt = amountOf(r);
        if (t === '消费') {
            daily[day - 1] += amt;
        } else if (t === '退款' || t === '还款') {
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

export function computeCardStats(cards = [], records = [], today = new Date()) {
    const perCard = (cards || []).map(card => {
        const limit = Number(card.limit) || 0;
        const baseUsed = (card.currentUsedPeriod === 'previous') ? 0 : (Number(card.currentUsed) || 0);
        let used = baseUsed;
        let usedCount = 0;
        const { start: lastBill, end: nextBill } = getPeriodBounds(card, today, 0);
        (records || []).forEach(r => {
            if (r.cardName !== card.name) return;
            const t = normalizeType(r.type);
            const amt = amountOf(r);
            const rd = new Date(r.date);
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
        const baseUsed = (card.currentUsedPeriod === 'previous') ? 0 : (Number(card.currentUsed) || 0);
        let usedAmount = baseUsed;
        let usedCount = 0; // 只计消费笔数
        let feeEstimate = 0; // 账单期内手续费（消费）
        const { start: lastBill, end: nextBill } = getPeriodBounds(card, today, periodOffset);
        (records || []).forEach(r => {
            if (r.cardName !== card.name) return;
            const t = normalizeType(r.type);
            const rd = new Date(r.date);
            if (Number.isNaN(rd.getTime())) return;
            if (rd < lastBill || rd >= nextBill) return;
            const amt = amountOf(r);
            if (t === '消费') {
                usedAmount += amt;
                usedCount += 1;
                feeEstimate += Number(r.fee || 0);
            } else if (t === '退款' || t === '还款') {
                usedAmount -= amt;
            }
        });
        const remaining = Math.max(0, limit - usedAmount);
        const usageRate = limit > 0 ? Math.min(1, Math.max(0, usedAmount / limit)) : 0;
        return { cardName: card.name, limit, usedAmount, usedCount, remaining, feeEstimate, usageRate };
    });

    const totalLimit = perCard.reduce((s,c)=>s + c.limit, 0);
    const totalUsed = perCard.reduce((s,c)=>s + c.usedAmount, 0);
    const totalFeeEstimate = perCard.reduce((s,c)=>s + c.feeEstimate, 0);
    const totalRemaining = Math.max(0, totalLimit - totalUsed);
    const usageRate = totalLimit > 0 ? Math.min(1, totalUsed / totalLimit) : 0;

    return {
        overview: { totalLimit, totalUsed, totalRemaining, totalFeeEstimate, usageRate },
        perCard
    };
}
