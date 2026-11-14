export type UserRole = 'superadmin' | 'admin' | 'user';
export type FeatureLevel = 'none' | 'read' | 'write' | 'full';

export const FEATURE_KEYS = [
  'meetings.instant',
  'meetings.scheduled',
  'meetings.invitations',
  'recording',
  'transcription',
  'chat',
  'whiteboard',
  'history',
  'notifications',
  'user_management',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type PermissionMap = Partial<Record<FeatureKey, FeatureLevel>>;

export interface FeatureInfo {
  key: FeatureKey;
  label: string;
}

export interface AccessState {
  role: UserRole;
  disabled: boolean;
  permissions: PermissionMap;
  features: readonly FeatureInfo[];
}

const RANK: Record<FeatureLevel, number> = { none: 0, read: 1, write: 2, full: 3 };

// Matches the backend defaults: everything is open except user management.
export function defaultLevel(key: FeatureKey): FeatureLevel {
  return key === 'user_management' ? 'none' : 'full';
}

export function effectiveLevel(access: AccessState | null | undefined, key: FeatureKey): FeatureLevel {
  if (access?.role === 'superadmin') return 'full';
  return access?.permissions?.[key] ?? defaultLevel(key);
}

export function hasFeature(access: AccessState | null | undefined, key: FeatureKey, min: FeatureLevel): boolean {
  if (access?.disabled) return false;
  return RANK[effectiveLevel(access, key)] >= RANK[min];
}

export const LEVEL_LABELS: Record<FeatureLevel, string> = {
  none: 'No access',
  read: 'Read',
  write: 'Write',
  full: 'Full access',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Super admin',
  admin: 'Admin',
  user: 'User',
};
