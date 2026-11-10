# Decision log

| Date | Decision | Reason | Approved by |
|------|----------|--------|-------------|
| 2026-11-10 | Supabase as backend | Owner requirement | @ArekSahal |
| 2026-11-10 | Channel3 API for online-shop products | Official product API with images, prices and commissions; no scraping | @ArekSahal |
| 2026-11-10 | Expo (React Native) + TypeScript + Supabase | Camera access, one codebase for iOS/Android/web | @ArekSahal (`/approve stack`, issue #1) |
| 2026-11-10 | Agents get full read/write access to the Supabase database, including production | Faster agent-first development; migrations still tracked in repo | @ArekSahal |
| 2026-11-10 | Add specialist agents: UX, Market (Channel3), Fashion (stylist engine), Platform | Dedicated ownership of design, shop economics, styling quality and cross-feature experience | @ArekSahal |
| 2026-11-10 | Lockfile is generated in GitHub Actions ("Bootstrap dependencies") from Expo's SDK version table | Agent sandboxes cannot reach npm; keeps versions SDK-compatible and reproducible | Lead agent (in PR #3, pending owner review) |
