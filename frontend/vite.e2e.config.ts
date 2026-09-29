import { mergeConfig } from 'vite';
import existing from './vite.config';

// Test-only proxy target; the normal development config remains unchanged.
export default mergeConfig(existing, {
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3002' } } },
});
