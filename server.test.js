import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server;
let directory;
let base;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "snip-backend-"));
  await writeFile(join(directory, "index.html"), "Snip UI");
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  base = `http://127.0.0.1:${port}`;
  server = Bun.spawn([process.execPath, "server.js"], {
    cwd: import.meta.dir,
    env: { ...process.env, PORT: String(port), BASE_URL: "https://short.example", PUBLIC_DIR: directory },
    stdout: "pipe",
    stderr: "inherit",
  });
  const reader = server.stdout.getReader();
  const result = await reader.read();
  reader.releaseLock();
  if (result.done || !new TextDecoder().decode(result.value).includes("Snip listening")) {
    throw new Error("Backend failed to start");
  }
});

afterAll(async () => {
  if (server) {
    server.kill();
    await server.exited;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("creates, lists and redirects links while counting hits", async () => {
  const response = await fetch(`${base}/api/links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/path" }),
  });
  expect(response.status).toBe(201);
  const link = await response.json();
  expect(link.code).toMatch(/^[a-zA-Z0-9]{6}$/);
  expect(link.shortUrl).toBe(`https://short.example/${link.code}`);
  expect(link.url).toBe("https://example.com/path");
  expect(link.hits).toBe(0);
  expect(new Date(link.createdAt).toISOString()).toBe(link.createdAt);
  expect(await (await fetch(`${base}/api/links`)).json()).toEqual([link]);

  const redirect = await fetch(`${base}/${link.code}`, { redirect: "manual" });
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get("location")).toBe(link.url);
  expect((await (await fetch(`${base}/api/links`)).json())[0].hits).toBe(1);
  expect((await fetch(`${base}/unknown`)).status).toBe(404);

  await writeFile(join(directory, link.code), "static wins");
  const staticResponse = await fetch(`${base}/${link.code}`, { redirect: "manual" });
  expect(staticResponse.status).toBe(200);
  expect(await staticResponse.text()).toBe("static wins");
  expect((await (await fetch(`${base}/api/links`)).json())[0].hits).toBe(1);
});

test("rejects malformed or non-HTTP URLs and supports preflight", async () => {
  for (const body of ["{", "null", "{}", JSON.stringify({ url: "file:///etc/passwd" })]) {
    const response = await fetch(`${base}/api/links`, { method: "POST", body });
    expect(response.status).toBe(400);
    expect(typeof (await response.json()).error).toBe("string");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  }
  const preflight = await fetch(`${base}/api/links`, { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
});

test("serves the UI without exposing files outside PUBLIC_DIR", async () => {
  expect(await (await fetch(base)).text()).toBe("Snip UI");
  const response = await fetch(`${base}/%2e%2e%2fserver.js`);
  expect(response.status).toBe(404);
});
