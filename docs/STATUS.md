# Status

_Last updated: 2026-11-10 (M0 complete, pending merge of PR #5)_

## Current phase
Milestone 0 done once PR #5 is merged. Next: M1 (auth and wardrobe).

## Done
- M0 specialist foundations (PR #5, issue #4): design system v1 + tokens and base components (`src/ui/`),
  garment taxonomy + colour/formality/pattern rules (`src/lib/taxonomy.ts`), `docs/styling-engine.md`,
  `docs/architecture.md`, `docs/metrics.md`, `docs/channel3.md`.
- App scaffold (PR #3, issue #2): Expo SDK 57 / React Native 0.86 + TypeScript + Expo Router, web build on
  the GitHub Pages sub-path, Supabase client with a guard against secret keys in the bundle.
- `supabase/` folder (config, migrations, functions). Live DB is empty, so repo and DB match.
- CI: migration check (naming + RLS on every new table), `expo install --check`, lint, typecheck, Vitest, web build. Green on PR #3.
- "Bootstrap dependencies" workflow: resolves SDK-compatible versions and commits `package-lock.json`
  (agent sandboxes have no npm access).
- First preview build published to GitHub Pages from `agent/2-m0-scaffold`.
- Pages URL added to Supabase Auth redirect URLs (by @ArekSahal, 2026-11-10).
- Channel3 API key saved as Supabase secret `CHANNEL3_API_KEY`.
- Specialist agents added: UX, Market, Fashion, Platform (`docs/agents/`).
- Stack approved: Expo + TypeScript + Supabase.
- Supabase project created (ref `emnkjfoccluygilkebbz`, eu-north-1).

## In progress
- PR #5 waiting for owner review/merge.

## Blocked / needs owners
- Review and merge PR #5 (`needs-owner`).
- Decisions asked in the docs (see PR #5): Channel3 caching change, Channel3 used offers, dev DB project,
  language (sv/en), menswear/womenswear scope, visual direction.

## Next up
- M1: auth + profiles with RLS, GDPR export/delete, then add-item flow with AI tagging.
