# Product metrics

_Owner: Platform agent. v1, 2026-11-10._

We measure from our own database first (no third-party analytics SDK until owners approve one; privacy by default).
Numbers go in the heartbeat once there are real users.

## North star
**Weekly active wardrobes:** users who added an item or logged an outfit in the last 7 days.
It captures the habit the whole product depends on (diary data feeds recommendations, style analysis and resale).

## Funnel (per user)
| Step | Event (source) | Target |
|---|---|---|
| Activated | ≥ 10 items in wardrobe within 7 days of sign-up (`clothing_items`) | 40 % of sign-ups |
| Habit | ≥ 3 outfits logged in week 2 (`outfits`) | 25 % of activated |
| Style unlocked | 15 outfits logged (`profiles.style_unlocked_at`) | 15 % of activated |
| Seller | ≥ 1 active listing (`listings`) | track only |

## Feature health
| Metric | Definition | Target |
|---|---|---|
| Time to add item | upload start → item saved (client timing, p50/p90) | p50 < 30 s |
| Tag accuracy | share of AI tags the user didn't change, per field | > 80 % for category, > 65 % for colour |
| Suggestion acceptance | accepted ÷ shown (`recommendation_feedback`) | > 20 % |
| Suggestion → worn | accepted suggestions worn within 14 days | track |
| Eval-set score | NDCG@5 on `eval/pairs.json` | improves with every engine change |
| Recreate coverage | garments matched to owned / used / new / none | owned + used ≥ 50 % |
| Retention | D1 / D7 / D30 of sign-ups | track |

## Cost (from `api_usage`)
| Metric | Limit |
|---|---|
| Channel3 credits / month | 1,000 free (warn at 70 %, stop at 90 %) |
| Vision + embedding calls / month and estimated cost | report weekly; budget set by owners in M1 |
| Cost per weekly active wardrobe | report once > 10 users |
| Supabase usage (DB size, storage, egress) | stay inside free tier |

## Reliability and performance
- App start to first screen < 2 s on a mid-range phone (web build: < 3 s on 4G).
- Edge Function error rate < 1 %, p90 latency: `recommend` < 800 ms, `tag-item` < 6 s.
- Errors are logged in Edge Function logs; an error-tracking tool (e.g. Sentry) is a later owner decision.

## How we collect
- Most metrics are SQL views over existing tables (no extra tracking).
- A small `events` table (user_id, name, props jsonb, created_at) for client-only timings like "time to add item",
  RLS insert-own-only. Added in M1.
- No personal data in event props; aggregated for the heartbeat.
