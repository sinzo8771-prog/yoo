import type { NextConfig } from 'next';

import { collectImageHosts, toRemotePatterns } from './lib/media/images';

/**
 * Task 20, Step 2 — the image optimizer allowlist.
 *
 * `lib/media/images.ts` parses the hosts this deployment actually serves
 * catalog media from (backend origin, media store, any operator-declared
 * supplier CDN) and rejects anything malformed. Before this, the config
 * hard-coded `protocol: 'https'` and `port: ''`, so an `http://localhost:3000`
 * backend — the documented local setup — could not be optimized at all, and an
 * unset `S3_ENDPOINT` produced a pattern with `hostname: '/'` that could never
 * match. Everything now derives from one place, and a host we have not declared
 * falls back to an unoptimized `<img>` instead of a 400 from the optimizer
 * (see components/media/ProductImage.tsx).
 */
const imageHosts = collectImageHosts(process.env);

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ['graphql'],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  // Workaround since we diverged from Keystone reltionship and document views
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: toRemotePatterns(imageHosts),
    // Catalog media is immutable per URL (the backend writes a new path on
    // re-upload), so the optimizer's own cache can hold a transformed variant
    // for a month instead of re-fetching supplier origins on every deploy.
    minimumCacheTTL: 2678400,
  },
};

export default nextConfig;
