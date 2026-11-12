import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

// This module only seals/unseals a provider session. It does not create a
// session, write a job, expose an API, or authenticate the current caller.
export type CompanyRecordingSessionBinding = {
  jobId: string;
  recordingId: string;
  ownerUserId: string;
  driveFileId: string;
  credentialGeneration: string;
  companyAccountEmail: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const driveIdPattern = /^[A-Za-z0-9_-]{10,128}$/;
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const sessionLimit = 4096;
const envelopeLimit = 8192;
const sessionDomain = 'ylaam-company-drive-session:v1';

function bindingBytes(binding: CompanyRecordingSessionBinding): Buffer {
  if (!uuidPattern.test(binding.jobId) || !uuidPattern.test(binding.recordingId) ||
      !uuidPattern.test(binding.ownerUserId) || !uuidPattern.test(binding.credentialGeneration) ||
      !driveIdPattern.test(binding.driveFileId) || binding.companyAccountEmail.length > 254 ||
      !emailPattern.test(binding.companyAccountEmail)) throw new Error('Invalid recording session binding.');
  return Buffer.from(JSON.stringify([sessionDomain, binding.jobId.toLowerCase(), binding.recordingId.toLowerCase(),
    binding.ownerUserId.toLowerCase(), binding.driveFileId, binding.credentialGeneration.toLowerCase(),
    binding.companyAccountEmail.toLowerCase()]), 'utf8');
}

// Accept only the Drive v3 resumable creation endpoint. Additional Google
// session query parameters are opaque and must survive encryption unchanged.
// The transport disables redirects and neither layer logs this capability URL.
function checkedSessionUrl(value: string): string {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value, 'utf8') > sessionLimit || /[\x00-\x20\x7f]/.test(value))
    throw new Error('Invalid company recording session.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid company recording session.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || url.port || url.username || url.password || url.hash ||
      url.pathname !== '/upload/drive/v3/files' || url.searchParams.getAll('uploadType').length !== 1 ||
      url.searchParams.get('uploadType') !== 'resumable' || url.searchParams.getAll('upload_id').length !== 1 ||
      !/^[A-Za-z0-9_-]{1,2048}$/.test(url.searchParams.get('upload_id') ?? ''))
    throw new Error('Invalid company recording session.');
  return value;
}

function sessionKey(masterKey: Buffer): Buffer {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) throw new Error('Invalid recording session key.');
  // Derive a separate key even if a deployment's master key is also used by
  // another integration. Key provisioning and rotation are future work.
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.from(sessionDomain, 'utf8'), Buffer.from('aes-256-gcm', 'utf8'), 32));
}

export function sealCompanyRecordingSession(sessionUrl: string, binding: CompanyRecordingSessionBinding, masterKey: Buffer): string {
  const aad = bindingBytes(binding), url = checkedSessionUrl(sessionUrl), key = sessionKey(masterKey);
  try {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
    return `v1.${nonce.toString('base64url')}.${ciphertext.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`;
  } finally { key.fill(0); }
}

export function unsealCompanyRecordingSession(envelope: string, binding: CompanyRecordingSessionBinding, masterKey: Buffer): string {
  let key: Buffer | undefined;
  try {
    if (typeof envelope !== 'string' || envelope.length > envelopeLimit) throw new Error();
    const aad = bindingBytes(binding);
    key = sessionKey(masterKey);
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1' || parts.slice(1).some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const [nonce, ciphertext, tag] = parts.slice(1).map(part => Buffer.from(part, 'base64url'));
    if (nonce.length !== 12 || tag.length !== 16 || !ciphertext.length || ciphertext.length > sessionLimit ||
        [nonce, ciphertext, tag].some((part, index) => part.toString('base64url') !== parts[index + 1])) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAAD(aad); decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    try { return checkedSessionUrl(plaintext.toString('utf8')); } finally { plaintext.fill(0); }
  } catch { throw new Error('Company recording session cannot be verified.'); }
  finally { key?.fill(0); }
}
