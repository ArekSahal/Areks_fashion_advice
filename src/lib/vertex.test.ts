import { describe, expect, it } from 'vitest';
import { TAGGING_PROMPT, TAGGING_RESPONSE_SCHEMA, parseTaggingResponse } from './tagging';
import {
  OAUTH_SCOPE,
  PROBE_IMAGE,
  TAGGING_MODEL,
  base64UrlEncode,
  buildCountTokensRequest,
  buildJwtClaims,
  buildTaggingRequest,
  bytesToBase64,
  estimateCostUsd,
  vertexUsageRow,
  extractResponseText,
  modelUrl,
  parseServiceAccountKey,
  parseUsage,
  pemToDer,
  safeErrorMessage,
  signServiceAccountJwt,
  tokenRequestBody,
  vertexHost,
} from './vertex';

const subtle = globalThis.crypto.subtle;

async function makeKey() {
  const pair = await subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = new Uint8Array(await subtle.exportKey('pkcs8', pair.privateKey));
  const b64 = bytesToBase64(der).replace(/.{64}/g, '$&\n');
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
  return { pem, publicKey: pair.publicKey };
}

const fakeJson = (privateKey: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'service_account',
    project_id: 'cloey-test',
    private_key: privateKey,
    client_email: 'tagger@cloey-test.iam.gserviceaccount.com',
    ...extra,
  });

const decodePart = (part: string) =>
  JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

describe('parseServiceAccountKey', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n';

  it('reads the JSON key file and defaults token_uri', () => {
    const k = parseServiceAccountKey(fakeJson(pem));
    expect(k).toMatchObject({ project_id: 'cloey-test', token_uri: 'https://oauth2.googleapis.com/token' });
  });

  it('accepts the same JSON base64-encoded', () => {
    const k = parseServiceAccountKey(btoa(fakeJson(pem)));
    expect(k.client_email).toBe('tagger@cloey-test.iam.gserviceaccount.com');
  });

  it('explains what is wrong without echoing the secret', () => {
    expect(() => parseServiceAccountKey(undefined)).toThrow('not set');
    expect(() => parseServiceAccountKey('not json !!')).toThrow('not valid JSON');
    expect(() => parseServiceAccountKey(fakeJson(pem, { client_email: '' }))).toThrow('missing client_email');
    expect(() => parseServiceAccountKey(fakeJson(pem, { type: 'authorized_user' }))).toThrow('not a service-account');
    try {
      parseServiceAccountKey(fakeJson('secret-not-a-pem'));
    } catch (e) {
      expect(String(e)).not.toContain('secret-not-a-pem');
    }
  });
});

describe('JWT', () => {
  it('builds claims for the jwt-bearer grant, valid for one hour', () => {
    const key = parseServiceAccountKey(fakeJson('-----BEGIN PRIVATE KEY-----\nAA\n-----END PRIVATE KEY-----'));
    expect(buildJwtClaims(key, 1_000.7)).toEqual({
      iss: 'tagger@cloey-test.iam.gserviceaccount.com',
      scope: OAUTH_SCOPE,
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1000,
      exp: 4600,
    });
  });

  it('base64url-encodes without padding', () => {
    expect(base64UrlEncode(new Uint8Array([251, 255, 191]))).toBe('-_-_');
    expect(base64UrlEncode('ab')).toBe('YWI');
  });

  it('handles escaped newlines in the PEM (keys pasted as one line)', () => {
    const der = pemToDer('-----BEGIN PRIVATE KEY-----\\nAQID\\n-----END PRIVATE KEY-----\\n');
    expect([...der]).toEqual([1, 2, 3]);
  });

  it('signs an RS256 JWT that verifies with the public key', async () => {
    const { pem, publicKey } = await makeKey();
    const key = parseServiceAccountKey(fakeJson(pem));
    const jwt = await signServiceAccountJwt(key, 1_700_000_000);
    const [h, c, s] = jwt.split('.') as [string, string, string];
    expect(decodePart(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodePart(c)).toMatchObject({ iss: key.client_email, exp: 1_700_003_600 });
    const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const ok = await subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sig, new TextEncoder().encode(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it('reports a broken private key without leaking it', async () => {
    const key = parseServiceAccountKey(fakeJson('-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----'));
    await expect(signServiceAccountJwt(key, 0)).rejects.toThrow('could not be imported');
  });

  it('builds the token request form body', () => {
    const body = new URLSearchParams(tokenRequestBody('a.b.c'));
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(body.get('assertion')).toBe('a.b.c');
  });
});

describe('endpoints', () => {
  it('uses the EU multi-region host for "eu"', () => {
    expect(modelUrl('p1', 'eu', TAGGING_MODEL, 'countTokens')).toBe(
      'https://aiplatform.eu.rep.googleapis.com/v1/projects/p1/locations/eu/publishers/google/models/gemini-3.5-flash-lite:countTokens',
    );
  });

  it('supports single regions and global, and rejects junk', () => {
    expect(vertexHost('europe-west4')).toBe('https://europe-west4-aiplatform.googleapis.com');
    expect(vertexHost('global')).toBe('https://aiplatform.googleapis.com');
    expect(() => vertexHost('evil.com/x')).toThrow();
  });
});

describe('requests', () => {
  it('sends the photo, the contract prompt and the contract schema with low temperature', () => {
    const req = buildTaggingRequest({ mimeType: 'image/webp', data: 'AAAA' });
    expect(req.contents[0]?.parts).toEqual([{ inlineData: { mimeType: 'image/webp', data: 'AAAA' } }, { text: TAGGING_PROMPT }]);
    expect(req.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: TAGGING_RESPONSE_SCHEMA,
    });
    expect(req.generationConfig.temperature).toBeLessThanOrEqual(0.2);
    expect(req.generationConfig.maxOutputTokens).toBeLessThanOrEqual(2048);
    expect(JSON.parse(JSON.stringify(req))).toEqual(req);
  });

  it('countTokens (health check) mirrors the tagging request without billing labels', () => {
    const req = buildCountTokensRequest();
    const tagging = buildTaggingRequest(PROBE_IMAGE);
    expect(req).toEqual({ contents: tagging.contents, generationConfig: tagging.generationConfig });
    expect(req).not.toHaveProperty('labels');
  });

  it('base64-encodes large byte arrays', () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(Buffer.from(bytesToBase64(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true);
  });
});

describe('responses', () => {
  const reply = {
    is_garment: true, garment_count: 1, category: 'top', subcategory: 'knit', colours: ['navy'], pattern: 'solid',
    materials: ['wool'], fit: 'regular', formality: 2, seasons: ['autumn', 'winter'], occasions: ['everyday'],
    confidence: { category: 0.95, subcategory: 0.9, colours: 0.9, pattern: 0.9, materials: 0.5, fit: 0.7,
      formality: 0.8, seasons: 0.8, occasions: 0.7 },
  };
  const resp = {
    candidates: [{
      content: { parts: [{ text: 'thinking…', thought: true }, { text: JSON.stringify(reply) }] },
      finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 120, thoughtsTokenCount: 30, totalTokenCount: 1650 },
  };

  it('extracts the JSON text (skipping thoughts) and it passes the tagging contract', () => {
    const r = extractResponseText(resp);
    if (!r.ok) throw new Error(r.reason);
    const tags = parseTaggingResponse(r.text);
    expect(tags.ok && tags.tags.subcategory).toBe('knit');
    expect(tags.ok && tags.needsCheck).toContain('materials');
  });

  it('counts thinking tokens as output', () => {
    expect(parseUsage(resp)).toEqual({ inputTokens: 1500, outputTokens: 150 });
    expect(parseUsage({})).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('reports blocked, truncated and empty replies', () => {
    expect(extractResponseText({ promptFeedback: { blockReason: 'SAFETY' } })).toMatchObject({ ok: false, reason: 'blocked' });
    expect(extractResponseText({ candidates: [{ content: { parts: [{ text: '{"a' }] }, finishReason: 'MAX_TOKENS' }] }))
      .toMatchObject({ ok: false, reason: 'truncated' });
    expect(extractResponseText({ candidates: [{ finishReason: 'SAFETY' }] })).toMatchObject({ ok: false, reason: 'blocked' });
    expect(extractResponseText({ candidates: [] })).toMatchObject({ ok: false, reason: 'empty' });
    expect(extractResponseText(null)).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('estimateCostUsd', () => {
  it('uses the non-global price in the EU', () => {
    // 1,500 × $0.33/M + 150 × $2.75/M
    expect(estimateCostUsd(TAGGING_MODEL, 'eu', { inputTokens: 1500, outputTokens: 150 })).toBe(0.0009075);
  });

  it('is cheaper on the global endpoint', () => {
    expect(estimateCostUsd(TAGGING_MODEL, 'global', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(2.8);
  });

  it('is zero for countTokens and null for an unknown model', () => {
    expect(estimateCostUsd(TAGGING_MODEL, 'eu', { inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(estimateCostUsd('some-new-model', 'eu', { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it('a typical photo costs well under a cent (budget sanity check)', () => {
    const usd = estimateCostUsd(TAGGING_MODEL, 'eu', { inputTokens: 1_100 + 900, outputTokens: 400 }) ?? 1;
    expect(usd * 5000).toBeLessThan(10); // 5,000 photos/month stays under $10
  });
});

describe('safeErrorMessage', () => {
  it('redacts keys, tokens and JWTs and truncates', () => {
    const msg = safeErrorMessage(
      'bad -----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY----- token ya29.abc-def jwt eyJa.eyJb.sig',
    );
    expect(msg).not.toMatch(/abc|ya29|eyJ/);
    expect(safeErrorMessage('x'.repeat(1000)).length).toBe(300);
  });
});

describe('vertexUsageRow', () => {
  it('builds an api_usage row with provider, token units and a cost estimate', () => {
    const row = vertexUsageRow({
      userId: 'u1', feature: 'tag_item', model: TAGGING_MODEL, location: 'eu',
      usage: { inputTokens: 1500, outputTokens: 150 }, ok: true,
    });
    expect(row).toEqual({
      user_id: 'u1', provider: 'vertex', feature: 'tag_item', model: TAGGING_MODEL, location: 'eu',
      input_tokens: 1500, output_tokens: 150, units: 1650, unit: 'tokens', cost_estimate_usd: 0.0009075, ok: true,
    });
  });

  it('logs failed calls with zero units', () => {
    const row = vertexUsageRow({ userId: null, feature: 'tag_item', model: TAGGING_MODEL, location: 'eu', usage: null, ok: false });
    expect(row).toMatchObject({ user_id: null, units: 0, input_tokens: 0, output_tokens: 0, cost_estimate_usd: 0, ok: false });
  });

  it('has no cost estimate for unknown models', () => {
    expect(vertexUsageRow({ userId: null, feature: 'x', model: 'nope', location: 'eu', usage: null, ok: true }).cost_estimate_usd).toBeNull();
  });
});
