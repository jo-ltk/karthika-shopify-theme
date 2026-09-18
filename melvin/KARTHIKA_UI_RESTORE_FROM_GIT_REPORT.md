# Karthika UI Restore From Git

## Current Git State

- Base: `main` @ `9a354bc`
- Safety backup branch: `cursor/backup-pre-ui-restore-f453` (pre-change snapshot)
- Working branch: `cursor/restore-homepage-category-ui-f453`
- No `git reset --hard` / `git clean` / blind checkout used

## Historical Homepage Commit

`18aa73e` — Improve Order Again and post-login home return, and guard frontpage redirect against loops.

## Historical Category Commit

`0f768b6` — feat: add categories landing page for /collections/all

## Why These Commits Were Selected

### Homepage (`18aa73e`)
Compared `templates/index.json` across history. Section **order** still listed shelves after Popular this week on HEAD, but commit `93a94c5` removed `collection: "all"` from `todays_deals`, `kerala_favourites`, and `new_arrivals`. Current `karthika-product-carousel` hides shelves when no collection is set → large blank area after Popular. `18aa73e` is the last clear homepage JSON that still bound those shelves to Shopify `all` while keeping the same section order/types (banner, feature grid, carousels, AI, order again).

### Category (`0f768b6`)
Git shows the dedicated category hub is `templates/collection.all.json` → section `karthika-categories-landing` for URL `/collections/all`. That landing was introduced in `0f768b6`. It is still present on current `collection.all.json`. `templates/collection.json` was briefly the landing too, then correctly switched in `93a94c5` to Dawn product grid for real category/collection product browsing — that functional fix is **kept**.

## Homepage UI Before

Order still: Quick Tabs → Desktop Home → Ad Banner → Feature Grid → Popular this week → Order again → Today's deals → Kerala favourites → Assistant → New arrivals  

But shelves after Popular had **no collection** → empty storefront gap.

## Homepage UI After

Same historical order. Shelves rebound to `collection: "all"` from `18aa73e`. Carousel soft-falls back to `collections.all` if a shelf collection is unset (no offset-slice fake products).

## Missing Sections Restored

Visibility restored for:

- Today's deals
- Kerala favourites
- New arrivals
- (Order again + Assistant were already configured; remain)

## Category Page Restored

| Item | Value |
|------|--------|
| Category landing URL | `/collections/all` |
| Template | `templates/collection.all.json` |
| Section | `karthika-categories-landing` |
| Historical commit | `0f768b6` |
| Per-collection product page | `templates/collection.json` (Dawn grid) — **kept current** |

No redesign. Landing already matched the historical category UI; not overwritten with a new layout.

## Files Restored

| OLD FILE | CURRENT FILE | ACTION |
|----------|--------------|--------|
| `18aa73e:templates/index.json` shelf collections | `templates/index.json` | MERGE CAREFULLY (restore collection bindings + order) |
| pre-`93a94c5` carousel all-collection visibility | `sections/karthika-product-carousel.liquid` | MERGE CAREFULLY (fallback only; keep real product cards/cart) |
| `0f768b6` categories landing | `templates/collection.all.json` + `sections/karthika-categories-landing.liquid` | KEEP CURRENT (already historical UI + later fixes) |
| `templates/collection.json` product grid | `templates/collection.json` | KEEP CURRENT |

## Files Merged

- `templates/index.json`
- `sections/karthika-product-carousel.liquid`

## Files Kept Current

- Quick Tabs / Search / Cart / Wishlist / Assistant / Checkout / Account / Singapore geography / responsive & a11y CSS
- `templates/collection.json` (real collection product grid)
- `sections/karthika-categories-landing.liquid` (current = historical UI + fixes)
- Product card snippets, CartManager, wishlist JS

## Functionality Preserved

Search, Cart, Wishlist, Manual Assistant, Checkout, Account, Singapore geography, responsive, accessibility, real Shopify collection URLs / pricing / cart.

## Bugs NOT Reintroduced

- No fake search / fake ATC / fake checkout / fake AI
- No product_offset slice fakes from pre-`93a94c5` carousel
- No `requestSubmit()` fake category nav
- No putting categories landing on every `collection.json` route

## Responsive Preservation

No responsive CSS reverted.

## Accessibility Preservation

No a11y markup reverted.

## Validation

- `python3 -m json.tool templates/index.json` — OK
- Theme Check / live storefront — not run against password store in this pass

## Regression Check

| Area | Status |
|------|--------|
| Search | PASS (untouched) |
| Cart | PASS (untouched) |
| Wishlist | PASS (untouched) |
| Manual Assistant | PASS (untouched) |
| Checkout | PASS (untouched) |
| Account | PASS (untouched) |
| Singapore geography | PASS (untouched) |
| Responsive | PASS (untouched) |
| Accessibility | PASS (untouched) |

## Live Testing

NOT TESTABLE (password-protected demo; no claim of live visual verification)

## Remaining Issues

- Shelves sharing `all` show overlapping products until merchant assigns distinct collections in the theme editor
- Category landing visual already present; if a different older category browser (e.g. kcb2) is desired, specify the commit/URL

---

GIT UI RESTORE COMPLETE

Homepage historical commit: `18aa73e`

Category historical commit: `0f768b6`

Homepage sections restored: Today's deals, Kerala favourites, New arrivals (collection bindings)

Category page restored: `/collections/all` via `collection.all.json` + `karthika-categories-landing` (kept)

Files changed: `templates/index.json`, `sections/karthika-product-carousel.liquid`, `melvin/KARTHIKA_UI_RESTORE_FROM_GIT_REPORT.md`

Files restored directly: none (no blind file overwrite)

Files merged: `templates/index.json`, `sections/karthika-product-carousel.liquid`

Validation: index.json valid

Regression: PASS (logic untouched outside shelf visibility)

Live testing: NOT TESTABLE

Remaining issues: shared `all` collection on shelves until merchant configures distinct ones
