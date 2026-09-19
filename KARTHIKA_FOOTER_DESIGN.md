# Karthika Footer Design System

## Modern Editorial Grocery Footer: "Good Food. Good Mood."

### 1. Purpose

This document defines the visual and interaction direction for the Karthika modern footer.

The footer should feel like a **premium modern grocery/e-commerce brand**, not a traditional corporate footer or a default Shopify/Dawn footer.

The approved visual direction is centered around:

> **GOOD FOOD.**  
> **GOOD MOOD.**

The design should feel:

- modern
- editorial
- premium
- warm
- confident
- playful but not childish
- clean
- distinctly Karthika

Do not redesign the rest of the storefront when implementing this design.

---

## 2. Core Visual Direction

The footer is a **brand closing experience**, not simply a collection of links.

Visual hierarchy:

1. Strong brand statement
2. Supporting grocery imagery / visual element
3. Primary shopping CTA
4. Brand/contact information
5. Navigation
6. Newsletter
7. Payment methods
8. Legal/copyright

Avoid making every element visually equal.

The headline must be the strongest visual element.

---

## 3. Primary Brand Concept

### Hero Headline

Use:

**GOOD FOOD.**  
**GOOD MOOD.**

The headline should be large, bold, and editorial.

### Typography

Use the project's existing preferred brand font if available.

Do not introduce a random new font.

Preferred characteristics:

- heavy/bold weight
- slightly tight letter spacing
- large display size
- compact line height
- strong visual presence

Desktop target:

- 72-92px
- font weight: 750-900
- line height: 0.88-0.95
- letter spacing: -0.05em to -0.07em

Mobile target:

- 47-72px
- responsive with `clamp()`

---

## 4. Color System

### Primary Footer Background

```text
#183719
```

Rich, premium deep green. Do not use pure black.

### Secondary Green

```text
#315F2B
```

For supporting surfaces, gradients, and decorative elements.

### Deep Green

```text
#21451E
```

For darker visual layers and hover states.

### Accent Lime

```text
#D9EC78
```

Use for:

- "GOOD MOOD." headline
- eyebrow text
- active accents
- important icons
- primary CTA background
- small decorative dots
- hover emphasis

Do not overuse it.

### Yellow

```text
#F5DC4D
```

Use sparingly for tiny decorative highlights and brand accents.

### Main Text

```text
#F7F8F2
```

For primary headings and important labels.

### Muted Text

```text
rgba(247, 248, 242, 0.66)
```

For descriptions, secondary navigation, contact information, and supporting copy.

Do not make muted text too faint.

---

## 5. CTA Color Correction

**Important:** The primary CTA must not use white text on the light/lime background.

### Primary CTA

```text
Background: #D9EC78
Text: #183719
Border: none
Radius: 14px
```

Example:

**[ Shop groceries ]**

### Secondary CTA

```text
Background: rgba(255,255,255,.04)
Text: #F7F8F2
Border: rgba(255,255,255,.13)
Radius: 14px
```

Example:

**[ My account ]**

The primary action should visually dominate.

---

## 6. Footer Hero

Desktop structure:

```text
+---------------------------------------------------------+
|                                                         |
|  KARTHIKA SUPERMARKET                    [Visual]       |
|                                                         |
|  GOOD FOOD.                                             |
|  GOOD MOOD.                               grocery       |
|                                             visual      |
|  Everyday groceries, familiar favourites                |
|  and fresh finds - all in one place.                    |
|                                                         |
|  [ Shop groceries ] [ My account ]                      |
|                                                         |
+---------------------------------------------------------+
```

Use a two-column layout.

Approximate split:

- left: 60-70%
- right: 30-40%

The visual must support the headline, not overpower it.

---

## 7. Hero Eyebrow

Use a small pill:

```text
* KARTHIKA SUPERMARKET
```

Style:

- lime/green text
- subtle transparent green background
- thin translucent border
- rounded pill
- 10-11px
- strong letter spacing
- yellow dot as a tiny brand accent

---

## 8. Hero Description

Use short editorial copy:

> Everyday groceries, familiar favourites and fresh finds - all in one place.

Recommended:

- 15-16px desktop
- 14px mobile
- line height: 1.6-1.7
- muted white
- maximum width around 540-580px

---

## 9. Hero Visual

The right side should contain a visual element.

Preferred order:

1. Merchant-selected Karthika/grocery image
2. Existing project asset
3. Built-in abstract grocery-inspired fallback

Do not use random external image URLs.

Visual characteristics:

- 24-30px rounded corners
- subtle border
- dark green overlay
- soft gradient
- editorial crop

Optional overlay:

```text
FROM KARTHIKA

Your everyday
grocery stop.
```

---

## 10. Hero Buttons

Use:

```text
[ Shop groceries ] [ My account ]
```

Primary:

```text
Background: #D9EC78
Text: #183719
```

Secondary:

```text
Background: transparent / subtle white overlay
Text: #F7F8F2
Border: rgba(255,255,255,.13)
```

Both:

- minimum height: 46-48px
- radius: 13-14px
- horizontal padding: 16-20px
- font weight: 700-800

Hover:

- subtle translateY(-2px)
- no exaggerated animation

---

## 11. Brand / Navigation Area

Below the hero, use:

```text
BRAND        SHOP        HELP        COMPANY
```

Recommended grid:

```text
1.15fr 1fr 1fr 1fr
```

The brand/contact column can be slightly wider.

---

## 12. Brand Column

Include:

- Karthika logo
- short brand description
- social icons
- contact information

Description:

> Quality groceries, snacks, beverages and household essentials for everyday life.

Keep it short.

Do not repeat the hero headline here.

---

## 13. Social Icons

Only render configured social networks.

Never invent URLs.

Use existing Shopify/theme social settings.

Visual style:

- 38x38px
- 10-12px radius
- subtle translucent background
- thin border
- white icon
- lime hover state

Hover:

- border -> lime
- background -> subtle lime
- icon -> lime
- translateY -> -2px

---

## 14. Navigation Columns

Suggested headings:

```text
SHOP
HELP
COMPANY
```

Heading:

- 10-12px
- font weight: 800
- letter spacing: 0.12-0.15em
- uppercase

Links:

- 13-14px
- muted white
- line height: 1.4-1.5
- approximately 10-12px vertical spacing

Hover:

- color -> #D9EC78
- translateX -> 2-3px

Do not use unnecessary underlines.

---

## 15. Contact Information

Use real configured Shopify/theme values.

Current Karthika information:

```text
34 Buffalo Road, Singapore 219796
(65) 6297 7533
grocery@karthika.sg
GST Registration Number: 200311912H
```

Do not invent or alter these values.

Phone:

```text
tel:
```

Email:

```text
mailto:
```

Use small line icons:

- location
- phone
- email

Icons should be lime.

---

## 16. GST

Keep GST visually secondary.

Example:

```text
GST 200311912H
```

Use:

- small font
- muted color
- subtle top border
- strong **GST** label

Do not make it a large card.

---

## 17. Newsletter

Use a horizontal editorial section.

Example:

```text
STAY FRESH

Fresh picks.
Better deals.

Get new product updates and offers.

                         [ Your email address        -> ]
```

Desktop:

- two columns
- copy left
- form right

Mobile:

- stack vertically

---

## 18. Newsletter Form

Keep the Shopify customer form.

Do not replace it with fake JavaScript-only behavior.

Input:

- height: 53-56px
- radius: 16-17px
- background: rgba(255,255,255,.055)
- border: rgba(255,255,255,.16)
- text: #FFFFFF
- placeholder: rgba(255,255,255,.43)

Submit button:

```text
Background: #D9EC78
Color: #183719
```

Use an arrow icon.

---

## 19. Payment Methods

Payment methods should be visually small.

Do not let payment logos dominate the footer.

Use Shopify:

```liquid
shop.enabled_payment_types
```

Each item:

- 44-48px wide
- 27-30px high
- small radius
- subtle border

Payment methods belong near the bottom.

---

## 20. Bottom Bar

Desktop:

```text
(c) 2026, Karthika - All rights reserved.

                         VISA  MC  AMEX ...
                         Privacy - Terms - Refunds
```

Keep it compact.

Use:

- 11-12px text
- muted color
- restrained spacing

---

## 21. Mobile Design

At 320-430px:

```text
Karthika logo

Good Food.
Good Mood.

Description

[ Shop groceries ]
[ My account ]

Visual

Brand/contact

Shop       Help
Company    ...

Newsletter

Payments

Copyright
Policies
```

Do not make the footer a giant wall of text.

---

## 22. Responsive Breakpoints

Review at:

```text
320px
375px
390px
414px
768px
900px
1024px
1440px
```

There must be:

- no horizontal page overflow
- no clipped buttons
- no clipped headline
- no overlapping text
- no broken payment logos
- no broken newsletter input
- no content hidden behind mobile navigation

---

## 23. Mobile Bottom Navigation

Karthika has a fixed mobile bottom navigation.

The footer must leave enough bottom spacing so:

- copyright remains visible
- policy links remain visible
- footer content is not hidden underneath the fixed navigation

Do not modify the bottom navigation itself.

---

## 24. Animation

Keep motion subtle.

Allowed:

- CTA translateY(-2px)
- link translateX(2-3px)
- social icon translateY(-2px)
- small hover transitions

Do not use:

- aggressive bouncing
- infinite animations
- excessive parallax
- distracting moving graphics

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

---

## 25. Shadows

Avoid generic large shadows.

The dark footer should provide most of the depth.

Prefer:

- translucent borders
- subtle background layers
- restrained shadows only where necessary

---

## 26. Border Radius

Use a consistent Karthika radius language:

Small:

```text
10-12px
```

Buttons:

```text
13-14px
```

Cards:

```text
24-30px
```

Avoid mixing many unrelated radius values.

---

## 27. Important Design Principle

The footer should not look like:

```text
LOGO
Address
Phone
Email
Links
Payment logos
Copyright
```

That is the old/basic pattern.

It should feel like:

```text
          KARTHIKA SUPERMARKET

          GOOD FOOD.
          GOOD MOOD.

          Everyday groceries,
          familiar favourites
          and fresh finds.

          [ Shop groceries ] [ My account ]

                    [ Visual ]

------------------------------------------------------------

BRAND          SHOP          HELP          COMPANY

------------------------------------------------------------

STAY FRESH

Fresh picks.
Better deals.

                         [ email              -> ]

------------------------------------------------------------

(c) Karthika                         Payments
                                   Privacy - Terms
```

The footer is a **brand experience**, not merely a sitemap.

---

## 28. What Must Not Change

Preserve:

- Shopify newsletter form
- Shopify navigation
- Shopify policies
- Shopify payment methods
- Shopify account routes
- Shopify cart routes
- real contact information
- social settings
- current responsive fixes
- current accessibility fixes

Do not introduce:

- fake URLs
- fake social accounts
- fake payment providers
- fake store information
- random external image URLs
- external icon libraries
- fake newsletter submission
- fake customer functionality

---

## 29. Implementation Priority

### P0 - Visual hierarchy

The footer must immediately communicate:

**Karthika -> Good Food -> Good Mood**

### P1 - CTA contrast

Primary CTA:

```text
#D9EC78 background
#183719 text
```

Never use white text on the light lime button.

### P1 - Typography

The headline must be the dominant text.

### P1 - Layout

Hero + visual should feel balanced.

### P2 - Navigation

Clean, compact columns.

### P2 - Contact

Useful but secondary.

### P2 - Newsletter

Strong but not overpowering.

### P3 - Payment/legal

Small and restrained.

---

## 30. Final Acceptance Criteria

The footer is visually correct when:

- It does not resemble the default Dawn footer.
- "GOOD FOOD. GOOD MOOD." is the visual focal point.
- "GOOD MOOD." uses the lime accent.
- The primary "Shop groceries" CTA uses dark green text on lime.
- The secondary "My account" CTA uses light text on the dark background.
- The hero visual supports the brand without dominating it.
- Navigation is clean and compact.
- Contact information feels integrated rather than like a large support box.
- Newsletter feels editorial and premium.
- Payment icons are secondary.
- The footer feels like a deliberate Karthika brand experience.
- Mobile remains clean and does not become excessively tall.
- There is no horizontal overflow.
- Existing Shopify functionality remains intact.

---

## 31. Final Design Statement

**Karthika should end the page with personality.**

The footer should leave the customer with:

> **GOOD FOOD. GOOD MOOD.**

It should feel like the final brand statement of a modern grocery store - confident, warm, clean, slightly playful, and premium.
