// Accepts either a bare meeting code (YLM-XXXXXX) or a pasted invite link
// (https://host/meet/YLM-XXXXXX?ref=email) and returns the canonical code.
// Returns '' when the input cannot be reduced to a plausible code.
export function extractMeetingCode(value: string): string {
  const trimmed = value.trim();
  const linkMatch = trimmed.match(/\/meet\/([A-Za-z0-9-]+)/i);
  if (linkMatch) {
    try { return decodeURIComponent(linkMatch[1]).toUpperCase(); }
    catch { return linkMatch[1].toUpperCase(); }
  }
  const bareMatch = trimmed.match(/^([A-Za-z0-9-]+)$/);
  return bareMatch ? bareMatch[1].toUpperCase() : '';
}
