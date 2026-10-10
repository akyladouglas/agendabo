import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import type { Env } from '../../config/env.validation';
import { SchedulingFlowService } from './scheduling-flow.service';
import { TelegramClientService } from '../../shared/telegram/telegram-client.service';

/**
 * Bootstrap do bot (Fase 1): DONO do long-polling — um unico processo consome o
 * getUpdates do token (gotcha 5: duas instancias = 409 Conflict). `deleteWebhook`
 * no boot garante que nao ha webhook pendurado brigando com o polling.
 *
 * Os handlers sao FINOS (regra default-architecture #4): extrai telegramId + texto/
 * callback e delega ao SchedulingFlowService; gate de conta fica no service.
 * S6 sobe com TELEGRAM_BOT_TOKEN (a API pode viver sem bot em dev/test).
 */
@Injectable()
export class BotGatewayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BotGatewayService.name);
  private bot: Telegraf | null = null;
  private shuttingDown = false;

  constructor(
    private readonly telegram: TelegramClientService,
    private readonly flow: SchedulingFlowService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Dono do polling: o binario do bot (bot-main.js) marca BOT_GATEWAY_EXPLICIT_OWNER
   * no process.env e SEMPRE liga o gateway, mesmo com BOT_GATEWAY_ENABLED=false
   * herdado de env compartilhada do cluster (gotcha 5).
   */
  ownsPolling(): boolean {
    return process.env.BOT_GATEWAY_EXPLICIT_OWNER === 'true';
  }

  async onApplicationBootstrap(): Promise<void> {
    // O polling vive num unico processo (gotcha 5): o servico api desliga o
    // gateway com BOT_GATEWAY_ENABLED=false e so o servico bot faz getUpdates.
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

  /** Log periodico de saude do polling (diagnostico de fila presa/409). */
  private startHealthLoop(bot: Telegraf): void {
    const timer = setInterval(async () => {
      try {
        const wi = await bot.telegram.getWebhookInfo();
        if (wi.pending_update_count > 0) {
          this.logger.warn(
            `polling: fila presa — pendencias=${wi.pending_update_count} url='${wi.url || 'nenhuma'}' ultimo_erro=${wi.last_error_message ?? 'nenhum'}`,
          );
        }
      } catch (err) {
        this.logger.warn(`polling health-check falhou: ${String(err)}`);
      }
    }, 5 * 60_000);
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
