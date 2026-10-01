import jwt from 'jsonwebtoken';
import { env } from '../env.js';

export type JwtPayload = {
  sub: string;
  sid?: string;
  email: string;
  name?: string;
  iat?: number;
  exp?: number;
};

export function signJwt(payload: JwtPayload) {
  const expiresIn = env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn,
  });
}

export function verifyJwt(token: string) {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export function getBearerToken(authHeader?: string) {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
