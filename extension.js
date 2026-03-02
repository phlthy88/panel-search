import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup?version=3.0';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const SEARCH_ENGINES = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q='
};

const HISTORY_DECAY_DAYS = 30;
const MAX_HISTORY_ENTRIES = 100;
const MAX_QUERY_LENGTH = 500;
const RECENCY_WEIGHT = 0.3;
const FREQUENCY_WEIGHT = 0.7;
const RECENCY_HALF_LIFE_DAYS = 7;
const SEARCH_DEBOUNCE_MS = 150;

function getSafeSearchEngine(rawEngine) {
    return Object.hasOwn(SEARCH_ENGINES, rawEngine) ? rawEngine : 'google';
}

/**
 * Manages search predictions based on usage patterns
 */
class PredictionEngine {
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

    destroy() {
        this._usageData = null;
        this._settings = null;
    }
}

const PanelSearchWidget = GObject.registerClass(
class PanelSearchWidget extends St.BoxLayout {
    _init(settings) {
        super._init({
            style_class: 'panel-search-box',
            reactive: true,
            can_focus: true,
            track_hover: true
        });

        this._settings = settings;
        this._appSystem = Shell.AppSystem.get_default();
        this._settingsAppsCache = null;
        this._settingsOnlyCache = null;
        this._predictionEngine = new PredictionEngine(settings);
        this._selectedIndex = -1;
        this._focusOutTimeoutId = null;
        this._searchDebounceId = null;
        this._menuItems = [];
        this._suggestRequestId = 0;
        this._webSuggestions = [];
        this._soupSession = new Soup.Session();
        this._suggestCancellable = null;
        this._lastQuery = '';
        this._menuHovered = false;
        this._signals = [];

        // Invalidate app cache when apps change
        this._signals.push({
            obj: this._appSystem,
            id: this._appSystem.connect('installed-changed', () => {
                this._settingsAppsCache = null;
                this._settingsOnlyCache = null;
            })
        });

        // Search entry
        this._searchEntry = new St.Entry({
            name: 'panelSearchEntry',
            style_class: 'panel-search-entry',
            can_focus: true,
            hint_text: 'Search...',
            track_hover: true
        });

        this._clearIcon = new St.Icon({
            icon_name: 'edit-clear-symbolic',
            icon_size: 14,
            style_class: 'panel-search-clear-icon'
        });
        this._searchEntry.set_secondary_icon(this._clearIcon);
        this._clearIcon.visible = false;

        this._signals.push({
            obj: this._searchEntry,
            id: this._searchEntry.connect('secondary-icon-clicked', () => {
                this._searchEntry.set_text('');
                this._clearIcon.visible = false;
                this._searchEntry.grab_key_focus();
            })
        });

        this.add_child(this._searchEntry);

        // Results popup
        this._resultsMenu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
        this._resultsMenu.box.add_style_class_name('panel-search-results');
        Main.uiGroup.add_child(this._resultsMenu.actor);
        this._resultsMenu.actor.hide();

        // Signals
        const text = this._searchEntry.clutter_text;
        this._signals.push(
            { obj: text, id: text.connect('text-changed', () => this._onSearchChangedDebounced()) },
            { obj: text, id: text.connect('activate', () => this._onSearchActivate()) },
            { obj: text, id: text.connect('key-focus-in', () => this._showResults()) },
            { obj: text, id: text.connect('key-press-event', (_actor, event) => this._onKeyPress(event)) },
            { obj: this._resultsMenu.actor, id: this._resultsMenu.actor.connect('enter-event', () => { this._menuHovered = true; }) },
            { obj: this._resultsMenu.actor, id: this._resultsMenu.actor.connect('leave-event', () => { this._menuHovered = false; }) },
            { obj: text, id: text.connect('key-focus-out', () => {
                if (this._focusOutTimeoutId) {
                    GLib.source_remove(this._focusOutTimeoutId);
                    this._focusOutTimeoutId = null;
                }
                this._focusOutTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    this._focusOutTimeoutId = null;
                    if (!this._searchEntry) return GLib.SOURCE_REMOVE;
                    if (!this._menuHovered)
                        this._hideResults();
                    return GLib.SOURCE_REMOVE;
                });
            }) }
        );
    }

    // ─── Visibility helpers ──────────────────────────────────────────────────

    _showResults() {
        if (this._searchEntry.get_text().trim().length > 0)
            this._resultsMenu.open(true);
    }

    _hideResults() {
        this._resultsMenu.close(true);
        this._searchEntry.set_text('');
        this._selectedIndex = -1;
    }

    // ─── Debounced search ────────────────────────────────────────────────────

    _onSearchChangedDebounced() {
        if (this._searchDebounceId) {
            GLib.source_remove(this._searchDebounceId);
            this._searchDebounceId = null;
        }

        const query = this._searchEntry.get_text().trim();
        this._clearIcon.visible = query.length > 0;

        if (query.length === 0) {
            this._resultsMenu.close(true);
            return;
        }

        this._searchDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DEBOUNCE_MS, () => {
            this._searchDebounceId = null;
            this._onSearchChanged();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ─── Keyboard navigation ─────────────────────────────────────────────────

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        const items = this._menuItems;

        if (items.length === 0)
            return Clutter.EVENT_PROPAGATE;

        switch (symbol) {
            case Clutter.KEY_Down:
                this._selectedIndex = Math.min(this._selectedIndex + 1, items.length - 1);
                this._updateSelection(items);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Up:
                this._selectedIndex = Math.max(this._selectedIndex - 1, -1);
                this._updateSelection(items);
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
                if (this._selectedIndex >= 0 && this._selectedIndex < items.length) {
                    items[this._selectedIndex].activate(event);
                    this._hideResults();
                }
                return Clutter.EVENT_STOP;

            case Clutter.KEY_Escape:
                this._hideResults();
                return Clutter.EVENT_STOP;

            default:
                return Clutter.EVENT_PROPAGATE;
        }
    }

    _onSearchActivate() {
        const items = this._menuItems;
        if (items.length === 0) return;
        const index = Math.max(0, this._selectedIndex);
        if (index < items.length)
            items[index].activate(null);
    }

    _updateSelection(items) {
        for (const item of items)
            item.setOrnament(PopupMenu.Ornament.NONE);

        if (this._selectedIndex >= 0 && this._selectedIndex < items.length)
            items[this._selectedIndex].setOrnament(PopupMenu.Ornament.DOT);
    }

    // ─── Web suggestions ─────────────────────────────────────────────────────

    async _fetchWebSuggestions(query) {
        const requestId = ++this._suggestRequestId;
        if (this._suggestCancellable) {
            this._suggestCancellable.cancel();
            this._suggestCancellable = null;
        }

        const cancellable = new Gio.Cancellable();
        this._suggestCancellable = cancellable;

        try {
            const url = `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}`;
            const message = Soup.Message.new('GET', url);
            message.request_headers.append('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64)');

            const bytes = await new Promise((resolve, reject) => {
                this._soupSession.send_and_read_async(
                    message,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (session, res) => {
                        try { resolve(session.send_and_read_finish(res)); }
                        catch (e) { reject(e); }
                    }
                );
            });

            if (requestId !== this._suggestRequestId)
                return [];

            const response = new TextDecoder().decode(bytes.get_data());

            try {
                const data = JSON.parse(response);
                if (Array.isArray(data) && Array.isArray(data[1]))
                    return data[1].slice(0, 5);

                if (Array.isArray(data) && data.length > 0 && typeof data[0]?.phrase === 'string')
                    return data.map(item => item.phrase).filter(Boolean).slice(0, 5);

                return [];
            } catch (e) {
                console.error('Failed to parse web suggestions:', e);
                return [];
            }
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return [];
            console.error('Failed to fetch web suggestions:', e);
            return [];
        } finally {
            if (this._suggestCancellable === cancellable)
                this._suggestCancellable = null;
        }
    }

    _injectWebSuggestions(query) {
        this._fetchWebSuggestions(query).then(suggestions => {
            if (!this._searchEntry || this._searchEntry.get_text().trim() !== query || !suggestions?.length)
                return;

            const engine = getSafeSearchEngine(this._settings.get_string('search-engine'));
            const newSuggestions = suggestions.slice(0, 5).map(phrase => ({
                label: phrase,
                subtitle: 'Suggestion',
                icon: 'edit-find-symbolic',
                action: () => {
                    this._runActionSafely(() => {
                        Gio.AppInfo.launch_default_for_uri(
                            SEARCH_ENGINES[engine] + encodeURIComponent(phrase), null
                        );
                    }, 'launching suggestion URI');
                    this._predictionEngine.recordUsage(phrase, 'web');
                    this._hideResults();
                }
            }));

            const changed = JSON.stringify(newSuggestions.map(s => s.label)) !==
                           JSON.stringify(this._webSuggestions.map(s => s.label));

            if (!changed) return;

            const previousLabel = this._selectedIndex >= 0 && this._selectedIndex < this._menuItems.length
                ? this._menuItems[this._selectedIndex].label?.get_text?.()
                : null;

            this._webSuggestions = newSuggestions;
            this._renderResults(query);

            if (previousLabel) {
                const idx = this._menuItems.findIndex(i => i.label?.get_text?.() === previousLabel);
                if (idx !== -1) {
                    this._selectedIndex = idx;
                    this._updateSelection(this._menuItems);
                }
            }
        }).catch(e => console.error('Web suggestion error:', e));
    }

    // ─── Core search logic ───────────────────────────────────────────────────

    _onSearchChanged() {
        const query = this._searchEntry.get_text().trim();

        if (query.length > MAX_QUERY_LENGTH) {
            this._searchEntry.set_text(query.substring(0, MAX_QUERY_LENGTH));
            return;
        }

        if (query !== this._lastQuery) {
            this._webSuggestions = [];
            this._lastQuery = query;
        }

        if (query.length === 0) {
            this._resultsMenu.close(true);
            return;
        }

        this._renderResults(query);

        if (query.length >= 2)
            this._injectWebSuggestions(query);
    }

    _buildAppCaches() {
        const all = this._appSystem.get_installed();
        this._settingsOnlyCache = [];
        this._settingsAppsCache = [];

        for (const appInfo of all) {
            const name = appInfo.get_name();
            if (!name)
                continue;

            const desc = appInfo.get_description() || '';
            const appId = appInfo.get_id?.() ?? null;
            const searchable = {
                appInfo,
                appId,
                name,
                desc,
                nameLower: name.toLowerCase(),
                descLower: desc.toLowerCase(),
                keywordsLower: (appInfo.get_keywords?.()?.join(' ') || '').toLowerCase()
            };

            const cats = appInfo.get_categories?.();
            if (cats && cats.includes('Settings'))
                this._settingsOnlyCache.push(searchable);
            else
                this._settingsAppsCache.push(searchable);
        }
    }

    _getCompletionSection(query, lowerQuery, engine, usageData, now) {
        const completions = [];
        for (const [key, data] of Object.entries(usageData)) {
            const [type, value] = key.split(':');
            if (type !== 'web' || !value) continue;

            if (lowerQuery.length >= 2 && this._fuzzyScore(lowerQuery, value, true) >= 70) {
                const daysSince = (now - data.lastUsed) / (1000 * 60 * 60 * 24);
                completions.push({
                    label: value,
                    subtitle: 'Recent',
                    icon: 'edit-find-symbolic',
                    score: (data.count * 20) + Math.max(0, 30 - daysSince),
                    action: () => {
                        this._runActionSafely(() => {
                            Gio.AppInfo.launch_default_for_uri(
                                SEARCH_ENGINES[engine] + encodeURIComponent(value), null
                            );
                        }, 'launching completion URI');
                        this._predictionEngine.recordUsage(value, 'web');
                        this._hideResults();
                    }
                });
            }
        }
        completions.sort((a, b) => b.score - a.score);

        const suggestionLabels = new Set(this._webSuggestions.map(s => s.label.toLowerCase()));
        return [...this._webSuggestions, ...completions.filter(c => !suggestionLabels.has(c.label.toLowerCase()))].slice(0, 5);
    }

    _getLocalSection(query, lowerQuery, usageData, now, maxResults) {
        const candidates = [];
        const calcResult = this._tryCalculator(query);
        if (calcResult) {
            candidates.push({
                label: 'Calculator',
                subtitle: calcResult,
                score: 200,
                icon: 'accessories-calculator-symbolic',
                action: () => {
                    this._predictionEngine.recordUsage(query, 'calc');
                    this._hideResults();
                }
            });
        }

        const convResult = this._tryConversion(query);
        if (convResult) {
            candidates.push({
                label: 'Converter',
                subtitle: convResult,
                score: 200,
                icon: 'preferences-system-symbolic',
                action: () => {
                    this._predictionEngine.recordUsage(query, 'convert');
                    this._hideResults();
                }
            });
        }

        for (const [key, data] of Object.entries(usageData)) {
            const [type, value] = key.split(':');
            if (type !== 'app' && type !== 'setting') continue;

            const app = this._appSystem.lookup_app(data.metadata || value);
            if (!app || !app.get_name()) continue;

            const name = app.get_name();
            if (lowerQuery.length >= 2 && this._fuzzyScore(lowerQuery, name.toLowerCase(), true) >= 70) {
                const daysSince = (now - data.lastUsed) / (1000 * 60 * 60 * 24);
                candidates.push({
                    label: name,
                    subtitle: 'Recent',
                    score: 250 + (data.count * 20) + Math.max(0, 30 - daysSince),
                    icon: app.app_info?.get_icon() || 'application-x-executable-symbolic',
                    action: () => {
                        this._runActionSafely(() => app.activate(), `activating app ${app.get_id()}`);
                        this._predictionEngine.recordUsage(name, type, app.get_id());
                        this._hideResults();
                    }
                });
            }
        }

        if (!this._settingsAppsCache) this._buildAppCaches();

        const addAppsFromCache = (cache, isSettings) => {
            for (const item of cache) {
                const score = (this._fuzzyScore(lowerQuery, item.nameLower, true) * 2) +
                             this._fuzzyScore(lowerQuery, item.descLower, true) +
                             this._fuzzyScore(lowerQuery, item.keywordsLower, true);
                if (score > 0) {
                    candidates.push({
                        label: item.name,
                        subtitle: isSettings ? 'Settings' : item.desc,
                        score,
                        icon: item.appInfo.get_icon?.() || 'application-x-executable-symbolic',
                        action: () => {
                            this._runActionSafely(() => this._activateLocalCandidate(item), `activating local result ${item.appId ?? item.name}`);
                            this._predictionEngine.recordUsage(item.name, isSettings ? 'setting' : 'app', item.appId);
                            this._hideResults();
                        }
                    });
                }
            }
        };

        addAppsFromCache(this._settingsAppsCache, false);
        addAppsFromCache(this._settingsOnlyCache, true);

        candidates.sort((a, b) => b.score - a.score);
        return candidates.slice(0, maxResults);
    }

    _renderResults(query) {
        this._resultsMenu.removeAll();
        this._menuItems = [];

        const lowerQuery = query.toLowerCase();
        const engine = getSafeSearchEngine(this._settings.get_string('search-engine'));
        const usageData = this._predictionEngine.getUsageData();
        const now = Date.now();

        const completions = this._getCompletionSection(query, lowerQuery, engine, usageData, now);
        completions.forEach(row => this._addResult(row.label, row.subtitle, row.action, row.icon));

        const local = this._getLocalSection(query, lowerQuery, usageData, now, this._settings.get_int('max-predictions') || 5);
        if (local.length > 0) {
            if (completions.length > 0) this._resultsMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            local.forEach(row => this._addResult(row.label, row.subtitle, row.action, row.icon));
        }

        if (completions.length > 0 || local.length > 0)
            this._resultsMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const engineName = engine.charAt(0).toUpperCase() + engine.slice(1);
        this._addResult(`Search ${engineName}`, query, () => {
            this._runActionSafely(() => {
                Gio.AppInfo.launch_default_for_uri(SEARCH_ENGINES[engine] + encodeURIComponent(query), null);
            }, 'launching search URI');
            this._predictionEngine.recordUsage(query, 'web');
            this._hideResults();
        }, 'web-browser-symbolic');

        if (this._selectedIndex >= this._menuItems.length)
            this._selectedIndex = this._menuItems.length - 1;

        if (this._menuItems.length > 0)
            this._resultsMenu.open(true);
    }

    // ─── Result row builder ──────────────────────────────────────────────────

    _addResult(title, subtitle, callback, icon) {
        const item = new PopupMenu.PopupImageMenuItem(title, icon);

        if (subtitle) {
            const label = new St.Label({
                text: subtitle,
                style_class: 'popup-subtitle-menu-item'
            });
            item.add_child(label);
        }

        if (callback)
            item.connect('activate', callback);

        this._resultsMenu.addMenuItem(item);
        this._menuItems.push(item);
    }

    // ─── Calculator ──────────────────────────────────────────────────────────

    _tryCalculator(query) {
        const sanitized = query.replace(/\s/g, '');
        if (!/^[\d+\-*/().]+$/.test(sanitized) || !/\d/.test(sanitized))
            return null;

        try {
            const result = this._evaluateExpression(sanitized);
            if (typeof result === 'number' && isFinite(result))
                return `${query} = ${result}`;
        } catch (_e) {}
        return null;
    }

    _evaluateExpression(expr) {
        const tokens = expr.match(/\d+\.?\d*|[+\-*/()]/g);
        if (!tokens) return null;

        let pos = 0;

        const parseNumber = () => {
            const token = tokens[pos++];
            if (token === '(') {
                const result = parseAddSub();
                pos++; // skip ')'
                return result;
            }
            return parseFloat(token);
        };

        const parseMulDiv = () => {
            let left = parseNumber();
            while (pos < tokens.length && (tokens[pos] === '*' || tokens[pos] === '/')) {
                const op = tokens[pos++];
                const right = parseNumber();
                left = op === '*' ? left * right : left / right;
            }
            return left;
        };

        const parseAddSub = () => {
            let left = parseMulDiv();
            while (pos < tokens.length && (tokens[pos] === '+' || tokens[pos] === '-')) {
                const op = tokens[pos++];
                const right = parseMulDiv();
                left = op === '+' ? left + right : left - right;
            }
            return left;
        };

        return parseAddSub();
    }

    // ─── Converter ───────────────────────────────────────────────────────────

    _tryConversion(query) {
        const lower = query.toLowerCase();

        const distMatch = lower.match(/(\d+\.?\d*)\s*(km|mi|m|ft|cm|in)\s+to\s+(km|mi|m|ft|cm|in)/);
        if (distMatch) {
            const value = parseFloat(distMatch[1]);
            const result = this._convertDistance(value, distMatch[2], distMatch[3]);
            if (result !== null) return `${value} ${distMatch[2]} = ${result.toFixed(4)} ${distMatch[3]}`;
        }

        const weightMatch = lower.match(/(\d+\.?\d*)\s*(kg|lb|g|oz)\s+to\s+(kg|lb|g|oz)/);
        if (weightMatch) {
            const value = parseFloat(weightMatch[1]);
            const result = this._convertWeight(value, weightMatch[2], weightMatch[3]);
            if (result !== null) return `${value} ${weightMatch[2]} = ${result.toFixed(4)} ${weightMatch[3]}`;
        }

        const volMatch = lower.match(/(\d+\.?\d*)\s*(l|ml|gal|qt|pt|cup)\s+to\s+(l|ml|gal|qt|pt|cup)/);
        if (volMatch) {
            const value = parseFloat(volMatch[1]);
            const result = this._convertVolume(value, volMatch[2], volMatch[3]);
            if (result !== null) return `${value} ${volMatch[2]} = ${result.toFixed(4)} ${volMatch[3]}`;
        }

        return null;
    }

    _convertDistance(value, from, to) {
        const toMeters = {m: 1, km: 1000, cm: 0.01, ft: 0.3048, mi: 1609.34, in: 0.0254};
        if (!toMeters[from] || !toMeters[to]) return null;
        return value * toMeters[from] / toMeters[to];
    }

    _convertWeight(value, from, to) {
        const toGrams = {g: 1, kg: 1000, oz: 28.3495, lb: 453.592};
        if (!toGrams[from] || !toGrams[to]) return null;
        return value * toGrams[from] / toGrams[to];
    }

    _convertVolume(value, from, to) {
        const toLiters = {l: 1, ml: 0.001, gal: 3.78541, qt: 0.946353, pt: 0.473176, cup: 0.236588};
        if (!toLiters[from] || !toLiters[to]) return null;
        return value * toLiters[from] / toLiters[to];
    }

    // ─── Fuzzy scoring ───────────────────────────────────────────────────────

    _fuzzyScore(query, text, preLowercased = false) {
        if (!text) return 0;

        const q = preLowercased ? query : query.toLowerCase();
        const t = preLowercased ? text : text.toLowerCase();

        if (q === t) return 100;

        let score = 0;
        let qi = 0;
        let consecutive = 0;

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

        // No artificial floor — callers gate on score > 0
        return Math.max(0, score);
    }

    // ─── Cleanup ─────────────────────────────────────────────────────────────

    _runActionSafely(action, context) {
        try {
            action();
        } catch (e) {
            console.error(`Panel Search: Error ${context}:`, e);
        }
    }

    _activateLocalCandidate(item) {
        const shellApp = item.appId ? this._appSystem.lookup_app(item.appId) : null;
        if (shellApp) {
            shellApp.activate();
            return;
        }

        if (item.appInfo?.launch) {
            item.appInfo.launch([], null);
            return;
        }

        throw new Error(`No launch path for local result "${item.appId ?? item.name}"`);
    }

    destroy() {
        this._menuHovered = false;
        this._settingsAppsCache = null;
        this._settingsOnlyCache = null;

        if (this._signals) {
            for (const signal of this._signals)
                signal.obj.disconnect(signal.id);
            this._signals = [];
        }

        if (this._searchDebounceId) {
            GLib.source_remove(this._searchDebounceId);
            this._searchDebounceId = null;
        }

        if (this._focusOutTimeoutId) {
            GLib.source_remove(this._focusOutTimeoutId);
            this._focusOutTimeoutId = null;
        }

        if (this._suggestCancellable) {
            this._suggestCancellable.cancel();
            this._suggestCancellable = null;
        }

        // Abort any in-flight HTTP requests before nulling the session
        if (this._soupSession) {
            this._soupSession.abort();
            this._soupSession = null;
        }

        if (this._predictionEngine) {
            this._predictionEngine.destroy();
            this._predictionEngine = null;
        }

        if (this._resultsMenu) {
            this._resultsMenu.destroy();
            this._resultsMenu = null;
        }

        this._appSystem = null;
        this._settings = null;
        this._searchEntry = null;

        super.destroy();
    }
});

export default class PanelSearchExtension extends Extension {
    _repositionWidget() {
        if (!this._widget || !this._settings)
            return;

        const boxName = this._settings.get_string('panel-box');
        const position = this._settings.get_int('panel-position');
        const container = this._resolvePanelContainer(boxName);
        if (!container)
            return;

        const parent = this._widget.get_parent();
        if (parent)
            parent.remove_child(this._widget);

        container.insert_child_at_index(this._widget, position);
        this._container = container;
    }

    _disconnectSettingsSignals() {
        if (!this._settings || !this._settingsSignals)
            return;

        for (const id of this._settingsSignals)
            this._settings.disconnect(id);
        this._settingsSignals = [];
    }

    _resolvePanelContainer(boxName) {
        const panel = Main.panel;
        const boxMap = {
            left: panel?._leftBox,
            center: panel?._centerBox,
            right: panel?._rightBox
        };

        if (Object.hasOwn(boxMap, boxName) && boxMap[boxName])
            return boxMap[boxName];

        const fallback = boxMap.left ?? boxMap.center ?? boxMap.right ?? null;
        console.error(`Panel Search: Invalid or unavailable panel box "${boxName}", using fallback.`);
        return fallback;
    }

    enable() {
        if (this._widget) {
            console.error('Panel Search: enable() called while already enabled; ignoring duplicate call.');
            return;
        }

        try {
            this._settings = this.getSettings();
            this._widget = new PanelSearchWidget(this._settings);
            this._settingsSignals = [];

            this._repositionWidget();
            if (!this._container)
                throw new Error('No panel container available');

            this._settingsSignals.push(
                this._settings.connect('changed::panel-box', () => this._repositionWidget()),
                this._settings.connect('changed::panel-position', () => this._repositionWidget())
            );
        } catch (e) {
            console.error('Panel Search: Failed to enable extension:', e);
            this._disconnectSettingsSignals();
            if (this._widget) {
                this._widget.destroy();
                this._widget = null;
            }
            this._container = null;
            this._settings = null;
            throw e;
        }
    }

    disable() {
        if (this._widget) {
            const parent = this._widget.get_parent();
            if (parent)
                parent.remove_child(this._widget);
            this._widget.destroy();
            this._widget = null;
        }
        this._disconnectSettingsSignals();
        this._container = null;
        this._settings = null;
    }
}
