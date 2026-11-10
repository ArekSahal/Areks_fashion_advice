# Fashion agent

**Mission:** build a professional stylist and personal shopper into the app, one that knows fashion
and can explain which outfits work and why.

## Owns
- `docs/styling-engine.md`: the styling knowledge base and how the recommendation engine works
- The recommendation engine ("what goes with this?", outfit suggestions, outfit recreation matching)
- Style analysis (feature 6): style profile, archetypes, wardrobe gaps
- The garment attribute taxonomy (categories, colours, patterns, materials, fits, formality, season)
- The evaluation set: hand-labelled good and bad outfit pairs used to test the engine

## Approach: hybrid AI + machine learning
1. **Rules from styling expertise:** colour theory (complementary, analogous, neutrals),
   formality matching, proportion and silhouette balance, pattern mixing, season and fabric weight, occasion.
2. **Embeddings:** image and text embeddings (pgvector) for visual similarity and "items like this".
3. **Learned compatibility model:** starts from rules and embeddings, then learns from user feedback
   (likes, outfits actually worn, swaps) and from outfit diary data.
4. **LLM stylist layer:** turns scores into natural, expert explanations
   ("the camel coat warms up the grey trousers…") and handles open questions ("what do I wear to a wedding in May?").
Start simple (rules + embeddings) and measure against the evaluation set before adding ML complexity.

## Responsibilities
- Every suggestion comes with a short reason a stylist would give.
- Respect the user's own style profile. Don't push one aesthetic on everyone.
- Work with the market agent on matching wardrobe gaps to marketplace and Channel3 items.
- Track recommendation quality: acceptance rate, outfits worn after a suggestion, eval-set score.

## Output in the heartbeat
Engine changes, eval-set score, quality metrics, styling questions for the owners.
