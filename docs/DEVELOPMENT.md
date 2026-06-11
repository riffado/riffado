# Development Guide

This guide covers setting up a local development environment for Riffado.

## Quick Start

```bash
# Clone repository
git clone https://github.com/riffado/riffado.git
cd riffado

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your values

# Create database
createdb riffado

# Run migrations
pnpm db:migrate

# Start dev server
pnpm dev
```

Access at http://localhost:3000

## Development Tools

### Required
- Node.js 20+
- pnpm (package manager)
- PostgreSQL 16+
- Git

### Recommended
- VS Code with extensions:
  - ESLint
  - Prettier
  - Tailwind CSS IntelliSense
  - Prisma (for viewing database)
- Docker Desktop (for testing Docker builds)

## Project Scripts

```bash
# Development
pnpm dev                    # Start dev server with hot reload
pnpm build                  # Build for production
pnpm start                  # Start production server

# Code Quality
pnpm format-and-lint        # Check code style
pnpm format-and-lint:fix    # Auto-fix style issues
pnpm type-check             # Run TypeScript checks

# Testing
pnpm test                   # Run tests
pnpm test:watch             # Run tests in watch mode

# Database
pnpm db:generate            # Generate migration from schema changes
pnpm db:migrate             # Apply migrations
pnpm db:studio              # Open Drizzle Studio (database GUI)
```

## Architecture

### Frontend
- **Next.js 16** (App Router)
- **React 19** with TypeScript
- **Tailwind CSS** for styling
- **Shadcn/ui** for components
- **Framer Motion** for animations

### Backend
- **Next.js API Routes**
- **PostgreSQL** database
- **Drizzle ORM**
- **Better Auth** for authentication

### Storage
- Local filesystem or S3-compatible

### AI Integration
- OpenAI SDK (universal OpenAI-compatible)
- Transformers.js for browser transcription

## Database Development

### Schema Changes

1. Edit `src/db/schema.ts`
2. Generate migration: `pnpm db:generate`
3. Review generated SQL in `src/db/migrations/`
4. Apply migration: `pnpm db:migrate`
5. Commit both schema.ts and migration files

### Database GUI

```bash
pnpm db:studio
```

Opens Drizzle Studio at http://localhost:4983

## Testing

### Running Tests

```bash
# All tests
pnpm test

# Watch mode
pnpm test:watch

# Integration tests (requires Plaud bearer token)
export PLAUD_BEARER_TOKEN="Bearer your-token"
bun test src/tests/plaud.integration.test.ts
```

### Writing Tests

Use Vitest for testing:

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('MyFunction', () => {
  it('should do something', () => {
    expect(myFunction()).toBe(expected);
  });
});
```

## Debugging

### VS Code

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: debug server-side",
      "type": "node-terminal",
      "request": "launch",
      "command": "pnpm dev"
    }
  ]
}
```

### Browser DevTools

- React DevTools
- Network tab for API calls
- Console for errors

## Code Style

### Biome Configuration

We use Biome for linting and formatting. See `biome.json` for configuration.

### Naming Conventions

- Components: PascalCase (`MyComponent.tsx`)
- Files: kebab-case (`my-utility.ts`)
- API routes: kebab-case (`my-route/route.ts`)
- Database tables: snake_case (`user_settings`)

### Component Structure

```typescript
'use client';  // If client component

import { useState } from 'react';

interface MyComponentProps {
  title: string;
}

export function MyComponent({ title }: MyComponentProps) {
  const [state, setState] = useState();

  return <div>{title}</div>;
}
```

## Common Tasks

### Adding a New API Route

1. Create file: `src/app/api/my-route/route.ts`
2. Export handler: `export async function GET(request: Request) {}`
3. Add auth check if needed
4. Return `NextResponse.json()`

### Adding a New Page

1. Create file: `src/app/(app)/my-page/page.tsx`
2. Export default component
3. Add to navigation if needed

### Adding a Database Table

1. Edit `src/db/schema.ts`
2. Add table definition using Drizzle
3. Generate migration: `pnpm db:generate`
4. Apply: `pnpm db:migrate`

### Adding a New UI Component

```bash
# Use shadcn CLI
npx shadcn@latest add button
```

Or create manually in `src/components/`

## Troubleshooting

### Port Already in Use

```bash
# Find process
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
pg_isready

# Restart PostgreSQL
brew services restart postgresql  # macOS
sudo systemctl restart postgresql  # Linux
```

### Type Errors

```bash
# Regenerate types
rm -rf .next
pnpm dev
```

## Environment Variables

See `.env.example` for all variables. Required for development:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/riffado
BETTER_AUTH_SECRET=your-secret-here
ENCRYPTION_KEY=your-64-char-hex-key-here
APP_URL=http://localhost:3000
```

## Resources

- [Next.js Docs](https://nextjs.org/docs)
- [Drizzle ORM Docs](https://orm.drizzle.team)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)
- [Better Auth Docs](https://better-auth.com)

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
