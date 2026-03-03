import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { FileScanner } from './fileScanner.js';

/**
 * FileSearchProvider manages file discovery and ranking.
 */
export class FileSearchProvider {
    constructor(settings) {
        this._settings = settings;
        this._scanner = new FileScanner(GLib.get_home_dir());
        this._scannerRootPath = GLib.get_home_dir();
    }

    _getMaxScanDepth() {
        let value;
        try {
            value = this._settings?.get_int?.('file-search-max-depth');
        } catch (_e) {
            return 2;
        }
        if (!Number.isFinite(value))
            return 2;
        return Math.max(1, Math.min(6, value));
    }

    _getMaxScanDirectories() {
        let value;
        try {
            value = this._settings?.get_int?.('file-search-max-directories');
        } catch (_e) {
            return 50;
        }
        if (!Number.isFinite(value))
            return 50;
        return Math.max(10, Math.min(500, value));
    }

    _getConfiguredRootPath() {
        let rawPath;
        try {
            rawPath = this._settings?.get_string?.('file-search-root-path');
        } catch (_e) {
            return null;
        }
        if (typeof rawPath !== 'string')
            return null;
        const normalized = rawPath.trim();
        return normalized.length > 0 ? normalized : null;
    }

    _getActiveRootPath() {
        const configured = this._getConfiguredRootPath();
        if (!configured)
            return GLib.get_home_dir();
        return GLib.path_is_absolute(configured)
            ? configured
            : GLib.build_filenamev([GLib.get_home_dir(), configured]);
    }

    _getScanner() {
        const rootPath = this._getActiveRootPath();
        if (!this._scanner || this._scannerRootPath !== rootPath) {
            this._scanner = new FileScanner(rootPath);
            this._scannerRootPath = rootPath;
        }
        return this._scanner;
    }

    /**
     * Get ranked suggestions for the query.
     * @param {string} query - The search query.
     * @param {number} maxResults - Max results to return.
     * @param {Gio.Cancellable} cancellable - Cancellable for the operation.
     * @returns {Promise<Array>} - Array of ranked suggestion objects.
     */
    async getSuggestions(query, maxResults = 10, cancellable = null) {
        if (!query) return [];

        const rawFiles = await this._getScanner().scan(
            query,
            maxResults * 5,
            cancellable,
            this._getMaxScanDepth(),
            this._getMaxScanDirectories()
        );
        if (cancellable?.is_cancelled()) return [];

        const ranked = rawFiles.slice(0, maxResults);

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

    destroy() {
        if (this._scanner) {
            this._scanner.destroy();
            this._scanner = null;
        }

        this._settings = null;
        this._scannerRootPath = null;
    }
}
