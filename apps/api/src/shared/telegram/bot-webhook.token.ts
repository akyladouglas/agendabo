/**
 * Token do handler HTTP do webhook do bot. Vive fora de modules/ porque o
 * entrypoint main.ts nao pode importar logica de modulos (lint:arch): o
 * BotModule registra o handler sob este token e main.ts resolve via app.get —
 * uma string-contract, nenhuma dependencia de implementacao.
 */
export const BOT_WEBHOOK_HANDLER = 'BOT_WEBHOOK_HANDLER' as const;
