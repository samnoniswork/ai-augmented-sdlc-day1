import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const port = Number(process.env.PORT ?? 3000);
const baseUrl = (
  process.env.BASE_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${port}`)
).replace(/\/+$/, "");
const publicDir = process.env.PUBLIC_DIR ? await realpath(process.env.PUBLIC_DIR) : null;
const links = new Map();
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(value, status = 200) {
  return Response.json(value, { status, headers: cors });
}

function newCode() {
  let code = "";
  while (code.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(6 - code.length));
    for (const byte of bytes) {
      if (byte < 248) code += alphabet[byte % alphabet.length];
    }
  }
  return links.has(code) ? newCode() : code;
}

async function staticFile(pathname) {
  if (!publicDir) return null;
  let name;
  try {
    name = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    return null;
  }
  if (name.includes("\0")) return null;
  const candidate = resolve(publicDir, `.${name}`);
  const relativePath = relative(publicDir, candidate);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    return null;
  }
  try {
    const actual = await realpath(candidate);
    const actualRelative = relative(publicDir, actual);
    if (actualRelative === ".." || actualRelative.startsWith(`..${sep}`) || isAbsolute(actualRelative)) {
      return null;
    }
    if (!(await stat(actual)).isFile()) return null;
    return Bun.file(actual);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

Bun.serve({
  port,
  async fetch(request) {
    try {
      const { pathname } = new URL(request.url);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: cors });
      }

      if (pathname === "/api/links") {
        if (request.method === "GET") return json([...links.values()]);
        if (request.method === "POST") {
          let body;
          try {
            body = await request.json();
          } catch {
            return json({ error: "Invalid JSON" }, 400);
          }
          if (!body || typeof body.url !== "string") {
            return json({ error: "A valid HTTP or HTTPS URL is required" }, 400);
          }
          try {
            const url = new URL(body.url);
            if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Invalid protocol");
          } catch {
            return json({ error: "A valid HTTP or HTTPS URL is required" }, 400);
          }
          const code = newCode();
          const link = { code, url: body.url, shortUrl: `${baseUrl}/${code}`, hits: 0, createdAt: new Date().toISOString() };
          links.set(code, link);
          return json(link, 201);
        }
        return json({ error: "Method not allowed" }, 405);
      }

      if (request.method === "GET") {
        const file = await staticFile(pathname);
        if (file) return new Response(file, { headers: cors });
        const code = pathname.slice(1);
        const link = links.get(code);
        if (link) {
          link.hits++;
          return new Response(null, { status: 302, headers: { ...cors, Location: new URL(link.url).href } });
        }
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      console.error("Request failed:", error);
      return json({ error: "Internal server error" }, 500);
    }
  },
});

console.log(`Snip listening on port ${port}`);
