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

    /**
     * Get ranked suggestions for the query.
     * @param {string} query - The search query.
     * @param {number} maxResults - Max results to return.
     * @param {Gio.Cancellable} cancellable - Cancellable for the operation.
     * @returns {Promise<Array>} - Array of ranked suggestion objects.
     */
    async getSuggestions(query, maxResults = 10, cancellable = null) {
        if (!query || query.length < 3) return [];

        const rawFiles = await this._scanner.scan(query, maxResults * 5, cancellable, 2, 50);
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
