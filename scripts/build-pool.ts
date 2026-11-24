import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTitle } from '../src/services/scoring.js';
import { DEFAULT_USER_AGENT, fetchTopicsByTitle } from '../src/services/wikimedia.js';
import type { ConnectivityTier, Language, PoolArticle } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXCLUDED_PREFIXES = [
  'Special:',
  'Especial:',
  'Wikipedia:',
  'Wikipédia:',
  'File:',
  'Ficheiro:',
  'Imagem:',
  'Category:',
  'Categoria:',
  'Portal:',
  'Help:',
  'Ajuda:',
  'Template:',
  'Predefinição:',
  'Talk:',
  'Discussão:',
  'User:',
  'Usuário:',
  'Usuária:',
];

const EXCLUDED_EXACT = new Set([
  'Main Page',
  'Página principal',
  'Wikipédia:Página principal',
  '-',
  '404.php',
]);

interface PageviewsTopResponse {
  items?: Array<{
    articles?: Array<{
      article: string;
      views: number;
      rank: number;
    }>;
  }>;
}

interface MediaWikiBatchInfoResponse {
  query?: {
    pages?: Array<{
      pageid?: number;
      ns?: number;
      title: string;
      missing?: boolean;
      lastrevid?: number;
      pageprops?: {
        disambiguation?: string;
      };
      linkshere?: Array<{ pageid: number }>;
    }>;
  };
}

function isValidCandidateTitle(rawTitle: string): boolean {
  const title = normalizeTitle(rawTitle);
  if (!title || EXCLUDED_EXACT.has(title)) return false;
  for (const prefix of EXCLUDED_PREFIXES) {
    if (title.toLowerCase().startsWith(prefix.toLowerCase())) {
      return false;
    }
  }
  return true;
}

/**
 * Busca artigos populares na Wikimedia Pageviews API agregando múltiplos dias recentes
 * até atingir a quantidade necessária de candidatos únicos.
 */
async function fetchTopPageviewsCandidates(
  lang: Language,
  targetCount: number
): Promise<Map<string, number>> {
  const viewsMap = new Map<string, number>();
  const now = new Date();

  // Usa datas a partir de 2 dias atrás (dados consolidados na Wikimedia)
  for (let dayOffset = 2; dayOffset <= 35 && viewsMap.size < targetCount * 1.3; dayOffset++) {
    const d = new Date(now.getTime() - dayOffset * 86400 * 1000);
    // Nota: caso o relógio local esteja no futuro em ambiente de teste, usa 2024 como fallback
    const year = d.getUTCFullYear() > 2025 ? 2024 : d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');

    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${year}/${month}/${day}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
    });

    if (!res.ok) {
      continue;
    }

    const data = (await res.json()) as PageviewsTopResponse;
    const articles = data.items?.[0]?.articles ?? [];

    for (const item of articles) {
      if (!isValidCandidateTitle(item.article)) continue;
      const clean = normalizeTitle(item.article);
      viewsMap.set(clean, (viewsMap.get(clean) ?? 0) + item.views);
    }
  }

  return viewsMap;
}

/**
 * Valida candidatos em lotes de 50 na MediaWiki Action API:
 * - Filtra páginas ausentes, fora do namespace 0 ou de desambiguação
 * - Obtém `pageId` e `lastrevid`
 */
async function enrichCandidatesFromMediaWiki(
  lang: Language,
  candidates: Array<{ title: string; views: number }>,
  limit: number
): Promise<Array<{ title: string; pageId: number; lastRevId: number; views: number }>> {
  const endpoint = `https://${lang}.wikipedia.org/w/api.php`;
  const enriched: Array<{ title: string; pageId: number; lastRevId: number; views: number }> = [];
  const seenTitles = new Set<string>();

  for (let i = 0; i < candidates.length && enriched.length < limit; i += 50) {
    const batch = candidates.slice(i, i + 50);
    const viewsByTitle = new Map(batch.map((b) => [b.title.toLowerCase(), b.views]));

    const params = new URLSearchParams({
      action: 'query',
      titles: batch.map((b) => b.title).join('|'),
      prop: 'pageprops|info',
      ppprop: 'disambiguation',
      redirects: '1',
      format: 'json',
      formatversion: '2',
    });

    const res = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
    });

    if (!res.ok) continue;

    const data = (await res.json()) as MediaWikiBatchInfoResponse;
    for (const page of data.query?.pages ?? []) {
      if (
        page.missing ||
        page.ns !== 0 ||
        !page.pageid ||
        !page.lastrevid ||
        page.pageprops && 'disambiguation' in page.pageprops
      ) {
        continue;
      }

      const cleanTitle = normalizeTitle(page.title);
      if (seenTitles.has(cleanTitle.toLowerCase()) || !isValidCandidateTitle(cleanTitle)) {
        continue;
      }

      seenTitles.add(cleanTitle.toLowerCase());
      const views = viewsByTitle.get(cleanTitle.toLowerCase()) ?? batch[0]?.views ?? 1000;

      enriched.push({
        title: cleanTitle,
        pageId: page.pageid,
        lastRevId: page.lastrevid,
        views,
      });

      if (enriched.length >= limit) break;
    }
  }

  return enriched;
}

/**
 * Executa promessas com limite de concorrência para respeitar os rate limits da Wikimedia.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let currentIndex = 0;

  async function worker() {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Estima o in-degree (amostra de backlinks do namespace 0 até 500) na MediaWiki Action API.
 */
async function fetchInDegreeSample(lang: Language, title: string): Promise<number> {
  const endpoint = `https://${lang}.wikipedia.org/w/api.php`;
  const params = new URLSearchParams({
    action: 'query',
    list: 'backlinks',
    bltitle: title,
    blnamespace: '0',
    bllimit: '500',
    format: 'json',
    formatversion: '2',
  });

  try {
    const res = await fetch(`${endpoint}?${params.toString()}`, {
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
    });
    if (!res.ok) return 50;
    const data = (await res.json()) as { query?: { backlinks?: unknown[] } };
    return data.query?.backlinks?.length ?? 50;
  } catch {
    return 50;
  }
}

export async function buildPoolForLanguage(lang: Language, limit: number): Promise<PoolArticle[]> {
  console.log(`[pool:${lang}] Buscando candidatos via Wikimedia Pageviews API (alvo: ${limit})...`);
  const candidatesMap = await fetchTopPageviewsCandidates(lang, limit);

  const sortedCandidates = Array.from(candidatesMap.entries())
    .map(([title, views]) => ({ title, views }))
    .sort((a, b) => b.views - a.views);

  console.log(
    `[pool:${lang}] Encontrados ${sortedCandidates.length} candidatos brutos. Filtrando desambiguações...`
  );
  const validPages = await enrichCandidatesFromMediaWiki(lang, sortedCandidates, limit);

  console.log(
    `[pool:${lang}] ${validPages.length} artigos válidos. Consultando conectividade (backlinks) e tópicos (Lift Wing)...`
  );

  const withMetrics = await mapWithConcurrency(validPages, 6, async (item) => {
    const [inDegree, topics] = await Promise.all([
      fetchInDegreeSample(lang, item.title),
      fetchTopicsByTitle(lang, item.title, 0.5, DEFAULT_USER_AGENT),
    ]);

    return {
      ...item,
      inDegree,
      topics: topics.length > 0 ? topics.slice(0, 3) : ['Culture.General'],
    };
  });

  if (withMetrics.length < 2) {
    throw new Error(
      `[pool:${lang}] Quantidade insuficiente de artigos obtidos (${withMetrics.length}). Abortando escrita para não corromper o arquivo.`
    );
  }

  // Ordena por score combinado de conectividade (inDegree) e popularidade (views)
  withMetrics.sort((a, b) => {
    if (b.inDegree !== a.inDegree) return b.inDegree - a.inDegree;
    return b.views - a.views;
  });

  const total = withMetrics.length;
  const tier1Cutoff = Math.ceil(total * 0.3);
  const tier2Cutoff = Math.ceil(total * 0.7);

  const pool: PoolArticle[] = withMetrics.map((item, idx) => {
    let tier: ConnectivityTier = 3;
    if (idx < tier1Cutoff) tier = 1;
    else if (idx < tier2Cutoff) tier = 2;

    return {
      title: item.title,
      pageId: item.pageId,
      views: item.views,
      inDegree: item.inDegree,
      tier,
      topics: item.topics,
    };
  });

  const outputPath = resolve(__dirname, `../src/data/pool-${lang}.json`);
  await writeFile(outputPath, `${JSON.stringify(pool, null, 2)}\n`, 'utf-8');
  console.log(`[pool:${lang}] Salvo ${pool.length} artigos em ${outputPath}`);

  return pool;
}

async function main() {
  const args = process.argv.slice(2);
  const langArg = args.find((a) => a.startsWith('--lang='))?.split('=')[1] ?? 'all';
  const limitArg = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '5000');

  const langs: Language[] =
    langArg === 'pt' ? ['pt'] : langArg === 'en' ? ['en'] : ['pt', 'en'];

  for (const lang of langs) {
    await buildPoolForLanguage(lang, limitArg);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((err) => {
    console.error('Erro na geração do pool:', err);
    process.exit(1);
  });
}
