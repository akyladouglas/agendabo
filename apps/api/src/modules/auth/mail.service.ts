import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '../../config/env.validation';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Unico ponto de saida de email. Sem RESEND_API_KEY, loga em vez de enviar (dev). */
@Injectable()
export class MailService {
  private resend: Resend | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async send(message: MailMessage): Promise<void> {
    const apiKey = this.config.get('RESEND_API_KEY', { infer: true });
    const from = this.config.get('RESEND_FROM', { infer: true });
    if (!apiKey || !from) {
      process.stderr.write(
        `[mail:dev] para=${message.to} assunto="${message.subject}"\n${message.text}\n`,
      );
      return;
    }
    this.resend ??= new Resend(apiKey);
    const { error } = await this.resend.emails.send({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    if (error) {
      throw new Error(`Resend falhou: ${error.message}`);
    }
  }
}
