/**
 * Google Vertex AI (Gemini) helpers for the Edge Functions (docs/ai-providers.md).
 *
 * Pure TypeScript + WebCrypto, so the same file runs in Deno (Edge Functions import it with an explicit `.ts`
 * path) and in Vitest. Reading the secret, network calls and token caching live in
 * supabase/functions/_shared/vertex.ts. Nothing here ever puts the service-account key in an error message.
 */
import { TAGGING_PROMPT, TAGGING_RESPONSE_SCHEMA } from './tagging.ts';

export const TAGGING_MODEL = 'gemini-3.5-flash-lite';
/** EU multi-region: data stays inside EU member states. */
export const DEFAULT_LOCATION = 'eu';
export const OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
export const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** Low temperature: we want the same tags for the same photo, not creativity. */
export const TAGGING_TEMPERATURE = 0.1;
/** The JSON reply is ~300 tokens; this caps cost if the model rambles. */
export const TAGGING_MAX_OUTPUT_TOKENS = 1024;

// ---------- Service-account key ----------

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
}

/**
 * Parses the GOOGLE_VERTEX_SA_KEY secret (the JSON key file, or the same JSON base64-encoded).
 * Throws an Error whose message never contains the key itself.
 */
export function parseServiceAccountKey(raw: string | null | undefined): ServiceAccountKey {
  if (!raw || !raw.trim()) throw new Error('GOOGLE_VERTEX_SA_KEY is not set');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    try {
      data = JSON.parse(atob(raw.trim()));
    } catch {
      throw new Error('GOOGLE_VERTEX_SA_KEY is not valid JSON (or base64 JSON)');
    }
  }
  if (typeof data !== 'object' || data === null) throw new Error('GOOGLE_VERTEX_SA_KEY is not a JSON object');
  const d = data as Record<string, unknown>;
  if (d.type !== undefined && d.type !== 'service_account') {
    throw new Error('GOOGLE_VERTEX_SA_KEY is not a service-account key');
  }
  const missing = ['client_email', 'private_key', 'project_id'].filter(
    (f) => typeof d[f] !== 'string' || !(d[f] as string),
  );
  if (missing.length) throw new Error(`GOOGLE_VERTEX_SA_KEY is missing ${missing.join(', ')}`);
  if (!(d.private_key as string).includes('PRIVATE KEY')) {
    throw new Error('GOOGLE_VERTEX_SA_KEY private_key is not a PEM key');
  }
  return {
    client_email: d.client_email as string,
    private_key: d.private_key as string,
    project_id: d.project_id as string,
    token_uri: typeof d.token_uri === 'string' && d.token_uri ? d.token_uri : DEFAULT_TOKEN_URI,
  };
}

// ---------- JWT (RS256) for the OAuth token exchange ----------

export interface JwtClaims {
  iss: string;
  scope: string;
  aud: string;
  iat: number;
  exp: number;
}

/** Google allows at most one hour between iat and exp. */
export function buildJwtClaims(key: ServiceAccountKey, nowSeconds: number): JwtClaims {
  const iat = Math.floor(nowSeconds);
  return { iss: key.client_email, scope: OAUTH_SCOPE, aud: key.token_uri, iat, exp: iat + 3600 };
}

export function base64UrlEncode(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Standard base64, chunked so large photos don't overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----") → DER bytes for crypto.subtle.importKey. */
export function pemToDer(pem: string): Uint8Array {
  const b64 = pem
    .replace(/\\n/g, '\n')
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Signed JWT assertion for the jwt-bearer grant. */
export async function signServiceAccountJwt(
  key: ServiceAccountKey,
  nowSeconds: number,
  subtle: SubtleCrypto = globalThis.crypto.subtle,
): Promise<string> {
  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await subtle.importKey(
      'pkcs8',
      pemToDer(key.private_key) as BufferSource,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
  } catch {
    throw new Error('GOOGLE_VERTEX_SA_KEY private_key could not be imported');
  }
  const unsigned = `${base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64UrlEncode(
    JSON.stringify(buildJwtClaims(key, nowSeconds)),
  )}`;
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/** Form body for POST {token_uri}. */
export function tokenRequestBody(assertion: string): string {
  return new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString();
}

// ---------- Endpoints ----------

/** eu/us multi-regions use the *.rep.googleapis.com hosts; "global" and single regions use the classic ones. */
export function vertexHost(location: string): string {
  if (location === 'global') return 'https://aiplatform.googleapis.com';
  if (location === 'eu' || location === 'us') return `https://aiplatform.${location}.rep.googleapis.com`;
  if (!/^[a-z]+-[a-z]+\d+$/.test(location)) throw new Error(`Unknown Vertex location: ${location}`);
  return `https://${location}-aiplatform.googleapis.com`;
}

export function modelUrl(
  projectId: string,
  location: string,
  model: string,
  method: 'generateContent' | 'countTokens',
): string {
  return `${vertexHost(location)}/v1/projects/${encodeURIComponent(projectId)}/locations/${location}/publishers/google/models/${model}:${method}`;
}

// ---------- Requests ----------

export interface InlineImage {
  mimeType: string;
  /** base64 (not base64url) */
  data: string;
}

export function buildTaggingRequest(image: InlineImage) {
  return {
    contents: [{ role: 'user', parts: [{ inlineData: image }, { text: TAGGING_PROMPT }] }],
    generationConfig: {
      temperature: TAGGING_TEMPERATURE,
      maxOutputTokens: TAGGING_MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
      responseJsonSchema: TAGGING_RESPONSE_SCHEMA,
      // Tagging is a lookup, not a reasoning task; thinking tokens are billed as output.
      thinkingConfig: { thinkingLevel: 'MINIMAL' },
    },
    // Shows up in Google Cloud billing, so cost can be split per feature there too.
    labels: { feature: 'tag_item' },
  };
}

/** 1×1 grey PNG, so the free health check also exercises image input. */
export const PROBE_IMAGE: InlineImage = {
  mimeType: 'image/png',
  data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
};

/**
 * countTokens is free. The health check sends the real tagging request (minus billing labels, which countTokens
 * doesn't take), so it proves auth, model access in the location, image input and our generationConfig
 * without spending money.
 */
export function buildCountTokensRequest(image: InlineImage = PROBE_IMAGE) {
  const { contents, generationConfig } = buildTaggingRequest(image);
  return { contents, generationConfig };
}

// ---------- Responses ----------

export interface Usage {
  inputTokens: number;
  /** Response + thinking tokens (both billed at the output price). */
  outputTokens: number;
}

const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

export function parseUsage(resp: unknown): Usage {
  const u = (resp as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata ?? {};
  return {
    inputTokens: count(u.promptTokenCount),
    outputTokens: count(u.candidatesTokenCount) + count(u.thoughtsTokenCount),
  };
}

export type ExtractResult =
  | { ok: true; text: string; finishReason: string | null }
  | { ok: false; reason: 'blocked' | 'empty' | 'truncated'; detail: string | null };

/** The JSON text of the first candidate (thought parts skipped). */
export function extractResponseText(resp: unknown): ExtractResult {
  const r = (resp ?? {}) as {
    candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] }; finishReason?: unknown }[];
    promptFeedback?: { blockReason?: unknown };
  };
  const block = r.promptFeedback?.blockReason;
  if (typeof block === 'string') return { ok: false, reason: 'blocked', detail: block };
  const cand = r.candidates?.[0];
  if (!cand) return { ok: false, reason: 'empty', detail: null };
  const finishReason = typeof cand.finishReason === 'string' ? cand.finishReason : null;
  const text = (cand.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text as string)
    .join('');
  if (finishReason === 'MAX_TOKENS') return { ok: false, reason: 'truncated', detail: finishReason };
  if (finishReason && finishReason !== 'STOP' && !text) return { ok: false, reason: 'blocked', detail: finishReason };
  if (!text.trim()) return { ok: false, reason: 'empty', detail: finishReason };
  return { ok: true, text, finishReason };
}

// ---------- Cost ----------

/**
 * USD per 1M tokens, standard (non-batch) pricing from https://cloud.google.com/vertex-ai/generative-ai/pricing
 * (checked 2026-11-12). Non-global endpoints (eu, us, single regions) cost 10% more than global.
 */
export const PRICES_USD_PER_MTOK: Record<string, { global: { input: number; output: number }; regional: { input: number; output: number } }> = {
  'gemini-3.5-flash-lite': { global: { input: 0.3, output: 2.5 }, regional: { input: 0.33, output: 2.75 } },
};

/** Estimated cost in USD (8 decimals), or null for a model we have no price for. */
export function estimateCostUsd(model: string, location: string, usage: Usage): number | null {
  const prices = PRICES_USD_PER_MTOK[model];
  if (!prices) return null;
  const p = location === 'global' ? prices.global : prices.regional;
  const usd = (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}

/** Row for the shared `api_usage` cost log (docs/architecture.md): one per Vertex call, also failed ones. */
export function vertexUsageRow(row: {
  userId: string | null;
  feature: string;
  model: string;
  location: string;
  usage: Usage | null;
  ok: boolean;
}) {
  const usage = row.usage ?? { inputTokens: 0, outputTokens: 0 };
  return {
    user_id: row.userId,
    provider: 'vertex' as const,
    feature: row.feature,
    model: row.model,
    location: row.location,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    units: usage.inputTokens + usage.outputTokens,
    unit: 'tokens' as const,
    cost_estimate_usd: estimateCostUsd(row.model, row.location, usage),
    ok: row.ok,
  };
}

/** Shortens a provider error for logs/responses and strips anything that looks like a key or token. */
export function safeErrorMessage(message: unknown, max = 300): string {
  const s = typeof message === 'string' ? message : String(message);
  return s
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[redacted key]')
    .replace(/ya29\.[\w.-]+/g, '[redacted token]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted jwt]')
    .slice(0, max);
}
