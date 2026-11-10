# Styling engine

_Owner: Fashion agent. v1, 2026-11-10. Code: `src/lib/taxonomy.ts` (taxonomy + pairwise rules)._

The engine answers three questions, in this order of build:
1. **"What goes with this?"** (M3): given one item, rank the user's other items that pair with it.
2. **Style analysis** (M5): what does this person actually wear, and what's missing?
3. **Recreate this outfit** (M6): for each garment in a photo, find the closest owned / used / new piece.

Principle: **rules first, then embeddings, then learning.** Every step must beat the previous one on the evaluation set
before it ships. Every suggestion carries a reason a stylist would say out loud.

## 1. Taxonomy (v1)
Defined once in `src/lib/taxonomy.ts` and mirrored as DB check constraints in M1.

| Attribute | Values | Notes |
|---|---|---|
| category / subcategory | top, bottom, one_piece, outerwear, footwear, accessory → ~45 subcategories | one subcategory per item |
| layer | base, mid, outer (tops and outerwear only), derived from subcategory | allows shirt + knit + coat |
| colours | 28 named colours with hex, painter's-wheel (RYB) hue, tone (light/mid/deep), neutral flag | up to 3 per item, dominant first |
| pattern | 15 values (solid, stripe, check, floral, graphic…) | "quiet" patterns (solid, herringbone, knit texture) mix with anything |
| material | 19 values, each with warmth 1–5 | drives season and layering |
| fit | slim, regular, relaxed, oversized, cropped, tailored | |
| formality | 1 very casual … 5 formal | the most important pairing signal after colour |
| season | spring, summer, autumn, winter (multi) | empty = all-season |
| occasion | everyday, work, evening, party, wedding, sport, outdoor, travel, lounge | used for open questions and filters |

Hues sit on the **painter's (RYB) colour wheel**, not the screen (RGB) wheel, because that's the wheel stylists use:
red/green, blue/orange and yellow/purple come out complementary. Gold and silver are neutral metallics.

Navy, camel, olive, beige, brown and denim blue count as **neutrals** in menswear and womenswear styling, not just
black/white/grey. That single choice makes suggestions feel far more natural than pure colour-wheel maths.

**AI tagging (M1):** the vision model fills these fields with a confidence per field. Fields below 0.6 confidence are
shown to the user as "check this". The user's correction is stored and used as a training signal for tag quality.

## 2. Pair score: "what goes with this?" (M3, v1 = rules)
For a seed item S and candidate C (different category slot, e.g. top ↔ bottom):

```
score = 0.35·colour + 0.25·formality + 0.15·pattern + 0.10·season + 0.15·slot_bonus
```
- **colour** (`itemColourScore`): 70 % from the two dominant colours, 30 % from the best secondary pairing, so a small
  neutral detail can't rescue two clashing main colours. Neutral pairs with everything; monochrome and analogous score
  high; same-tone pairs (two pastels, two jewel tones) score well; complementary is a deliberate statement; the
  in-between hues ("contrast") score lowest but are not forbidden.
- **formality**: gap 0 → 1, gap 1 → 0.85, gap 2 → 0.5 (intentional contrast like blazer + jeans), 3+ → near 0.
- **pattern**: one print + quiet pieces = 1; two loud prints = 0.3.
- **season**: hard filter when the user asks "for today" (weather), soft score otherwise.
- **slot_bonus**: candidate fills a slot the seed needs (top needs bottom + shoes; dress needs shoes + outerwear).

Hard rules (filter, don't score, `canPair`): two items in the same slot never pair (two trousers, two base-layer tops,
two coats), but layering is fine (shirt + knit + coat; dress + cardigan); several accessories are fine. Warmth gap ≥ 3
between non-outerwear pieces is dropped (outerwear is exempt: linen shirt + down parka is layering). Items with status
`sold` / `archived` are excluded.

**Explanation:** the top two contributing rules become the sentence, e.g.
_"The camel coat warms up the grey trousers, and both sit at the same smart-casual level."_
v1 uses templates per rule; the LLM layer rewrites them more naturally later (cheap model, cached per pair).

## 3. Embeddings (M3 v2)
- Image embedding per item (background-removed photo) + text embedding of its tags, stored in pgvector.
- Used for: "items like this" (similarity), and as an extra term in the pair score via learned compatibility (below).
- Same embedding space for Channel3 products and marketplace listings, so M6 can compare them with owned items directly.
- Model choice is a Platform + Fashion decision in M3; we pick one model and keep it fixed (re-embedding costs money).

## 4. Learning from users (M3 v3+)
Signals, from strongest to weakest:
1. Items **worn together** in the outfit diary (real, revealed preference).
2. Suggestion **accepted** → later worn.
3. Explicit 👍 / 👎 on a suggestion (stored in `recommendation_feedback`).
4. Suggestion shown and ignored (weak negative).

Start with per-user weight tuning of the rule terms (some people love clashing colour). Only train a compatibility model
once we have ~2,000 worn-together pairs across users. Never let one user's taste change another user's weights
except through the global model.

## 5. Style analysis (M5)
Unlocks after 15 diary outfits. Produces:
- Dominant colours (palette chart) and neutral vs accent ratio
- Formality profile (share of outfits per level) and typical silhouettes (fit combinations)
- Style archetypes as a mix, not a label: minimal, classic, smart casual, streetwear, bohemian, sporty, romantic, edgy.
  Scored from tags and outfit patterns; shown as "mostly classic, with streetwear touches".
- **Gaps**: slots the user's outfits keep missing (e.g. "no smart shoes for your business-level outfits").
- **Never worn** items in the last 90 days, with a suggestion for how to wear each one, or to list it for sale.

## 6. Recreate an outfit (M6)
1. Detect garments in the inspiration photo (vision model) and tag each with the same taxonomy.
2. For each garment: score the user's own items (taxonomy match + embedding similarity). If the best owned match is good
   enough, stop there for that garment. Owned first saves money and fits our sustainability angle.
3. Otherwise search the marketplace, then Channel3 used, then Channel3 new (see `docs/channel3.md`).
4. Show the full outfit with each piece labelled **owned / buy used / buy new** and a one-line reason for the match.

## 7. Evaluation set
`eval/pairs.json` (created in M3): hand-labelled pairs `{seed, candidate, label: good|ok|bad, reason}`, at least 200 pairs
covering casual, smart casual and business looks for both menswear and womenswear. Owners and friends can add pairs.
Metric: NDCG@5 for "what goes with this?" plus agreement rate with "good" labels. Reported in the heartbeat when the engine changes.

## 8. Things we deliberately don't do
- No body-shape or face analysis unless the user opts in (privacy).
- No single "correct" style. The engine adapts to the user, not the other way round.
- No pushing new purchases: buying suggestions only appear for real gaps or when the user asks.

## Open questions for owners
1. Should the app speak Swedish, English or both from day one? (Affects explanation templates.)
2. Menswear, womenswear, or both at launch? The taxonomy covers both; the evaluation set needs to know.
