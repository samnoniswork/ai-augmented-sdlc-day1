#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const USAGE = `Usage:
  snip add <url>    Create a short link
  snip ls           List links and hit counts
  snip open <code>  Open a short link in your browser
  snip help         Show this help

Set SNIP_API to change the API base URL (default: http://localhost:3000).`;
const REQUEST_TIMEOUT_MS = 10000;

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SNIP_API must be a valid HTTP(S) URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('SNIP_API must use HTTP or HTTPS.');
  }
  if (url.search || url.hash) {
    throw new Error('SNIP_API must not include a query string or fragment.');
  }

  return url.href.replace(/\/+$/, '');
}

function browserCommand(url, platform = process.platform) {
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  }
  if (platform === 'darwin') {
    return { command: 'open', args: [url] };
  }
  return { command: 'xdg-open', args: [url] };
}

function openInBrowser(url, platform = process.platform, spawnImpl = spawn) {
  const { command, args } = browserCommand(url, platform);
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function request(fetchImpl, baseUrl, path, options = {}) {
  let response;
  try {
    response = await fetchImpl(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...options
    });
  } catch (error) {
    if (error && error.name === 'TimeoutError') {
      throw new Error('The API request timed out.');
    }
    throw new Error(`Could not reach the Snip API: ${error.message}`);
  }
  return response;
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error('The API returned an invalid JSON response.');
  }
}

async function ensureOk(response) {
  if (response.ok) return;

  let message = `API request failed with HTTP ${response.status}.`;
  try {
    const body = await response.json();
    if (typeof body.error === 'string' && body.error.trim()) message = body.error;
  } catch {
    // Keep the HTTP status when an error response has no JSON body.
  }
  throw new Error(message);
}

function formatLinks(links) {
  if (links.length === 0) return 'No links yet.';

  const rows = links.map((link) => ({
    code: String(link.code),
    hits: String(link.hits),
    url: String(link.url)
  }));
  const codeWidth = Math.max(4, ...rows.map((row) => row.code.length));
  const hitsWidth = Math.max(4, ...rows.map((row) => row.hits.length));
  const header = `${'CODE'.padEnd(codeWidth)}  ${'HITS'.padStart(hitsWidth)}  URL`;
  const separator = `${'-'.repeat(codeWidth)}  ${'-'.repeat(hitsWidth)}  ${'-'.repeat(Math.max(3, ...rows.map((row) => row.url.length)))}`;
  const lines = rows.map((row) => `${row.code.padEnd(codeWidth)}  ${row.hits.padStart(hitsWidth)}  ${row.url}`);
  return [header, separator, ...lines].join('\n');
}

async function run(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const openUrl = dependencies.openUrl || openInBrowser;
  const env = dependencies.env || process.env;

  const [command, ...args] = argv;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  try {
    const baseUrl = normalizeBaseUrl(env.SNIP_API || 'http://localhost:3000');

    if (command === 'add') {
      if (args.length !== 1) throw new Error('Usage: snip add <url>');
      let destination;
      try {
        destination = new URL(args[0]);
      } catch {
        throw new Error('URL must be a valid HTTP(S) URL.');
      }
      if (!['http:', 'https:'].includes(destination.protocol)) {
        throw new Error('URL must use HTTP or HTTPS.');
      }

      const response = await request(fetchImpl, baseUrl, '/api/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: destination.href })
      });
      await ensureOk(response);
      const link = await responseJson(response);
      if (typeof link.shortUrl !== 'string' || !link.shortUrl) {
        throw new Error('The API response is missing shortUrl.');
      }
      stdout.write(`${link.shortUrl}\n`);
      return 0;
    }

    if (command === 'ls') {
      if (args.length !== 0) throw new Error('Usage: snip ls');
      const response = await request(fetchImpl, baseUrl, '/api/links');
      await ensureOk(response);
      const links = await responseJson(response);
      if (!Array.isArray(links)) throw new Error('The API response is not a links array.');
      stdout.write(`${formatLinks(links)}\n`);
      return 0;
    }

    if (command === 'open') {
      if (args.length !== 1 || !args[0]) throw new Error('Usage: snip open <code>');
      const response = await request(fetchImpl, baseUrl, `/${encodeURIComponent(args[0])}`, {
        redirect: 'manual'
      });
      if (response.status === 404) throw new Error(`Unknown short code: ${args[0]}`);
      if (response.status !== 302) {
        await ensureOk(response);
        throw new Error(`Expected a redirect, received HTTP ${response.status}.`);
      }

      const location = response.headers.get('location');
      if (!location) throw new Error('The API redirect did not include a Location header.');
      let destination;
      try {
        destination = new URL(location, baseUrl);
      } catch {
        throw new Error('The API returned an invalid redirect URL.');
      }
      if (!['http:', 'https:'].includes(destination.protocol)) {
        throw new Error('The API returned a non-HTTP(S) redirect URL.');
      }
      await openUrl(destination.href);
      stdout.write(`Opened ${destination.href}\n`);
      return 0;
    }

    throw new Error(`Unknown command: ${command}\n${USAGE}`);
  } catch (error) {
    stderr.write(`Error: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}

module.exports = { browserCommand, formatLinks, normalizeBaseUrl, openInBrowser, run };
