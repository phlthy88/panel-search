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
import { FileSearchProvider } from './fileProvider.js';
import { fuzzyScore } from './fuzzyMatch.js';

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
const DEFAULT_SEARCH_DEBOUNCE_MS = 150;
const DEFAULT_PACKAGE_SUGGESTIONS_MAX = 4;
const PACKAGE_MIN_QUERY_LENGTH = 2;
const DEFAULT_FILE_SUGGESTIONS_MAX = 6;
const DEFAULT_FILE_MIN_QUERY_LENGTH = 3;
const WEATHER_SUGGESTIONS_MAX = 1;
const SOFTWARE_SEARCH_PROVIDER_BUS = 'org.gnome.Software';
const SOFTWARE_SEARCH_PROVIDER_PATH = '/org/gnome/Software/SearchProvider';
const SOFTWARE_SEARCH_PROVIDER_IFACE = 'org.gnome.Shell.SearchProvider2';
const WEATHER_CODE_MAP = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail'
};

function getSafeSearchEngine(rawEngine) {
    return Object.hasOwn(SEARCH_ENGINES, rawEngine) ? rawEngine : 'google';
}

function getSafeWeatherUnits(rawUnits) {
    return rawUnits === 'celsius' ? 'celsius' : 'fahrenheit';
}

function getSuggestionSubtitle() {
    // Suggestion phrases are intentionally sourced from DuckDuckGo AC for broad availability.
    return 'Suggestion (DuckDuckGo)';
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

    reloadUsageData() {
        this._usageData = this._loadUsageData();
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
        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._appSystem = Shell.AppSystem.get_default();
        this._settingsAppsCache = null;
        this._settingsOnlyCache = null;
        this._predictionEngine = new PredictionEngine(settings);
        this._selectedIndex = -1;
        this._focusOutTimeoutId = null;
        this._searchDebounceId = null;
        this._menuItems = [];
        this._suggestRequestId = 0;
        this._packageRequestId = 0;
        this._weatherRequestId = 0;
        this._webSuggestions = [];
        this._packageSuggestions = [];
        this._fileSuggestions = [];
        this._fileSearchError = null;
        this._weatherSuggestions = [];
        this._fileSearchProvider = new FileSearchProvider(settings);
        this._soupSession = new Soup.Session();
        this._suggestCancellable = null;
        this._packageSuggestCancellable = null;
        this._fileSuggestCancellable = null;
        this._weatherSuggestCancellable = null;
        this._activatePackageCancellable = null;
        this._softwareProxyCancellable = null;
        this._softwareProxy = null;
        this._softwareProxyInit = null;
        this._resultsMenuActor = null;
        this._softwareUnavailableLogged = false;
        this._lastQuery = '';
        this._menuHovered = false;
        this._signals = [];
        this._cacheWarmupId = null;

        // Invalidate app cache when apps change
        this._signals.push({
            obj: this._appSystem,
            id: this._appSystem.connect('installed-changed', () => {
                this._settingsAppsCache = null;
                this._settingsOnlyCache = null;
                this._scheduleAppCacheWarmup();
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
        this._applyThemeClass();

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
        this._resultsMenuActor = this._resultsMenu.actor ?? this._resultsMenu;
        Main.uiGroup.add_child(this._resultsMenuActor);
        this._resultsMenuActor.hide();

        // Signals
        const text = this._searchEntry.clutter_text;
        this._signals.push(
            { obj: text, id: text.connect('text-changed', () => this._onSearchChangedDebounced()) },
            { obj: text, id: text.connect('activate', () => this._onSearchActivate()) },
            { obj: text, id: text.connect('key-focus-in', () => this._showResults()) },
            { obj: text, id: text.connect('key-press-event', (_actor, event) => this._onKeyPress(event)) },
            { obj: this._interfaceSettings, id: this._interfaceSettings.connect('changed::color-scheme', () => this._applyThemeClass()) },
            { obj: this._settings, id: this._settings.connect('changed::usage-history', () => {
                if (this._predictionEngine)
                    this._predictionEngine.reloadUsageData();
            }) },
            { obj: this._settings, id: this._settings.connect('changed::enable-file-search', () => {
                const enabled = this._settings?.get_boolean('enable-file-search');
                const query = this._searchEntry?.get_text?.().trim() ?? '';
                if (enabled) {
                    this._fileSearchError = null;
                    if (query.length >= this._getFileSearchMinQueryLength())
                        this._injectFileSuggestions(query);
                } else {
                    this._fileSuggestCancellable?.cancel();
                    this._fileSuggestCancellable = null;
                    this._fileSuggestions = [];
                    this._fileSearchError = null;
                }
                this._renderCurrentQuery();
            }) },
            { obj: this._settings, id: this._settings.connect('changed::enable-package-search', () => {
                const enabled = this._settings?.get_boolean('enable-package-search');
                const query = this._searchEntry?.get_text?.().trim() ?? '';
                if (!enabled) {
                    this._packageSuggestCancellable?.cancel();
                    this._packageSuggestCancellable = null;
                    this._packageSuggestions = [];
                } else if (query.length >= PACKAGE_MIN_QUERY_LENGTH) {
                    this._injectPackageSuggestions(query);
                }
                this._renderCurrentQuery();
            }) },
            { obj: this._settings, id: this._settings.connect('changed::enable-weather-search', () => {
                const enabled = this._settings?.get_boolean('enable-weather-search');
                const query = this._searchEntry?.get_text?.().trim() ?? '';
                if (!enabled) {
                    this._weatherSuggestCancellable?.cancel();
                    this._weatherSuggestCancellable = null;
                    this._weatherSuggestions = [];
                } else if (this._extractWeatherLocation(query)) {
                    this._injectWeatherSuggestion(query);
                }
                this._renderCurrentQuery();
            }) },
            { obj: this._settings, id: this._settings.connect('changed::file-search-root-path', () => {
                const query = this._searchEntry?.get_text?.().trim() ?? '';
                this._fileSuggestCancellable?.cancel();
                this._fileSuggestCancellable = null;
                this._fileSuggestions = [];
                this._fileSearchError = null;
                if (this._settings?.get_boolean('enable-file-search') &&
                    query.length >= this._getFileSearchMinQueryLength()) {
                    this._injectFileSuggestions(query);
                }
                this._renderCurrentQuery();
            }) },
            { obj: this._resultsMenuActor, id: this._resultsMenuActor.connect('enter-event', () => { this._menuHovered = true; }) },
            { obj: this._resultsMenuActor, id: this._resultsMenuActor.connect('leave-event', () => { this._menuHovered = false; }) },
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

        this._scheduleAppCacheWarmup();
    }

    _scheduleAppCacheWarmup() {
        if (this._cacheWarmupId)
            return;

        this._cacheWarmupId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._cacheWarmupId = null;
            if (!this._appSystem || this._settingsAppsCache)
                return GLib.SOURCE_REMOVE;

            this._buildAppCaches();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ─── Visibility helpers ──────────────────────────────────────────────────

    _showResults() {
        if (this._searchEntry.get_text().trim().length > 0)
            this._resultsMenu.open(true);
    }

    _renderCurrentQuery() {
        if (!this._searchEntry || !this._resultsMenu)
            return;
        const query = this._searchEntry.get_text().trim();
        if (query.length === 0)
            return;
        this._renderResults(query);
    }

    _applyThemeClass() {
        if (!this._searchEntry || !this._interfaceSettings)
            return;

        const scheme = this._interfaceSettings.get_string('color-scheme');
        const darkMode = scheme === 'prefer-dark';

        this._searchEntry.remove_style_class_name('panel-search-entry-light');
        this._searchEntry.remove_style_class_name('panel-search-entry-dark');
        this._searchEntry.add_style_class_name(darkMode ? 'panel-search-entry-dark' : 'panel-search-entry-light');
    }

    _hideResults() {
        this._resultsMenu.close(true);
        this._searchEntry.set_text('');
        this._selectedIndex = -1;
        try {
            global.stage?.set_key_focus?.(null);
        } catch (_e) {}
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

        this._searchDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._getSearchDebounceMs(), () => {
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
                subtitle: getSuggestionSubtitle(),
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

    _getActivationTimestamp() {
        try {
            if (global?.get_current_time)
                return global.get_current_time();
        } catch (_e) {}

        try {
            return Clutter.get_current_event_time();
        } catch (_e) {
            return 0;
        }
    }

    async _ensureSoftwareProxy() {
        if (this._softwareProxy)
            return this._softwareProxy;

        if (this._softwareProxyInit)
            return this._softwareProxyInit;

        const proxyCancellable = new Gio.Cancellable();
        this._softwareProxyCancellable = proxyCancellable;

        this._softwareProxyInit = new Promise(resolve => {
            Gio.DBusProxy.new_for_bus(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                SOFTWARE_SEARCH_PROVIDER_BUS,
                SOFTWARE_SEARCH_PROVIDER_PATH,
                SOFTWARE_SEARCH_PROVIDER_IFACE,
                proxyCancellable,
                (_obj, res) => {
                    try {
                        this._softwareProxy = Gio.DBusProxy.new_for_bus_finish(res);
                    } catch (e) {
                        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED) && !this._softwareUnavailableLogged) {
                            console.error('Panel Search: GNOME Software search provider unavailable:', e);
                            this._softwareUnavailableLogged = true;
                        }
                        this._softwareProxy = null;
                    } finally {
                        if (this._softwareProxyCancellable === proxyCancellable)
                            this._softwareProxyCancellable = null;
                        resolve(this._softwareProxy);
                    }
                }
            );
        });

        try {
            return await this._softwareProxyInit;
        } finally {
            this._softwareProxyInit = null;
        }
    }

    _callProxy(proxy, method, parameters, cancellable) {
        return new Promise((resolve, reject) => {
            proxy.call(
                method,
                parameters,
                Gio.DBusCallFlags.NONE,
                -1,
                cancellable,
                (_obj, res) => {
                    try {
                        resolve(proxy.call_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    _normalizeMetaValue(value) {
        return value?.deepUnpack ? value.deepUnpack() : value;
    }

    _normalizeResultMeta(meta) {
        if (!meta || typeof meta !== 'object')
            return {};

        const normalized = {};
        for (const [key, value] of Object.entries(meta))
            normalized[key] = this._normalizeMetaValue(value);
        return normalized;
    }

    async _fetchPackageSuggestions(query) {
        if (query.length < PACKAGE_MIN_QUERY_LENGTH)
            return [];
        if (!this._settings.get_boolean('enable-package-search'))
            return [];

        const maxResults = this._getPackageSearchMaxResults();
        const requestId = ++this._packageRequestId;
        if (this._packageSuggestCancellable) {
            this._packageSuggestCancellable.cancel();
            this._packageSuggestCancellable = null;
        }

        const cancellable = new Gio.Cancellable();
        this._packageSuggestCancellable = cancellable;

        try {
            const proxy = await this._ensureSoftwareProxy();
            if (!this._searchEntry)
                return [];
            if (!proxy)
                return [];

            const initialReply = await this._callProxy(
                proxy,
                'GetInitialResultSet',
                new GLib.Variant('(as)', [[query]]),
                cancellable
            );
            const initialResults = initialReply.deepUnpack()?.[0] ?? [];
            if (!Array.isArray(initialResults) || initialResults.length === 0)
                return [];

            const resultIds = initialResults.slice(0, maxResults);
            const metasReply = await this._callProxy(
                proxy,
                'GetResultMetas',
                new GLib.Variant('(as)', [resultIds]),
                cancellable
            );
            const metas = metasReply.deepUnpack()?.[0] ?? [];

            if (requestId !== this._packageRequestId)
                return [];

            const suggestions = resultIds.map((resultId, index) => {
                const meta = this._normalizeResultMeta(metas[index] ?? {});
                const name = typeof meta.name === 'string' && meta.name.length > 0
                    ? meta.name
                    : resultId;
                const description = typeof meta.description === 'string' && meta.description.length > 0
                    ? meta.description
                    : 'Available in Software';

                return {
                    label: name,
                    subtitle: description,
                    icon: 'system-software-install-symbolic',
                    action: () => {
                        this._runActionSafely(() => {
                            this._activatePackageSuggestion(resultId, query);
                        }, `activating package suggestion ${resultId}`);
                        this._hideResults();
                    }
                };
            });

            return suggestions.slice(0, maxResults);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return [];

            console.error('Panel Search: Failed to fetch package suggestions:', e);
            return [];
        } finally {
            if (this._packageSuggestCancellable === cancellable)
                this._packageSuggestCancellable = null;
        }
    }

    _activatePackageSuggestion(resultId, query) {
        this._activatePackageCancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._activatePackageCancellable = cancellable;

        this._ensureSoftwareProxy().then(proxy => {
            if (!proxy)
                return;

            proxy.call(
                'ActivateResult',
                new GLib.Variant('(sasu)', [resultId, [query], this._getActivationTimestamp()]),
                Gio.DBusCallFlags.NONE,
                -1,
                cancellable,
                (_obj, res) => {
                    try {
                        proxy.call_finish(res);
                    } catch (e) {
                        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            console.error(`Panel Search: Failed to activate package suggestion ${resultId}:`, e);
                    } finally {
                        if (this._activatePackageCancellable === cancellable)
                            this._activatePackageCancellable = null;
                    }
                }
            );
        }).catch(e => console.error('Panel Search: Software proxy activation failure:', e));
    }

    _injectPackageSuggestions(query) {
        this._fetchPackageSuggestions(query).then(suggestions => {
            if (!this._searchEntry || this._searchEntry.get_text().trim() !== query || !suggestions?.length)
                return;

            const changed = JSON.stringify(suggestions.map(s => s.label)) !==
                JSON.stringify(this._packageSuggestions.map(s => s.label));
            if (!changed)
                return;

            const previousLabel = this._selectedIndex >= 0 && this._selectedIndex < this._menuItems.length
                ? this._menuItems[this._selectedIndex].label?.get_text?.()
                : null;

            this._packageSuggestions = suggestions;
            this._renderResults(query);

            if (previousLabel) {
                const idx = this._menuItems.findIndex(i => i.label?.get_text?.() === previousLabel);
                if (idx !== -1) {
                    this._selectedIndex = idx;
                    this._updateSelection(this._menuItems);
                }
            }
        }).catch(e => console.error('Panel Search: Package suggestion error:', e));
    }

    _getFileSearchMaxResults() {
        let value;
        try {
            value = this._settings.get_int('file-search-max-results');
        } catch (_e) {
            return DEFAULT_FILE_SUGGESTIONS_MAX;
        }
        if (!Number.isFinite(value))
            return DEFAULT_FILE_SUGGESTIONS_MAX;
        return Math.max(1, Math.min(15, value));
    }

    _getFileSearchMinQueryLength() {
        let value;
        try {
            value = this._settings.get_int('file-search-min-query-length');
        } catch (_e) {
            return DEFAULT_FILE_MIN_QUERY_LENGTH;
        }
        if (!Number.isFinite(value))
            return DEFAULT_FILE_MIN_QUERY_LENGTH;
        return Math.max(1, Math.min(20, value));
    }

    _getPackageSearchMaxResults() {
        let value;
        try {
            value = this._settings.get_int('package-search-max-results');
        } catch (_e) {
            return DEFAULT_PACKAGE_SUGGESTIONS_MAX;
        }
        if (!Number.isFinite(value))
            return DEFAULT_PACKAGE_SUGGESTIONS_MAX;
        return Math.max(1, Math.min(10, value));
    }

    _getSearchDebounceMs() {
        let value;
        try {
            value = this._settings.get_int('search-debounce-ms');
        } catch (_e) {
            return DEFAULT_SEARCH_DEBOUNCE_MS;
        }
        if (!Number.isFinite(value))
            return DEFAULT_SEARCH_DEBOUNCE_MS;
        return Math.max(50, Math.min(500, value));
    }

    _extractWeatherLocation(query) {
        const match = query.match(/^(weather|wx|temp|temperature)\s*(?:in|for)?\s+(.+)$/i);
        if (!match || typeof match[2] !== 'string')
            return null;

        const location = match[2].trim();
        return location.length > 0 ? location : null;
    }

    _weatherDescription(code) {
        return Object.hasOwn(WEATHER_CODE_MAP, code) ? WEATHER_CODE_MAP[code] : 'Weather unavailable';
    }

    async _fetchJson(url, cancellable) {
        const message = Soup.Message.new('GET', url);
        message.request_headers.append('User-Agent', 'panel-search-extension');

        const bytes = await new Promise((resolve, reject) => {
            this._soupSession.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                cancellable,
                (session, res) => {
                    try {
                        resolve(session.send_and_read_finish(res));
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });

        const response = new TextDecoder().decode(bytes.get_data());
        return JSON.parse(response);
    }

    async _fetchWeatherSuggestion(query) {
        const location = this._extractWeatherLocation(query);
        if (!location)
            return [];

        const requestId = ++this._weatherRequestId;
        if (this._weatherSuggestCancellable) {
            this._weatherSuggestCancellable.cancel();
            this._weatherSuggestCancellable = null;
        }

        const cancellable = new Gio.Cancellable();
        this._weatherSuggestCancellable = cancellable;

        try {
            const units = getSafeWeatherUnits(this._settings.get_string('weather-units'));
            const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
            const geocode = await this._fetchJson(geocodeUrl, cancellable);
            const match = geocode?.results?.[0];
            if (!match || requestId !== this._weatherRequestId)
                return [];

            const latitude = match.latitude;
            const longitude = match.longitude;
            if (typeof latitude !== 'number' || typeof longitude !== 'number')
                return [];

            const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&temperature_unit=${units}&timezone=auto`;
            const weather = await this._fetchJson(weatherUrl, cancellable);
            if (requestId !== this._weatherRequestId)
                return [];

            const current = weather?.current ?? weather?.current_weather ?? null;
            if (!current)
                return [];

            const temperature = current.temperature_2m ?? current.temperature;
            const weatherCode = current.weather_code ?? current.weathercode;
            if (typeof temperature !== 'number')
                return [];

            const unitSymbol = units === 'celsius' ? 'C' : 'F';
            const placeBits = [match.name, match.admin1, match.country].filter(Boolean);
            const placeLabel = placeBits.join(', ');
            const description = this._weatherDescription(Number(weatherCode));

            return [{
                label: `Weather in ${placeLabel || location}`,
                subtitle: `${temperature.toFixed(1)}°${unitSymbol} - ${description}`,
                icon: 'weather-clear-symbolic',
                action: () => {
                    const weatherPage = `https://open-meteo.com/en/docs?latitude=${latitude}&longitude=${longitude}`;
                    this._runActionSafely(() => Gio.AppInfo.launch_default_for_uri(weatherPage, null), 'launching weather details URI');
                    this._hideResults();
                }
            }];
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return [];

            console.error('Panel Search: Failed to fetch weather suggestion:', e);
            return [];
        } finally {
            if (this._weatherSuggestCancellable === cancellable)
                this._weatherSuggestCancellable = null;
        }
    }

    _injectWeatherSuggestion(query) {
        this._fetchWeatherSuggestion(query).then(suggestions => {
            if (!this._searchEntry || this._searchEntry.get_text().trim() !== query || !suggestions)
                return;

            const changed = JSON.stringify(suggestions.map(s => `${s.label}:${s.subtitle}`)) !==
                JSON.stringify(this._weatherSuggestions.map(s => `${s.label}:${s.subtitle}`));
            if (!changed)
                return;

            const previousLabel = this._selectedIndex >= 0 && this._selectedIndex < this._menuItems.length
                ? this._menuItems[this._selectedIndex].label?.get_text?.()
                : null;

            this._weatherSuggestions = suggestions;
            this._renderResults(query);

            if (previousLabel) {
                const idx = this._menuItems.findIndex(i => i.label?.get_text?.() === previousLabel);
                if (idx !== -1) {
                    this._selectedIndex = idx;
                    this._updateSelection(this._menuItems);
                }
            }
        }).catch(e => console.error('Panel Search: Weather suggestion error:', e));
    }

    _injectFileSuggestions(query) {
        if (this._fileSuggestCancellable) {
            this._fileSuggestCancellable.cancel();
            this._fileSuggestCancellable = null;
        }

        const cancellable = new Gio.Cancellable();
        this._fileSuggestCancellable = cancellable;

        this._fileSearchProvider.getSuggestions(
            query,
            this._getFileSearchMaxResults(),
            cancellable
        ).then(suggestions => {
            if (!this._searchEntry || this._searchEntry.get_text().trim() !== query || !suggestions)
                return;

            this._fileSearchError = null;

            const changed = JSON.stringify(suggestions.map(s => `${s.label}:${s.subtitle}`)) !==
                JSON.stringify(this._fileSuggestions.map(s => `${s.label}:${s.subtitle}`));
            if (!changed)
                return;

            const previousLabel = this._selectedIndex >= 0 && this._selectedIndex < this._menuItems.length
                ? this._menuItems[this._selectedIndex].label?.get_text?.()
                : null;

            this._fileSuggestions = suggestions;
            this._renderResults(query);

            if (previousLabel) {
                const idx = this._menuItems.findIndex(i => i.label?.get_text?.() === previousLabel);
                if (idx !== -1) {
                    this._selectedIndex = idx;
                    this._updateSelection(this._menuItems);
                }
            }
        }).catch(e => {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                console.error('Panel Search: File suggestion error:', e);
                this._fileSuggestions = [];
                this._fileSearchError = 'File search unavailable';
                if (this._searchEntry && this._searchEntry.get_text().trim() === query)
                    this._renderResults(query);
            }
        }).finally(() => {
            if (this._fileSuggestCancellable === cancellable)
                this._fileSuggestCancellable = null;
        });
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
            this._packageSuggestions = [];
            this._fileSuggestions = [];
            this._fileSearchError = null;
            this._weatherSuggestions = [];
            this._lastQuery = query;
        }

        if (query.length === 0) {
            this._resultsMenu.close(true);
            return;
        }

        if (!this._settings.get_boolean('enable-file-search')) {
            this._fileSuggestions = [];
            this._fileSearchError = null;
        }
        if (!this._settings.get_boolean('enable-weather-search'))
            this._weatherSuggestions = [];
        if (!this._settings.get_boolean('enable-package-search'))
            this._packageSuggestions = [];

        this._renderResults(query);

        if (query.length >= PACKAGE_MIN_QUERY_LENGTH) {
            this._injectWebSuggestions(query);
            if (this._settings.get_boolean('enable-package-search'))
                this._injectPackageSuggestions(query);
        }

        const fileSearchEnabled = this._settings.get_boolean('enable-file-search');
        const fileSearchMinLen = this._getFileSearchMinQueryLength();
        if (fileSearchEnabled && query.length >= fileSearchMinLen)
            this._injectFileSuggestions(query);

        const weatherSearchEnabled = this._settings.get_boolean('enable-weather-search');
        if (weatherSearchEnabled && this._extractWeatherLocation(query))
            this._injectWeatherSuggestion(query);
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

            if (lowerQuery.length >= 2 && fuzzyScore(lowerQuery, value, true) >= 70) {
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
            if (lowerQuery.length >= 2 && fuzzyScore(lowerQuery, name.toLowerCase(), true) >= 70) {
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
                const score = (fuzzyScore(lowerQuery, item.nameLower, true) * 2) +
                             fuzzyScore(lowerQuery, item.descLower, true) +
                             fuzzyScore(lowerQuery, item.keywordsLower, true);
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

        const packages = this._settings.get_boolean('enable-package-search')
            ? this._packageSuggestions.slice(0, this._getPackageSearchMaxResults())
            : [];
        if (packages.length > 0) {
            if (completions.length > 0)
                this._resultsMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            packages.forEach(row => this._addResult(row.label, row.subtitle, row.action, row.icon));
        }

        const files = this._settings.get_boolean('enable-file-search')
            ? this._fileSuggestions.slice(0, this._getFileSearchMaxResults())
            : [];
        if (files.length > 0) {
            if (completions.length > 0 || packages.length > 0)
                this._resultsMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            files.forEach(row => this._addResult(row.label, row.subtitle, row.action, row.icon));
        }

        const fileSearchError = this._settings.get_boolean('enable-file-search') ? this._fileSearchError : null;
        if (fileSearchError) {
            if (completions.length > 0 || packages.length > 0 || files.length > 0)
                this._resultsMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._addResult('File Search', fileSearchError, null, 'dialog-warning-symbolic');
        }

        const weather = this._settings.get_boolean('enable-weather-search')
            ? this._weatherSuggestions.slice(0, WEATHER_SUGGESTIONS_MAX)
            : [];
        if (weather.length > 0) {
            if (completions.length > 0 || packages.length > 0 || files.length > 0 || fileSearchError)
                this._resultsMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            weather.forEach(row => this._addResult(row.label, row.subtitle, row.action, row.icon));
        }

        const maxPredictions = this._settings.get_int('max-predictions');
        const safeMaxPredictions = Number.isFinite(maxPredictions)
            ? Math.max(0, Math.min(5, maxPredictions))
            : 5;
        const local = this._getLocalSection(query, lowerQuery, usageData, now, safeMaxPredictions);
        if (local.length > 0) {
            if (completions.length > 0 || packages.length > 0 || files.length > 0 || fileSearchError || weather.length > 0)
                this._resultsMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            local.forEach(row => this._addResult(row.label, row.subtitle, row.action, row.icon));
        }

        if (completions.length > 0 || packages.length > 0 || files.length > 0 || fileSearchError || weather.length > 0 || local.length > 0)
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
        const iconName = typeof icon === 'string' ? icon : 'text-x-generic-symbolic';
        const item = new PopupMenu.PopupImageMenuItem(title, iconName);
        if (icon && typeof icon !== 'string' && item?._icon && 'gicon' in item._icon)
            item._icon.gicon = icon;

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

        if (this._cacheWarmupId) {
            GLib.source_remove(this._cacheWarmupId);
            this._cacheWarmupId = null;
        }

        if (this._suggestCancellable) {
            this._suggestCancellable.cancel();
            this._suggestCancellable = null;
        }

        if (this._packageSuggestCancellable) {
            this._packageSuggestCancellable.cancel();
            this._packageSuggestCancellable = null;
        }

        if (this._fileSuggestCancellable) {
            this._fileSuggestCancellable.cancel();
            this._fileSuggestCancellable = null;
        }

        if (this._weatherSuggestCancellable) {
            this._weatherSuggestCancellable.cancel();
            this._weatherSuggestCancellable = null;
        }

        if (this._activatePackageCancellable) {
            this._activatePackageCancellable.cancel();
            this._activatePackageCancellable = null;
        }

        if (this._softwareProxyCancellable) {
            this._softwareProxyCancellable.cancel();
            this._softwareProxyCancellable = null;
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
        this._interfaceSettings = null;
        this._settings = null;
        this._searchEntry = null;
        if (this._fileSearchProvider) {
            this._fileSearchProvider.destroy();
            this._fileSearchProvider = null;
        }
        this._softwareProxy = null;
        this._softwareProxyInit = null;
        this._resultsMenuActor = null;

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

        const safePosition = Math.max(0, position);
        const childCount = typeof container.get_n_children === 'function' ? container.get_n_children() : safePosition;
        const clampedIndex = Math.min(safePosition, childCount);
        container.insert_child_at_index(this._widget, clampedIndex);
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
