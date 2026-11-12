# Cloey: product brief

What we're building and why. Agent rules live in [`AGENTS.md`](../AGENTS.md); owner decisions in
[`DECISIONS.md`](DECISIONS.md); the plan in [`ROADMAP.md`](ROADMAP.md).

**Cloey** helps users document their wardrobe, plan outfits, and get outfit inspiration.
It is English-only and made for both men and women (see `DECISIONS.md`, 2026-11-11).

## Core features (in build order)
1. **Auth and profile**: Supabase Auth (email + Google/Apple). Row Level Security on every table.
2. **Wardrobe**: user photographs an item → image goes to Storage (EXIF/location stripped) →
   AI suggests tags → user confirms/edits → saved as a `clothing_item`.
3. **Outfit diary**: post today's outfit (a photo plus links to the items worn). Calendar view,
   wear counts per item, "last worn".
4. **Recommendations: "what goes with this?"**: given an item, rank matching items from the
   user's wardrobe (colour theory, formality, season, embeddings, plus feedback over time).
   Explain *why* each match is suggested.
5. **Marketplace**: user marks an item as for sale (price, condition, size, location).
   Listed items can show up as recommendations in other users' wardrobes when they fill a gap
   or match owned items. Messaging between buyer and seller. Payments come later; MVP = contact + deal.
6. **Style analysis**: unlocks after N outfits are posted (start with N = 15). Produces a style
   profile: dominant colours, silhouettes, formality, style archetypes, gaps in the wardrobe,
   items never worn. Updates as more outfits are posted.
7. **Recreate an outfit from an image**: user uploads an inspiration photo → detect each
   garment → for each piece, find the closest match in (a) the user's own wardrobe,
   (b) the in-app marketplace, (c) second-hand offers from online shops via Channel3,
   (d) new items via Channel3. Show the result as a full outfit labelled "owned / buy used /
   buy new", with price and link. Rank owned first, then marketplace, then Channel3 used,
   then Channel3 new. No scraping of shops; only official APIs like Channel3.

## Data model (starting point; propose changes as migrations)
profiles, clothing_items (owner, images, category, colours[], pattern, material, brand, size,
season[], formality, embedding, status: owned|for_sale|sold|archived), outfits (owner, date,
photo, notes), outfit_items, listings (item, price, condition, location, status),
messages, style_profiles, inspiration_requests, external_products (Channel3 product IDs plus display fields only),
recommendation_feedback.
The current schema lives in `docs/architecture.md` and `supabase/migrations/`.

## Product principles
- MVP first: get features 1–4 solid before the marketplace and external shops.
- Privacy and GDPR (users in Sweden/EU): consent for photos, data export, account deletion,
  no faces used for analysis unless the user opts in, private by default.
- Mobile-first UX: adding an item must take under 30 seconds.
