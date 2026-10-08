/**
 * E-mail do magic link de reset (spec esqueci-a-senha regra 7): HTML table-based
 * na paleta de `verification-email.ts` (o unico formato que Gmail/Outlook
 * aceitam), botao "Redefinir senha" + URL em texto alternativo + aviso "valido
 * por 1 hora; se voce nao pediu, ignore". `escapeHtml` defensivo no link (o
 * token e hex, mas o preco da defesa e zero — gotcha 6/verification-email).
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

/**
 * @param link URL absoluta do magic link (`${WEB_ORIGIN}/redefinir-senha?token=...`)
 * gerada pelo service. Vai escapada no href E como texto alternativo clicavel.
 */
export function passwordResetEmailHtml(link: string): string {
  const safeLink = escapeHtml(link);
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
                    <td style="width:36px;height:36px;background:${PALETTE.primary};border-radius:10px;text-align:center;font-size:18px;line-height:36px">&#128274;</td>
                    <td style="padding-left:10px;font-size:20px;font-weight:700;color:${PALETTE.text};${FONT}">Agendab&ocirc;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:20px;font-weight:700;color:${PALETTE.text};padding-bottom:8px;${FONT}">
                Redefinir senha
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:14px;color:${PALETTE.muted};line-height:1.55;padding-bottom:24px;${FONT}">
                Recebemos um pedido para redefinir a senha da tua conta. &Eacute; s&oacute; clicar no bot&atilde;o abaixo e escolher uma senha nova:
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="background:${PALETTE.primary};border-radius:10px">
                      <a href="${safeLink}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;${FONT}">Redefinir senha</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:12px;color:${PALETTE.muted};line-height:1.55;padding-bottom:16px;${FONT}">
                Se o bot&atilde;o n&atilde;o funcionar, copie e cole este link no navegador:<br />
                <a href="${safeLink}" style="color:${PALETTE.primary};word-break:break-all">${safeLink}</a>
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:13px;color:${PALETTE.muted};line-height:1.55;padding-bottom:20px;${FONT}">
                V&aacute;lido por <strong style="color:${PALETTE.text}">1 hora</strong>. Se voc&ecirc; n&atilde;o pediu isto,
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
