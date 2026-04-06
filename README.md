# pi-agent-engrams

Agent self-improvement memory system for [pi](https://github.com/badlogic/pi). When an agent learns something valuable during a task — a debugging technique, an API quirk, a domain pattern — it writes a structured **engram** document. Later, any agent can semantically search the engram store to recall relevant knowledge before starting work.

This is the **self-improvement flywheel**: the more engrams that are written, the better-informed future agents become from the start. Each engram compounds the team's collective intelligence.

## Install

```bash
pi install git:github.com/samfoy/pi-agent-engrams
```

Or try without installing:

```bash
pi -e git:github.com/samfoy/pi-agent-engrams
```

## Setup

Run the interactive setup command inside pi:

```
/engrams-setup
```

This walks you through:
1. **Engram directory** - Where engram markdown files are stored (default: `~/.pi/agent/engrams/docs`)
2. **Embedding provider** — OpenAI, AWS Bedrock, or local Ollama
3. **Embedding model** (default: `Qwen3-Embedding-0.6B-4bit-DWQ`)
4. **Embedding dimensions** (default: `512`)

Config is saved to `~/.pi/agent-engrams.json`. Run `/reload` to activate.

### Config file

You can also edit the config file directly:

```json
{
  "dir": "~/.pi/agent/engrams/docs",
  "dimensions": 512,
  "provider": {
    "type": "openai",
    "model": "Qwen3-Embedding-0.6B-4bit-DWQ"
  }
}
```

The API key for OpenAI can be set in the config file (`"apiKey": "sk-..."`) or via the `OPENAI_API_KEY` environment variable. The default **`model`** targets local OpenAI-compatible servers (e.g. omlx with `Qwen3-Embedding-0.6B-4bit-DWQ`). For **OpenAI's hosted API**, set `"model": "text-embedding-3-small"` (or another OpenAI embedding model) and ensure **`dimensions`** matches that model.

### Understanding `dimensions`

The `dimensions` field specifies the number of values in each embedding vector. Different embedding models produce different sized vectors:

| Model | Dimensions |
|-------|------------|
| `nomic-embed-text` | 768 |
| `Qwen3-Embedding-0.6B-4bit-DWQ` | 512 |
| `text-embedding-3-small` | 1536 |
| `text-embedding-3-large` | 3072 |

For OpenAI's API, you can also use the `dimensions` parameter to truncate a larger model's output to a smaller size for efficiency. The default is `512` which works well for most local embedding models.

<details>
<summary>OpenAI-compatible server (e.g. omlx)</summary>

Use the same `openai` provider with a **`baseUrl`** pointing at your server. The client uses the OpenAI embeddings API (`POST /v1/embeddings`). Set **`apiKey`** to the key your server expects (Bearer token), or omit it if the server has no API key configured.

```json
{
  "dir": "~/.pi/agent/engrams/docs",
  "dimensions": 512,
  "provider": {
    "type": "openai",
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "",
    "model": "Qwen3-Embedding-0.6B-4bit-DWQ"
  }
}
```

</details>

<details>
<summary>Bedrock config</summary>

```json
{
  "dir": "~/.pi/agent/engrams/docs",
  "dimensions": 512,
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
  "dir": "~/.pi/agent/engrams/docs",
  "dimensions": 512,
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

Every config field can be overridden via environment variables. This is useful for CI or when you want different settings per shell session. See [docs/env-vars.md](docs/env-vars.md) for the full list.

## How it works

1. On session start, loads the index from disk and incrementally syncs — only re-embeds new or modified files
2. Starts a file watcher for real-time updates (debounced, 2s)
3. Registers `engrams_write` and `engrams_search` tools the LLM can call
4. Returns ranked results with file paths, relevance scores, and content excerpts

The index is stored at `~/.pi/agent-engrams/index.json`.

### Self-improvement flywheel

```
┌─────────────────────────────────────────────────────────────────┐
│                    THE FLYWHEEL                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. WRITE: Agent learns something valuable                    │
│     ↓                                                           │
│  2. INDEX: Engram is embedded and added to vector store       │
│     ↓                                                           │
│  3. RECALL: Next agent searches for relevant knowledge        │
│     ↓                                                           │
│  4. IMPROVE: Agent makes better decisions from prior insights │
│     ↓                                                           │
│  (Loop back to step 1 - knowledge compounds over time)        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight:** The more tasks agents complete, the more engrams accumulate, and the better-informed future agents become from the start. This creates a compounding effect where the team's collective intelligence grows with each session.

## Tools

### `engrams_write`

**The WRITE phase of the self-improvement flywheel.** Creates a new engram document from structured parameters. The agent provides title, category, tags, durability, context, insight, trigger/anti-trigger, and the tool renders and saves the markdown file.

**When to use:** Call this when you discover something non-obvious during a task that future agents (or your future self) should know. This is how the team learns and improves over time.

**Good candidates:** debugging breakthroughs, API quirks, domain constraints, architectural decisions, performance findings, testing patterns, integration patterns, deployment gotchas.

**Bad candidates:** trivial facts, information already in documentation, one-time configuration values, obvious best practices.

### `engrams_search`

**The RECALL phase of the self-improvement flywheel.** Semantic search with optional metadata filters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Natural language search query |
| `limit` | number | Max results (default 8, max 20) |
| `category` | string | Filter by category |
| `agent` | string | Filter by authoring agent |
| `durability` | string | Filter by durability level |
| `tags` | string[] | Filter by tags (match any) |

**When to use:** Call this at the START of a task to recall relevant prior knowledge from the team's collective memory. This helps you avoid rediscovering what others have already learned.

## Commands

| Command | Description |
|---------|-------------|
| `/engrams-setup` | Interactive setup wizard |
| `/engrams-reindex` | Force a full re-index |

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