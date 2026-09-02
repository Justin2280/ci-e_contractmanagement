import { ClientSecretCredential } from "@azure/identity";

/**
 * Minimal Microsoft Graph client (app-only / client credentials).
 * Plain fetch: we need raw Prefer headers, $value streams and deltaLinks.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPE = "https://graph.microsoft.com/.default";

let credential: ClientSecretCredential | null = null;
let cached: { token: string; expiresOn: number } | null = null;

export function graphConfigured(): boolean {
  return Boolean(process.env.GRAPH_TENANT_ID && process.env.GRAPH_CLIENT_ID && process.env.GRAPH_CLIENT_SECRET);
}

export function sharedMailbox(): string {
  const m = process.env.GRAPH_SHARED_MAILBOX;
  if (!m) throw new Error("GRAPH_SHARED_MAILBOX ontbreekt");
  return m;
}

export async function getGraphToken(): Promise<string> {
  if (cached && cached.expiresOn - 60_000 > Date.now()) return cached.token;
  if (!graphConfigured()) throw new Error("Microsoft Graph is niet geconfigureerd (GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET).");
  credential ??= new ClientSecretCredential(process.env.GRAPH_TENANT_ID!, process.env.GRAPH_CLIENT_ID!, process.env.GRAPH_CLIENT_SECRET!);
  const token = await credential.getToken(SCOPE);
  if (!token) throw new Error("Geen Graph-token verkregen");
  cached = { token: token.token, expiresOn: token.expiresOnTimestamp };
  return token.token;
}

export class GraphError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    public url: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export interface GraphRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  /** Return the raw Response instead of parsed JSON. */
  raw?: boolean;
}

export async function graphFetch<T = unknown>(pathOrUrl: string, opts: GraphRequestOptions = {}): Promise<T> {
  const token = await getGraphToken();
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...opts.headers,
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 429 || res.status === 503) {
      attempt++;
      if (attempt > 3) throw new GraphError(res.status, "throttled", "Graph throttled", url);
      const retry = Number(res.headers.get("retry-after") ?? "2");
      await new Promise((r) => setTimeout(r, Math.min(retry, 10) * 1000));
      continue;
    }
    if (!res.ok) {
      let code: string | undefined;
      let message = res.statusText;
      try {
        const err = (await res.json()) as { error?: { code?: string; message?: string } };
        code = err.error?.code;
        message = err.error?.message ?? message;
      } catch {
        /* ignore */
      }
      throw new GraphError(res.status, code, `Graph ${res.status} ${code ?? ""}: ${message}`, url);
    }
    if (opts.raw) return res as unknown as T;
    if (res.status === 202 || res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

/** Downloads a binary Graph resource (e.g. attachment $value) as a Buffer. */
export async function graphFetchBinary(path: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  const res = await graphFetch<Response>(path, { raw: true, headers: { Accept: "*/*" } });
  const ab = await res.arrayBuffer();
  return { buffer: Buffer.from(ab), contentType: res.headers.get("content-type") };
}

export function encodeUser(upn: string): string {
  return encodeURIComponent(upn);
}
