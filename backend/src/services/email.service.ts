import { TRPCError } from '@trpc/server';
import { env } from '../env.js';

type EmailInput = { to: string; subject: string; html: string; from?: string };

export async function sendEmail(input: EmailInput) {
  if (!env.RESEND_API_KEY) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Email is not configured. Add RESEND_API_KEY to the backend environment.' });
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: input.from || env.EMAIL_FROM, to: [input.to], subject: input.subject, html: input.html }),
  });
  if (!response.ok) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Unable to send email: ${(await response.text()).slice(0, 300)}` });
  }
}

export function verificationEmail(name: string, code: string) {
  return { subject: 'Verify your YLAAM-MEET email', html: emailLayout(`Welcome to YLAAM-MEET, ${escapeHtml(name)}`, 'Enter this code to verify your email address:', code) };
}

export function passwordResetEmail(name: string, code: string) {
  return { subject: 'Reset your YLAAM-MEET password', html: emailLayout('Password reset', `Hi ${escapeHtml(name)}, enter this code to choose a new password:`, code) };
}

function emailLayout(title: string, message: string, code: string) {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h2>${title}</h2><p>${message}</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>This code expires in 10 minutes. If you did not request this, you can ignore this email.</p></div>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}
