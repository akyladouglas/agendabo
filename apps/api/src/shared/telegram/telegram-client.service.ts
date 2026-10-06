import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import type { Env } from '../../config/env.validation';

/**
 * Client outbound do Telegram (envio de mensagem) + dono do token do bot.
 * O long-polling do fluxo conversacional vive em modules/bot (fase 3); aqui fica
 * o que os workers de notificacao/resumo precisam: mandar texto para um chat.
 */
@Injectable()
export class TelegramClientService {
  private readonly logger = new Logger(TelegramClientService.name);
  private client: Telegraf | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  getClient(): Telegraf {
    if (!this.client) {
      const token = this.config.get('TELEGRAM_BOT_TOKEN', { infer: true });
      if (!token) {
        throw new Error('TELEGRAM_BOT_TOKEN ausente — bot/digest desabilitados');
      }
      this.client = new Telegraf(token);
    }
    return this.client;
  }

  async sendMessage(telegramId: string, text: string): Promise<void> {
    try {
      await this.getClient().telegram.sendMessage(telegramId, text, { parse_mode: 'HTML' });
    } catch (err) {
      this.logger.error(`Falha ao enviar Telegram para ${telegramId}: ${String(err)}`);
      throw err;
    }
  }
}
