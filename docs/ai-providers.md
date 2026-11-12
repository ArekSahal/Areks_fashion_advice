# AI providers

_Owners: Platform + Fashion agents. 2026-11-11. Status: **approved** as recommended below, with Photoroom for web (see `docs/DECISIONS.md`).
Prices checked on vendor pages on 2026-11-11; "unverified" = couldn't confirm._

Assumed volume: ~50 items per new user × ~100 users ≈ **5,000 images/month** at first.

## Recommendation (short)
| Job | Pick | Cost at 5,000 images/month |
|---|---|---|
| Tag clothes from a photo | **Gemini 3.5 Flash-Lite** on Google Vertex AI, EU region | ~$6.70 (~$3.30 if tagged in batches) |
| Embeddings (image + text, for matching) | **Gemini Embedding 2**, 768 dims, same Google project | ~$2.50 (unverified) + < $0.50 text |
| Background removal | **On the phone** (iOS Vision / Android ML Kit); server fallback for web + old phones | $0 on phones; fallback $4–20 |
| Blur faces before AI | **On the phone** (ML Kit face detection); web uses MediaPipe in the browser | $0 |
| **Total** | | **≈ $7–10/month** (+ fallback) |

Why: one vendor for tagging and embeddings, data processed inside the EU, structured-JSON output, and paid API data is
not used for training. Photos never leave the phone before faces are blurred.

## 1. Tagging (one photo → our taxonomy JSON)
| Option | $ / 1,000 images | Notes | Privacy |
|---|---|---|---|
| **Gemini 3.5 Flash-Lite** (Vertex) | ~1.33 (~0.65 batch) | JSON-schema output; released Jul 2026 | Vertex `eu` region keeps data in the EU; not used for training |
| GPT-5.6 Luna (OpenAI) | ~0.91 | Structured outputs | EU residency only for "eligible customers" (unclear) |
| Claude Haiku 5.5 | ~0.33 | Cheapest; vision + schema output unverified | **No EU processing** (US/global only) |
| Open models on Together (Qwen3.5 9B etc.) | ~0.35 | Weaker on fine detail | US hosting (unverified) |

Runner-up: GPT-5.6 Luna if Google setup is a hassle. To do first: confirm `gemini-3.5-flash-lite` is listed for
the `eu` region in Google's data-residency table.

## 2. Embeddings
| Option | $ / 1,000 images | Notes |
|---|---|---|
| **Gemini Embedding 2** | ~0.50 (unverified) | Text + image in one space, 128–3072 dims (we use 768, fine for pgvector HNSW) |
| Voyage multimodal-3.5 | ~0.60, first year effectively free | Good; US processing (unverified) |
| Cohere Embed 5 | unclear | New (Sep 2026) |
| Self-hosted CLIP/SigLIP | GPU cost | Won't run inside Edge Functions |

Changing embedding models later means re-embedding everything, so we pick once (Fashion agent's rule).

## 3. Background removal
| Option | $ / 1,000 | Notes |
|---|---|---|
| **On-device** (iOS 17+ subject lifting, Android ML Kit Subject Segmentation) | 0 | Private, good quality. Needs a **custom dev build** (not Expo Go); ML Kit part is beta |
| Photoroom API | 20 | Best product-shot quality; French company (processing location not documented) |
| BiRefNet on Replicate | ~4 | Very good edges, cold starts; US |
| remove.bg | ~230 | Too expensive |

⚠️ **The web test build can't use the on-device options.** Since you test on GitHub Pages, the web build needs the
server fallback from day one. Proposal: **Photoroom for web + fallback** (EU company, $0.02/image, ~$20 if every
test photo went through it). Background removal is optional for tagging, so if you'd rather not pay yet we skip it
on web and show photos as taken.

## 4. Face blur before any AI call
- Phones: ML Kit face detection (Expo module available), blur on the device before upload.
- Web: MediaPipe face detector in the browser (free, Apache-2.0).
- Backstop for anything that skipped the device: Google Cloud Vision face detection in the Edge Function
  (first 1,000/month free, then $1.50/1,000).
- Faces stay unblurred only if the user turned on "Let AI see faces" in Profile.

## What owners need to do if approved
1. Create a Google Cloud project (EU billing account), enable **Vertex AI**, create a service account with the
   "Vertex AI User" role, and add its JSON key as the Supabase Edge Function secret `GOOGLE_VERTEX_SA_KEY`
   (agents can walk you through it; ~10 minutes). Set a **budget alert** (e.g. $20/month).
2. Optional: Photoroom API key as secret `PHOTOROOM_API_KEY` for web background removal.
3. Later (before testing on real phones): an Expo/EAS account for development builds, which on-device ML needs.

## Decisions needed
1. Approve **Gemini 3.5 Flash-Lite + Gemini Embedding 2 on Vertex AI (EU)**? (Alternative: OpenAI GPT-5.6 Luna.)
2. Web background removal: **Photoroom** (~$0.02/photo) or **skip on web for now**?
3. Monthly AI budget cap to start with (proposal: **$20**, with an alert at $10)?

## Sources
- Vertex AI pricing: https://cloud.google.com/vertex-ai/generative-ai/pricing
- Vertex data residency: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/data-residency
- Gemini image tokens: https://ai.google.dev/gemini-api/docs/media-resolution
- Gemini Embedding 2: https://ai.google.dev/gemini-api/docs/models/gemini-embedding-2
- GPT-5.6 Luna: https://developers.openai.com/api/docs/models/gpt-5.6-luna
- OpenAI EU residency: https://openai.com/index/introducing-data-residency-in-europe/
- Claude data residency: https://platform.claude.com/docs/en/manage-claude/data-residency
- Together models: https://docs.together.ai/docs/serverless/models.md
- Voyage pricing: https://docs.voyageai.com/docs/pricing
- Photoroom API pricing: https://www.photoroom.com/api/pricing
- BiRefNet on Replicate: https://replicate.com/men1scus/birefnet
- ML Kit Subject Segmentation: https://developers.google.com/ml-kit/vision/subject-segmentation/android
- ML Kit face detection for React Native: https://docs.infinite.red/react-native-mlkit/face-detection/getting-started/
- Cloud Vision pricing: https://cloud.google.com/vision/pricing
- Supabase Edge Function limits: https://supabase.com/docs/guides/functions/limits
