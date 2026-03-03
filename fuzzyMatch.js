/**
 * fuzzyScore calculates a score based on how well the query matches the text.
 * @param {string} query - The search query.
 * @param {string} text - The text to match against.
 * @param {boolean} preLowercased - Whether the input is already lowercased.
 * @returns {number} - The calculated score (0-100+).
 */
export function fuzzyScore(query, text, preLowercased = false) {
    if (!text || !query) return 0;

    const q = preLowercased ? query : query.toLowerCase();
    const t = preLowercased ? text : text.toLowerCase();

    if (q === t) return 100;
    const positions = [];
    let searchFrom = 0;
    for (let i = 0; i < q.length; i++) {
        const idx = t.indexOf(q[i], searchFrom);
        if (idx === -1)
            return 0;
        positions.push(idx);
        searchFrom = idx + 1;
    }

    let score = q.length * 8;
    const firstPos = positions[0];
    if (firstPos === 0)
        score += 20;
    if (t.startsWith(q))
        score += 20;

    let runLength = 1;
    for (let i = 0; i < positions.length; i++) {
        const pos = positions[i];
        const prev = pos > 0 ? t[pos - 1] : '';
        if (pos === 0 || !/[a-z0-9]/.test(prev))
            score += 4;

        if (i === 0)
            continue;

        if (positions[i] === positions[i - 1] + 1) {
            runLength++;
            score += 6 + Math.min(6, runLength);
        } else {
            const gap = positions[i] - positions[i - 1] - 1;
            runLength = 1;
            score -= Math.min(8, gap * 2);
        }
    }

    score -= Math.min(30, Math.max(0, t.length - q.length));
    return Math.max(0, Math.round(score));
}
