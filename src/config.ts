import * as fs from "node:fs";
import * as path from "node:path";

const HOME = process.env.HOME || "/tmp";

const ENGRAMS_DIR = path.join(HOME, ".pi", "agent", "engrams", "docs");
const INDEX_DIR = path.join(HOME, ".pi", "agent-engrams");
const FILE_EXTENSIONS = [".md"];
const EXCLUDE_DIRS = [".git", ".trash"];
const DEFAULT_DIMENSIONS = 512;
const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "nomic-embed-text";

export interface OllamaConfig {
  url: string;
  model: string;
}

export interface Config {
  engramsDir: string;
  indexDir: string;
  fileExtensions: string[];
  excludeDirs: string[];
  dimensions: number;
  ollama: OllamaConfig;
}

interface ConfigFile {
  ollama?: { url?: string; model?: string };
  dimensions?: number;
}

const CONFIG_PATH =
  process.env.AGENT_ENGRAMS_CONFIG ||
  path.join(HOME, ".pi", "agent-engrams.json");

export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Load config with hardcoded defaults and optional file/env overrides.
 * Always returns a valid Config — no setup step required.
 */
export function loadConfig(): Config {
  let file: ConfigFile | null = null;
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    } catch {
      // Corrupted file — use defaults
    }
  }

  const ollamaUrl =
    envStr("AGENT_ENGRAMS_OLLAMA_URL") ??
    file?.ollama?.url ??
    DEFAULT_OLLAMA_URL;

  const ollamaModel =
    envStr("AGENT_ENGRAMS_OLLAMA_MODEL") ??
    file?.ollama?.model ??
    DEFAULT_OLLAMA_MODEL;

  const dimensions =
    envInt("AGENT_ENGRAMS_DIMENSIONS") ??
    file?.dimensions ??
    DEFAULT_DIMENSIONS;

  return {
    engramsDir: ENGRAMS_DIR,
    indexDir: INDEX_DIR,
    fileExtensions: FILE_EXTENSIONS,
    excludeDirs: EXCLUDE_DIRS,
    dimensions,
    ollama: { url: ollamaUrl, model: ollamaModel },
  };
}

export function saveConfig(config: ConfigFile): void {
  const dir = path.dirname(CONFIG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function envStr(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

function envInt(key: string): number | undefined {
  const v = envStr(key);
  return v ? parseInt(v, 10) : undefined;
}
