import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { Env } from '../../config/env.validation';

export interface AuthenticatedUser {
  id: string;
  email: string;
  telegramId: string | null;
}

export interface AuthenticatedRequest {
  user?: AuthenticatedUser;
}

export const REFRESH_COOKIE = 'agendabo_refresh';

/** SHA-256 hex — para hashes de codigo de verificacao (semente publica, busca por email). */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * HMAC com segredo do servidor para tokens de refresh (semente aleatoria de 32 bytes,
 * entao o HMAC adiciona defesa em profundidade contra colusao de indice).
 */
export function hashToken(input: string, secret: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password);
  }

  verifyPassword(hash: string, password: string): Promise<boolean> {
    return argon2.verify(hash, password);
  }

  async signAccessToken(user: AuthenticatedUser): Promise<string> {
    return this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { expiresIn: this.config.get('ACCESS_TOKEN_TTL', { infer: true }) },
    );
  }

  /** null em qualquer falha (expirado/assinatura errada/malformado) — nunca lanca. */
  async verifyAccessToken(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token) return null;
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string }>(token);
      return { id: payload.sub, email: payload.email, telegramId: null };
    } catch {
      return null;
    }
  }

  /** Refresh: token opaco guardado como HMAC no banco (30 dias, cookie httpOnly). */
  newRefreshToken(): { token: string; tokenHash: string } {
    const token = randomToken();
    return { token, tokenHash: hashToken(token, this.config.get('JWT_SECRET', { infer: true })) };
  }

  hashRefreshToken(token: string): string {
    return hashToken(token, this.config.get('JWT_SECRET', { infer: true }));
  }

  /** Comparacao em tempo constante do codigo de 6 digitos. */
  codeMatches(candidate: string, codeHash: string): boolean {
    const candidateHash = sha256Hex(candidate);
    const a = Buffer.from(candidateHash, 'hex');
    const b = Buffer.from(codeHash, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
