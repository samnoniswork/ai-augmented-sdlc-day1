# Snip frontend

Angular 19 client for the Snip URL shortener. It creates links and displays their
original URL, short link and hit count using the shared `/api/links` API.

Run the backend on port 3000, then run `npm install` and `npm start` here.
Open `http://localhost:4200`. The development server proxies `/api` to
`http://localhost:3000`; the production build uses the same origin as the page,
so the bundled Bun server serves both the app and its API.

Run `npm run build` to generate `dist/snip-frontend/browser` and
`npm test -- --watch=false` for component tests (requires Chrome).
