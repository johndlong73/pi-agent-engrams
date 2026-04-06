# Environment Variable Reference

All settings can be overridden via environment variables. The config file (`~/.pi/agent-engrams.json`) is checked first, then env vars override individual fields.

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENT_ENGRAMS_CONFIG` | Path to config file | `~/.pi/agent-engrams.json` |
| `AGENT_ENGRAMS_DIR` | Engram documents directory | `~/.pi/agent/engrams/docs` |
| `AGENT_ENGRAMS_DIMENSIONS` | Embedding vector dimensions | `512` |
| `AGENT_ENGRAMS_PROVIDER` | Embedding provider type | `openai` |

### OpenAI Provider

| Variable | Default |
|----------|---------|
| `AGENT_ENGRAMS_OPENAI_BASE_URL` | `http://localhost:11434/v1` |
| `AGENT_ENGRAMS_OPENAI_API_KEY` | (from config or `OPENAI_API_KEY`) |
| `AGENT_ENGRAMS_OPENAI_MODEL` | `Qwen3-Embedding-0.6B-4bit-DWQ` |

### Bedrock Provider

| Variable | Default |
|----------|---------|
| `AGENT_ENGRAMS_BEDROCK_PROFILE` | `default` |
| `AGENT_ENGRAMS_BEDROCK_REGION` | `us-east-1` |
| `AGENT_ENGRAMS_BEDROCK_MODEL` | `amazon.titan-embed-text-v2:0` |

### Ollama Provider

| Variable | Default |
|----------|---------|
| `AGENT_ENGRAMS_OLLAMA_URL` | `http://localhost:11434` |
| `AGENT_ENGRAMS_OLLAMA_MODEL` | `nomic-embed-text` |

**Note:** The provider configuration is compatible with pi-knowledge-search. You can use the same provider config in both extensions.