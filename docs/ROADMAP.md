# Roadmap

## M0: Setup
- Expo + TypeScript scaffold (iOS, Android, web), lint, typecheck, tests
- Supabase project structure (`supabase/` with migrations), local dev setup
- GitHub Actions CI

## M1: Auth and wardrobe (MVP core)
- Sign up / log in (email + Google/Apple), profiles, RLS
- Add item via camera/gallery, EXIF stripping, background removal
- AI tagging with user confirmation; wardrobe grid with filters

## M2: Outfit diary
- Post today's outfit (photo + linked items), calendar, wear counts, "last worn"

## M3: "What goes with this?"
- Matching engine (rules + embeddings), explanations, feedback loop

## M4: Marketplace
- Mark items for sale, listings, recommendations of listed items to other users, messaging

## M5: Style analysis
- Unlocks after 15 outfits; style profile, wardrobe gaps, unworn items

## M6: Recreate outfit from image
- Garment detection on an inspiration photo
- Match against own wardrobe → marketplace → Channel3 shops
- Combined outfit view with prices and links
