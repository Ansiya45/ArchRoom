import { useCallback, useEffect, useState } from 'react';
import { trpc } from '../lib/trpc';
import { hasFeature, type AccessState, type FeatureKey, type FeatureLevel } from '../lib/permissions';

// Workspace access is cached per user id so repeated mounts do not refetch.
const cache = new Map<string, AccessState>();
const pending = new Map<string, Promise<AccessState>>();

export function clearAccessCache(userId?: string) {
  if (userId) { cache.delete(userId); pending.delete(userId); return; }
  cache.clear(); pending.clear();
}

export function loadAccess(userId: string): Promise<AccessState> {
  const cached = cache.get(userId);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(userId);
  if (inflight) return inflight;
  const request = trpc.users.myAccess.query()
    .then((result) => {
      cache.set(userId, result as AccessState);
      pending.delete(userId);
      return result as AccessState;
    })
    .catch((error) => {
      pending.delete(userId);
      throw error;
    });
  pending.set(userId, request);
  return request;
}

/**
 * Workspace permissions for the signed-in user. When `enabled` is false
 * (guests / signed out) every check passes — meeting guests are not governed
 * by workspace feature permissions.
 */
export function usePermissions(userId: string | undefined | null) {
  const [access, setAccess] = useState<AccessState | null>(() => (userId ? cache.get(userId) ?? null : null));
  // A failed access fetch must not permanently hide meeting features — the
  // backend still enforces permissions on every call, so the UI falls back
  // to the default-open posture instead of silently disabling everything.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!userId) { setAccess(null); setLoadFailed(false); return; }
    const cached = cache.get(userId);
    if (cached) { setAccess(cached); setLoadFailed(false); return; }
    let cancelled = false;
    loadAccess(userId)
      .then((result) => { if (!cancelled) { setAccess(result); setLoadFailed(false); } })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [userId]);

  const refresh = useCallback(() => {
    if (!userId) return Promise.resolve();
    clearAccessCache(userId);
    return loadAccess(userId).then(setAccess).catch(() => {});
  }, [userId]);

  const can = useCallback((key: FeatureKey, min: FeatureLevel) => {
    if (!userId) return true; // Guests are meeting-scoped, not workspace-governed.
    if (!access) {
      // Deny only while the first load is in flight; after a failed fetch the
      // backend remains the enforcement point, so use the open defaults.
      return loadFailed ? hasFeature(null, key, min) : false;
    }
    return hasFeature(access, key, min);
  }, [userId, access, loadFailed]);

  return { access, can, refresh, loaded: !userId || !!access };
}
