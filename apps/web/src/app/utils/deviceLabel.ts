/**
 * Rótulos de sessão ativa (spec sessao-24h: seção "Suas sessões ativas").
 * Funções PURAS e determinísticas: a UA crua entra, um resumo legível sai.
 * Ordem importa: Edge (Edg/) tambem contem "Chrome/", iOS contem "Mac OS X",
 * Android/Edge contem "Linux"/"Android" generico — os mais especificos vem antes.
 */

const UNKNOWN = 'Dispositivo desconhecido';

interface Pattern {
  re: RegExp;
  label: string;
}

/** SOs: primeiro match vence (iPhone antes de "like Mac OS X", etc). */
const OS_PATTERNS: Pattern[] = [
  { re: /iPhone/, label: 'iPhone' },
  { re: /iPad/, label: 'iPad' },
  { re: /Android/, label: 'Android' },
  { re: /\(Macintosh|Mac OS X/, label: 'macOS' },
  { re: /Windows/, label: 'Windows' },
  { re: /CrOS/, label: 'ChromeOS' },
  { re: /Linux|X11/, label: 'Linux' },
];

/** Navegadores: primeiro match vence (mais específico → menos). */
const BROWSER_PATTERNS: Pattern[] = [
  { re: /Edg(A|iOS)?\//, label: 'Edge' },
  { re: /OPR\/|Opera/, label: 'Opera' },
  { re: /SamsungBrowser\//, label: 'Samsung Internet' },
  { re: /Firefox\/|FxiOS\//, label: 'Firefox' },
  { re: /Chrome\//, label: 'Chrome' },
  // Safari de verdade: "Version/x Safari/y" SEM "Chrome/" (já descartado acima)
  { re: /Version\/.+Safari\//, label: 'Safari' },
];

/** UA crua → "SO · Navegador" (ou só o SO / só o navegador / desconhecido). */
export function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return UNKNOWN;
  const os = OS_PATTERNS.find((p) => p.re.test(userAgent))?.label;
  const browser = BROWSER_PATTERNS.find((p) => p.re.test(userAgent))?.label;
  if (os && browser) return `${os} · ${browser}`;
  if (os) return os;
  if (browser) return browser;
  return UNKNOWN;
}

/**
 * Data de login para exibição: "dd/MM HH:mm" SEMPRE em UTC (a coluna do banco
 * é UTC e a UI da seção declara "Horários em UTC" — sem conversão de fuso aqui).
 */
export function formatSessionDate(loginAt: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(loginAt.getUTCDate())}/${p(loginAt.getUTCMonth() + 1)} ${p(loginAt.getUTCHours())}:${p(loginAt.getUTCMinutes())}`;
}
