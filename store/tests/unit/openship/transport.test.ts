import { describe, expect, it, vi } from "vitest";
import { createOpenShipTransport } from "@/lib/openship/transport";

describe("OpenShip transport", () => {
  it("sends a scoped bearer token without caching or following redirects", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { value: "ok" } })));
    const request = createOpenShipTransport({ url: "http://localhost:3002/api/graphql", token: "osp_test_only", fetcher });
    await expect(request("query { value }", {})).resolves.toEqual({ value: "ok" });
    expect(fetcher).toHaveBeenCalledWith("http://localhost:3002/api/graphql", expect.objectContaining({
      method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/json", Authorization: "Bearer osp_test_only" },
      body: JSON.stringify({ query: "query { value }", variables: {} }),
    }));
  });

  it("sanitizes GraphQL failures and never retries a mutation", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { createLink: { id: "partial" } }, errors: [{ message: "secret-token" }],
    })));
    const request = createOpenShipTransport({ url: "http://localhost:3002/api/graphql", token: "osp_test_only", fetcher });
    await expect(request("mutation { createLink { id } }", {})).rejects.toThrow("OpenShip request failed; mutation outcome may be unknown.");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
