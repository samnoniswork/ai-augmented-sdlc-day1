# Snip CLI

A zero-dependency Node.js command-line client for the Snip URL shortener API.
Node.js 20 or newer is required.

```sh
node cli.js help
node cli.js add https://example.com
node cli.js ls
node cli.js open <code>
```

Set `SNIP_API` to the API base URL when it is not `http://localhost:3000`.
`snip`, `snip.cmd`, and `snip.ps1` are small local wrappers for Unix shells,
Command Prompt, and PowerShell respectively. The `snip` package bin entry is
available when the package is linked or installed.

The CLI uses `POST /api/links`, `GET /api/links`, and manually handles the
`302` from `GET /:code` before opening its `Location` URL in the default browser.

Run the focused checks with `node --test`.
