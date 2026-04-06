import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Config } from './config';
import type { Embedder } from './embedder';
import { parseFrontmatter, type EngramMetadata } from './frontmatter';

interface IndexEntry {
  relPath: string;
  sourceDir: string;
  mtime: number;
  vector: number[];
  excerpt: string;
  metadata: EngramMetadata;
}

interface IndexData {
  version: number;
  dimensions: number;
  entries: Record<string, IndexEntry>;
}

export interface SearchFilters {
  category?: string;
  agent?: string;
  durability?: string;
  tags?: string[];
}

export interface SearchResult {
  path: string;
  score: number;
  excerpt: string;
  metadata: EngramMetadata;
}

const INDEX_VERSION = 3;
const EXCERPT_LENGTH = 2000;

export class EngramIndex {
  private config: Config;
  private embedder: Embedder;
  private data: IndexData;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Config, embedder: Embedder) {
    this.config = config;
    this.embedder = embedder;
    this.data = {
      version: INDEX_VERSION,
      dimensions: config.dimensions,
      entries: {},
    };
  }

  size(): number {
    return Object.keys(this.data.entries).length;
  }

  async load(): Promise<void> {
    const indexFile = path.join(this.config.indexDir, 'index.json');
    if (fs.existsSync(indexFile)) {
      try {
        const raw = fs.readFileSync(indexFile, 'utf-8');
        const parsed = JSON.parse(raw) as IndexData;
        if (parsed.version === INDEX_VERSION && parsed.dimensions === this.config.dimensions) {
          this.data = parsed;
        }
      } catch {
        // Corrupted — start fresh
      }
    }
  }

  private save(): void {
    fs.mkdirSync(this.config.indexDir, { recursive: true });
    const indexFile = path.join(this.config.indexDir, 'index.json');
    fs.writeFileSync(indexFile, JSON.stringify(this.data));
    this.dirty = false;
  }

  scheduleSave(): void {
    if (this.saveTimer) return;
    this.dirty = true;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) this.save();
    }, 5000);
  }

  async sync(): Promise<{ added: number; updated: number; removed: number }> {
    const allFiles = this.scanAllFiles();
    const currentPaths = new Set(allFiles.map(f => f.absPath));

    const removedPaths: string[] = [];
    for (const absPath of Object.keys(this.data.entries)) {
      if (!currentPaths.has(absPath)) {
        removedPaths.push(absPath);
      }
    }
    for (const p of removedPaths) {
      delete this.data.entries[p];
    }

    const toEmbed: {
      absPath: string;
      relPath: string;
      sourceDir: string;
      mtime: number;
      content: string;
      metadata: EngramMetadata;
    }[] = [];

    for (const file of allFiles) {
      const existing = this.data.entries[file.absPath];
      if (!existing || existing.mtime < file.mtime) {
        const result = this.readAndParseFile(file.absPath);
        if (result && result.content.trim().length > 20) {
          toEmbed.push({ ...file, content: result.content, metadata: result.metadata });
        }
      }
    }

    let added = 0;
    let updated = 0;

    if (toEmbed.length > 0) {
      const texts = toEmbed.map(f => {
        const title = f.relPath.replace(/\.[^.]+$/, '').replace(/\//g, ' > ');
        return `Title: ${title}\n\n${f.content}`;
      });

      const BATCH_SIZE = 50;
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batchTexts = texts.slice(i, i + BATCH_SIZE);
        const batchFiles = toEmbed.slice(i, i + BATCH_SIZE);
        const vectors = await this.embedder.embedBatch(batchTexts);

        for (let j = 0; j < batchFiles.length; j++) {
          const vector = vectors[j];
          if (!vector) continue;
          const file = batchFiles[j];
          const isNew = !this.data.entries[file.absPath];
          this.data.entries[file.absPath] = {
            relPath: file.relPath,
            sourceDir: file.sourceDir,
            mtime: file.mtime,
            vector,
            excerpt: file.content.slice(0, EXCERPT_LENGTH),
            metadata: file.metadata,
          };
          if (isNew) added++;
          else updated++;
        }
      }
    }

    const removed = removedPaths.length;
    if (added + updated + removed > 0) {
      this.save();
    }

    return { added, updated, removed };
  }

  async rebuild(): Promise<void> {
    this.data.entries = {};
    await this.sync();
  }

  async search(
    query: string,
    limit: number,
    filters?: SearchFilters,
    signal?: AbortSignal
  ): Promise<SearchResult[]> {
    const queryVector = await this.embedder.embed(query, signal);

    const scored: { absPath: string; score: number }[] = [];
    for (const [absPath, entry] of Object.entries(this.data.entries)) {
      if (!entry.vector) continue;
      if (filters && !matchesFilters(entry.metadata, filters)) continue;
      const score = dotProduct(queryVector, entry.vector);
      scored.push({ absPath, score });
    }

    scored.sort((a, b) => b.score - a.score);

    return scored
      .slice(0, limit)
      .filter(s => s.score > 0.15)
      .map(s => ({
        path: s.absPath,
        score: s.score,
        excerpt: this.data.entries[s.absPath].excerpt,
        metadata: this.data.entries[s.absPath].metadata,
      }));
  }

  async updateFile(absPath: string, sourceDir: string): Promise<void> {
    if (!fs.existsSync(absPath)) {
      this.removeFile(absPath);
      return;
    }

    const relPath = path.relative(sourceDir, absPath);
    if (this.shouldSkip(relPath, path.basename(absPath))) return;

    const stat = fs.statSync(absPath);
    const result = this.readAndParseFile(absPath);
    if (!result || result.content.trim().length <= 20) {
      this.removeFile(absPath);
      return;
    }

    const title = relPath.replace(/\.[^.]+$/, '').replace(/\//g, ' > ');
    const text = `Title: ${title}\n\n${result.content}`;
    const vector = await this.embedder.embed(text);

    if (!vector) return;

    this.data.entries[absPath] = {
      relPath,
      sourceDir,
      mtime: stat.mtimeMs,
      vector,
      excerpt: result.content.slice(0, EXCERPT_LENGTH),
      metadata: result.metadata,
    };
    this.scheduleSave();
  }

  removeFile(absPath: string): void {
    if (this.data.entries[absPath]) {
      delete this.data.entries[absPath];
      this.scheduleSave();
    }
  }

  // -----------------------------------------------------------------------
  // Scanning
  // -----------------------------------------------------------------------

  private scanAllFiles(): {
    absPath: string;
    relPath: string;
    sourceDir: string;
    mtime: number;
  }[] {
    const results: {
      absPath: string;
      relPath: string;
      sourceDir: string;
      mtime: number;
    }[] = [];

    this.walkDir(this.config.dir, this.config.dir, results);
    return results;
  }

  private walkDir(
    currentDir: string,
    sourceDir: string,
    results: {
      absPath: string;
      relPath: string;
      sourceDir: string;
      mtime: number;
    }[]
  ): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) {
          continue;
        }
        this.walkDir(absPath, sourceDir, results);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (ext !== '.md') continue;
        const relPath = path.relative(sourceDir, absPath);
        if (this.shouldSkip(relPath, entry.name)) continue;
        try {
          const stat = fs.statSync(absPath);
          results.push({ absPath, relPath, sourceDir, mtime: stat.mtimeMs });
        } catch {
          // Skip unreadable
        }
      }
    }
  }

  private shouldSkip(relPath: string, _basename: string): boolean {
    const parts = relPath.split(path.sep);
    for (const part of parts) {
      if (part.startsWith('.')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Read a file and parse its frontmatter. Returns the full raw content
   * (frontmatter included) for embedding, plus the parsed metadata.
   */
  private readAndParseFile(absPath: string): { content: string; metadata: EngramMetadata } | null {
    try {
      const raw = fs.readFileSync(absPath, 'utf-8');
      const { metadata } = parseFrontmatter(raw);
      return { content: raw, metadata };
    } catch {
      return null;
    }
  }
}

function matchesFilters(metadata: EngramMetadata, filters: SearchFilters): boolean {
  if (filters.category && metadata.category !== filters.category) return false;
  if (filters.agent && metadata.agent !== filters.agent) return false;
  if (filters.durability && metadata.durability !== filters.durability) return false;
  if (filters.tags && filters.tags.length > 0) {
    const entryTags = new Set(metadata.tags ?? []);
    const hasAny = filters.tags.some(t => entryTags.has(t));
    if (!hasAny) return false;
  }
  return true;
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}
