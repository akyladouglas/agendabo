/**
 * E-mail de código de confirmação (Fase 5): HTML table-based (o único formato que
 * Gmail/Outlook aceitam), tema do produto, e 6 caixinhas com o código — a mesma
 * cara da tela de confirmação. `escapeHtml` defensivo no e-mail (gotcha 6 é do
 * Telegram; aqui é barateza contra futuro dado dinâmico).
 */
const PALETTE = {
  bg: '#f6f8fa',
  surface: '#ffffff',
  border: '#d7dee6',
  text: '#182430',
  muted: '#5b6675',
  primary: '#157a4e',
  chipBg: '#eef1f5',
} as const;

const FONT = `font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Caixinhas apenas para codigos de 6 digitos; qualquer outra entrada cai no fallback. */
const CODE_DIGITS = /^\d{6}$/;

function codeDisplay(code: string): string {
  if (!CODE_DIGITS.test(code)) {
    return `<div style="font-size:26px;font-weight:700;letter-spacing:6px;color:${PALETTE.text};${FONT}">${escapeHtml(code)}</div>`;
  }
  return code
    .split('')
    .map(
      (d) =>
        `<td style="padding:0 4px">
          <div style="width:40px;height:48px;line-height:48px;text-align:center;background:${PALETTE.chipBg};border:1px solid ${PALETTE.border};border-radius:8px;font-size:22px;font-weight:700;color:${PALETTE.text};${FONT}">${d}</div>
        </td>`,
    )
    .join('');
}

export function verificationCodeEmailHtml(code: string): string {
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
                    <td style="width:36px;height:36px;background:${PALETTE.primary};border-radius:10px;text-align:center;font-size:18px;line-height:36px">&#128197;</td>
                    <td style="padding-left:10px;font-size:20px;font-weight:700;color:${PALETTE.text};${FONT}">Agendab&ocirc;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:20px;font-weight:700;color:${PALETTE.text};padding-bottom:8px;${FONT}">
                Confirme teu e-mail
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:14px;color:${PALETTE.muted};line-height:1.55;padding-bottom:24px;${FONT}">
                &Eacute; s&oacute; digitar este c&oacute;digo na tela de confirma&ccedil;&atilde;o para liberar o bot:
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>${codeDisplay(code)}</tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:13px;color:${PALETTE.muted};line-height:1.55;padding-bottom:20px;${FONT}">
                V&aacute;lido por <strong style="color:${PALETTE.text}">15 minutos</strong>. Se voc&ecirc; n&atilde;o pediu isto,
                &eacute; s&oacute; ignorar este e-mail &mdash; nada muda na sua conta.
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
