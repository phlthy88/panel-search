import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import { fuzzyScore } from './fuzzyMatch.js';

/**
 * FileScanner performs asynchronous directory traversal using GIO.
 */
export class FileScanner {
    constructor(rootPath) {
        this.root = Gio.File.new_for_path(rootPath);
    }

    /**
     * Scan the directory for files matching the query.
     * @param {string} query - The search query.
     * @param {number} maxResults - Maximum number of results to return.
     * @param {Gio.Cancellable} cancellable - Cancellable for the operation.
     * @returns {Promise<Array>} - Array of file results.
     */
    async scan(query, maxResults = 10, cancellable = null, maxDepth = 3, maxDirs = 100) {
        const results = [];
        const lowerQuery = query.toLowerCase();
        const state = { dirsScanned: 0 };

        try {
            await this._enumerateRecursive(this.root, lowerQuery, results, maxResults, cancellable, 0, maxDepth, state, maxDirs);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                console.error('FileScanner: Scan failed:', e);
            }
        }

        return results;
    }

    async _enumerateRecursive(directory, lowerQuery, results, maxResults, cancellable, currentDepth, maxDepth, state, maxDirs) {
        if (cancellable?.is_cancelled()) return;
        if (currentDepth > maxDepth) return;
        if (state.dirsScanned >= maxDirs) return;

        state.dirsScanned++;

        let enumerator = null;
        try {
            enumerator = await new Promise((resolve, reject) => {
                directory.enumerate_children_async(
                    'standard::name,standard::type,standard::icon',
                    Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (obj, res) => {
                        try {
                            resolve(obj.enumerate_children_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                throw e;
            }

            const path = directory.get_path() || directory.get_uri();
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND)) {
                console.debug(`FileScanner: Skipping missing directory ${path}:`, e.message);
            } else {
                console.warn(`FileScanner: Could not enumerate directory ${path}:`, e.message);
            }

            return;
        }

        try {
            while (true) {
                if (cancellable?.is_cancelled()) break;

                let infos;
                try {
                    infos = await new Promise((resolve, reject) => {
                        enumerator.next_files_async(
                            10,
                            GLib.PRIORITY_DEFAULT,
                            cancellable,
                            (obj, res) => {
                                try {
                                    resolve(obj.next_files_finish(res));
                                } catch (e) {
                                    reject(e);
                                }
                            }
                        );
                    });
                } catch (e) {
                    if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        throw e;
                    }

                    const path = directory.get_path() || directory.get_uri();
                    console.warn(`FileScanner: Could not continue enumerating ${path}:`, e.message);
                    break;
                }

                if (infos.length === 0) break;

                for (const info of infos) {
                    const name = info.get_name();
                    const type = info.get_file_type();
                    const child = directory.get_child(name);

                    if (type === Gio.FileType.DIRECTORY) {
                        // Skip hidden directories like .git
                        if (!name.startsWith('.')) {
                            await this._enumerateRecursive(child, lowerQuery, results, maxResults, cancellable, currentDepth + 1, maxDepth, state, maxDirs);
                        }
                    } else if (type === Gio.FileType.REGULAR) {
                        const lowerName = name.toLowerCase();
                        const score = fuzzyScore(lowerQuery, lowerName, true);

                        if (score > 0) {
                            this._pushResultByScore(results, {
                                name: name,
                                path: child.get_path(),
                                uri: child.get_uri(),
                                icon: info.get_icon(),
                                score
                            }, maxResults);
                        }
                    }
                }
            }
        } finally {
            if (enumerator) {
                await new Promise((resolve, reject) => {
                    enumerator.close_async(GLib.PRIORITY_DEFAULT, cancellable, (obj, res) => {
                        try {
                            resolve(obj.close_finish(res));
                        } catch (e) {
                            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                                reject(e);
                                return;
                            }

                            const path = directory.get_path() || directory.get_uri();
                            console.debug(`FileScanner: Failed to close enumerator for ${path}:`, e.message);
                            resolve(false);
                        }
                    });
                }
                );
            }
        }
    }

    destroy() {
        this.root = null;
    }

    _pushResultByScore(results, entry, maxResults) {
        let insertAt = results.length;
        for (let i = 0; i < results.length; i++) {
            if (entry.score > results[i].score) {
                insertAt = i;
                break;
            }
        }

        if (insertAt === results.length)
            results.push(entry);
        else
            results.splice(insertAt, 0, entry);

        if (results.length > maxResults)
            results.pop();
    }
}
