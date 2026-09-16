#!/usr/bin/env node
/**
 * Health check — verifies that Keystone GraphQL endpoints respond.
 * Dependency-free (Node 18+ global fetch). Never sends credentials.
 *
 * Usage:
 *   node scripts/healthcheck.mjs                     # checks default local endpoints
 *   node scripts/healthcheck.mjs http://host:3000 …  # checks custom endpoints
 */

// This repo runs the custom storefront on 3000, so Openfront cannot claim its
// upstream default of 3000 — it runs on 3001 (see openfront/.env PORT and
// env-templates/store.env.example).
const DEFAULTS = [
  { name: "openfront", url: "http://localhost:3001/api/graphql" },
  { name: "openship", url: "http://localhost:3002/api/graphql" },
];

const targets = process.argv.length > 2
  ? process.argv.slice(2).map((url) => ({ name: url, url }))
  : DEFAULTS;

const query = JSON.stringify({ query: "{ __typename }" });

let failures = 0;

for (const { name, url } of targets) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: query,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      failures++;
      console.log(`✗ ${name}  ${url}  HTTP ${res.status}`);
      continue;
    }
    const body = await res.json();
    if (body?.data?.__typename) {
      console.log(`✓ ${name}  ${url}  graphql ok (${Date.now() - started}ms)`);
    } else {
      failures++;
      console.log(`✗ ${name}  ${url}  unexpected response: ${JSON.stringify(body).slice(0, 120)}`);
    }
  } catch (err) {
    failures++;
    console.log(`✗ ${name}  ${url}  ${err.name === "AbortError" ? "timeout (5s)" : err.message}`);
  }
}

process.exit(failures > 0 ? 1 : 0);
