# Performance Budget & Guidelines (Task 20, Step 5)

This document establishes concrete, deterministic performance thresholds and operational guidelines for the Next.js storefront deployment.

---

## 1. Core Web Vitals Targets

The storefront targets standard 75th-percentile (p75) field performance across mobile and desktop connections:

| Metric | Target (Good) | Needs Improvement | Poor | Primary Drivers & Optimizations |
| :--- | :--- | :--- | :--- | :--- |
| **LCP** (Largest Contentful Paint) | **≤ 2.5s** | 2.5s – 4.0s | > 4.0s | Hero image & product gallery hero loading; eager fetching; responsive sizes; CDN edge caching. |
| **FID / INP** (Interaction to Next Paint) | **≤ 200ms** | 200ms – 500ms | > 500ms | Minimal client JS runtime; no heavy animation engines on critical path; lightweight state containers. |
| **CLS** (Cumulative Layout Shift) | **≤ 0.1** | 0.1 – 0.25 | > 0.25 | Fixed aspect ratio wrappers (`aspect-square`); explicit intrinsic dimensions; font preloading with fallback metrics. |
| **FCP** (First Contentful Paint) | **≤ 1.8s** | 1.8s – 3.0s | > 3.0s | Server component rendering; streamable RSC boundaries; zero render-blocking client scripts. |
| **TTFB** (Time to First Byte) | **≤ 0.8s** | 0.8s – 1.8s | > 1.8s | Edge caching for public catalog routes; minimal synchronous upstream database roundtrips. |

---

## 2. JavaScript Bundle Budget

The storefront keeps client JavaScript footprint lean by defaulting to React Server Components (RSC) and isolating interactivity to leaf components.

### 2.1 Thresholds

- **Initial Shared Client JS (First Load JS)**: **≤ 125 KB** (gzipped) across common shared chunks. Current baseline is ~102 KB.
- **Per-Route Client JS Added**: **≤ 50 KB** (gzipped) per route.
- **Total Route Page JS (Shared + Page chunk)**: **≤ 160 KB** (gzipped).
- **External Heavy Dependencies**:
  - `framer-motion`: **0 KB** on active routes (prohibited on customer-facing critical path; CSS transitions and `@number-flow/react` utilized instead).
  - Canvas / WebGL shaders: **0 KB** on customer-facing routes (legacy dots-shader modules removed).

### 2.2 CI Verification

Bundle budgets are evaluated during Next.js production builds (`next build`). A PR that increases the shared initial bundle above 135 KB or adds a client bundle exceeding the per-route budget triggers code review.

---

## 3. Image Delivery Policy & Intrinsic Sizing

All catalog images are external supplier or object-storage assets. To prevent shipping raw, unoptimized 5MB+ supplier photographs to mobile clients, all catalog images MUST pass through `components/media/ProductImage.tsx`.

### 3.1 Allowlisted Optimizer vs Fallback Degradation

1. **Allowlisted Hosts (`NEXT_PUBLIC_IMAGE_HOSTS`, `S3_ENDPOINT`, `NEXT_PUBLIC_BACKEND_URL`)**:
   - Next.js image optimizer converts images into modern responsive WebP/AVIF formats.
   - Enforces `sizes` attributes tailored to viewport breakpoints (e.g., `(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw`).
   - Image payloads on mobile are kept under **100 KB** per product thumbnail.
2. **Un-allowlisted Supplier Domains**:
   - Degrades safely to a native `<img>` tag without throwing optimizer 400 errors or showing broken images.
   - **Operator Action Required**: Operators must add new supplier media domains to `NEXT_PUBLIC_IMAGE_HOSTS` in `.env` so Next.js can optimize them.

### 3.2 Layout Shift Prevention

- Product cards and gallery containers must always maintain a fixed aspect ratio container (e.g. `aspect-square`, `aspect-[4/3]`) with `relative overflow-hidden`.
- Image components fill the container using `fill` or `h-full w-full object-cover`.
- Missing or failed images display a consistent fallback placeholder without collapsing container geometry.

---

## 4. Accessibility & Reduced Motion Standards

- **Reduced Motion**: All animations and transforms must respect `prefers-reduced-motion: reduce`. The `MotionPreference` provider syncs CSS tokens, and CSS transitions use `motion-reduce:transition-none` or equivalent graceful degradation.
- **Landmarks**: Exactly one `<main id="main-content">` landmark per rendered page. Global layout (`app/layout.tsx`) does not nest `<main>`.
- **Keyboard Navigation & Skip Link**: All pages provide an accessible skip link (`<a href="#main-content" className="skip-link">`) as the first focusable element.
- **Accessible Names**: All icon-only buttons (`DeleteButton`, mobile menu toggles, expand/collapse shipment accordions) must provide clear `aria-label` attributes.
- **Images**: Alt text is contextual. Decorative thumbnails beside text links use empty `alt=""` to avoid repetitive screen reader announcements.
