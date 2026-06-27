# gframew

A dead simple gemini server-side framework written in TypeScript with Bun, featuring MongoDB-powered comments system.

## Features

- 🚀 Server-side Gemini protocol implementation
- 📝 Handlebars templating for dynamic content
- 💬 MongoDB-powered comments system with client certificates
- 🎨 Built-in helpers: ansi and unicode styling
- 🐳 Fully containerized with Docker Compose
- 🔒 TLS/SSL support with client certificate authentication
- 🛡️ Built-in security: DoS protection, request size limits, timeouts
- ⚡ Fast and lightweight with Bun runtime

## Quick Start

### Using Docker Compose (Recommended)

The default Containerfile uses Node.js for full PROXY protocol support:

```bash
docker compose up -d
```

This will start:
- Gemini server on port 1965 (with PROXY mode enabled)
- MongoDB for comments storage

View logs:
```bash
docker compose logs -f
```

### Prebuilt image

Every push to `main` (and every `v*` tag) is built by GitHub Actions and
published to the GitHub Container Registry:

```bash
docker pull ghcr.io/angelagbl/gframew:latest
```

Tags include `latest` (default branch), the branch name, the commit SHA, and
semver tags for `v*` releases.

### Development

For development with PROXY support (Node.js):
```bash
npm install
npm run dev:node
```

For development without PROXY (Bun - faster):
```bash
bun install
bun run dev
```

## Project Structure

```tree
.
├── public/                 # Static files and Gemini content
│   ├── index.gmi          # Homepage
│   └── *.gmi              # Your Gemini pages
├── src/
│   ├── app.ts             # Bootstrap: connect DB, start server, shutdown
│   ├── constants.ts       # Protocol status codes, limits and timeouts
│   ├── types.ts           # Shared TypeScript types
│   ├── config/            # Configuration
│   │   ├── database.ts    # MongoDB connection
│   │   ├── logger.ts      # Logging setup
│   │   └── server.ts      # Server/env configuration
│   ├── protocol/          # Transport layer
│   │   ├── tls.ts         # TLS options
│   │   ├── proxy.ts       # PROXY protocol v1/v2 parsing
│   │   └── connection.ts  # TLS socket + PROXY connection handling
│   ├── handlers/          # Request handling
│   │   ├── request.ts     # Main router
│   │   ├── static.ts      # Static file serving + comments
│   │   └── dynamic.ts     # Dynamic routes (modules + scripts)
│   ├── runtime/           # Dynamic route resolution + execution
│   │   ├── routing.ts     # SvelteKit-style route matching
│   │   └── scripts.ts     # Runs .py/.sh/.bash/.zsh routes
│   ├── templates/         # Templating
│   │   └── handlebars.ts  # Built-in + user Handlebars helpers
│   ├── services/          # Business logic
│   │   └── comments.ts    # Comments management
│   └── utils/             # Pure helpers
│       ├── charset.ts     # Charset detection
│       ├── mime.ts        # MIME type lookup
│       ├── styles.ts      # ANSI + Unicode text styling
│       ├── certificate.ts # Client certificate extraction
│       └── validation.ts  # Request/domain validation
└── compose.yml            # Docker Compose configuration
```

## Comments System

The framework includes a powerful comments system that works with client certificates.

### Enable Comments on a Page

Add the `{{{comments}}}` tag to any `.gmi` file:

```gemini
# My Page

Content here...

{{{comments}}}

=> ?input Write a comment
```

### How It Works

1. **View comments**: Access `page.gmi` to see all comments
2. **Comment form**: Access `page.gmi?input`
   - Without certificate: Returns `60 Certificate needed`
   - With certificate: Returns `10 Write your comment`
3. **Submit comment**: Access `page.gmi?your_comment_here`
   - Saves comment and redirects to original page

## Handlebars Helpers

### Built-in Helpers

- `{{ansi}}` - ANSI color codes
- `{{unicode}}` - Unicode characters
- `{{date}}` - Current ISO date
- `{{year}}` - Current year
- `{{{comments}}}` - Comments section (when enabled)

### Example

```gemini
# Welcome to {{year}}

Current date: {{date}}

{{ansi "bold italic f#ff3a3a b#111111"}}This text is on red{{ansi}}

{{unicode "bold"}}This text is written with unicode bold characters{{unicode}}

{{comments}}
```

## Configuration

### Environment Variables

- `MONGO_URL` - MongoDB connection URL (default: `mongodb://mongo:27017`)
- `MONGO_DB` - Database name (default: `gemini_comments`)
- `LANGUAGE` - Language tag advertised for `text/gemini` responses (default: `en`)
- `LOG_TIMEZONE` - IANA timezone for log timestamps, e.g. `America/Mexico_City` (default: `UTC`, falls back to `TZ`)
- `PROXY` - Enable PROXY protocol mode (default: `false`)
  - Set to `true` to enable PROXY protocol v1 and v2 support
  - When enabled, the server parses PROXY headers then establishes TLS
  - Client certificates (mTLS) are fully supported

### PROXY Protocol Mode

**Runtime Compatibility**:
- ✅ **Node.js**: Full support for PROXY protocol
- ⚠️ **Bun**: Limited support due to TLSSocket implementation
- ❓ **Deno**: Likely works but untested

**Recommended setup**: Use Node.js when PROXY mode is needed.

When `PROXY=true`, the server accepts PROXY protocol headers and extracts the real client IP, then establishes TLS with full mTLS support.

Flow: `TCP → PROXY header → TLS handshake → Gemini request`

The server:
1. Receives TCP connection
2. Parses PROXY protocol header (v1 or v2) to get real client IP/port
3. Establishes TLS over the socket
4. Processes Gemini requests with client certificate support

Example with HAProxy:

```haproxy
frontend gemini_frontend
    bind *:1965
    mode tcp
    default_backend gemini_backend

backend gemini_backend
    mode tcp
    server gemini1 127.0.0.1:1966 send-proxy-v2
```

Run with Node.js:
```bash
PROXY=true npm run start:node
```

Or with Docker (already configured):
```bash
docker compose up -d
```

### Docker Compose

The `compose.yml` file defines:

- MongoDB service with persistent volume
- Gemini server connected to MongoDB
- Private network for secure communication

## Static File Serving

Place your files in the `public/` directory:

- `.gmi` files are processed with Handlebars
- `.hbs` files are also processed as templates
- Other files are served as-is
- Directory index: `index.gmi` or `ìndex.ts`

## Dynamic Routes

Create `+page.<ext>` files in `public/`. A request for `/page` (or
`/page.gmi`) is served by the matching `+page.<ext>` (or `+page.gmi.<ext>`)
file. Two kinds of dynamic routes are supported.

### Module routes (`.ts`, `.js`, `.mjs`)

Imported as ES modules; export a handler returning a string or a response
object:

```typescript
export default function (context) {
  return {
    content: "# Dynamic Page\n\nGenerated at runtime",
    statusCode: 20,
    mimeType: "text/gemini"
  };
}
```

The `context` is `{ socket, pathname, input, params }`, where `params` holds the
values captured from dynamic route segments (see below).

### Script routes (`.py`, `.sh`, `.bash`, `.zsh`)

Executed with their interpreter; whatever they print to **stdout** becomes the
response body. Request details are provided as environment variables:

- `GEMINI_PATHNAME` - the requested path
- `GEMINI_INPUT` - the query string (user input), if any
- `GEMINI_REMOTE_ADDR` - the client address
- `GEMINI_CLIENT_CERT` - the client certificate identity, if presented
- `GEMINI_PARAMS` - captured route params as JSON
- `GEMINI_PARAM_<NAME>` - each captured param individually (uppercased)

```python
# public/+index.py
import os
print("# Hello from Python")
print(f"You requested: {os.environ.get('GEMINI_PATHNAME')}")
```

```bash
# public/+status.sh
echo "# Server status"
echo "Uptime: $(uptime)"
```

Scripts run with a timeout, a bounded output buffer, and a minimal environment
(server secrets are not exposed), and are resolved only within `public/`.

#### Setting the response header from a script

By default a script route replies `20 text/gemini`. To control the status code
and meta yourself, make the **first line** of output a Gemini status line
(`<10-69> [meta]`); it is used verbatim as the header and the rest is the body:

```python
# public/+go.py — redirect
print("30 /somewhere-else")
```

```bash
# public/+data.sh — custom content type
printf '20 application/json\r\n'
echo '{"ok": true}'
```

If the first line is not a valid status line, the default header is used and the
whole output is treated as the body.

### Parameterized routes (SvelteKit-style)

Both **directory names** and **route-file names** may use dynamic patterns:

- `[param]` — matches exactly one path segment
- `[[param]]` — optional, matches zero or one segment
- `[...rest]` — catch-all, matches the remaining segments (joined with `/`)
- `[param=matcher]` — any of the above with a validation matcher (e.g.
  `[id=integer]`, `[[lang=lang]]`, `[...path=slug]`)

```
public/
  blog/
    [slug]/
      +index.ts        →  /blog/hello/   ⇒ params.slug = "hello"
  +[...path].py        →  /a/b/c         ⇒ params.path = "a/b/c"
  files/
    [...path]/
      +index.sh        →  /files/x/y/    ⇒ params.path  = "x/y"
  [[lang]]/
    +about.ts          →  /about  and  /en/about  ⇒ params.lang = "" or "en"
  user/
    +[id=integer].ts   →  /user/42  (but not /user/abc)
```

Resolution priority is literal → `[param]` → `[[optional]]` → `[...rest]`.

**Directory vs file — the trailing slash matters.** A request *with* a trailing
slash resolves to a directory route (ending in an index file); *without* one it
resolves to a route file. So `[...path]/` (a directory) is reached by
`/a/b/c/`, while `+[...path].py` (a file) is reached by `/a/b/c`.

#### Matchers

Define matchers in `public/.matchers.ts` (also `.js`/`.mjs`). The default
export maps matcher names to predicates `(value: string) => boolean`:

```typescript
// public/.matchers.ts
export default {
  integer: (value: string) => /^\d+$/.test(value),
  slug: (value: string) => /^[a-z0-9-]+$/.test(value),
  lang: (value: string) => value === '' || /^[a-z]{2}$/.test(value),
};
```

A segment only matches `[x=name]` when the named matcher returns true. Matchers
are loaded once at startup and the file is never served to clients.

## Custom Handlebars Helpers

Define your own helpers without touching the framework by creating
`public/.styles.ts` (also `.js`/`.mjs`). Its default export receives the shared
Handlebars instance:

```typescript
// public/.styles.ts
import type Handlebars from 'handlebars';

export default function (handlebars: typeof Handlebars) {
  handlebars.registerHelper('shout', (text: string) => String(text).toUpperCase());
  handlebars.registerHelper('repeat', (text: string, n: number) => String(text).repeat(n));
}
```

Then use them in any `.gmi`/`.hbs` template: `{{shout "hello"}}`. The file is
loaded once at startup (restart to pick up changes) and is never served to
clients.

## Contributing

Contributions are welcome! Feel free to:

</content>
</file>

- Add styling functions in `src/utils/styles.ts` and register new Handlebars helpers in `src/templates/handlebars.ts`
- Improve the comments system
- Add new features
- Fix bugs
- Improve security

Create a PR with your changes.

## License

See LICENSE file for details.

## Just Want a Simple Static Server?

No problem! Just serve standard Gemini files and static content in the `public/` directory. The framework works great as a simple static server too.
