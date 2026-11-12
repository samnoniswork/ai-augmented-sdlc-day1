'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { browserCommand, formatLinks, normalizeBaseUrl, openInBrowser, run } = require('../cli');

function capture() {
  let output = '';
  return {
    stream: { write: (text) => { output += text; } },
    text: () => output
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

test('help prints usage without contacting the API', async () => {
  const stdout = capture();
  const stderr = capture();
  let requested = false;
  const code = await run(['help'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    fetchImpl: async () => { requested = true; }
  });

  assert.equal(code, 0);
  assert.match(stdout.text(), /snip add <url>/);
  assert.equal(stderr.text(), '');
  assert.equal(requested, false);
});

test('add validates URLs and posts the shared contract', async () => {
  const stdout = capture();
  const stderr = capture();
  let posted;
  const code = await run(['add', 'https://example.com/path'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    env: { SNIP_API: 'http://localhost:3000/' },
    fetchImpl: async (url, options) => {
      posted = { url, options };
      return jsonResponse({ code: 'a1B2c3', shortUrl: 'http://localhost:3000/a1B2c3' }, 201);
    }
  });

  assert.equal(code, 0);
  assert.equal(posted.url, 'http://localhost:3000/api/links');
  assert.equal(posted.options.method, 'POST');
  assert.deepEqual(JSON.parse(posted.options.body), { url: 'https://example.com/path' });
  assert.equal(stdout.text(), 'http://localhost:3000/a1B2c3\n');
  assert.equal(stderr.text(), '');
});

test('invalid input fails before a request and reports to stderr', async () => {
  const stderr = capture();
  let requested = false;
  const code = await run(['add', 'javascript:alert(1)'], {
    stderr: stderr.stream,
    fetchImpl: async () => { requested = true; }
  });

  assert.equal(code, 1);
  assert.match(stderr.text(), /HTTP or HTTPS/);
  assert.equal(requested, false);
});

test('ls formats links and handles an empty list', async () => {
  const stdout = capture();
  const code = await run(['ls'], {
    stdout: stdout.stream,
    fetchImpl: async () => jsonResponse([
      { code: 'a1B2c3', hits: 2, url: 'https://example.com/long' },
      { code: 'z9Y8x7', hits: 0, url: 'https://x.test' }
    ])
  });

  assert.equal(code, 0);
  assert.match(stdout.text(), /CODE\s+HITS\s+URL/);
  assert.match(stdout.text(), /a1B2c3\s+2\s+https:\/\/example\.com\/long/);
  assert.match(formatLinks([]), /^No links yet\.$/);
});

test('open requests manual redirect, opens Location and reports unknown code', async () => {
  const stdout = capture();
  const stderr = capture();
  let options;
  let opened;
  const code = await run(['open', 'a1B2c3'], {
    stdout: stdout.stream,
    stderr: stderr.stream,
    env: { SNIP_API: 'http://localhost:3000' },
    fetchImpl: async (_url, requestOptions) => {
      options = requestOptions;
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/target' }
      });
    },
    openUrl: async (url) => { opened = url; }
  });

  assert.equal(code, 0);
  assert.equal(options.redirect, 'manual');
  assert.equal(opened, 'https://example.com/target');
  assert.match(stdout.text(), /Opened https:\/\/example\.com\/target/);
  assert.equal(stderr.text(), '');

  const failed = await run(['open', 'missing'], {
    stderr: stderr.stream,
    fetchImpl: async () => new Response(null, { status: 404 })
  });
  assert.equal(failed, 1);
  assert.match(stderr.text(), /Unknown short code: missing/);
});

test('API and SNIP_API errors are reported with exit code 1', async () => {
  const stderr = capture();
  const failedApi = await run(['ls'], {
    stderr: stderr.stream,
    fetchImpl: async () => jsonResponse({ error: 'service unavailable' }, 503)
  });
  assert.equal(failedApi, 1);
  assert.match(stderr.text(), /service unavailable/);

  const invalidConfig = await run(['ls'], {
    stderr: stderr.stream,
    env: { SNIP_API: 'file:///tmp/api' },
    fetchImpl: async () => { throw new Error('must not fetch'); }
  });
  assert.equal(invalidConfig, 1);
  assert.match(stderr.text(), /SNIP_API must use HTTP or HTTPS/);
});

test('browser launch selects platform command and detaches the child', async () => {
  assert.deepEqual(browserCommand('https://example.com', 'win32'), {
    command: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', 'https://example.com']
  });
  assert.deepEqual(browserCommand('https://example.com', 'darwin'), {
    command: 'open',
    args: ['https://example.com']
  });
  assert.deepEqual(browserCommand('https://example.com', 'linux'), {
    command: 'xdg-open',
    args: ['https://example.com']
  });

  let spawnArgs;
  const child = new EventEmitter();
  child.unref = () => { child.detached = true; };
  const opening = openInBrowser('https://example.com', 'linux', (...args) => {
    spawnArgs = args;
    process.nextTick(() => child.emit('spawn'));
    return child;
  });
  await opening;
  assert.equal(spawnArgs[0], 'xdg-open');
  assert.equal(spawnArgs[2].detached, true);
  assert.equal(child.detached, true);
});

test('base URL accepts and trims path prefixes', () => {
  assert.equal(normalizeBaseUrl('https://api.example.test/snip/'), 'https://api.example.test/snip');
});
