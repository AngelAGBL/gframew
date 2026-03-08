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

Clone the repository and start the services:

```bash
docker compose up -d
```

This will start:

- Gemini server on port 1965
- MongoDB for comments storage

```bash
docker compose logs -f
```

### Development

Run the compose file

```bash
docker compose up --build -d
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
  - When enabled, the server expects PROXY headers followed by TLS
  - The server parses PROXY headers first, then establishes TLS on the underlying socket
  - Client certificates are still supported through the TLS layer

### PROXY Protocol Mode

When `PROXY=true`, the server:

- Accepts PROXY protocol v1 and v2 headers
- Extracts real client IP and port from PROXY headers
- Establishes TLS connection AFTER parsing the PROXY header
- Supports client certificate authentication through the TLS layer

The flow is: `TCP → PROXY header → TLS handshake → Gemini request`

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

Then run your Gemini server:

```bash
PROXY=true bun run src/app.ts
```

The server will:
1. Receive the connection
2. Parse the PROXY protocol header to get real client IP
3. Establish TLS on the underlying socket
4. Process the Gemini request with client certificate support

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
