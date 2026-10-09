import type {
  Base64ImageSource,
  MessageCreateParamsBase,
  MessageCreateParamsNonStreaming,
  Tool,
} from '@anthropic-ai/sdk/resources/messages/messages';

export type { Base64ImageSource, Tool as MessageCreateTool };

export type MessagesCreateParams = MessageCreateParamsBase & MessageCreateParamsNonStreaming;

export interface MessagesCreateResult {
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: string; [k: string]: unknown }
  >;
  stop_reason: string | null;
  /** Fase 9 (observabilidade): modelo que respondeu; `usage` ausente => undefined (jamais chute). */
  model?: string;
  usage?: { input_tokens: number; output_tokens: number };
}

/**
 * Interface minima sobre a API de messages do Anthropic (padrao financas):
 * os services de IA dependem DESTA interface, nunca do SDK, para serem
 * testaveis com um stub plano em jest/vitest.
 */
export interface AnthropicMessagesClient {
  create(params: MessagesCreateParams): Promise<MessagesCreateResult>;
}
