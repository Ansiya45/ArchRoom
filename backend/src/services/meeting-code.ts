// Participants routinely paste the whole invite link into fields that expect
// the bare code (the join UI literally labels its input "Meeting Code / Link").
// A pasted URL like https://app/meet/YLM-ABC123 must resolve to YLM-ABC123,
// otherwise every meeting lookup reports a false "Meeting not found".
export function normalizeMeetingCode(raw: string): string {
  let code = raw.trim();
  const linkMatch = code.match(/\/meet\/([^/?#\s]+)/i);
  if (linkMatch) {
    try { code = decodeURIComponent(linkMatch[1]); } catch { code = linkMatch[1]; }
  }
  return code.toUpperCase();
}
