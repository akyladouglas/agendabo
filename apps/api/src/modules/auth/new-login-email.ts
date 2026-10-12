import type { MailMessage } from './mail.service';

/**
 * E-mail de alerta de novo login (spec sessão-24h, decisão humana nº 3): disparado
 * quando o user-agent do login NÃO bate com nenhuma sessão ativa anterior (mesmo
 * device não alarma — D4 do plano). Conteúdo fixo: ip, user-agent, data/hora UTC
 * e o caminho de emergência ("encerre as outras sessões"). Os dados entram por
 * parâmetro (módulo puro, TDD no vitest) e o html reusa a paleta table-based de
 * `verification-email.ts` com `escapeHtml` defensivo (ip/UA chegam de fora).
 */

export const NEW_LOGIN_SUBJECT = 'Novo login na sua conta';

const PALETTE = {
  bg: '#f6f8fa',
  surface: '#ffffff',
  border: '#d7dee6',
  text: '#182430',
  muted: '#5b6675',
  primary: '#157a4e',
} as const;

const FONT = `font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Data/hora fixa em UTC (ADR-002: banco é UTC; o e-mail declara o fuso). */
function formatUtc(at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(at.getUTCDate())}/${p(at.getUTCMonth() + 1)}/${at.getUTCFullYear()} ` +
    `${p(at.getUTCHours())}:${p(at.getUTCMinutes())} UTC`
  );
}

export const NEW_LOGIN_WARNING =
  'Se não foi você, acesse a aplicação e encerre as outras sessões em Perfil → Suas sessões.';

export function newLoginEmail(input: {
  to: string;
  ip: string | null;
  userAgent: string | null;
  at: Date;
}): MailMessage {
  const ip = input.ip ?? 'desconhecido';
  const userAgent = input.userAgent ?? 'desconhecido';
  const when = formatUtc(input.at);
  return {
    to: input.to,
    subject: NEW_LOGIN_SUBJECT,
    text:
      `Novo login na sua conta do Agendabô.\n\n` +
      `Data/hora: ${when}\n` +
      `IP: ${ip}\n` +
      `Navegador/dispositivo: ${userAgent}\n\n` +
      `${NEW_LOGIN_WARNING}`,
    html: newLoginEmailHtml(ip, userAgent, when),
  };
}

function newLoginEmailHtml(ip: string, userAgent: string, when: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background:${PALETTE.bg};${FONT}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PALETTE.bg};padding:32px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:${PALETTE.surface};border:1px solid ${PALETTE.border};border-radius:16px;padding:32px 28px">
            <tr>
              <td align="center" style="padding-bottom:20px">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:36px;height:36px;background:${PALETTE.primary};border-radius:10px;text-align:center;font-size:18px;line-height:36px">&#128276;</td>
                    <td style="padding-left:10px;font-size:20px;font-weight:700;color:${PALETTE.text};${FONT}">Agendab&ocirc;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:20px;font-weight:700;color:${PALETTE.text};padding-bottom:8px;${FONT}">
                Novo login na sua conta
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:14px;color:${PALETTE.muted};line-height:1.55;padding-bottom:24px;${FONT}">
                Registros do acesso:<br />
                <strong style="color:${PALETTE.text}">${escapeHtml(when)}</strong><br />
                IP: ${escapeHtml(ip)}<br />
                Navegador/dispositivo: ${escapeHtml(userAgent)}
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:13px;color:${PALETTE.muted};line-height:1.55;padding-bottom:20px;${FONT}">
                ${escapeHtml(NEW_LOGIN_WARNING)}
              </td>
            </tr>
            <tr>
              <td align="center" style="border-top:1px solid ${PALETTE.border};padding-top:16px;font-size:12px;color:${PALETTE.muted};${FONT}">
                Agendab&ocirc; &middot; Sua agenda sem complica&ccedil;&atilde;o, agenda inteligente = dia organizado.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
