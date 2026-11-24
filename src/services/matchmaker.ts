import poolEnRaw from '../data/pool-en.json';
import poolPtRaw from '../data/pool-pt.json';
import type {
  Difficulty,
  GameLimits,
  GameMode,
  Language,
  PoolArticle,
  RoundModifiers,
} from '../types.js';
import { normalizeTitle } from './scoring.js';

const POOLS: Record<Language, PoolArticle[]> = {
  pt: (poolPtRaw as PoolArticle[]).map((a) => ({ ...a, title: normalizeTitle(a.title) })),
  en: (poolEnRaw as PoolArticle[]).map((a) => ({ ...a, title: normalizeTitle(a.title) })),
};

const HIGH_LEVEL_TOPICS = [
  'STEM.Physics',
  'STEM.Computing',
  'STEM.Space',
  'Culture.Sports',
  'Culture.Literature',
  'History_and_Society.History',
  'History_and_Society.Politics_and_government',
  'Geography.Regions',
];

export function getPool(lang: Language): PoolArticle[] {
  return POOLS[lang] ?? POOLS.pt;
}

export function getKnownPoolTopicsMap(lang: Language): Record<string, string[]> {
  const pool = getPool(lang);
  const map: Record<string, string[]> = {};
  for (const item of pool) {
    map[normalizeTitle(item.title)] = item.topics;
  }
  return map;
}

/**
 * Converte uma string de semente (ex: "2026-11-23:pt") em um inteiro de 32 bits (FNV-1a).
 */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * PRNG determinístico Mulberry32 que retorna um float entre [0, 1).
 */
function createPrng(seedString?: string): () => number {
  if (!seedString) {
    return () => Math.random();
  }
  let state = hashSeed(seedString);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandom<T>(items: T[], rand: () => number): T {
  const idx = Math.floor(rand() * items.length);
  return items[Math.min(idx, items.length - 1)];
}

export interface GeneratedMatch {
  mode: GameMode;
  lang: Language;
  difficulty: Difficulty;
  origin: string;
  target: string;
  modifiers: RoundModifiers;
  limits: GameLimits;
  seed?: string;
}

/**
 * Sorteia origem, destino e modificadores a partir do pool estático.
 * O pool é usado exclusivamente para definir início, fim e eventual checkpoint.
 */
export function generateMatch(options: {
  mode: GameMode;
  lang: Language;
  difficulty?: Difficulty;
  limits?: Partial<GameLimits>;
  enableModifiers?: boolean;
  date?: string;
}): GeneratedMatch {
  const { mode, lang } = options;
  const pool = getPool(lang);

  if (pool.length < 2) {
    throw new Error(`Pool for language "${lang}" must have at least 2 articles`);
  }

  const todayUtc = options.date ?? new Date().toISOString().slice(0, 10);
  const seed = mode === 'daily' ? `${todayUtc}:${lang}` : undefined;
  const rand = createPrng(seed);

  const difficulty: Difficulty =
    mode === 'daily'
      ? pickRandom<Difficulty>(['easy', 'medium', 'hard'], rand)
      : (options.difficulty ?? 'medium');

  const tier1 = pool.filter((a) => a.tier === 1);
  const tier2 = pool.filter((a) => a.tier === 2);
  const tier3 = pool.filter((a) => a.tier === 3);

  let originCandidates: PoolArticle[] = pool;
  let targetCandidates: PoolArticle[] = pool;

  if (difficulty === 'easy') {
    originCandidates = tier1.length >= 2 ? tier1 : pool;
    targetCandidates = tier1.length >= 2 ? tier1 : pool;
  } else if (difficulty === 'medium') {
    const t12 = [...tier1, ...tier2];
    originCandidates = t12.length >= 1 ? t12 : pool;
    targetCandidates = tier2.length >= 1 ? tier2 : pool;
  } else if (difficulty === 'hard') {
    const t23 = [...tier2, ...tier3];
    originCandidates = t23.length >= 1 ? t23 : pool;
    targetCandidates = tier3.length >= 1 ? tier3 : pool;
  }

  const originArticle = pickRandom(originCandidates, rand);
  const filteredTargets = targetCandidates.filter((a) => a.title !== originArticle.title);
  const targetPool =
    filteredTargets.length > 0
      ? filteredTargets
      : pool.filter((a) => a.title !== originArticle.title);
  const targetArticle = pickRandom(targetPool, rand);

  const enableModifiers = mode === 'daily' ? true : (options.enableModifiers ?? true);

  let modifiers: RoundModifiers = {
    clickPenalty: 10,
    timePenalty: 2,
    topicModifiers: [],
    checkpoint: null,
  };

  if (enableModifiers) {
    // 1. Multiplicadores dinâmicos de cliques e tempo
    const clickMultiplierRoll = rand();
    const timeMultiplierRoll = rand();

    const clickPenalty = clickMultiplierRoll > 0.7 ? 20 : clickMultiplierRoll < 0.2 ? 5 : 10;
    const timePenalty = timeMultiplierRoll > 0.7 ? 4 : timeMultiplierRoll < 0.2 ? 1 : 2;

    // 2. Modificador de tópico (bônus ou penalidade)
    const chosenTopic = pickRandom(HIGH_LEVEL_TOPICS, rand);
    const isBonus = rand() >= 0.35;
    const topicPoints = isBonus ? 40 : -25;

    // 3. Modificador de checkpoint (35% de chance)
    let checkpoint = null;
    if (rand() < 0.35) {
      const checkpointPool = (tier1.length > 2 ? tier1 : pool).filter(
        (a) => a.title !== originArticle.title && a.title !== targetArticle.title
      );
      if (checkpointPool.length > 0) {
        const cpArticle = pickRandom(checkpointPool, rand);
        const required = rand() < 0.4;
        checkpoint = {
          title: cpArticle.title,
          points: required ? 150 : 100,
          required,
        };
      }
    }

    modifiers = {
      clickPenalty,
      timePenalty,
      topicModifiers: [{ topic: chosenTopic, points: topicPoints }],
      checkpoint,
    };
  }

  // Limites customizáveis (podem ser desligados definindo null)
  const limits: GameLimits =
    mode === 'daily'
      ? { maxTimeSeconds: 600, maxClicks: 30 }
      : {
          maxTimeSeconds:
            options.limits && 'maxTimeSeconds' in options.limits
              ? (options.limits.maxTimeSeconds ?? null)
              : null,
          maxClicks:
            options.limits && 'maxClicks' in options.limits
              ? (options.limits.maxClicks ?? null)
              : null,
        };

  return {
    mode,
    lang,
    difficulty,
    origin: originArticle.title,
    target: targetArticle.title,
    modifiers,
    limits,
    seed,
  };
}
