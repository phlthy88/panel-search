import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

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
    async scan(query, maxResults = 10, cancellable = null) {
        const results = [];
        const lowerQuery = query.toLowerCase();

        try {
            await this._enumerateRecursive(this.root, lowerQuery, results, maxResults, cancellable);
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                console.error('FileScanner: Scan failed:', e);
            }
        }

        return results;
    }

    async _enumerateRecursive(directory, lowerQuery, results, maxResults, cancellable) {
        if (cancellable?.is_cancelled()) return;
        if (results.length >= maxResults) return;

        const enumerator = await new Promise((resolve, reject) => {
            directory.enumerate_children_async(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
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

        while (true) {
            if (cancellable?.is_cancelled()) break;
            if (results.length >= maxResults) break;

            const infos = await new Promise((resolve, reject) => {
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

            if (infos.length === 0) break;

            for (const info of infos) {
                const name = info.get_name();
                const type = info.get_file_type();
                const child = directory.get_child(name);

                if (type === Gio.FileType.DIRECTORY) {
                    // Skip hidden directories like .git
                    if (!name.startsWith('.')) {
                        await this._enumerateRecursive(child, lowerQuery, results, maxResults, cancellable);
                    }
                } else if (type === Gio.FileType.REGULAR) {
                    if (name.toLowerCase().includes(lowerQuery)) {
                        results.push({
                            name: name,
                            path: child.get_path(),
                            uri: child.get_uri()
                        });
                    }
                }

                if (results.length >= maxResults) break;
            }
        }

        await new Promise((resolve, reject) => {
            enumerator.close_async(GLib.PRIORITY_DEFAULT, cancellable, (obj, res) => {
                try {
                    resolve(obj.close_finish(res));
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}
