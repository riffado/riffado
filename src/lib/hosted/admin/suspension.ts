/**
 * Suspension is a hosted-mode operator action: an admin sets users.suspendedAt
 * and the rest of the system cooperatively refuses to do work on that user's
 * behalf. It is NOT a hard kill -- in-flight requests are not interrupted.
 *
 * Enforcement points:
 *   - middleware.ts: web routes redirect to /suspended.
 *   - sync worker (sync-recordings.ts): the per-user entry exits early after
 *     loading the user row.
 *   - (future) /api/v1/*: endpoint guards return 403.
 *
 * Self-host never sets suspendedAt because the admin gate is locked behind
 * IS_HOSTED, so this code is effectively no-op there.
 */

export interface SuspendableUser {
    suspendedAt: Date | null;
}

export function isSuspended(user: SuspendableUser | null | undefined): boolean {
    if (!user) return false;
    return user.suspendedAt !== null && user.suspendedAt !== undefined;
}
