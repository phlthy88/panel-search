import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { FileScanner } from './fileScanner.js';
import { fuzzyScore } from './fuzzyMatch.js';

/**
 * FileSearchProvider manages file discovery and ranking.
 */
export class FileSearchProvider {
    constructor(settings) {
        this._settings = settings;
        this._scanner = new FileScanner(GLib.get_home_dir());
    }

    _getMinQueryLength() {
        const value = this._settings?.get_int('file-search-min-query-length');
        if (!Number.isFinite(value))
            return 3;
        return Math.max(1, Math.min(20, value));
    }

    _getMaxScanDepth() {
        const value = this._settings?.get_int('file-search-max-depth');
        if (!Number.isFinite(value))
            return 2;
        return Math.max(1, Math.min(6, value));
    }

    _getMaxScanDirectories() {
        const value = this._settings?.get_int('file-search-max-directories');
        if (!Number.isFinite(value))
            return 50;
        return Math.max(10, Math.min(500, value));
    }

    /**
     * Get ranked suggestions for the query.
     * @param {string} query - The search query.
     * @param {number} maxResults - Max results to return.
     * @param {Gio.Cancellable} cancellable - Cancellable for the operation.
     * @returns {Promise<Array>} - Array of ranked suggestion objects.
     */
    async getSuggestions(query, maxResults = 10, cancellable = null) {
        if (!query || query.length < this._getMinQueryLength()) return [];

        const rawFiles = await this._scanner.scan(
            query,
            maxResults * 5,
            cancellable,
            this._getMaxScanDepth(),
            this._getMaxScanDirectories()
        );
        if (cancellable?.is_cancelled()) return [];

        const lowerQuery = query.toLowerCase();
        const ranked = rawFiles.map(file => {
            const score = fuzzyScore(lowerQuery, file.name.toLowerCase(), true);
            return { ...file, score };
        })
        .filter(f => f.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

        return ranked.map(f => ({
            label: f.name,
            subtitle: f.path,
            icon: f.icon || 'text-x-generic-symbolic',
            action: () => {
                const file = Gio.File.new_for_uri(f.uri);
                Gio.AppInfo.launch_default_for_uri(file.get_uri(), null);
            }
        }));
    }
}
