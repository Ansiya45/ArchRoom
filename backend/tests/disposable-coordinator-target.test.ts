import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isDisposableCoordinatorTarget } from '../src/db/disposable-migration-coordinator.js';

test('allows the pinned disposable cluster recording-staging target', () => {
  assert.equal(isDisposableCoordinatorTarget(new URL(
    'postgres://ylaam_disposable_admin@127.0.0.1:55470/ylaam_staging_disposable_company_local',
  )), true);
});

test('rejects remote, credential-bearing, query-modified, and unrelated targets', () => {
  for (const value of [
    'postgres://ylaam_disposable_admin@db.example:55470/ylaam_staging_disposable_company_local',
    'postgres://ylaam_disposable_admin:password@127.0.0.1:55470/ylaam_staging_disposable_company_local',
    'postgres://ylaam_disposable_admin@127.0.0.1:55470/ylaam_staging_disposable_company_local?sslmode=disable',
    'postgres://ylaam_disposable_admin@127.0.0.1:55470/archroom_auth_test',
  ]) assert.equal(isDisposableCoordinatorTarget(new URL(value)), false);
});
