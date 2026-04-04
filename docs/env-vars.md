# Environment Variable Reference

All settings can be overridden via environment variables. The config file (`~/.pi/agent-engrams.json`) is checked first, then env vars override individual fields.

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_ENGRAMS_CONFIG` | Path to config file | `~/.pi/agent-engrams.json` |
| `AGENT_ENGRAMS_DIMENSIONS` | Embedding vector dimensions | `512` |

### Ollama

| Variable | Default |
|----------|---------|
| `AGENT_ENGRAMS_OLLAMA_URL` | `http://localhost:11434` |
| `AGENT_ENGRAMS_OLLAMA_MODEL` | `nomic-embed-text` |
