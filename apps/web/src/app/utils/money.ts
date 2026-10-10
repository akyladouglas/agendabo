/** micro-USD inteiro → USD legível (ADR-0017; valores < 1 centavo ganham casas). */
export function formatUsd(micros: number): string {
  const usd = micros / 1_000_000;
  if (usd === 0) return '$0';
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(6).replace(/0+$/, '')}`;
}
