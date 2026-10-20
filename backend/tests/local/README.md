# Local database tests

Run `npm run test:integration:local` from `backend` with `PG_TEST_PASSWORD`
set to the password for your local PostgreSQL `postgres` user.
The test requires the migrated `ylaam_auth_test` database at `127.0.0.1:5432`.

These tests are separate from `npm test` (unit tests) and
`npm run test:integration` (the disposable database tests used in CI).
Do not commit database credentials.
