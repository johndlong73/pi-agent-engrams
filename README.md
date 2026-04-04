# pi-agent-engrams

Agent memory system for [pi](https://github.com/badlogic/pi). When an agent learns something valuable during a task — a debugging technique, an API quirk, a domain pattern — it writes a structured **engram** document. Later, any agent can semantically search the engram store to recall relevant knowledge before starting work.

Built as a purpose-scoped fork of [pi-knowledge-search](https://github.com/samfoy/pi-knowledge-search) with frontmatter-aware indexing, metadata filtering, and dedicated read/write tools.

## Install

```bash
pi install git:github.com/samfoy/pi-agent-engrams
```

### Prerequisites

[Ollama](https://ollama.ai) must be running locally with an embedding model pulled:

```bash
ollama serve
ollama pull nomic-embed-text
```

## How it works

**Write cycle (learning):**

1. An agent encounters something worth remembering — a non-obvious fix, a domain constraint, an API behavior
2. The agent calls `engrams_write` with structured content (title, category, tags, insight, etc.)
3. The tool renders a markdown file from a template and writes it to `~/.pi/agent/engrams/docs/`
4. The file watcher detects the new file, generates an embedding via Ollama, and adds it to the vector index

**Read cycle (recall):**

1. An agent starting a new task calls `engrams_search` with a natural language query
2. The query is embedded and compared against the engram index using cosine similarity
3. Optional metadata filters (category, agent, durability, tags) narrow the results
4. Ranked results with relevance scores, content excerpts, and metadata are returned

## Engram document template

Each engram follows a structured markdown template:

```markdown
---
Category: debugging
Tags: timeout, api, retry
Durability: permanent
Agent: backend-software-engineer
Date: 2025-03-15
Source: PROJ-1234
---

# Retry logic must respect upstream rate limits

## Context

What situation triggered this learning?

## Insight

What was learned? What is the non-obvious part?

## Application

**Trigger:** specific conditions when this engram is relevant
**Anti-trigger:** conditions when this engram should NOT be applied

## Supersedes

None
```

### Metadata fields

| Field | Values | Purpose |
|-------|--------|---------|
| Category | `debugging`, `api`, `architecture`, `tooling`, `domain`, `performance`, `testing` | Primary classification |
| Tags | Comma-separated keywords | Discoverability |
| Durability | `permanent`, `workaround`, `hypothesis` | Trust level — permanent is verified, workaround is temporary, hypothesis is unverified |
| Agent | Agent name | Authorship tracking |
| Date | ISO date | When the engram was created |
| Source | Ticket key, PR URL, or description | What triggered the learning |

## Tools

### `engrams_write`

Creates a new engram document from structured parameters. The agent provides title, category, tags, durability, context, insight, trigger/anti-trigger, and the tool renders and saves the markdown file.

### `engrams_search`

Semantic search with optional metadata filters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `query` | string | Natural language search query |
| `limit` | number | Max results (default 8, max 20) |
| `category` | string | Filter by category |
| `agent` | string | Filter by authoring agent |
| `durability` | string | Filter by durability level |
| `tags` | string[] | Filter by tags (match any) |

## Commands

| Command | Description |
|---------|-------------|
| `/engrams-setup` | Configure Ollama connection (URL, model, dimensions) |
| `/engrams-reindex` | Force a full re-index of all engram documents |

## Configuration

Works out of the box with zero configuration if Ollama is running on localhost with `nomic-embed-text`.

Optional config file at `~/.pi/agent-engrams.json`:

```json
{
  "ollama": {
    "url": "http://localhost:11434",
    "model": "nomic-embed-text"
  },
  "dimensions": 512
}
```

All settings can be overridden via environment variables. See [docs/env-vars.md](docs/env-vars.md).

## Storage

- Engram documents: `~/.pi/agent/engrams/docs/`
- Vector index: `~/.pi/agent-engrams/index.json`
- Config file: `~/.pi/agent-engrams.json`

## License

MIT
