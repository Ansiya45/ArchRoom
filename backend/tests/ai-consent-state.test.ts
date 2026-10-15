import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiConsentState } from '../src/services/ai-consent-state.ts';

test('AI remains off until every admitted participant agrees', () => {
  assert.deepEqual(aiConsentState(['host', 'guest'], new Map([['host', true]])), {
    pending: 1, declined: 0, active: false, agreedParticipantIds: ['host'],
  });
  assert.equal(aiConsentState(['host', 'guest'], new Map([['host', true], ['guest', true]])).active, true);
});

test('decline, withdrawal, and late arrival stop capture eligibility', () => {
  const decisions = new Map([['host', true], ['guest', true]]);
  assert.equal(aiConsentState(['host', 'guest', 'late'], decisions).active, false);
  decisions.set('guest', false);
  assert.equal(aiConsentState(['host', 'guest'], decisions).declined, 1);
  assert.equal(aiConsentState(['host', 'guest'], decisions).active, false);
});
