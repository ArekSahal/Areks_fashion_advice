// Retired. This was a one-off health check for GOOGLE_VERTEX_SA_KEY (OAuth token + free countTokens call); the
// key was verified on 2026-11-12 (see PR #25). It now does nothing: no Vertex call, no database writes.
// If the key needs re-checking, restore the version from PR #25's history and run it from SQL via pg_net.
Deno.serve(() =>
  new Response(JSON.stringify({ ok: false, error: 'gone', message: 'vertex-check is retired.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  }),
);
