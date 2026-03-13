# pi-knowledge-search

Semantic search over local files for [pi](https://github.com/badlogic/pi). Indexes directories of text/markdown files using vector embeddings, watches for changes in real-time, and exposes a `knowledge_search` tool the LLM can call.

## Install

```bash
pi install git:github.com/samfperry/pi-knowledge-search
```

Or try without installing:

```bash
pi -e git:github.com/samfperry/pi-knowledge-search
```

## Setup

Run the interactive setup command inside pi:

```
/knowledge-search-setup
```

This walks you through:
1. **Directories** to index (comma-separated paths)
2. **File extensions** to include (default: `.md, .txt`)
3. **Directories to exclude** (default: `node_modules, .git, .obsidian, .trash`)
4. **Embedding provider** — OpenAI, AWS Bedrock, or local Ollama

Config is saved to `~/.pi/knowledge-search.json`. Run `/reload` to activate.

### Config file

You can also edit the config file directly:

```json
{
  "dirs": ["~/notes", "~/docs"],
  "fileExtensions": [".md", ".txt"],
  "excludeDirs": ["node_modules", ".git", ".obsidian", ".trash"],
  "provider": {
    "type": "openai",
    "model": "text-embedding-3-small"
  }
}
```

The API key for OpenAI can be set in the config file (`"apiKey": "sk-..."`) or via the `OPENAI_API_KEY` environment variable.

<details>
<summary>Bedrock config</summary>

```json
{
  "dirs": ["~/vault"],
  "provider": {
    "type": "bedrock",
    "profile": "my-aws-profile",
    "region": "us-west-2",
    "model": "amazon.titan-embed-text-v2:0"
  }
}
```

Requires the AWS SDK and valid credentials for the specified profile.

</details>

<details>
<summary>Ollama config (free, local)</summary>

```json
{
  "dirs": ["~/notes"],
  "provider": {
    "type": "ollama",
    "url": "http://localhost:11434",
    "model": "nomic-embed-text"
  }
}
```

Requires [Ollama](https://ollama.ai) running locally:
```bash
ollama serve
ollama pull nomic-embed-text
```

</details>

### Environment variable overrides

Every config field can be overridden via environment variables. This is useful for CI or when you want different settings per shell session. See [env-vars.md](docs/env-vars.md) for the full list.

## How it works

1. On session start, loads the index from disk and incrementally syncs — only re-embeds new or modified files
2. Starts a file watcher for real-time updates (debounced, 2s)
3. Registers a `knowledge_search` tool the LLM calls with natural language queries
4. Returns ranked results with file paths, relevance scores, and content excerpts

The index is stored at `~/.pi/knowledge-search/index.json`.

## Commands

| Command | Description |
|---------|-------------|
| `/knowledge-search-setup` | Interactive setup wizard |
| `/knowledge-reindex` | Force a full re-index |

## Performance

Typical numbers for ~500 markdown files (~20MB):

| Operation | Time |
|-----------|------|
| Full index build | ~7s |
| Incremental sync (no changes) | ~12ms |
| File re-embed (watcher) | ~200ms |
| Search query | ~250ms |
| Index file size | ~5MB |

## License

MIT
