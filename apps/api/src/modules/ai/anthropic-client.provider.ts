import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Anthropic } from '@anthropic-ai/sdk';
import type { Env } from '../../config/env.validation';
import type {
  AnthropicMessagesClient,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';

/** Adaptador fino sobre o SDK. Fora de modules/ai ninguem ve o SDK (ver ai.module.ts). */
@Injectable()
export class AnthropicClientProvider implements AnthropicMessagesClient {
  private sdk: Anthropic | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async create(params: MessagesCreateParams): Promise<MessagesCreateResult> {
    this.sdk ??= new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY', { infer: true }) });
    const response = await this.sdk.messages.create(params);
    return {
      content: response.content as MessagesCreateResult['content'],
      stop_reason: response.stop_reason,
    };
  }
}
