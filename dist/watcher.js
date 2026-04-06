import * as fs from 'node:fs';
import * as path from 'node:path';
/**
 * Watches the engrams directory for file changes and updates the index in real-time.
 * Uses Node.js fs.watch (recursive) with debouncing.
 */
export class FileWatcher {
    config;
    index;
    watcher = null;
    pending = new Map();
    DEBOUNCE_MS = 2000;
    constructor(config, index) {
        this.config = config;
        this.index = index;
    }
    start() {
        const dir = this.config.dir;
        try {
            this.watcher = fs.watch(dir, { recursive: true }, (_eventType, filename) => {
                if (!filename)
                    return;
                const relPath = filename.replace(/\\/g, '/');
                const ext = path.extname(relPath);
                if (ext !== '.md')
                    return;
                const parts = relPath.split('/');
                for (const part of parts) {
                    if (part.startsWith('.')) {
                        return;
                    }
                }
                const absPath = path.join(dir, relPath);
                this.debounce(absPath, dir);
            });
            this.watcher.on('error', (err) => {
                if (err.code === 'EACCES' || err.code === 'ENOENT')
                    return;
                console.error(`agent-engrams: watcher error for ${dir}: ${err.message}`);
            });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`agent-engrams: watcher failed for ${dir}: ${msg}`);
        }
    }
    stop() {
        this.watcher?.close();
        this.watcher = null;
        for (const timer of this.pending.values()) {
            clearTimeout(timer);
        }
        this.pending.clear();
    }
    debounce(absPath, sourceDir) {
        const existing = this.pending.get(absPath);
        if (existing)
            clearTimeout(existing);
        this.pending.set(absPath, setTimeout(async () => {
            this.pending.delete(absPath);
            try {
                if (fs.existsSync(absPath)) {
                    await this.index.updateFile(absPath, sourceDir);
                }
                else {
                    this.index.removeFile(absPath);
                }
            }
            catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`agent-engrams: watcher update failed for ${absPath}: ${msg}`);
            }
        }, this.DEBOUNCE_MS));
    }
}
//# sourceMappingURL=watcher.js.map