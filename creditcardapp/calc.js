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

export function calcCardPeriodStats(card, recs, today = new Date()) {
    const lastBill = getLastBillDate(card.billDay, today);
    let periodSpend = 0; // 消费-退款
    let netChange = 0;   // 消费-退款-还款
    let feeSum = 0;      // 只对消费计手续费
    let txCount = 0;     // 只计算消费笔数
    (recs || []).forEach(r => {
        if (r.cardName !== card.name) return;
        if (!r.date) return;
        const rd = new Date(r.date);
        if (Number.isNaN(rd.getTime())) return;
        if (rd < lastBill) return;
        const amt = Number(r.amount) || 0;
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
        if (normalizeType(r.type) !== '消费') return;
        const day = d.getDate(); // 1..daysInMonth
        daily[day - 1] += Number(r.amount) || 0;
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
        let used = 0;
        let usedCount = 0;
        (records || []).forEach(r => {
            if (r.cardName !== card.name) return;
            const t = normalizeType(r.type);
            const amt = Number(r.amount) || 0;
            const rd = new Date(r.date);
            if (Number.isNaN(rd.getTime())) return;
            // 账单期判断：使用账单日
            const lastBill = getLastBillDate(card.billDay, today);
            if (rd < lastBill) return;
            if (t === '消费') {
                used += amt;
                usedCount += 1;
            } else if (t === '退款' || t === '还款') {
                used -= amt;
            }
        });
        used = Math.max(0, used);
        const remain = Math.max(0, limit - used);
        const rate = limit > 0 ? used / limit : 0;
        return {
            cardName: card.name,
            limit,
            used,
            usedCount,
            remain,
            rate: Math.min(1, rate)
        };
    });
    const totalLimit = perCard.reduce((s,c)=>s+c.limit,0);
    const totalUsed = perCard.reduce((s,c)=>s+c.used,0);
    const totalRemain = Math.max(0, totalLimit - totalUsed);
    const usageRate = totalLimit > 0 ? totalUsed / totalLimit : 0;
    return { totalLimit, totalUsed, totalRemain, usageRate, perCard };
}
