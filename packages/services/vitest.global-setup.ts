// One Postgres for the whole run, shared by every spec file in this project. See
// `@app/db`'s `src/testing/global-setup.ts`.
export { setup, teardown } from '@app/db/testing/global-setup';
