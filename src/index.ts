import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import {
  loadConfig,
  saveConfig,
  getConfigPath,
  type Config,
  type ConfigFile,
} from "./config";
import { createEmbedder } from "./embedder";
import { KnowledgeIndex } from "./index-store";
import { FileWatcher } from "./watcher";

export default function (pi: ExtensionAPI) {
  let index: KnowledgeIndex | null = null;
  let watcher: FileWatcher | null = null;
  let currentConfig: Config | null = null;

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    try {
      currentConfig = loadConfig();
    } catch (err: any) {
      ctx.ui.notify(`knowledge-search: ${err.message}`, "warning");
      return;
    }

    if (!currentConfig) {
      // Not configured yet — silent, user can run /knowledge-search-setup
      return;
    }

    await startIndex(currentConfig, ctx);
  });

  pi.on("session_shutdown", async () => {
    watcher?.stop();
  });

  async function startIndex(config: Config, ctx: any) {
    try {
      const embedder = createEmbedder(config.provider, config.dimensions);
      index = new KnowledgeIndex(config, embedder);
      await index.load();

      const { added, updated, removed } = await index.sync();
      const changes = added + updated + removed;
      if (changes > 0) {
        ctx.ui.setStatus(
          "knowledge-search",
          `Index: +${added} ~${updated} -${removed} (${index.size()} files)`
        );
        setTimeout(() => ctx.ui.setStatus("knowledge-search", ""), 5000);
      }

      watcher = new FileWatcher(config, index);
      watcher.start();
    } catch (err: any) {
      ctx.ui.notify(`knowledge-search init failed: ${err.message}`, "error");
    }
  }

  // ------------------------------------------------------------------
  // Setup command
  // ------------------------------------------------------------------

  pi.registerCommand("knowledge-search-setup", {
    description: "Configure knowledge search directories and embedding provider",
    handler: async (_args, ctx) => {
      // Step 1: Directories
      const dirsInput = await ctx.ui.input(
        "Directories to index (comma-separated):",
        "~/notes, ~/docs"
      );
      if (!dirsInput) {
        ctx.ui.notify("Setup cancelled.", "info");
        return;
      }

      const dirs = dirsInput
        .split(",")
        .map((d: string) => d.trim())
        .filter(Boolean);

      if (dirs.length === 0) {
        ctx.ui.notify("No directories specified.", "warning");
        return;
      }

      // Step 2: File extensions
      const extsInput = await ctx.ui.input(
        "File extensions to index:",
        ".md, .txt"
      );
      const fileExtensions = (extsInput || ".md, .txt")
        .split(",")
        .map((e: string) => e.trim())
        .filter(Boolean);

      // Step 3: Exclude directories
      const excludeInput = await ctx.ui.input(
        "Directory names to exclude:",
        "node_modules, .git, .obsidian, .trash"
      );
      const excludeDirs = (
        excludeInput || "node_modules, .git, .obsidian, .trash"
      )
        .split(",")
        .map((d: string) => d.trim())
        .filter(Boolean);

      // Step 4: Provider
      const providerChoice = await ctx.ui.select("Embedding provider:", [
        "openai — OpenAI API (text-embedding-3-small)",
        "bedrock — AWS Bedrock (Titan Embeddings v2)",
        "ollama — Local Ollama (nomic-embed-text)",
      ]);

      if (!providerChoice) {
        ctx.ui.notify("Setup cancelled.", "info");
        return;
      }

      const providerType = providerChoice.split(" ")[0] as
        | "openai"
        | "bedrock"
        | "ollama";

      let configFile: ConfigFile;

      switch (providerType) {
        case "openai": {
          const apiKey = await ctx.ui.input(
            "OpenAI API key (or env var name):",
            process.env.OPENAI_API_KEY ? "(using OPENAI_API_KEY from env)" : ""
          );
          const model = await ctx.ui.input(
            "Model:",
            "text-embedding-3-small"
          );
          configFile = {
            dirs,
            fileExtensions,
            excludeDirs,
            provider: {
              type: "openai",
              apiKey: apiKey?.startsWith("(") ? undefined : apiKey || undefined,
              model: model || "text-embedding-3-small",
            },
          };
          break;
        }
        case "bedrock": {
          const profile = await ctx.ui.input("AWS profile:", "default");
          const region = await ctx.ui.input("AWS region:", "us-east-1");
          const model = await ctx.ui.input(
            "Model:",
            "amazon.titan-embed-text-v2:0"
          );
          configFile = {
            dirs,
            fileExtensions,
            excludeDirs,
            provider: {
              type: "bedrock",
              profile: profile || "default",
              region: region || "us-east-1",
              model: model || "amazon.titan-embed-text-v2:0",
            },
          };
          break;
        }
        case "ollama": {
          const url = await ctx.ui.input(
            "Ollama URL:",
            "http://localhost:11434"
          );
          const model = await ctx.ui.input("Model:", "nomic-embed-text");
          configFile = {
            dirs,
            fileExtensions,
            excludeDirs,
            provider: {
              type: "ollama",
              url: url || "http://localhost:11434",
              model: model || "nomic-embed-text",
            },
          };
          break;
        }
      }

      // Save and confirm
      saveConfig(configFile!);
      ctx.ui.notify(
        `Config saved to ${getConfigPath()}. Run /reload to activate.`,
        "success"
      );
    },
  });

  // ------------------------------------------------------------------
  // Reindex command
  // ------------------------------------------------------------------

  pi.registerCommand("knowledge-reindex", {
    description: "Force full re-index of all configured knowledge directories",
    handler: async (_args, ctx) => {
      if (!index) {
        ctx.ui.notify(
          "Not configured. Run /knowledge-search-setup first.",
          "warning"
        );
        return;
      }
      ctx.ui.notify("Re-indexing...", "info");
      try {
        await index.rebuild();
        ctx.ui.notify(`Re-indexed: ${index.size()} files`, "success");
      } catch (err: any) {
        ctx.ui.notify(`Re-index failed: ${err.message}`, "error");
      }
    },
  });

  // ------------------------------------------------------------------
  // Search tool
  // ------------------------------------------------------------------

  pi.registerTool({
    name: "knowledge_search",
    label: "Knowledge Search",
    description:
      "Semantic search over local knowledge files. Returns the most relevant file excerpts for a natural language query. Use for finding past notes, investigations, decisions, documentation, and context. Prefer this over grep when you need conceptual or fuzzy matching rather than exact text.",
    promptGuidelines: [
      'Use knowledge_search for conceptual queries (e.g. "how did we handle X", "what was decided about Y"). Use grep/read for exact text or known filenames.',
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Natural language search query" }),
      limit: Type.Optional(
        Type.Number({
          description: "Max results to return (default 8, max 20)",
        })
      ),
    }),
    async execute(toolCallId, params, signal) {
      if (!index || index.size() === 0) {
        const msg = !index
          ? 'knowledge-search is not configured. The user can run /knowledge-search-setup to set it up.'
          : "Index is empty — it may still be building. Try again in a moment.";
        return { content: [{ type: "text", text: msg }], details: {} };
      }

      const limit = Math.min(params.limit ?? 8, 20);

      try {
        const results = await index.search(params.query, limit, signal);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No relevant results found for: "${params.query}"`,
              },
            ],
            details: {},
          };
        }

        const home = process.env.HOME || "";
        const output = results
          .map((r, i) => {
            const displayPath = r.path.replace(home, "~");
            const score = (r.score * 100).toFixed(1);
            return `### ${i + 1}. ${displayPath} (${score}% match)\n\n${r.excerpt}`;
          })
          .join("\n\n---\n\n");

        const header = `Found ${results.length} results for "${params.query}" (${index.size()} files indexed):\n\n`;

        return {
          content: [{ type: "text", text: header + output }],
          details: { resultCount: results.length, indexSize: index.size() },
        };
      } catch (err: any) {
        throw new Error(`knowledge-search failed: ${err.message}`);
      }
    },
  });
}
