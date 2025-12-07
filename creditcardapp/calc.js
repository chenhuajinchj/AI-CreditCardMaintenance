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

export function calcCardPeriodStats(card, recs, today = new Date()) {
    const lastBill = getLastBillDate(card.billDay, today);
    let periodSpend = 0; // 只计算消费与现金
    let netChange = 0;   // 消费+现金-还款
    let feeSum = 0;
    let txCount = 0;
    (recs || []).forEach(r => {
        if (r.cardName !== card.name) return;
        if (!r.date) return;
        const rd = new Date(r.date);
        if (Number.isNaN(rd.getTime())) return;
        if (rd < lastBill) return;
        const amt = Number(r.amount) || 0;
        const fee = Number(r.fee) || 0;
        feeSum += fee;
        txCount += 1;
        const t = r.type || 'expense';
        if (t === 'repayment') {
            netChange -= amt;
        } else {
            periodSpend += amt;
            netChange += amt;
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
        if (r.type === 'repayment') return;
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
