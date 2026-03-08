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
├── public/              # Static files and Gemini content
│   ├── index.gmi       # Homepage
│   └── *.gmi           # Your Gemini pages
├── src/
│   ├── app.ts          # Main application
│   ├── config/         # Configuration files
│   │   ├── database.ts # MongoDB connection
│   │   └── logger.ts   # Logging setup
│   ├── handlers/       # Request handlers
│   │   ├── static.ts   # Static file serving + comments
│   │   └── dynamic.ts  # Dynamic routes
│   └── services/       # Business logic
│       └── comments.ts # Comments management
├── scripts/            # Utility scripts
└── compose.yml         # Docker Compose configuration
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

Create `.ts` or `.js` files in `public/` that export a handler:

```typescript
export default function() {
  return {
    content: "# Dynamic Page\n\nGenerated at runtime",
    statusCode: 20,
    mimeType: "text/gemini"
  };
}
```

## Contributing

Contributions are welcome! Feel free to:

- Add new Handlebars helpers in `src/utils/styles.ts`
- Improve the comments system
- Add new features
- Fix bugs
- Improve security

Create a PR with your changes.

## License

See LICENSE file for details.

## Just Want a Simple Server?

No problem! Just serve standard Gemini files and static content in the `public/` directory. The framework works great as a simple static server too.
