export type OpenShipRequest = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

/** Internal operator transport. Never expose this factory through a server action. */
export function createOpenShipTransport(options: {
  url: string;
  token: string;
  fetcher?: typeof fetch;
}): OpenShipRequest {
  if (typeof window !== "undefined") {
    throw new Error("OpenShip operator transport is server-only.");
  }

  const url = new URL(options.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash ||
      !/^osp_[A-Za-z0-9_-]+$/.test(options.token)) {
    throw new Error("Invalid OpenShip configuration.");
  }
  const fetcher = options.fetcher ?? fetch;
  return async <T>(query: string, variables: Record<string, unknown>): Promise<T> => {
    try {
      const response = await fetcher(url.href, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.token}` },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error();
      const body = await response.json();
      if (!body || (body.errors !== undefined &&
          (!Array.isArray(body.errors) || body.errors.length > 0)) ||
          !body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
        throw new Error();
      }
      return body.data as T;
    } catch {
      // Never echo provider bodies, tokens, URLs, or nested causes. Never retry writes.
      throw new Error("OpenShip request failed; mutation outcome may be unknown.");
    }
  };
}
