/**
 * E-mail do convite de compartilhamento (spec compartilhamento A.6): HTML
 * table-based na paleta de `password-reset-email.ts`/`verification-email.ts`
 * (o unico formato que Gmail/Outlook aceitam), botao "Ver convite" + URL em
 * texto alternativo + validade (24h) + "se voce nao reconhece, ignore".
 *
 * `escapeHtml` OBRIGATORIO no link E no nome do dono (gotcha 6/HTML mail): o
 * nome e dado digitado pelo usuario — um `Ana <admin>` quebraria o HTML e
 * abriria injecao de marcação no cliente de email do convidado.
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

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * @param link URL absoluta do convite (`${WEB_ORIGIN}/convite-agenda?token=...`)
 * gerada pelo service. Vai escapada no href E como texto alternativo clicavel.
 * @param ownerName nome da conta do dono (dado do usuario — escapado aqui).
 */
export function sharedAgendaInviteEmailHtml(link: string, ownerName: string): string {
  const safeLink = escapeHtml(link);
  const safeOwner = escapeHtml(ownerName);
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
                Agenda compartilhada
              </td>
            </tr>
            <tr>
              <td align="center" style="font-size:14px;color:${PALETTE.muted};line-height:1.55;padding-bottom:24px;${FONT}">
                <strong style="color:${PALETTE.text}">${safeOwner}</strong> quer compartilhar a agenda dele com voc&ecirc;
                (somente leitura). &Eacute; s&oacute; clicar no bot&atilde;o abaixo para aceitar:
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="background:${PALETTE.primary};border-radius:10px">
                      <a href="${safeLink}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;${FONT}">Ver convite</a>
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
                V&aacute;lido por <strong style="color:${PALETTE.text}">24 horas</strong>. Se voc&ecirc; n&atilde;o reconhece
                ${safeOwner}, &eacute; s&oacute; ignorar este e-mail &mdash; nada muda na sua conta.
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
