import * as fs from "node:fs";
import * as path from "node:path";
import type { Config } from "./config";
import type { EngramIndex } from "./index-store";

/**
 * Watches the engrams directory for file changes and updates the index in real-time.
 * Uses Node.js fs.watch (recursive) with debouncing.
 */
export class FileWatcher {
  private config: Config;
  private index: EngramIndex;
  private watcher: fs.FSWatcher | null = null;
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private DEBOUNCE_MS = 2000;

  constructor(config: Config, index: EngramIndex) {
    this.config = config;
    this.index = index;
  }

  start(): void {
    const dir = this.config.engramsDir;
    try {
      this.watcher = fs.watch(
        dir,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename) return;
          const relPath = filename.replace(/\\/g, "/");

          const ext = path.extname(relPath);
          if (!this.config.fileExtensions.includes(ext)) return;

          const parts = relPath.split("/");
          for (const part of parts) {
            if (
              this.config.excludeDirs.includes(part) ||
              part.startsWith(".")
            ) {
              return;
            }
          }

          const absPath = path.join(dir, relPath);
          this.debounce(absPath, dir);
        }
      );

      this.watcher.on("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EACCES" || err.code === "ENOENT") return;
        console.error(
          `agent-engrams: watcher error for ${dir}: ${err.message}`
        );
      });
    } catch (err: any) {
      console.error(
        `agent-engrams: watcher failed for ${dir}: ${err.message}`
      );
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
  }

  private debounce(absPath: string, sourceDir: string): void {
    const existing = this.pending.get(absPath);
    if (existing) clearTimeout(existing);

    this.pending.set(
      absPath,
      setTimeout(async () => {
        this.pending.delete(absPath);
        try {
          if (fs.existsSync(absPath)) {
            await this.index.updateFile(absPath, sourceDir);
          } else {
            this.index.removeFile(absPath);
          }
        } catch (err: any) {
          console.error(
            `agent-engrams: watcher update failed for ${absPath}: ${err.message}`
          );
        }
      }, this.DEBOUNCE_MS)
    );
  }
}
