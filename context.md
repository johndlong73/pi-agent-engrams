Thorough scout complete. I've analyzed the entire repository and written detailed findings to `/Users/jlo/projects/pi.dev/pi-agent-engrams/context.md`.

**Summary:**

This is `pi-agent-engrams` - an agent memory system that lets pi agents write structured "engram" documents and semantically search them using oMLX embeddings. It's a purpose-scoped fork of `pi-knowledge-search` with frontmatter-aware indexing and dedicated write/search tools.

**Key findings:**

1. **6 source files** - `index.ts` (main extension), `config.ts` (config management), `frontmatter.ts` (YAML parsing/rendering), `embedder.ts` (Ollama-compatible API integration), `index-store.ts` (vector index), `watcher.ts` (file monitoring)

2. **Two tools exposed** - `engrams_write` (creates markdown from structured params), `engrams_search` (semantic search with metadata filters)

3. **Two commands** - `/engrams-setup` (configure oMLX), `/engrams-reindex` (force rebuild)

4. **Storage** - Documents in `~/.pi/agent/engrams/docs/`, index in `~/.pi/agent-engrams/index.json`

5. **Dependencies** - Only `yaml` package; peer deps on `@mariozechner/pi-coding-agent` and `@sinclair/typebox`

6. **No tests** - No test files or CI/CD pipeline found

7. **Documentation** - Good README, env-vars.md, and architectural docs in `MyAgenticHarnessAtHome.md`

**Architecture Notes:**

- oMLX is the primary embedding provider (Ollama-compatible API at localhost:11434)
- GitHub Model Inference is available as an alternative (Alt) configuration
- All embedding operations use the Ollama-compatible API (compatible with oMLX)
- The naming convention `OllamaConfig` and `AGENT_ENGRAMS_OLLAMA_*` env vars is retained for compatibility with the pi-knowledge-search fork