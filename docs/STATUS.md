# Status

_Last updated: 2026-11-11 (M1a auth + profiles, M1b provider proposal)_

## Current phase
M1: auth and wardrobe.

## Done
- M1a (PR #9, issue #8): `profiles` + RLS (applied; `supabase/tests/profiles_rls.sql` passes), email/password
  sign-up/sign-in, tab shell, profile screen, GDPR export/delete Edge Functions (deployed). CI green, preview deployed.
- Owner decisions 2026-11-11 (PR #7): Channel3 used offers as middle tier, previews + live share one DB,
  app English-only for men and women, Channel3 stores IDs only, no Channel3 limits for now, keep colours,
  app renamed to **Cloey**. Recorded in DECISIONS.md, AGENTS.md and the docs.
- M0 specialist foundations (PR #5, issue #4): design system v1 + tokens and base components (`src/ui/`),
  garment taxonomy + colour/formality/pattern rules (`src/lib/taxonomy.ts`), `docs/styling-engine.md`,
  `docs/architecture.md`, `docs/metrics.md`, `docs/channel3.md`.
- App scaffold (PR #3, issue #2): Expo SDK 57 / React Native 0.86 + TypeScript + Expo Router, web build on
  the GitHub Pages sub-path, Supabase client with a guard against secret keys in the bundle.
- `supabase/` folder (config, migrations, functions, tests). Repo migrations match the live DB.
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
- PR #9 (M1a) and PR #11 (M1b AI provider proposal) waiting for owners.

## Blocked / needs owners
- Test and merge PR #9 (needs a real sign-up: Supabase's built-in email only reaches project team members).
- Decide PR #11: AI providers, web background removal, AI budget cap. Blocks AI tagging (M1c/M1d).
- Before outside testers: custom SMTP for auth emails; Google/Apple sign-in needs OAuth apps set up by an owner.

## Next up
- M1a follow-ups: forgot-password flow, Google/Apple sign-in once OAuth apps exist.
- M1c: add item (camera/gallery, quarantine upload, EXIF strip, storage buckets + RLS), wardrobe grid.
- M1d: AI tagging with confirmation and filters (after the provider decision).
