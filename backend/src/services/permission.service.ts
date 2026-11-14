import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db } from '../db/index.js';
import { userPermissions, users } from '../db/schema.js';

export const FEATURES = [
  { key: 'meetings.instant', label: 'Instant meetings' },
  { key: 'meetings.scheduled', label: 'Scheduled meetings' },
  { key: 'meetings.invitations', label: 'Meeting invitations' },
  { key: 'recording', label: 'Recording' },
  { key: 'transcription', label: 'Transcription & AI summaries' },
  { key: 'chat', label: 'Meeting chat & files' },
  { key: 'whiteboard', label: 'Whiteboard' },
  { key: 'history', label: 'Meeting history' },
  { key: 'notifications', label: 'Reminders & notifications' },
  { key: 'user_management', label: 'User management' },
] as const;

export type FeatureKey = (typeof FEATURES)[number]['key'];
export type FeatureLevel = 'none' | 'read' | 'write' | 'full';
export type UserRole = 'superadmin' | 'admin' | 'user';
export type PermissionMap = Partial<Record<FeatureKey, FeatureLevel>>;

export interface UserAccess {
  role: UserRole;
  disabled: boolean;
  permissions: PermissionMap;
}

const RANK: Record<FeatureLevel, number> = { none: 0, read: 1, write: 2, full: 3 };

const DEFAULT_LEVELS: Record<FeatureKey, FeatureLevel> = {
  'meetings.instant': 'full',
  'meetings.scheduled': 'full',
  'meetings.invitations': 'full',
  recording: 'full',
  transcription: 'full',
  chat: 'full',
  whiteboard: 'full',
  history: 'full',
  notifications: 'full',
  user_management: 'none',
};

const FEATURE_KEYS = new Set<string>(FEATURES.map((feature) => feature.key));
const LEVELS = new Set<string>(['none', 'read', 'write', 'full']);

export function isFeatureKey(value: string): value is FeatureKey {
  return FEATURE_KEYS.has(value);
}

export function isFeatureLevel(value: string): value is FeatureLevel {
  return LEVELS.has(value);
}

export function levelAllows(have: FeatureLevel, need: FeatureLevel) {
  return RANK[have] >= RANK[need];
}

export function effectiveLevel(access: UserAccess, feature: FeatureKey): FeatureLevel {
  if (access.role === 'superadmin') return 'full';
  return access.permissions[feature] ?? DEFAULT_LEVELS[feature];
}

export function featureAllowed(access: UserAccess, feature: FeatureKey, need: FeatureLevel) {
  if (access.disabled) return false;
  return levelAllows(effectiveLevel(access, feature), need);
}

const ACCESS_TTL_MS = 30_000;
const accessCache = new Map<string, { access: UserAccess; expiresAt: number }>();

export function invalidateAccess(userId: string) {
  accessCache.delete(userId);
}

export async function getUserAccess(userId: string): Promise<UserAccess> {
  const cached = accessCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.access;

  const [user, rows] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.userPermissions.findMany({ where: eq(userPermissions.userId, userId) }),
  ]);
  if (!user) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'User session is no longer valid' });

  const permissions: PermissionMap = {};
  for (const row of rows) {
    if (isFeatureKey(row.feature) && isFeatureLevel(row.level)) permissions[row.feature] = row.level;
  }
  const access: UserAccess = { role: user.role, disabled: !!user.disabledAt, permissions };
  accessCache.set(userId, { access, expiresAt: Date.now() + ACCESS_TTL_MS });
  return access;
}

const FEATURE_LABEL = new Map(FEATURES.map((feature) => [feature.key, feature.label]));

async function requireAccess(userId: string): Promise<UserAccess> {
  const access = await getUserAccess(userId);
  if (access.disabled) throw new TRPCError({ code: 'FORBIDDEN', message: 'Your account has been disabled. Contact your administrator.' });
  return access;
}

export async function requireFeature(userId: string, feature: FeatureKey, need: FeatureLevel): Promise<UserAccess> {
  const access = await requireAccess(userId);
  if (!featureAllowed(access, feature, need)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `You do not have ${need} access to ${FEATURE_LABEL.get(feature) ?? feature}. Contact your administrator.` });
  }
  return access;
}

export async function requireAnyFeature(userId: string, features: FeatureKey[], need: FeatureLevel): Promise<UserAccess> {
  const access = await requireAccess(userId);
  if (!features.some((feature) => featureAllowed(access, feature, need))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not have access to this feature. Contact your administrator.' });
  }
  return access;
}

export async function requireSuperadmin(userId: string): Promise<UserAccess> {
  const access = await requireAccess(userId);
  if (access.role !== 'superadmin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the workspace owner can perform this action.' });
  }
  return access;
}
