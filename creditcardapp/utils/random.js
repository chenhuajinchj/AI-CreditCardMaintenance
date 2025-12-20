// 轻量确定性随机工具（FNV-1a 变体 + sin 基础随机），无第三方依赖
export function stringHash(str) {
    const s = String(str ?? '');
    let hash = 2166136261;
    for (let i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }
    return hash >>> 0;
}

export function seededRandom(seedStr) {
    const seed = stringHash(seedStr);
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

export function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
