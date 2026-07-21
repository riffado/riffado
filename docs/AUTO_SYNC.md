# Auto-Sync Documentation

Riffado syncs recordings from your Plaud device through two independent mechanisms: a client-side poller that runs while a browser tab is open, and a server-side worker that runs regardless of whether anyone has the app open. Both call the same underlying sync routine (`syncRecordingsForUser` in `src/lib/sync/sync-recordings.ts`).

## How It Works

### Server-side background worker

Started once per app process from `src/instrumentation.ts` (`startBackgroundSyncWorker`, `src/lib/sync/worker.ts`). On a tick (default every 5 minutes, configurable via `BACKGROUND_SYNC_INTERVAL_MS`):

1. Claims up to 20 users whose Plaud connection hasn't synced in the last 4 minutes (oldest-synced first, so a large user pool cycles through everyone across ticks instead of starving the same subset).
2. On self-host, every user with a Plaud connection is eligible -- there's no plan/tier concept there. On hosted, only `hosted_pro` accounts are eligible; lapsed/free accounts are read-only and are skipped here (enforced again inside `syncRecordingsForUser` via `isHostedLockedOut`).
3. Runs `syncRecordingsForUser` for each claimed user sequentially, so the same download/transcription pipeline the client-triggered sync uses applies.

This is what makes an unattended `docker compose up` deployment (or a hosted Pro account with no browser open) keep pulling new recordings.

### Client-side poller

The `useAutoSync` hook (`src/hooks/use-auto-sync.ts`) additionally polls `POST /api/plaud/sync` from the browser while a tab is open:

1. **Periodic Background Sync** - checks for new recordings at a configurable interval (default: 5 minutes)
2. **Tab Visibility Detection** - when you return to the tab after being away, it syncs if more than half the interval has passed
3. **Sync Throttling** - a minimum interval between syncs (default: 1 minute) prevents redundant calls

This path exists for immediacy (the user sees new recordings the moment they open the app) and isn't a substitute for the server worker -- it's redundant with it by design; the server worker's 4-minute staleness check skips users a client tab just synced.

### User Experience

- **Non-intrusive**: Silent background syncs don't interrupt your workflow
- **Visual Feedback**: Sync status indicator shows last sync time and next scheduled sync
- **Manual Override**: Users can still manually sync at any time via the "SYNC DEVICE" button
- **Toast Notifications**: Only shows notifications when new recordings are found

## Configuration

### Environment Variables

For self-hosted deployments, `.env.example` documents the server-side knobs:

```bash
# Master switch for the server-side background sync worker. Default true.
# Set false to opt out entirely (e.g. sync only when the app is open, or
# drive syncing yourself via cron hitting POST /api/plaud/sync).
BACKGROUND_SYNC_ENABLED=true

# Tick interval for the server-side background sync worker, in milliseconds.
# Default 300000 (5 min). Range 60000..3600000. The worker also skips any
# user synced in the last 4 minutes regardless of this value, so setting it
# below 4 min has no effect beyond extra database queries.
BACKGROUND_SYNC_INTERVAL_MS=300000

# Per-user rate limit on POST /api/plaud/sync (requests per minute).
# Default 10. Range 1..600.
PLAUD_SYNC_RATE_LIMIT_PER_MINUTE=10
```

The client-side poller's interval, minimum interval, sync-on-mount, and sync-on-visibility knobs are `useAutoSync` hook props, not environment variables -- there is currently no env-var override for them.

## Architecture

### Components

1. **`useAutoSync` Hook** (`src/hooks/use-auto-sync.ts`)
   - Client-side auto-sync logic
   - Manages sync intervals, throttling, and visibility detection
   - Returns sync status and manual sync function

2. **`SyncStatus` Component** (`src/components/ui/sync-status.tsx`)
   - Visual indicator showing sync status
   - Displays last sync time, next sync time, and sync results
   - Shows errors and new recording counts

3. **Background sync worker** (`src/lib/sync/worker.ts`)
   - Server-side polling independent of any browser tab
   - Started from `src/instrumentation.ts` on process boot
   - Configurable via `BACKGROUND_SYNC_INTERVAL_MS`

### Key Features

#### Prevents Redundant Syncs

```typescript
// Minimum interval enforcement
if (timeSinceLastSync < minInterval) {
    return; // Skip sync
}

// Concurrent sync prevention
if (isSyncingRef.current) {
    return; // Already syncing
}
```

#### Tab Visibility Optimization

```typescript
// Only sync when tab becomes visible AND enough time has passed
if (document.visibilityState === "visible") {
    if (timeSinceLastSync > interval / 2) {
        performSync(true);
    }
}
```

#### LocalStorage Persistence

```typescript
// Syncs persist across page reloads
localStorage.setItem(STORAGE_KEY, syncTime.toISOString());
```

## Self-Hosted Deployment

### Docker Example

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy application files
COPY . .

# Install dependencies
RUN npm install

# Configure sync settings
ENV NEXT_PUBLIC_SYNC_INTERVAL=600000 # 10 minutes
ENV NEXT_PUBLIC_MIN_SYNC_INTERVAL=120000 # 2 minutes
ENV NEXT_PUBLIC_SYNC_ON_MOUNT=true
ENV NEXT_PUBLIC_SYNC_ON_VISIBILITY=true

# Build application
RUN npm run build

EXPOSE 3000

CMD ["npm", "start"]
```

### Docker Compose Example

```yaml
version: '3.8'

services:
  riffado:
    build: .
    ports:
      - "3000:3000"
    environment:
      # Database
      DATABASE_URL: postgresql://user:password@db:5432/riffado
      
      # Sync Configuration
      NEXT_PUBLIC_SYNC_INTERVAL: 300000 # 5 minutes
      NEXT_PUBLIC_MIN_SYNC_INTERVAL: 60000 # 1 minute
      NEXT_PUBLIC_SYNC_ON_MOUNT: "true"
      NEXT_PUBLIC_SYNC_ON_VISIBILITY: "true"
      
      # Plaud API
      PLAUD_API_KEY: your-api-key
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_PASSWORD: password
      POSTGRES_USER: user
      POSTGRES_DB: riffado
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## Cloud Deployment Considerations

### Load Balancing

When deploying behind a load balancer, each user's sync timer is independent and runs in their browser. The backend `/api/plaud/sync` endpoint should be stateless and handle concurrent requests gracefully.

### Rate Limiting

Consider implementing rate limiting on the sync endpoint:

```typescript
// Example rate limit: 1 sync per minute per user
import { rateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
    const userId = await getCurrentUserId(request);
    
    const limited = await rateLimit.check(userId, {
        limit: 1,
        window: 60000, // 1 minute
    });
    
    if (limited) {
        return new Response('Too many sync requests', { status: 429 });
    }
    
    // Proceed with sync...
}
```

### Scaling

Auto-sync is designed to scale horizontally:

- **Client-side timers**: Each user's browser manages their own sync schedule
- **Stateless API**: Sync endpoint doesn't maintain state between requests
- **Database-backed**: Last sync time persisted in localStorage (client) and database (server)

### Cost Optimization

For cloud deployments where API costs matter:

```bash
# Increase sync interval to reduce API calls
NEXT_PUBLIC_SYNC_INTERVAL=900000 # 15 minutes instead of 5

# Disable sync on mount to reduce initial load
NEXT_PUBLIC_SYNC_ON_MOUNT=false

# Keep visibility sync for better UX
NEXT_PUBLIC_SYNC_ON_VISIBILITY=true
```

## Monitoring

### Track Sync Performance

```typescript
// Add to your analytics/monitoring
const { lastSyncResult } = useAutoSync({
    onSuccess: (newRecordings) => {
        analytics.track('sync_success', {
            new_recordings: newRecordings,
        });
    },
    onError: (error) => {
        analytics.track('sync_error', {
            error_message: error,
        });
    },
});
```

### Health Checks

Monitor sync health by tracking:
- Last successful sync time per user
- Sync error rates
- Average sync duration
- New recordings per sync

## Troubleshooting

### Sync Not Working

1. **Check localStorage**: Ensure `riffado_auto_sync_enabled` is `"true"`
2. **Check environment variables**: Verify sync interval is set correctly
3. **Browser console**: Look for network errors or CORS issues
4. **API endpoint**: Test `/api/plaud/sync` manually

### Too Frequent Syncing

1. **Increase `NEXT_PUBLIC_SYNC_INTERVAL`** in environment variables
2. **Increase `NEXT_PUBLIC_MIN_SYNC_INTERVAL`** to throttle more aggressively
3. **Disable `NEXT_PUBLIC_SYNC_ON_VISIBILITY`** if users switch tabs frequently

### Missing Recordings

1. **Check Plaud API credentials**: Ensure they're valid
2. **Manual sync**: Try manual sync to see detailed error messages
3. **Check network**: Ensure connectivity to Plaud API
4. **Database**: Verify recordings are being saved correctly

## Future Enhancements

Potential improvements to the auto-sync system:

1. **Settings UI**: User-facing controls for sync interval and enable/disable
2. **Sync History**: Log of past syncs with timestamps and results
3. **Conflict Resolution**: Handle cases where recordings are modified on both ends
4. **Offline Support**: Queue syncs when offline, execute when online
5. **Selective Sync**: Choose which recordings to sync automatically
6. **Background Sync API**: Use Service Workers for truly background syncing

## API Reference

### `useAutoSync` Hook

```typescript
interface UseAutoSyncOptions {
    interval?: number; // Sync interval in ms (default: 300000)
    minInterval?: number; // Min interval in ms (default: 60000)
    syncOnMount?: boolean; // Sync on mount (default: true)
    syncOnVisibilityChange?: boolean; // Sync on visibility (default: true)
    enabled?: boolean; // Enable auto-sync (default: true)
    onSuccess?: (newRecordings: number) => void;
    onError?: (error: string) => void;
}

interface SyncStatus {
    isAutoSyncing: boolean;
    lastSyncTime: Date | null;
    nextSyncTime: Date | null;
    lastSyncResult: {
        success: boolean;
        newRecordings?: number;
        error?: string;
    } | null;
}

function useAutoSync(options?: UseAutoSyncOptions): SyncStatus & {
    manualSync: () => Promise<void>;
}
```

### Sync Config Functions

```typescript
// Get current sync interval
function getSyncInterval(): number;

// Set sync interval (must be >= minInterval)
function setSyncInterval(interval: number): void;

// Get auto-sync enabled state
function getAutoSyncEnabled(): boolean;

// Set auto-sync enabled state
function setAutoSyncEnabled(enabled: boolean): void;
```

## License

This auto-sync implementation is part of Riffado and follows the same license.

