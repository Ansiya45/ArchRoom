// The application has no student OpenID Connect linking flow. Never infer a
// Google subject from an enrollment email or from the company's Drive account.
export function studentGoogleIdentityStatus(authenticatedUserId: string) {
  return { userId: authenticatedUserId, status: 'unverified' as const, linkingAvailable: false, usableForDrive: false };
}
