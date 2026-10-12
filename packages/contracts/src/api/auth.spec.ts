import { describe, expect, it } from "vitest";
import {
  activeSessionSchema,
  authSessionsListResultSchema,
  forgotPasswordInputSchema,
  resetPasswordInputSchema,
  revokeOtherSessionsResultSchema,
} from "./auth";

/**
 * Contrato da mini-fase "Esqueci a senha" (spec esqueci-a-senha, critérios
 * Arquitetura): zod único nas duas bordas novas — nem a web nem a API podem
 * duplicar essas regras.
 */

const TOKEN = "a".repeat(64); // 64 hexchars válidos

describe("forgotPasswordInputSchema (POST /auth/forgot-password)", () => {
  it("aceita só o email (normalizado: trim + lowercase)", () => {
    expect(forgotPasswordInputSchema.parse({ email: " Ana@X.com " })).toEqual({
      email: "ana@x.com",
    });
  });

  it("rejeita email inválido e campos extras não declarados passam limpo (strip)", () => {
    expect(() =>
      forgotPasswordInputSchema.parse({ email: "nao-e-email" }),
    ).toThrow();
    expect(
      forgotPasswordInputSchema.parse({ email: "ana@x.com", token: TOKEN }),
    ).toEqual({
      email: "ana@x.com",
    });
  });
});

describe("resetPasswordInputSchema (POST /auth/reset-password)", () => {
  it("aceita token de 64 hexchars + senha no padrão vigente", () => {
    expect(
      resetPasswordInputSchema.parse({ token: TOKEN, password: "senha12345" }),
    ).toEqual({
      token: TOKEN,
      password: "senha12345",
    });
  });

  it("rejeita token fora do formato (não-64-hex é erro de entrada, não de posse → 400 zod)", () => {
    expect(() =>
      resetPasswordInputSchema.parse({ token: "abc", password: "senha12345" }),
    ).toThrow();
    expect(() =>
      resetPasswordInputSchema.parse({
        token: "g".repeat(64),
        password: "senha12345",
      }),
    ).toThrow(); // hexchars inválidos
    expect(() =>
      resetPasswordInputSchema.parse({
        token: "A".repeat(64),
        password: "senha12345",
      }),
    ).toThrow(); // maiúsculas não são aceitas (o token gerado é lowercase)
    expect(() =>
      resetPasswordInputSchema.parse({
        token: TOKEN.slice(0, 63),
        password: "senha12345",
      }),
    ).toThrow();
  });

  it("rejeita senha fraca com a mensagem do passwordSchema vigente (mín. 8)", () => {
    const parsed = resetPasswordInputSchema.safeParse({
      token: TOKEN,
      password: "123",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error.flatten().fieldErrors.password?.[0]).toMatch(/8/);
  });
});

/**
 * Sessões ativas (spec sessao-24h-e-gestao-de-sessoes): a web DESPENCA se a
 * lista vier torta — uuid de verdade, ip/UA nullable, loginAt coerido a Date.
 */
const SESSION_ID = "3f2b6c1e-8a4d-4a5b-9c3e-1d2f3a4b5c6d";

describe("activeSessionSchema (1 linha por refresh token ativo)", () => {
  it("aceita a linha completa e converte loginAt ISO em Date", () => {
    const parsed = activeSessionSchema.parse({
      id: SESSION_ID,
      ip: "201.1.2.3",
      userAgent: "Mozilla/5.0 (Windows NT 10.0)",
      loginAt: "2026-10-10T09:05:00.000Z",
      current: true,
    });
    expect(parsed.loginAt).toBeInstanceOf(Date);
    expect(parsed.current).toBe(true);
  });

  it("tolera ip/userAgent nulos (header ausente nao mata a sessao)", () => {
    expect(() =>
      activeSessionSchema.parse({
        id: SESSION_ID,
        ip: null,
        userAgent: null,
        loginAt: "2026-10-10T09:05:00.000Z",
        current: false,
      }),
    ).not.toThrow();
  });

  it("rejeita id que nao e uuid e loginAt que nao e data", () => {
    expect(() =>
      activeSessionSchema.parse({
        id: "sessao-1",
        ip: null,
        userAgent: null,
        loginAt: "ontem",
        current: true,
      }),
    ).toThrow();
  });
});

describe("authSessionsListResultSchema", () => {
  it("items e obrigatorio (ausente = payload torto → throw)", () => {
    expect(authSessionsListResultSchema.parse({ items: [] })).toEqual({
      items: [],
    });
    const parsed = authSessionsListResultSchema.parse({
      items: [
        {
          id: SESSION_ID,
          ip: null,
          userAgent: null,
          loginAt: "2026-10-10T09:05:00.000Z",
          current: true,
        },
      ],
    });
    expect(parsed.items).toHaveLength(1);
    expect(() => authSessionsListResultSchema.parse({})).toThrow();
  });
});

describe("revokeOtherSessionsResultSchema", () => {
  it("revoked e inteiro >= 0 (contagem de sessoes revogadas)", () => {
    expect(revokeOtherSessionsResultSchema.parse({ revoked: 0 })).toEqual({
      revoked: 0,
    });
    expect(() => revokeOtherSessionsResultSchema.parse({ revoked: -1 })).toThrow();
    expect(() => revokeOtherSessionsResultSchema.parse({ revoked: 1.5 })).toThrow();
  });
});
