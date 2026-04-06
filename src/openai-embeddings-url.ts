/**
 * Embeddings requests must use HTTP or HTTPS only (no javascript:, file:, etc.).
 */
export function assertHttpOrHttpsEmbeddingsUrl(urlStr: string): void {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new Error(
      `Invalid embeddings URL: ${urlStr.slice(0, 120)}${urlStr.length > 120 ? '…' : ''}`
    );
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Embeddings base URL must use http or https (got ${url.protocol})`);
  }
}

/**
 * Build the full URL for OpenAI-compatible POST /v1/embeddings.
 * @param baseUrl - Optional origin (or origin + /v1). Empty/undefined uses https://api.openai.com
 */
export function resolveOpenAiEmbeddingsUrl(baseUrl?: string): string {
  const defaultBase = 'https://api.openai.com';
  const raw = baseUrl?.trim();
  const base = raw || defaultBase;
  let u = base.replace(/\/$/, '');
  let resolved: string;
  if (u.endsWith('/v1')) {
    resolved = `${u}/embeddings`;
  } else {
    resolved = `${u}/v1/embeddings`;
  }
  assertHttpOrHttpsEmbeddingsUrl(resolved);
  return resolved;
}

/**
 * OpenAI's official API requires a key. Local OpenAI-compatible servers (e.g. omlx) may not.
 */
export function openAiEmbeddingsRequiresApiKey(embeddingsUrl: string): boolean {
  try {
    const url = new URL(embeddingsUrl);
    return url.hostname === 'api.openai.com';
  } catch {
    return true;
  }
}
