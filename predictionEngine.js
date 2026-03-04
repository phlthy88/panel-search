const HISTORY_DECAY_DAYS = 30;
const MAX_HISTORY_ENTRIES = 100;
const RECENCY_WEIGHT = 0.3;
const FREQUENCY_WEIGHT = 0.7;
const RECENCY_HALF_LIFE_DAYS = 7;

/**
 * Manages search predictions based on usage patterns
 */
export class PredictionEngine {
    constructor(settings) {
        this._settings = settings;
        this._usageData = this._loadUsageData();
    }

    _loadUsageData() {
        try {
            const json = this._settings.get_string('usage-history');
            const data = JSON.parse(json);

            if (typeof data !== 'object' || data === null)
                return {};

            for (const [key, value] of Object.entries(data)) {
                if (typeof value !== 'object' ||
                    typeof value.count !== 'number' ||
                    typeof value.lastUsed !== 'number') {
                    delete data[key];
                }
            }

            return data;
        } catch (e) {
            console.error('Failed to load usage history:', e);
            return {};
        }
    }

    _saveUsageData() {
        try {
            const json = JSON.stringify(this._usageData);
            this._settings.set_string('usage-history', json);
        } catch (e) {
            console.error('Failed to save usage history:', e);
        }
    }

    /**
     * Record a search action for learning.
     * @param {string} query - The search query or display name
     * @param {string} type  - 'app' | 'setting' | 'web' | 'calc' | 'convert'
     * @param {string|null} metadata - Canonical app ID for app/setting types
     */
    recordUsage(query, type, metadata = null) {
        if (!query || typeof query !== 'string' || query.length === 0)
            return;

        let key;
        if (type === 'app' || type === 'setting') {
            if (!metadata) {
                console.error(`recordUsage called for ${type} without metadata (appId)`);
                return;
            }
            key = `${type}:${metadata}`;
        } else {
            key = `${type}:${query.toLowerCase().trim()}`;
        }

        const now = Date.now();

        if (!this._usageData[key]) {
            this._usageData[key] = {
                count: 0,
                lastUsed: now,
                type,
                metadata
            };
        }

        this._usageData[key].count++;
        this._usageData[key].lastUsed = now;

        if (metadata !== null)
            this._usageData[key].metadata = metadata;

        this._pruneHistory();
        this._saveUsageData();
    }

    _pruneHistory() {
        const now = Date.now();
        const maxAge = HISTORY_DECAY_DAYS * 24 * 60 * 60 * 1000;

        for (const [key, data] of Object.entries(this._usageData)) {
            if (now - data.lastUsed > maxAge)
                delete this._usageData[key];
        }

        const entries = Object.entries(this._usageData);
        if (entries.length <= MAX_HISTORY_ENTRIES)
            return;

        const sorted = entries
            .map(([key, data]) => ({key, score: this._calculateScore(data, now)}))
            .sort((a, b) => b.score - a.score);

        for (const item of sorted.slice(MAX_HISTORY_ENTRIES))
            delete this._usageData[item.key];
    }

    _calculateScore(data, now) {
        const daysSinceUse = (now - data.lastUsed) / (24 * 60 * 60 * 1000);
        const recencyScore = Math.exp(-daysSinceUse / RECENCY_HALF_LIFE_DAYS);
        const frequencyScore = Math.log(data.count + 1);
        return (recencyScore * RECENCY_WEIGHT) + (frequencyScore * FREQUENCY_WEIGHT);
    }

    getUsageData() {
        return this._usageData;
    }

    reloadUsageData() {
        this._usageData = this._loadUsageData();
    }

    destroy() {
        this._usageData = null;
        this._settings = null;
    }
}
