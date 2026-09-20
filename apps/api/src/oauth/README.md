# oauth

The OAuth 2.1 authorization server MCP clients connect through. `apps/mcp` is the protected
resource; this app is the only thing that issues or validates a credential.

## Why a client never registers

A `client_id` here is always an https URL that serves a **Client ID Metadata Document**
(draft-ietf-oauth-client-id-metadata-document). There is no dynamic client registration endpoint and
no first-party client table: a client publishes what it would otherwise have POSTed, at a URL only
its owner controls, and this server fetches it. `GET /.well-known/oauth-authorization-server`
advertises `client_id_metadata_document_supported` so a client knows registration is neither needed
nor offered.

The document is held to the same rules a registration request would be, plus the one that matters
most: its `client_id` must equal the URL it was served from. Redirects are refused, since a redirect
would break that equality. The result is cached until the origin's `Cache-Control` says otherwise,
clamped between five minutes and a day; a document that later stops resolving falls back to the last
good copy rather than retracting consent the user has already given.

## Verified and unverified clients

Any client that gets that far may authorize. Publishing a document is a claim anyone can make, and
refusing every unknown client would make this server usable only by clients an operator had heard
of.

`MCP_OAUTH_VERIFIED_CLIENT_IDS` changes what the user is told, not who gets in. A client outside it
still reaches the consent screen — carrying an unverified warning and the hosts approving would send
them to — and the Connected Apps list marks it the same way. Verification is evaluated per read, so
editing the list takes effect without waiting for cached documents to expire.

Entries are whole `client_id` URLs, or a directory prefix ending in `/`. Never a bare host: a host
serves documents written by whoever can publish there. `claude.ai` serves both Claude's own metadata
document and every Artifact its users publish, so trusting the host would vouch for anything anyone
put at `https://claude.ai/public/artifacts/…`. The trailing slash on a prefix is required, or
`…/clients` would also vouch for `…/clientsevil`.

## The metadata fetch is an SSRF surface

The URL being dereferenced arrives from an unauthenticated caller, so `createSafeFetch`
(`packages/services/src/oauth/safe-fetch.ts`) is what stands between `GET /oauth/authorize` and
whatever this deployment's network can reach:

- https only, and no redirects — a redirect would escape every check below.
- The host is resolved once, and **every** address it resolves to must be public unicast. Loopback,
  private, carrier-grade NAT, link-local (`169.254.169.254` is where cloud instance metadata lives),
  multicast, reserved and documentation ranges are all refused, as are the v4 addresses tunnelled
  inside v6 forms (v4-mapped, NAT64, 6to4). One private address in a multi-record answer fails the
  whole request; which address a connection would have picked is not ours to guess.
- Those addresses are then pinned onto the connection. Validating a hostname and handing the
  hostname to `fetch` would leave a DNS-rebinding window in which the second lookup answers
  differently.
- Five-second timeout; the body must be JSON; the body is read against a 64 KiB cap **while
  streaming**, because `content-length` is a claim and a server that omits it must not be able to
  make this process buffer an endless response.

`MCP_OAUTH_ALLOW_PRIVATE_CLIENT_HOSTS=true` opens the address gate for local development against a
client on the same machine. It must never be set in a deployment.

## Where a failure goes

`redirect_uri` is where an error response would be sent, so until the client is resolved **and** the
URI proven to be one it published, an error redirect would be an open redirect carrying this
server's name. Those failures — a `client_id` that is not a metadata document URL, a document that
cannot be read, an unregistered `redirect_uri` — render on the web app's `/oauth/error` page
instead. Everything after that point — a bad `response_type`, a missing `code_challenge`, a denial —
redirects back to the client the way RFC 6749 §4.1.2.1 requires.

## Scopes

One scope, `mcp`. An MCP client that can read a workout can also log a set, and a split this server
did not actually enforce at the tool surface would claim a boundary that is not there. The consent
screen spells out what the single scope grants.

## Tokens

Opaque and stored as sha256 hashes, never JWTs. `apps/mcp` holds no database connection and no
signing key, so it forwards whatever it was given to this app, which is the only process that can
decide what a credential means — and an opaque token stops working the instant a user disconnects
the app, which a self-contained JWT could not.

Both single-use credentials detect replay the same way: the redeemed row is marked consumed rather
than deleted, and presenting a consumed one revokes the whole grant (RFC 6749 §4.1.2,
RFC 9700 §4.14.2). A leaked credential therefore costs the attacker the connection rather than
buying them one.

A grant is pinned to one workspace, resolved at consent time from the user's own workspace.
Workspaces are an internal concept in Phase 1, so consent never asks about one.

## Flow

```mermaid
sequenceDiagram
    participant Client as MCP client
    participant MCP as apps/mcp
    participant Browser
    participant API as apps/api (/oauth)

    Client->>MCP: POST /mcp (no token)
    MCP-->>Client: 401 WWW-Authenticate: resource_metadata=...
    Client->>MCP: GET /.well-known/oauth-protected-resource/mcp
    MCP-->>Client: authorization_servers: [api]
    Client->>API: GET /.well-known/oauth-authorization-server
    Client->>Browser: open GET /api/v1/oauth/authorize (client_id URL, PKCE, state)
    Browser->>API: GET /oauth/authorize
    API->>API: resolve client (allowlist + metadata document), store request
    API-->>Browser: 302 → web app /oauth/consent?request_id=…
    Browser->>API: GET/POST /oauth/consent/{requestId} (session cookie)
    API-->>Browser: { redirectTo: client callback?code=…&state=…&iss=… }
    Browser->>Client: deliver code
    Client->>API: POST /oauth/token (code + code_verifier)
    API-->>Client: access_token + refresh_token
    Client->>MCP: POST /mcp (Authorization: Bearer)
```

## Running the flow locally

The client (Claude, Cursor) and the user's browser both have to reach this server, so `localhost`
alone is not enough. Two public HTTPS tunnels — `ngrok`, `cloudflared`, whichever — one at
`apps/api` and one at `apps/mcp`:

```bash
cloudflared tunnel --url http://localhost:3000   # apps/api
cloudflared tunnel --url http://localhost:3100   # apps/mcp
```

Then point the configuration at those origins, because every URL in a discovery document is built
from them rather than from the request:

| Variable                                                  | Value                   |
| --------------------------------------------------------- | ----------------------- |
| `API_BASE_URL`, `AUTH_BASE_URL` (`apps/api`)              | the api tunnel          |
| `MCP_BASE_URL` (both apps)                                | the mcp tunnel          |
| `API_INTERNAL_BASE_URL` (`apps/mcp`)                      | `http://localhost:3000` |
| `WEB_APP_BASE_URL`, `CORS_ORIGIN`, `AUTH_TRUSTED_ORIGINS` | the web dev server      |

Add the mcp tunnel's `/mcp` URL in the client and it will discover the rest. The client's own
metadata document is fetched outbound from wherever the client publishes it, so it needs no tunnel.

To check discovery without a real client:

```bash
curl -fsS https://<mcp-tunnel>/.well-known/oauth-protected-resource
curl -fsS https://<api-tunnel>/.well-known/oauth-authorization-server
curl -si  https://<mcp-tunnel>/mcp -X POST | grep -i www-authenticate
```

The MCP Inspector (`npx @modelcontextprotocol/inspector`) drives the whole flow, including consent,
against those URLs. If you point it at a `client_id` served from your own machine, the address check
will refuse it — that is what `MCP_OAUTH_ALLOW_PRIVATE_CLIENT_HOSTS=true` is for, locally and
nowhere else.
