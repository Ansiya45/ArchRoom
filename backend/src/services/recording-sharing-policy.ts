export type SharingMode = 'private' | 'restricted' | 'anyone_with_link';
export type SharingRecipient = { userId: string; googleSubject?: string | null; googleEmail?: string | null; approved: boolean; authorized: boolean };

export function resolveRestrictedRecipients(input: { batchFolderId?: string | null; students: readonly SharingRecipient[]; staff: readonly SharingRecipient[] }) {
  return validateRestrictedRecipients({ batchFolderId: input.batchFolderId, recipients: [...input.students, ...input.staff] });
}

export function validateRestrictedRecipients(input: { batchFolderId?: string | null; recipients: readonly SharingRecipient[] }) {
  if (!input.batchFolderId) throw new Error('Restricted recordings require a valid batch.');
  const subjects = new Set<string>();
  const emails = new Set<string>();
  for (const recipient of input.recipients) {
    if (!recipient.approved || !recipient.authorized || !recipient.googleSubject || !recipient.googleEmail)
      throw new Error('Restricted recording recipient is not verified and approved.');
    const email = recipient.googleEmail.toLowerCase();
    if (subjects.has(recipient.googleSubject) || emails.has(email)) throw new Error('Restricted recording identities are ambiguous.');
    subjects.add(recipient.googleSubject); emails.add(email);
  }
  if (!input.recipients.length) throw new Error('Restricted recordings require approved recipients.');
  return [...input.recipients];
}

export function validateAnyoneWithLink(input: { mode: SharingMode; hostConfirmed: boolean; explicitHostAuthorization: boolean }) {
  if (input.mode !== 'anyone_with_link') throw new Error('Anyone-with-link validation requires the matching sharing mode.');
  if (!input.hostConfirmed || !input.explicitHostAuthorization) throw new Error('Anyone-with-link requires explicit host authorization and confirmation.');
  return { type: 'anyone' as const, role: 'reader' as const };
}

export function validateSharingTransition(input: { from: SharingMode; to: SharingMode; publicPermissionRevoked: boolean }) {
  if (input.from === 'anyone_with_link' && input.to !== 'anyone_with_link' && !input.publicPermissionRevoked)
    throw new Error('Public Drive access must be independently revoked before changing sharing mode.');
  return true;
}
