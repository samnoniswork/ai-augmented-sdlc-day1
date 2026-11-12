# Snip backend

A zero-dependency Bun URL shortener. Links are stored in memory and disappear on restart.

Run `bun start` (port 3000 by default). Set `PORT` to change the port and `BASE_URL`
to the public origin used in short links. Without `BASE_URL`, the server uses
`https://<RAILWAY_PUBLIC_DOMAIN>` if set, otherwise `http://localhost:<PORT>`.
Optionally set `PUBLIC_DIR` to serve files from that directory; existing files take
precedence over matching short codes.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/links` | `{ "url": "https://example.com" }` returns 201 with `{ code, url, shortUrl, hits, createdAt }`; invalid JSON or URLs return 400 `{ error }`. |
| GET | `/api/links` | 200 with all link records. |
| GET | `/:code` | 302 to the original URL and increments hits, or 404 for an unknown code. |

Codes have six base62 characters, hits start at zero, and `createdAt` is an ISO timestamp.
The API allows cross-origin requests and answers OPTIONS preflight requests.

Run `bun test` for the backend integration checks.
