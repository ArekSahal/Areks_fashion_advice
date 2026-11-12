// Google Vertex AI access for Edge Functions: reads GOOGLE_VERTEX_SA_KEY, gets an OAuth token (cached per
// isolate), calls Gemini and logs every call to ai_usage. Pure parts (JWT, request/response shapes, prices)
// live in src/lib/vertex.ts and are unit-tested there. Never log or return the key or the access token.
import {
  DEFAULT_LOCATION,
  type ServiceAccountKey,
  type Usage,
  estimateCostUsd,
  modelUrl,
  parseServiceAccountKey,
  parseUsage,
  safeErrorMessage,
  signServiceAccountJwt,
  tokenRequestBody,
} from '../../../src/lib/vertex.ts';

export type VertexStep = 'config' | 'auth' | 'request';

export class VertexError extends Error {
  constructor(
    public step: VertexStep,
    public status: number | null,
    message: string,
  ) {
    super(safeErrorMessage(message));
  }
}

export interface VertexConfig {
  key: ServiceAccountKey;
  projectId: string;
  location: string;
}

/** Optional secrets: VERTEX_LOCATION (default "eu"), VERTEX_PROJECT_ID (default: the key's project). */
export function loadVertexConfig(): VertexConfig {
  try {
    const key = parseServiceAccountKey(Deno.env.get('GOOGLE_VERTEX_SA_KEY'));
    return {
      key,
      projectId: Deno.env.get('VERTEX_PROJECT_ID') || key.project_id,
      location: Deno.env.get('VERTEX_LOCATION') || DEFAULT_LOCATION,
    };
  } catch (e) {
    throw new VertexError('config', null, e instanceof Error ? e.message : 'invalid config');
  }
}

let cachedToken: { email: string; token: string; expiresAt: number } | null = null;

export async function getAccessToken(key: ServiceAccountKey): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.email === key.client_email && cachedToken.expiresAt - 60_000 > now) {
    return cachedToken.token;
  }
  let assertion: string;
  try {
    assertion = await signServiceAccountJwt(key, now / 1000);
  } catch (e) {
    throw new VertexError('config', null, e instanceof Error ? e.message : 'could not sign JWT');
  }
  const res = await fetch(key.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenRequestBody(assertion),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.access_token !== 'string') {
    throw new VertexError('auth', res.status, `${data.error ?? 'token_error'}: ${data.error_description ?? res.statusText}`);
  }
  const ttl = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  cachedToken = { email: key.client_email, token: data.access_token, expiresAt: now + ttl * 1000 };
  return data.access_token;
}

/** POSTs to a Gemini model method and returns the parsed JSON. Throws VertexError on any failure. */
export async function callModel(
  cfg: VertexConfig,
  model: string,
  method: 'generateContent' | 'countTokens',
  body: unknown,
): Promise<Record<string, unknown>> {
  const token = await getAccessToken(cfg.key);
  let res: Response;
  try {
    res = await fetch(modelUrl(cfg.projectId, cfg.location, model, method), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new VertexError('request', null, `network error: ${e instanceof Error ? e.message : e}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new VertexError('request', res.status, data?.error?.message ?? res.statusText);
  }
  return data;
}

// deno-lint-ignore no-explicit-any
type AdminClient = { from: (table: string) => any };

/** One row per Vertex call (also failed ones), so cost per feature can be reported (docs/metrics.md). */
export async function logAiUsage(
  admin: AdminClient,
  row: { userId: string | null; feature: string; model: string; location: string; usage: Usage | null; ok: boolean },
): Promise<void> {
  const usage = row.usage ?? { inputTokens: 0, outputTokens: 0 };
  const { error } = await admin.from('ai_usage').insert({
    user_id: row.userId,
    feature: row.feature,
    model: row.model,
    location: row.location,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    est_cost_usd: estimateCostUsd(row.model, row.location, usage),
    ok: row.ok,
  });
  if (error) console.error('ai_usage insert failed', error.message);
}

export { parseUsage };
