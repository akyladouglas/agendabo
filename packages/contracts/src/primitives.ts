import { z } from 'zod';

/**
 * Identificador de timezone IANA (ex.: America/Sao_Paulo).
 * Datas vivem em UTC no banco; timezone e por usuario (ADR-001).
 */
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z]+\/[A-Za-z0-9_+-]+$/, 'timezone deve ser IANA (ex.: America/Sao_Paulo)');

/** Hora do dia no formato HH:mm (usada em resumoDiarioHora). */
export const hourOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'hora deve estar no formato HH:mm');

/** TelegramId numerico (o "Id" que o @userinfobot devolve). */
export const telegramIdSchema = z
  .string()
  .regex(/^\d{5,20}$/, 'telegramId deve ser o Id numerico do Telegram');

/** String opcional que colapsa '' -> undefined (inputs de formulario). */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/** Data ISO (UTC) aceita tanto `Date` quanto string ISO. */
export const isoDateSchema = z.coerce.date();
