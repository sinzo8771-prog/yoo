# Trend sourcing record

## What this records

On **2026-09-17** the dev fixture gained one product — `Stoneware Utensil Crock`
(`store/scripts/fixture/catalog-fixture.ts`) — as the first concrete pass at plan
**Task 22, Step 1** ("choose 10–30 products in one niche"). Nothing here is a
production listing.

## Method and evidence tags

Public web research with Firecrawl: search first, then fetch the pages that
looked primary. A search snippet is not the same evidence as a fetched page, so
every claim is tagged:

- **[F] fetched** — page retrieved and read
- **[S] snippet only** — search-index summary; the page body was not retrieved
  (bot protection)
- **[X] not verified**

## Signals

### 1. Countertop storage and organisers

- **Glimpse, "Top 21 Kitchen Trends of 2026"** — **[F]** (62,963 chars). Its
  section "Overflowing fridges fuel organizers" reports fridge storage
  containers as "an increasingly popular innovation in current kitchen trends",
  driven by waste: "Americans on average discard over 100 pounds of food from
  their fridges each year, often because they literally can't see what they're
  missing." The same page cites a 30% increase in average online-grocery cart
  size and a ~300,000-member "Fridge Detectives" community on Reddit. Its charted
  demand series (relative index, 2021→2025) rise for storage/countertop forms,
  e.g. "fridge drawer" 35K→139K and "quad-door fridge" 2.3K→9.3K.
- **Yahoo Shopping / Livingetc, "These Are Officially the Biggest Storage Trends
  for Kitchens in 2026"** — **[F]** (12,420 chars). Its named trends are
  *built-in* cabinetry (toe-kick drawers, false-front sink drawers, behind-door
  racks). Good demand context, but not shippable SKUs.

### 2. Nostalgia / "grandmacore" tableware

- **Country Living, "Grandmacore Kitchens Are Taking Over in 2026"** — **[F]**
  (16,477 chars). Defines the look as a "romanticized, nostalgic version of
  traditional, heartfelt, homespun interiors", notes "wood tones abound", and
  summarises the demand as: "People are clamoring for kitchens that feel real and
  not like a sanitized showroom space that no one actually uses."
- **The widely repeated "+545% for grandmacore kitchens" figure** is attributed
  to Pinterest's Spring Trend Report 2026. Pinterest's own pages returned
  HTTP 403 to retrieval, so it is **[S] snippet only** here — second-hand, and
  must not be quoted as verified.
- Trade/editorial coverage of nostalgic tableware demand ([S], e.g.
  giftsanddec.com "Is Grandma's Kitchen Cool Again?") is directionally the same
  claim at snippet level only.

### 3. The specific shape — a utensil crock

All **[S]**: Amazon maintains a Best Sellers category "Utensil Crocks"; Serious
Eats published "The 4 Best Utensil Crocks, Tested & Reviewed" dated 2026-07-17;
New York Magazine's Strategist ran "Put Your Kitchen Utensils in a Stylish
Crock". Together these indicate an actively merchandised, editorially covered
category in 2026 rather than a dead one.

## Why this product for this store

Northwind Goods already sells oak, linen and stoneware ("considered objects for
everyday life"). A reactive-glaze stoneware crock sits on the same material
story as the existing `Stoneware Mug` and answers the storage signal above at
countertop scale, so it is a same-niche addition rather than a category jump.

## What this does not establish

- **No sales, margin or conversion data.** Category interest is not purchase
  intent, and none of these sources report this store's numbers.
- **No supplier availability, landed cost, weight or US-warehouse stock.** The
  real gate for a dropship SKU is sourcing it at a price that leaves margin —
  **[X] unverified**. CJ's fee page (**[F]**, `cjdropshipping.com/service-fee`)
  shows free inbound and 90-day storage in its CN and US warehouses and no
  monthly membership line item, but says nothing about whether it stocks this
  item or at what price.
- **No SKU mapping.** `DEV-CROCK-5` / `DEV-CROCK-7` are placeholders, not
  supplier SKUs, and both variants are manual-fulfillment until **Task 22, Step 3**
  maps them 1:1 or records an explicit manual rule.
- **No media.** **Task 22, Step 4** (dimensions, alt text, file size, licence
  record) is untouched — the fixture stores no images at all.
- Title, subtitle and description are **original merchandising copy** written for
  this fixture (**Task 22, Step 2**), not supplier copy.

## Status and next steps

- Lives only in the `devfix_` namespace. `npm run seed:dev` creates/updates it;
  `npm run seed:dev -- --purge` removes it and nothing else.
- It is `published` **in the fixture only**, because the storefront reads just
  published products. It is not a production listing and must not be presented
  as one.
- To promote it: confirm supplier availability and landed cost for both sizes in
  a US warehouse, replace the placeholder SKUs with a mapped SKU or an explicit
  manual-fulfillment rule, add licensed media, then seed through the **Task 22**
  production seeder with human approval.
- Re-check the storage signal in ~30 days and drop the product if category
  interest does not hold.
- The catalog ceiling stays 10–30 products in one niche (**Task 22, Step 1**);
  this fixture product does not authorise expansion beyond it.

## Source index

| Source | Tag | Used for |
| --- | --- | --- |
| `meetglimpse.com/trends/kitchen-trends/` | [F] | storage demand, waste driver |
| `shopping.yahoo.com/.../officially-biggest-storage-trends-kitchens-070000319.html` | [F] | 2026 kitchen-storage trends |
| `countryliving.com/home-design/a70966358/grandmacore-kitchens-trend/` | [F] | nostalgia trend |
| `cjdropshipping.com/service-fee` | [F] | supplier fee structure (not stock) |
| `newsroom.pinterest.com/news/spring-trend-report-2026/` | [S] | "+545%" claim (403) |
| Amazon Best Sellers "Utensil Crocks"; Serious Eats 2026-07-17; NY Mag Strategist | [S] | category activity |
