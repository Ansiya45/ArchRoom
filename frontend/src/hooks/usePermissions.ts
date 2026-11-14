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

  useEffect(() => {
    if (!userId) { setAccess(null); return; }
    const cached = cache.get(userId);
    if (cached) { setAccess(cached); return; }
    let cancelled = false;
    loadAccess(userId).then((result) => { if (!cancelled) setAccess(result); }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  const refresh = useCallback(() => {
    if (!userId) return Promise.resolve();
    clearAccessCache(userId);
    return loadAccess(userId).then(setAccess).catch(() => {});
  }, [userId]);

  const can = useCallback((key: FeatureKey, min: FeatureLevel) => {
    if (!userId) return true; // Guests are meeting-scoped, not workspace-governed.
    if (!access) return false; // Deny until access is known for signed-in users.
    return hasFeature(access, key, min);
  }, [userId, access]);

  return { access, can, refresh, loaded: !userId || !!access };
}
