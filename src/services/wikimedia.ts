import type { Language } from '../types.js';
import { normalizeTitle } from './scoring.js';

export const DEFAULT_USER_AGENT =
  'wikipedia-game-api/0.1.0 (https://github.com/wikipedia-game; stateless-validator)';

interface MediaWikiLinksResponse {
  query?: {
    pages?: Array<{
      pageid?: number;
      title: string;
      missing?: boolean;
      lastrevid?: number;
      links?: Array<{ ns: number; title: string }>;
      redirects?: Array<{ ns: number; title: string }>;
    }>;
  };
}

interface LiftWingPredictionResponse {
  prediction?: {
    results?: Array<{
      topic: string;
      score: number;
    }>;
  };
  [key: string]: unknown;
}

/**
 * Verifica na MediaWiki Action API se existe um link válido de `fromTitle` para `toTitle`.
 * Considera tanto o título canônico direto quanto redirecionamentos que apontam para `toTitle`.
 */
export async function verifyLinkTransition(
  lang: Language,
  fromTitle: string,
  toTitle: string,
  userAgent: string = DEFAULT_USER_AGENT
): Promise<boolean> {
  const cleanFrom = normalizeTitle(fromTitle);
  const cleanTo = normalizeTitle(toTitle);

  if (cleanFrom.toLowerCase() === cleanTo.toLowerCase()) {
    return true;
  }

  const endpoint = `https://${lang}.wikipedia.org/w/api.php`;

  // 1. Verificação direta via prop=links & pltitles=cleanTo
  const directParams = new URLSearchParams({
    action: 'query',
    titles: cleanFrom,
    prop: 'links',
    pltitles: cleanTo,
    redirects: '1',
    format: 'json',
    formatversion: '2',
  });

  const directRes = await fetch(`${endpoint}?${directParams.toString()}`, {
    headers: { 'User-Agent': userAgent },
  });

  if (!directRes.ok) {
    throw new Error(`MediaWiki API error (${directRes.status}) while verifying link`);
  }

  const directData = (await directRes.json()) as MediaWikiLinksResponse;
  const fromPage = directData.query?.pages?.[0];

  if (!fromPage || fromPage.missing) {
    return false;
  }

  if (fromPage.links && fromPage.links.length > 0) {
    return true;
  }

  // 2. Fallback: busca redirecionamentos que apontam para `cleanTo` (até 49 aliases)
  const redirectsParams = new URLSearchParams({
    action: 'query',
    titles: cleanTo,
    prop: 'redirects',
    rdnamespace: '0',
    rdlimit: '49',
    redirects: '1',
    format: 'json',
    formatversion: '2',
  });

  const redirectsRes = await fetch(`${endpoint}?${redirectsParams.toString()}`, {
    headers: { 'User-Agent': userAgent },
  });

  if (!redirectsRes.ok) {
    return false;
  }

  const redirectsData = (await redirectsRes.json()) as MediaWikiLinksResponse;
  const toPage = redirectsData.query?.pages?.[0];
  const redirectTitles = toPage?.redirects?.map((r) => r.title) ?? [];

  if (redirectTitles.length === 0) {
    return false;
  }

  const aliasCheckParams = new URLSearchParams({
    action: 'query',
    titles: cleanFrom,
    prop: 'links',
    pltitles: redirectTitles.join('|'),
    redirects: '1',
    format: 'json',
    formatversion: '2',
  });

  const aliasRes = await fetch(`${endpoint}?${aliasCheckParams.toString()}`, {
    headers: { 'User-Agent': userAgent },
  });

  if (!aliasRes.ok) {
    return false;
  }

  const aliasData = (await aliasRes.json()) as MediaWikiLinksResponse;
  const aliasFromPage = aliasData.query?.pages?.[0];

  return Boolean(aliasFromPage?.links && aliasFromPage.links.length > 0);
}

/**
 * Valida todo o caminho percorrido pelo jogador na Wikipédia em paralelo.
 */
export async function verifyPathLinks(
  lang: Language,
  titles: string[],
  userAgent: string = DEFAULT_USER_AGENT
): Promise<{ valid: boolean; invalidTransition?: { from: string; to: string; stepIndex: number } }> {
  if (titles.length < 2) {
    return { valid: false };
  }

  const transitions = [];
  for (let i = 0; i < titles.length - 1; i++) {
    transitions.push({
      stepIndex: i,
      from: titles[i],
      to: titles[i + 1],
    });
  }

  const results = await Promise.all(
    transitions.map(async (t) => {
      const ok = await verifyLinkTransition(lang, t.from, t.to, userAgent);
      return { ...t, ok };
    })
  );

  const failed = results.find((r) => !r.ok);
  if (failed) {
    return {
      valid: false,
      invalidTransition: {
        from: failed.from,
        to: failed.to,
        stepIndex: failed.stepIndex,
      },
    };
  }

  return { valid: true };
}

/**
 * Busca o `lastrevid` de uma lista de títulos na MediaWiki Action API.
 */
export async function fetchLastRevIds(
  lang: Language,
  titles: string[],
  userAgent: string = DEFAULT_USER_AGENT
): Promise<Record<string, number>> {
  if (titles.length === 0) return {};

  const endpoint = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.map(normalizeTitle).slice(0, 50).join('|'),
    prop: 'info',
    redirects: '1',
    format: 'json',
    formatversion: '2',
  });

  const res = await fetch(`${endpoint}?${params.toString()}`, {
    headers: { 'User-Agent': userAgent },
  });

  if (!res.ok) {
    return {};
  }

  const data = (await res.json()) as MediaWikiLinksResponse;
  const map: Record<string, number> = {};

  for (const page of data.query?.pages ?? []) {
    if (!page.missing && page.lastrevid) {
      map[normalizeTitle(page.title)] = page.lastrevid;
    }
  }

  return map;
}

/**
 * Consulta o Outlink Topic Model na Lift Wing API da Wikimedia diretamente pelo `page_title`.
 */
export async function fetchTopicsByTitle(
  lang: Language,
  title: string,
  threshold: number = 0.5,
  userAgent: string = DEFAULT_USER_AGENT
): Promise<string[]> {
  const endpoint =
    'https://api.wikimedia.org/service/lw/inference/v1/models/outlink-topic-model:predict';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': userAgent,
    },
    body: JSON.stringify({
      lang,
      page_title: normalizeTitle(title),
    }),
  });

  if (!res.ok) {
    return [];
  }

  const data = (await res.json()) as LiftWingPredictionResponse;
  const results = data.prediction?.results ?? [];

  return results
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.topic);
}

/**
 * Obtém os tópicos de múltiplos títulos consultando um mapa pré-carregado (do pool)
 * e buscando na Lift Wing API apenas os artigos que não estiverem no pool.
 */
export async function resolveArticlesTopics(
  lang: Language,
  titles: string[],
  knownPoolTopics: Record<string, string[]>,
  userAgent: string = DEFAULT_USER_AGENT
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const missingTitles: string[] = [];

  for (const rawTitle of titles) {
    const clean = normalizeTitle(rawTitle);
    if (knownPoolTopics[clean] && knownPoolTopics[clean].length > 0) {
      result[clean] = knownPoolTopics[clean];
    } else {
      missingTitles.push(clean);
    }
  }

  if (missingTitles.length === 0) {
    return result;
  }

  await Promise.all(
    missingTitles.map(async (title) => {
      const topics = await fetchTopicsByTitle(lang, title, 0.5, userAgent);
      result[title] = topics;
    })
  );

  return result;
}
