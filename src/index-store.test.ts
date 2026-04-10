import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Config } from './config';
import { EngramIndex } from './index-store';
import { buildEmbeddingIndexIdentity } from './index-identity';

class TestEmbedder {
  async embed(_text: string): Promise<number[]> {
    return new Array(4).fill(0.1);
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    return texts.map(() => new Array(4).fill(0.1));
  }
}

const tempRoots: string[] = [];

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    dir: overrides?.dir ?? '/tmp/docs',
    dimensions: overrides?.dimensions ?? 4,
    provider:
      overrides?.provider ??
      ({
        type: 'openai',
        apiKey: '',
        model: 'test-model',
        baseUrl: 'http://localhost:11434/v1',
      } as const),
    indexDir: overrides?.indexDir ?? '/tmp/index',
    minSearchScore: 0.4,
  };
}

function createTempStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'engrams-test-'));
  const docsDir = path.join(root, 'docs');
  const indexDir = path.join(root, 'index');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.mkdirSync(indexDir, { recursive: true });
  tempRoots.push(root);
  return { root, docsDir, indexDir, indexJsonPath: path.join(indexDir, 'index.json') };
}

describe('EngramIndex identity validation', () => {
  beforeEach(() => {
    // no-op marker for structure consistency
  });

  after(() => {
    for (const root of tempRoots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('ignores index.json when embeddingModelId mismatches', async () => {
    const { docsDir, indexDir, indexJsonPath } = createTempStore();
    const config = makeConfig({ dir: docsDir, indexDir });
    const identity = buildEmbeddingIndexIdentity(config);
    fs.writeFileSync(
      indexJsonPath,
      JSON.stringify({
        dimensions: 4,
        embeddingModelId: 'different-model',
        providerFingerprint: identity.providerFingerprint,
        entries: {
          '/tmp/old.md': {
            relPath: 'old.md',
            sourceDir: docsDir,
            mtime: 1,
            vector: [0.1, 0.1, 0.1, 0.1],
            excerpt: 'x',
            metadata: {},
          },
        },
      })
    );

    const index = new EngramIndex(config, new TestEmbedder(), identity);
    await index.load();
    assert.equal(index.size(), 0);
  });

  it('ignores index.json when providerFingerprint mismatches', async () => {
    const { docsDir, indexDir, indexJsonPath } = createTempStore();
    const config = makeConfig({ dir: docsDir, indexDir });
    const identity = buildEmbeddingIndexIdentity(config);
    fs.writeFileSync(
      indexJsonPath,
      JSON.stringify({
        dimensions: 4,
        embeddingModelId: identity.embeddingModelId,
        providerFingerprint: 'openai:http://other/v1',
        entries: {},
      })
    );

    const index = new EngramIndex(config, new TestEmbedder(), identity);
    await index.load();
    assert.equal(index.size(), 0);
  });

  it('rejects index.json with unknown top-level fields', async () => {
    const { docsDir, indexDir, indexJsonPath } = createTempStore();
    const config = makeConfig({ dir: docsDir, indexDir });
    const identity = buildEmbeddingIndexIdentity(config);
    fs.writeFileSync(
      indexJsonPath,
      JSON.stringify({
        dimensions: 4,
        embeddingModelId: identity.embeddingModelId,
        providerFingerprint: identity.providerFingerprint,
        entries: {},
        extraField: true,
      })
    );

    const index = new EngramIndex(config, new TestEmbedder(), identity);
    await index.load();
    assert.equal(index.size(), 0);
  });
});
