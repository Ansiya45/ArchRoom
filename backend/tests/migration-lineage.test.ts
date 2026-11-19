import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyMigrationLineage } from '../src/db/migration-lineage.js';

const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), variant = 'd'.repeat(64);
const feature = [{ timestamp: 1, acceptedHashes: [a, variant] }, { timestamp: 2, acceptedHashes: [b] }];
const senior = [{ timestamp: 1, acceptedHashes: [a, variant] }, { timestamp: 3, acceptedHashes: [c] }];

test('classifies only exact historical ledgers as candidates', () => {
  assert.equal(classifyMigrationLineage([], feature, senior), 'fresh-candidate');
  assert.equal(classifyMigrationLineage([{ timestamp: 2, hash: b }, { timestamp: 1, hash: variant }], feature, senior), 'feature-candidate');
  assert.equal(classifyMigrationLineage([{ timestamp: 1, hash: a }, { timestamp: 3, hash: c }], feature, senior), 'senior-candidate');
});

test('rejects partial, combined, duplicated, unknown and ambiguous identities', () => {
  for (const rows of [
    [{ timestamp: 1, hash: a }],
    [{ timestamp: 1, hash: a }, { timestamp: 2, hash: b }, { timestamp: 3, hash: c }],
    [{ timestamp: 1, hash: a }, { timestamp: 1, hash: a }],
    [{ timestamp: 1, hash: a }, { timestamp: 2, hash: c }],
    [{ timestamp: 1, hash: a }, { timestamp: 2, hash: 'invalid' }],
  ]) assert.throws(() => classifyMigrationLineage(rows, feature, senior));
  assert.throws(() => classifyMigrationLineage([{ timestamp: 1, hash: a }, { timestamp: 2, hash: b }], feature, feature), /ambiguous/);
});
