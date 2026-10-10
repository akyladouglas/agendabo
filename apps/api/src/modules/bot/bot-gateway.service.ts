import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import type { Env } from '../../config/env.validation';
import { SchedulingFlowService } from './scheduling-flow.service';
import { TelegramClientService } from '../../shared/telegram/telegram-client.service';

/**
 * Bootstrap do bot: DONO do gateway do Telegram, em um de dois modos (env):
 * - TELEGRAM_WEBHOOK_URL presente -> WEBHOOK: o Telegram POSTa updates na rota
 *   /telegram/webhook da API (HTTPS de entrada; sem conexao longa de saida, que
 *   e engolida silenciosamente em alguns datacenters). O processo que roda o
 *   HTTP (api) atende o webhook; o binario do bot vira espectador.
 * - ausente -> LONG-POLLING: um unico processo consome getUpdates (gotcha 5:
 *   duas instancias = 409). `deleteWebhook` no boot garante que nao ha webhook
 *   brigando com o polling.
 *
 * Os handlers sao FINOS (regra default-architecture #4): extrai telegramId + texto/
 * callback e delega ao SchedulingFlowService; gate de conta fica no service.
 * S6 sobe com TELEGRAM_BOT_TOKEN (a API pode viver sem bot em dev/test).
 */
@Injectable()
export class BotGatewayService
  implements OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy
{
  private readonly logger = new Logger(BotGatewayService.name);
  private bot: Telegraf | null = null;
  private shuttingDown = false;

  constructor(
    private readonly telegram: TelegramClientService,
    private readonly flow: SchedulingFlowService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Dono do long-polling: so o binario do bot (bot-main.js marca o owner). */
  ownsPolling(): boolean {
    return process.env.BOT_GATEWAY_EXPLICIT_OWNER === 'true';
  }

  /** Dono do webhook: o processo que sobe HTTP (API) com a env configurada. */
  ownsWebhook(): boolean {
    // o dono do webhook e o processo que sobe HTTP = a API
    return Boolean(this.config.get('TELEGRAM_WEBHOOK_URL', { infer: true })) && !this.ownsPolling();
  }

  /**
   * Rota do webhook (mountada no app da API em HTTPS). NAO e controller: o
   * corpo e o Update bruto do Telegram — 200 rapido e processamento fino.
   * Segura o segredo na URL (telegramWebhookSecret), como o Telegram manda
   * no header X-Telegram-Bot-Api-Secret-Token.
   */
  webhookHandler: (req: IncomingMessage, res: ServerResponse) => Promise<void> = async (
    req,
    res,
  ) => {
    const url = this.config.get('TELEGRAM_WEBHOOK_URL', { infer: true });
    const secret = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true });
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (!url || !req.url?.startsWith('/telegram/webhook') || (secret && header !== secret)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(); // ack primeiro: o Telegram faz retry se demorar
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const update = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      await this.handleUpdate(update);
    } catch (err) {
      this.logger.error(`webhook: erro processando update: ${String(err)}`);
    }
  };

  /** Handler fino compartilhado webhook/polling: text + callback_query. */
  async handleUpdate(update: unknown): Promise<void> {
    const u = update as {
      message?: { text?: string; chat?: { id?: number } };
      callback_query?: { data?: string | unknown; from?: { id?: number } };
    };
    if (u.message?.text && u.message.chat?.id != null) {
      await this.flow.handleText(String(u.message.chat.id), u.message.text);
      return;
    }
    if (u.callback_query?.from?.id != null && typeof u.callback_query.data === 'string') {
      await this.flow.handleCallback(String(u.callback_query.from.id), u.callback_query.data);
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    const webhookUrl = this.config.get('TELEGRAM_WEBHOOK_URL', { infer: true });
    if (webhookUrl) {
      if (this.ownsPolling()) {
        // binario do bot: quem faz setWebhook e o HTTP da API — espectador
        this.logger.log('webhook mode — este processo nao e o dono do HTTP (espectador)');
        return;
      }
      try {
        const bot = this.telegram.getClient();
        const secret = this.config.get('TELEGRAM_WEBHOOK_SECRET', { infer: true });
        await bot.telegram.setWebhook(webhookUrl, {
          secret_token: secret,
          drop_pending_updates: true, // fila presa de polling nao inunda o webhook
          allowed_updates: ['message', 'callback_query'],
        });
        const wi = await bot.telegram.getWebhookInfo();
        this.logger.log(`webhook ativo: url='${wi.url}' pendencias=${wi.pending_update_count}`);
      } catch (err) {
        this.logger.error(`falha ao configurar webhook (bot sem receber updates): ${String(err)}`);
      }
      return;
    }
    // --- modo long-polling (dev/local; em prod com webhook a env manda aqui) ---
    if (!this.ownsPolling() && !this.config.get('BOT_GATEWAY_ENABLED', { infer: true })) {
      this.logger.log('BOT_GATEWAY_ENABLED=false — gateway do bot desligado neste processo');
      return;
    }
    // Ordem obrigatoria: deleteWebhook resolve ANTES do start — polling com
    // webhook pendurado da 409 (getUpdates fica barrado, update preso, sem erro no log).
    try {
      await this.telegram.getClient().telegram.deleteWebhook({ drop_pending_updates: false });
      this.logger.log('deleteWebhook no boot: aplicado');
    } catch (err) {
      // sem webhook configurado o Telegram responde 404; nada a fazer (gotcha 5).
      this.logger.log(`deleteWebhook no boot: ${String(err)}`);
    }
    let bot: Telegraf;
    try {
      bot = this.telegram.getClient();
    } catch {
      this.logger.warn('TELEGRAM_BOT_TOKEN ausente — gateway do bot desligado (API segue no ar)');
      return;
    }
    this.bot = bot;

    // Visibilidade total: toda falha de long-polling (409, timeout de rede, etc.)
    // sai no log em vez de engolida pelo retry interno do Telegraf.
    bot.catch((err: unknown) => {
      const payload =
        typeof err === 'object' && err !== null && 'payload' in err
          ? (err as { payload?: { error_code?: number } }).payload
          : undefined;
      this.logger.error(`erro no update: code=${payload?.error_code ?? '-'} ${String(err)}`);
    });

    bot.on('text', async (ctx) => {
      const id = ctx.from?.id;
      const text = 'text' in ctx.message ? ctx.message.text : undefined;
      if (!id || !text) return;
      await this.safe(`text ${id}`, () => this.flow.handleText(String(id), text), ctx);
    });

    bot.on('callback_query', async (ctx) => {
      const id = ctx.from?.id;
      const cq = ctx.callbackQuery;
      if (!id || !('data' in cq)) return;
      await this.safe(`callback ${id}`, () => this.flow.handleCallback(String(id), cq.data), ctx);
    });

    // Diagnostico: o que o telegram diz sobre a fila no boot (pendencias =
    // alguem esta segurando os updates, ou o polling nao e efetivo).
    const wi = await bot.telegram.getWebhookInfo();
    this.logger.log(
      `boot polling: url='${wi.url || 'nenhuma'}' pendencias=${wi.pending_update_count} ultimo_erro=${wi.last_error_message ?? 'nenhum'}`,
    );
    await bot.telegram.getMe(); // falha cedo se o token for invalido
    // tipagem do Telegraf exige middleware na sobrecarga de start; chamamos via Composer
    await (bot.start as unknown as () => Promise<void>)();
    this.startHealthLoop(bot);
    this.logger.log('gateway do bot: long-polling iniciado (processo único)');
  }

  onApplicationShutdown(): void {
    // para de aceitar updates ANTES do app fechar (evita 409/ruído no shutdown).
    this.shuttingDown = true;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.bot) return;
    try {
      await this.bot.stop('SIGTERM' as never);
      this.logger.log('gateway do bot: long-polling encerrado');
    } catch (err) {
      this.logger.warn(`erro ao parar o long-polling: ${String(err)}`);
    }
  }

  /**
   * Prova do polling (diagnostico): a cada 60s manda getMe com um timeout CURTO.
   * getMe e uma rota que NAO conflita com getUpdates de outro consumidor — 409
   * aqui = o token esta sendo usado em outro lugar; sucesso = rede/telegram ok.
   * Se aparecer isto no log do container, e o processo do bot MESMO dizendo que
   * consegue falar com o telegram a cada minuto (e a fila presa e culpa dele).
   */
  private startHealthLoop(bot: Telegraf): void {
    const timer = setInterval(async () => {
      const t0 = Date.now();
      try {
        await Promise.race([
          bot.telegram.getMe(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 10s')), 10_000)),
        ]);
        this.logger.log(`polling alive: getMe ok em ${Date.now() - t0}ms`);
      } catch (err) {
        this.logger.error(`polling alive: getMe FALHOU em ${Date.now() - t0}ms: ${String(err)}`);
      }
    }, 60_000);
    timer.unref?.();
  }

  /** Handler fino NUNCA derruba o polling: erro e logado e o usuário fica sabendo. */
  private async safe(
    label: string,
    work: () => Promise<void>,
    ctx: { reply: (t: string) => Promise<unknown> },
  ): Promise<void> {
    try {
      await work();
    } catch (err) {
      if (this.shuttingDown) return;
      this.logger.error(`bot: erro processando (${label}): ${String(err)}`);
      await ctx.reply('Tive um probleminha aqui, tenta de novo? 🙏').catch(() => undefined);
    }
  }
}
