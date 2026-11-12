// Policy compiler only, NOT authorization or ACL enforcement. Inputs must come
// from a transactionally authorized server snapshot, never an HTTP request.
// No current upload/publication path consumes this until durable identity
// ownership and serialized ACL mutation/verification are implemented.
export type PrivatePolicyInput = {
  mode: string;
  companySubject: string;
  companyEmail: string;
  creatorId: string;
  recordingHostId: string;
  durableHostIds: readonly string[];
  managerIds: readonly string[];
  identities: readonly { userId: string; subject: string; email: string; verified: boolean }[];
};
export function compilePrivateRecordingReaders(input: PrivatePolicyInput):
  | { status: 'BLOCKED'; reason: 'UNSUPPORTED_MODE' | 'DURABLE_HOST_REQUIRED' | 'IDENTITY_REQUIRED' | 'AMBIGUOUS_IDENTITY' }
  | { status: 'READY_FOR_ACL'; readers: { subject: string; email: string }[] } {
  if (input.mode !== 'private') return { status: 'BLOCKED', reason: 'UNSUPPORTED_MODE' };
  if (!input.creatorId || !input.recordingHostId ||
    (input.recordingHostId !== input.creatorId && !input.durableHostIds.includes(input.recordingHostId)))
    return { status: 'BLOCKED', reason: 'DURABLE_HOST_REQUIRED' };
  const validEmail = (value: string) => value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (!input.companySubject || !validEmail(input.companyEmail)) return { status: 'BLOCKED', reason: 'IDENTITY_REQUIRED' };
  const required = [...new Set([input.creatorId, input.recordingHostId, ...input.managerIds])].sort();
  const subjects = new Set<string>();
  const emails = new Set<string>();
  const readers: { subject: string; email: string }[] = [];
  for (const userId of required) {
    const matches = input.identities.filter(identity => identity.userId === userId);
    if (matches.length > 1) return { status: 'BLOCKED', reason: 'AMBIGUOUS_IDENTITY' };
    const identity = matches[0];
    if (!identity?.verified || !identity.subject || !validEmail(identity.email))
      return { status: 'BLOCKED', reason: 'IDENTITY_REQUIRED' };
    const email = identity.email.toLowerCase();
    if (subjects.has(identity.subject) || emails.has(email)) return { status: 'BLOCKED', reason: 'AMBIGUOUS_IDENTITY' };
    subjects.add(identity.subject); emails.add(email);
    if (identity.subject === input.companySubject || email === input.companyEmail.toLowerCase()) {
      if (identity.subject !== input.companySubject || email !== input.companyEmail.toLowerCase())
        return { status: 'BLOCKED', reason: 'AMBIGUOUS_IDENTITY' };
      continue; // The company already retains ownership; never downgrade it.
    }
    readers.push({ subject: identity.subject, email });
  }
  return { status: 'READY_FOR_ACL', readers };
}
