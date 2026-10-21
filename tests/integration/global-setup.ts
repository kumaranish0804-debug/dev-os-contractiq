import { loadEnv } from 'vite';

// Before the run: remove test users that a crashed earlier run left behind (> 1 h old).
export default async function setup() {
  Object.assign(process.env, loadEnv('test', process.cwd(), ''));
  const { sweepStaleTestUsers } = await import('./helpers');
  const removed = await sweepStaleTestUsers();
  if (removed > 0) console.log(`Swept ${removed} stale test user(s).`);
}
