import { randomUUID } from 'node:crypto';
import type { IntegrationCredentialRepository, StoredIntegrationCredential } from '../src/services/drive-security.service.js';

export function memoryCredentialRepository() {
  let generation = randomUUID();
  let value: Omit<StoredIntegrationCredential, 'generation'> | null = null;
  let writes = 0;
  const repository: IntegrationCredentialRepository = {
    generation: async () => generation,
    load: async () => value ? { ...value, generation } : null,
    save: async (next, expected, previous) => {
      if (generation !== expected || (previous !== undefined && value?.encryptedRefreshToken !== previous)) return false;
      value = next; writes++; return true;
    },
    remove: async () => { generation = randomUUID(); value = null; },
  };
  return { repository, stored: () => value, writes: () => writes };
}
