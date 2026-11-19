import type { PrivateAclDriveClient } from './company-recording-private-acl.service.js';
import type { CompanyDriveAccess } from './company-recording-drive-intent.service.js';

type FetchLike = typeof fetch;
type PermissionPage = { permissions?: Array<{ id?: string; type?: string; role?: string; emailAddress?: string }>; nextPageToken?: string };

/** Backend-only Drive permissions adapter. It never exposes tokens or provider URLs. */
export class CompanyRecordingDriveAclClient implements PrivateAclDriveClient {
  constructor(private readonly access: () => Promise<CompanyDriveAccess>, private readonly fetcher: FetchLike = fetch) {}

  private async request<T>(url: string, init?: RequestInit, binding?: { companyAccountEmail: string; credentialGeneration: string }): Promise<T> {
    const auth = await this.access();
    if (binding && (auth.accountEmail.toLowerCase() !== binding.companyAccountEmail.toLowerCase() || auth.credentialGeneration !== binding.credentialGeneration))
      throw new Error('Company Drive connection changed.');
    const response = await this.fetcher(url, { ...init, headers: { Authorization: `Bearer ${auth.accessToken}`, ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Google Drive permissions request failed.');
    const body = await response.text();
    if (body.length > 256 * 1024) throw new Error('Google Drive permissions response is too large.');
    return (body ? JSON.parse(body) : {}) as T;
  }

  async listPermissions(fileId: string, binding?: { companyAccountEmail: string; credentialGeneration: string }) {
    const all: Array<{ id: string; type: string; role: string; emailAddress?: string }> = [];
    let token: string | undefined;
    const tokens = new Set<string>();
    do {
      if (tokens.size >= 100) throw new Error('Drive permission pagination is incomplete.');
      const query = new URLSearchParams({ fields: 'permissions(id,type,role,emailAddress),nextPageToken', pageSize: '100' });
      if (token) query.set('pageToken', token);
      const page = await this.request<PermissionPage>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?${query}`, undefined, binding);
      if (!Array.isArray(page.permissions)) throw new Error('Drive permission metadata is incomplete.');
      for (const permission of page.permissions) {
        if (!permission.id || !permission.type || !permission.role) throw new Error('Drive permission metadata is incomplete.');
        all.push({ id: permission.id, type: permission.type, role: permission.role, emailAddress: permission.emailAddress });
      }
      token = page.nextPageToken;
      if (token !== undefined && (typeof token !== 'string' || !token || tokens.has(token))) throw new Error('Drive permission pagination is incomplete.');
      if (token) tokens.add(token);
    } while (token);
    return all;
  }

  async grantReader(input: { fileId: string; email: string; companyAccountEmail: string; credentialGeneration: string }) {
    const existing = (await this.listPermissions(input.fileId, input)).find(p => p.type === 'user' && p.emailAddress?.toLowerCase() === input.email.toLowerCase());
    if (existing) {
      if (existing.role !== 'reader') throw new Error('Existing Drive permission is not reader-only.');
      return { permissionId: existing.id, created: false };
    }
    const body = JSON.stringify({ type: 'user', role: 'reader', emailAddress: input.email });
    const created = await this.request<{ id?: string }>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions?sendNotificationEmail=false`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, input);
    if (!created.id) throw new Error('Drive permission creation was ambiguous.');
    return { permissionId: created.id, created: true };
  }

  async revokeDirectReader(input: { fileId: string; permissionId: string; companyAccountEmail: string; credentialGeneration: string }) {
    const permissions = await this.listPermissions(input.fileId, input);
    const permission = permissions.find(p => p.id === input.permissionId);
    if (!permission) return { revoked: true };
    if (permission.type !== 'user' || permission.role !== 'reader') throw new Error('Drive permission is not a direct reader grant.');
    await this.request<Record<string, never>>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions/${encodeURIComponent(input.permissionId)}`, { method: 'DELETE' }, input);
    return { revoked: true };
  }

  async grantAnyoneReader(input: { fileId: string; companyAccountEmail: string; credentialGeneration: string }) {
    const existing = (await this.listPermissions(input.fileId, input)).find(p => p.type === 'anyone');
    if (existing) {
      if (existing.role !== 'reader') throw new Error('Existing public permission is not reader-only.');
      return { permissionId: existing.id, created: false };
    }
    const created = await this.request<{ id?: string }>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions?sendNotificationEmail=false`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'anyone', role: 'reader' }) }, input);
    if (!created.id) throw new Error('Public permission creation was ambiguous.');
    return { permissionId: created.id, created: true };
  }

  async revokePermission(input: { fileId: string; permissionId: string; companyAccountEmail: string; credentialGeneration: string }) {
    const permission = (await this.listPermissions(input.fileId, input)).find(p => p.id === input.permissionId);
    if (!permission) return { revoked: true };
    if (permission.type !== 'anyone' || permission.role !== 'reader') throw new Error('Permission is not a direct public reader grant.');
    await this.request<Record<string, never>>(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.fileId)}/permissions/${encodeURIComponent(input.permissionId)}`, { method: 'DELETE' }, input);
    return { revoked: true };
  }
}
