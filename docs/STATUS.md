# Status

_Last updated: 2026-11-10 (M0 scaffold)_

## Current phase
Milestone 0: project setup.

## Done
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
- PR #3 waiting for owner review/merge.

## Blocked / needs owners
- Review and merge PR #3 (`needs-owner`).

## Next up
- Rest of M0: design system v1 (UX), styling engine doc (Fashion), architecture + metrics (Platform), Channel3 doc (Market).
- Then M1: auth + profiles with RLS.
