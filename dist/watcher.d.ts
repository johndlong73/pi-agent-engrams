import type { Config } from './config';
import type { EngramIndex } from './index-store';
/**
 * Watches the engrams directory for file changes and updates the index in real-time.
 * Uses Node.js fs.watch (recursive) with debouncing.
 */
export declare class FileWatcher {
    private config;
    private index;
    private watcher;
    private pending;
    private DEBOUNCE_MS;
    constructor(config: Config, index: EngramIndex);
    start(): void;
    stop(): void;
    private debounce;
}
//# sourceMappingURL=watcher.d.ts.map