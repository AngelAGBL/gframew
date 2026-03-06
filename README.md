# gframew

A dead simple gemini server-side framework written in TypeScript with Bun, featuring MongoDB-powered comments system.

## Features

- 🚀 Server-side Gemini protocol implementation
- 📝 Handlebars templating for dynamic content
- 💬 MongoDB-powered comments system with client certificates
- 🎨 Built-in helpers: ansi and unicode styling
- 🐳 Fully containerized with Docker Compose
- 🔒 TLS/SSL support with client certificate authentication
- ⚡ Fast and lightweight with Bun runtime

## Quick Start

### Using Docker Compose (Recommended)

1. Clone the repository and start the services:

```bash
docker compose up -d
```

This will start:
- Gemini server on port 1965
- MongoDB for comments storage

2. Access your server at `gemini://localhost:1965`

3. View logs:

```bash
docker compose logs -f
```

### Development

1. Install dependencies:

```bash
bun install
```

2. Start MongoDB:

```bash
docker run -d -p 27017:27017 --name mongo mongo:7
```

3. Run the development server:

```bash
bun run dev
```

## Project Structure

```
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

Add the `{{comments}}` tag to any `.gmi` file:

```gemini
# My Page

Content here...

{{comments}}

=> mypage.gmi?comment Write a comment
```

### How It Works

1. **View comments**: Access `page.gmi` to see all comments
2. **Comment form**: Access `page.gmi?comment`
   - Without certificate: Returns `60 Certificate needed`
   - With certificate: Returns `10 Escribe tu comentario`
3. **Submit comment**: Access `page.gmi?your_comment_here`
   - Saves comment and redirects to original page

See [COMENTARIOS.md](COMENTARIOS.md) for detailed documentation.

## Handlebars Helpers

### Built-in Helpers

- `{{ansi}}` - ANSI color codes
- `{{unicode}}` - Unicode characters
- `{{date}}` - Current ISO date
- `{{year}}` - Current year
- `{{comments}}` - Comments section (when enabled)

### Example

```gemini
# Welcome to {{year}}

Current date: {{date}}

{{comments}}
```

## MongoDB Management

Use the provided utility script:

```bash
# View statistics
./scripts/mongo-utils.sh stats

# Create backup
./scripts/mongo-utils.sh backup

# Restore from backup
./scripts/mongo-utils.sh restore ./backup

# Open MongoDB shell
./scripts/mongo-utils.sh shell

# Clean all comments
./scripts/mongo-utils.sh clean
```

## Configuration

### Environment Variables

- `MONGO_URL` - MongoDB connection URL (default: `mongodb://mongo:27017`)
- `MONGO_DB` - Database name (default: `gemini_comments`)

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
- Directory index: `index.gmi`

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

Create a PR with your changes.

## License

See LICENSE file for details.

## Just Want a Simple Server?

No problem! Just serve standard Gemini files and static content in the `public/` directory. The framework works great as a simple static server too.
