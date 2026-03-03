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

    let score = 0;
    let qi = 0;
    let consecutive = 0;

    // Start match bonus
    if (t.startsWith(q)) {
        score += 50;
    }

    for (let i = 0; i < t.length && qi < q.length; i++) {
        if (t[i] === q[qi]) {
            qi++;
            consecutive++;
            score += 10 + (consecutive * 5);
        } else {
            consecutive = 0;
            score -= 1;
        }
    }

    // All query characters must match
    if (qi < q.length) return 0;

    return Math.max(0, score);
}
