import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // OpenShip's Keystone context must never boot inside the store test
      // harness — replace it with the mutable stub below. Order matters: the
      // specific stub alias wins over the openship feature mappings, which win
      // over the store-root catch-all.
      //
      // Only OpenShip's own feature trees are remapped. A bare `@/features`
      // alias would shadow the store's `@/features/storefront/*` namespace
      // (cart, catalog, checkout modules all resolve through the catch-all).
      "@/features/keystone/context": fileURLToPath(new URL("./tests/stubs/openship-keystone-context.ts", import.meta.url)),
      "@/features/keystone": fileURLToPath(new URL("../openship/features/keystone", import.meta.url)),
      // The pinned create-order route and its adapters import the executor and
      // channel helpers through the OpenShip app alias. Scoped to
      // integrations/shop: the store has its own `features/integrations`
      // (payment, shipping) namespace under the catch-all below.
      "@/features/integrations/shop": fileURLToPath(new URL("../openship/features/integrations/shop", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});