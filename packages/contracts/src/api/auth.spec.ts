import { describe, expect, it } from "vitest";
import { forgotPasswordInputSchema, resetPasswordInputSchema } from "./auth";

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
