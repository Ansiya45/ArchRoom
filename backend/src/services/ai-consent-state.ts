export function aiConsentState(participantIds: string[], decisions: Map<string, boolean>) {
  const pending = participantIds.filter(id => !decisions.has(id)).length;
  const declined = participantIds.filter(id => decisions.get(id) === false).length;
  return {
    pending,
    declined,
    active: participantIds.length > 0 && pending === 0 && declined === 0,
    agreedParticipantIds: participantIds.filter(id => decisions.get(id) === true),
  };
}
