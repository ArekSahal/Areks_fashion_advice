# Design system v1

_Owner: UX agent. 2026-11-10. Code: `src/ui/` (`tokens.ts`, `theme.ts`, `components.tsx`)._

## Feel
**A calm, warm wardrobe where the clothes are the colour.** The UI is paper and ink; garment photos bring the colour.
One accent (clay) marks the main action. No gradients, no heavy shadows, no decorative illustrations competing with photos.
Tone of voice: a friendly stylist. Short, concrete, never judgmental ("Try it with the grey trousers", not "Wrong colours!").

## Rules for every screen
1. Use `useTheme()` tokens and `@/ui` components. No hard-coded colours, font sizes, spacing or radii in feature code.
   PRs that break this are blocked by the UX review.
2. One primary (clay) button per screen at most. Everything else is secondary or a plain row.
3. Touch targets ≥ 48 pt. Every pressable has an `accessibilityLabel`.
4. Light and dark mode both work before a PR is ready (check both in the Pages preview).
5. Text must stay readable at the largest system text size. Don't fix heights on text containers.
6. Respect reduce-motion: no animation when it's on.

## Colour
| Token | Light | Dark | Use |
|---|---|---|---|
| `background` | `#FAF8F5` | `#141412` | page |
| `surface` | `#FFFFFF` | `#1E1D1A` | cards, sheets |
| `surfaceSunken` | `#F1EEE8` | `#262521` | photo wells, inputs |
| `border` | `#E6E1D8` | `#34322D` | decorative hairlines only |
| `borderStrong` | `#8C857A` | `#7A746A` | outlines that must be seen: inputs, secondary buttons (≥ 3.4:1) |
| `text` | `#1C1B19` | `#F2F0EC` | main text (16.2:1) |
| `textMuted` | `#6B665E` | `#A39E95` | secondary text (≥ 4.9:1) |
| `accent` | `#A4482F` | `#E5917A` | primary action, selection (5.6:1 / 7.6:1) |
| `onAccent` | `#FFFFFF` | `#1C1B19` | text on accent (5.9:1 / 7.1:1) |
| `danger` / `success` | `#B42318` / `#2F7D4F` | `#F27A6E` / `#6CC28F` | errors, confirmations |

All text pairs meet WCAG AA (≥ 4.5:1) and `borderStrong` outlines meet 3:1 (WCAG 1.4.11). This is enforced by
`src/ui/tokens.test.ts`, so a new token pair must be added there.
Garment colour swatches (from `src/lib/taxonomy.ts`) are data, not UI colours, and always sit on a `borderStrong` ring so
white and black swatches stay visible in both modes.

## Typography (`theme.typography`)
System font (San Francisco / Roboto / system-ui on web): fast, native, scales with the user's text size.

| Variant | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 32 / 38 | 700 | onboarding, big moments only |
| `title` | 24 / 30 | 600 | screen titles |
| `heading` | 18 / 24 | 600 | section headers, card titles |
| `body` | 16 / 22 | 400 | default |
| `label` | 14 / 18 | 500 | buttons, chips, tags |
| `caption` | 12 / 16 | 400 | metadata ("worn 3 times", prices) |

## Spacing, radius, motion
- Spacing (4-pt grid): `xxs 2 · xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · xxxl 48`. Screen padding = `lg`.
- Radius: `sm 6` (chips, swatches), `md 12` (cards, photos), `lg 20` (sheets), `pill` (buttons).
- Motion: `fast 120ms` (press), `base 200ms` (sheets, transitions), `slow 320ms` (rare). Ease-out.
- Photos: items **4:5**, outfits **3:4**, `md` radius, `surfaceSunken` behind background-removed images.

## Navigation (M1 onwards)
Bottom tabs, max 4:
1. **Wardrobe** (grid of items, filters)
2. **Diary** (today's outfit + calendar)
3. **Add** ("Choose from library" first, "Take photo" second; library never asks for camera access; target: item added in < 30 s)
4. **Profile** (style analysis, settings, privacy)

Marketplace and "recreate an outfit" enter as screens inside Wardrobe/Profile until they earn their own tab.
Item and outfit detail screens push on top of the current tab. Camera and tag confirmation are full-screen modals.

## Components
Available now in `@/ui`:
- `Screen` (background, safe areas, padding; `scroll` and `centered` options)
- `Text` (`variant`, `muted`, `tone`)
- `Button` (`primary` / `secondary` / `danger` for confirming destructive actions, `loading`, `disabled`)
- `TextField` (label, hint, error; focus ring in accent)
- `Chip`, `ChipGroup` (single choice; tap again to clear)
- `SwitchRow` (setting with description)
- `Section` (surface card with optional heading)
- `EmptyState` (title, body, one action)
- `ItemCard` (4:5 photo well + optional 1-line label; `uri={null}` is the loading skeleton)
- `PhotoGrid` (equal columns; use `gridColumns(width)` from `src/lib/photo.ts`: 2 on phones, up to 5 on wide web)

Planned for M1 (build them once, here, then reuse): `ColourSwatch`, `Sheet` (bottom sheet),
`TagConfirmRow` (AI tag with "check this" state), `Toast` (errors and confirmations).

## Patterns
- **Loading:** skeletons in the shape of the content (photo wells), not spinners, for lists. Spinner only inside buttons.
- **Empty:** `EmptyState` with one next step ("Add your first item").
- **Errors:** say what happened and what to do, in plain words, with a retry. Never show raw error codes.
- **AI tags:** shown as editable chips. Low-confidence tags get a dotted border and "check this". Never auto-save without
  the user seeing the tags at least once.
- **Shop links:** always labelled "Shop link · we may earn a commission".

## References
Owner-supplied mockups and screenshots live in [`design-references/`](design-references/README.md). They are inspiration,
not rules: this file stays the source of truth until the owners decide on a change.

## Owner decisions
- 2026-11-11: keep the warm paper + clay colours for now.
- 2026-11-11: the app is called **Cloey** in the UI (app name, scheme `cloey://`).
