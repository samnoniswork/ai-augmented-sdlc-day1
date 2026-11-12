# Snip

Snip is a tiny URL shortener with one backend and two clients: an Angular web
app and a Node.js CLI. The link store is an in-memory `Map`, so links disappear
when the server restarts.

## Repository layout

This repository uses one orphan branch per layer. `main` is the superproject;
the component branches keep their files at the branch root and are mounted here
as submodules.

| Branch | Path on `main` | Stack |
| --- | --- | --- |
| `backend` | `backend/` | Zero-dependency Bun API server |
| `frontend` | `frontend/` | Angular 22 web app |
| `cli` | `cli/` | Zero-dependency CommonJS Node.js CLI |
| `bundle` | `bundle/` | Generated release: server, built UI, CLI, Dockerfile |
| `main` | repository root | Submodule pointers, build script, docs, CI |

## API contract

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| `POST` | `/api/links` | `{ "url": "https://example.com" }` | `201` `{ code, url, shortUrl, hits, createdAt }`; `400` `{ error }` for invalid JSON or a non-HTTP(S) URL |
| `GET` | `/api/links` | — | `200` array of link records |
| `GET` | `/:code` | — | `302` to the original URL and increments `hits`; `404` if unknown |

## Clone and run

Use a recursive clone so Git populates all submodule folders:

```sh
git clone --branch main --recurse-submodules https://github.com/samnoniswork/ai-augmented-sdlc-day1.git
```

In separate terminals from the checkout:

The Angular toolchain requires Node.js 22.22.3+ (22.x), 24.15.0+ (24.x), or 26+.

```sh
cd backend && bun start
cd frontend && npm install && npm start
cd cli && node cli.js ls
```

The backend listens on port `3000` by default. The Angular development server
uses port `4200` and proxies `/api` to the backend. The CLI uses
`SNIP_API` or `http://localhost:3000`.

## Updating a component

Edit a component in its submodule, then commit and push that branch. Back in the
superproject, advance and commit its gitlink:

```sh
git submodule update --remote backend
git add backend
git commit -m "Bump backend submodule"
git push
```

Replace `backend` with `frontend` or `cli` as needed. A gitlink pins the
superproject to one exact component commit.

## Building and releasing the bundle

`bundle/` is generated output; do not hand-edit it. From `main`, run:

```sh
node scripts/build-bundle.mjs
```

The script updates the source submodules, builds the Angular app, assembles and
commits the `bundle` branch, then commits the updated `bundle` gitlink on `main`.
Running it again without source changes is a no-op. Use `--push` to push both
commits. The bundle serves the built UI and API from one Bun process:

```sh
cd bundle && bun start
docker build -t snip ./bundle
docker run --rm -p 3000:3000 snip
```

The bundle workflow rebuilds hourly or on manual dispatch. The Docker workflow
publishes `ghcr.io/<owner>/<repo>:latest` and a short-SHA tag when the bundle
gitlink changes; it also supports manual dispatch. The Docker workflow listens
for completion of the bundle workflow because GitHub suppresses downstream
`push` workflow triggers for commits pushed with `GITHUB_TOKEN`.
