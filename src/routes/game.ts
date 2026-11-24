import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import { generateMatch, getKnownPoolTopicsMap, getPool } from '../services/matchmaker.js';
import { calculateScore, normalizeTitle } from '../services/scoring.js';
import {
  DEFAULT_USER_AGENT,
  resolveArticlesTopics,
  verifyPathLinks,
} from '../services/wikimedia.js';
import type {
  Difficulty,
  FinishGameRequest,
  GameMode,
  GameTokenPayload,
  Language,
  StartGameRequest,
} from '../types.js';

export interface AppBindings {
  JWT_SECRET?: string;
  WIKIMEDIA_USER_AGENT?: string;
}

const DEFAULT_DEV_SECRET = 'wikipedia-game-dev-secret-change-in-production';

function getJwtSecret(env?: AppBindings): string {
  if (env?.JWT_SECRET) return env.JWT_SECRET;
  if (typeof process !== 'undefined' && process.env?.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  return DEFAULT_DEV_SECRET;
}

function getUserAgent(env?: AppBindings): string {
  if (env?.WIKIMEDIA_USER_AGENT) return env.WIKIMEDIA_USER_AGENT;
  if (typeof process !== 'undefined' && process.env?.WIKIMEDIA_USER_AGENT) {
    return process.env.WIKIMEDIA_USER_AGENT;
  }
  return DEFAULT_USER_AGENT;
}

const VALID_LANGS: Language[] = ['pt', 'en'];
const VALID_MODES: GameMode[] = ['free', 'daily'];
const VALID_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

export const gameRoutes = new Hono<{ Bindings: AppBindings }>();

/**
 * GET /game/pool-info
 * Retorna estatísticas do pool estático por idioma.
 */
gameRoutes.get('/pool-info', (c) => {
  const ptPool = getPool('pt');
  const enPool = getPool('en');

  return c.json({
    pools: {
      pt: {
        total: ptPool.length,
        tier1: ptPool.filter((a) => a.tier === 1).length,
        tier2: ptPool.filter((a) => a.tier === 2).length,
        tier3: ptPool.filter((a) => a.tier === 3).length,
      },
      en: {
        total: enPool.length,
        tier1: enPool.filter((a) => a.tier === 1).length,
        tier2: enPool.filter((a) => a.tier === 2).length,
        tier3: enPool.filter((a) => a.tier === 3).length,
      },
    },
  });
});

/**
 * POST /game/start
 * Sorteia origem, destino e modificadores do pool estático e emite o JWT da partida.
 */
gameRoutes.post('/start', async (c) => {
  let body: StartGameRequest;
  try {
    body = await c.req.json<StartGameRequest>();
  } catch {
    return c.json({ error: 'Invalid JSON request body' }, 400);
  }

  const lang = body.lang ?? 'pt';
  const mode = body.mode ?? 'free';

  if (!VALID_LANGS.includes(lang)) {
    return c.json({ error: 'Invalid language. Allowed values: "pt", "en"' }, 400);
  }

  if (!VALID_MODES.includes(mode)) {
    return c.json({ error: 'Invalid game mode. Allowed values: "free", "daily"' }, 400);
  }

  if (body.difficulty && !VALID_DIFFICULTIES.includes(body.difficulty)) {
    return c.json({ error: 'Invalid difficulty. Allowed values: "easy", "medium", "hard"' }, 400);
  }

  const match = generateMatch({
    mode,
    lang,
    difficulty: body.difficulty,
    limits: body.limits,
    enableModifiers: body.enableModifiers,
    date: body.date,
  });

  const startedAt = Date.now();
  const nowSeconds = Math.floor(startedAt / 1000);
  const ttlSeconds =
    match.limits.maxTimeSeconds && match.limits.maxTimeSeconds > 0
      ? match.limits.maxTimeSeconds + 120
      : 7200;

  const payload: GameTokenPayload = {
    mode: match.mode,
    lang: match.lang,
    difficulty: match.difficulty,
    origin: match.origin,
    target: match.target,
    modifiers: match.modifiers,
    limits: match.limits,
    startedAt,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };

  const secret = getJwtSecret(c.env);
  const token = await sign(payload, secret, 'HS256');

  return c.json({
    token,
    match: {
      mode: match.mode,
      lang: match.lang,
      difficulty: match.difficulty,
      origin: match.origin,
      target: match.target,
      modifiers: match.modifiers,
      limits: match.limits,
      startedAt,
      expiresAt: (nowSeconds + ttlSeconds) * 1000,
    },
  });
});

/**
 * POST /game/finish
 * Valida o JWT, verifica os limites, confirma cada salto na MediaWiki API e calcula a pontuação final.
 */
gameRoutes.post('/finish', async (c) => {
  let body: FinishGameRequest;
  try {
    body = await c.req.json<FinishGameRequest>();
  } catch {
    return c.json({ error: 'Invalid JSON request body' }, 400);
  }

  if (!body.token || !Array.isArray(body.path) || body.path.length < 2) {
    return c.json(
      { error: 'Request must include a valid "token" and a "path" with at least 2 steps' },
      400
    );
  }

  const secret = getJwtSecret(c.env);
  let payload: GameTokenPayload;

  try {
    payload = (await verify(body.token, secret, 'HS256')) as unknown as GameTokenPayload;
  } catch {
    return c.json({ error: 'Invalid or expired match token' }, 401);
  }

  const normalizedSteps = body.path.map((step) => ({
    title: normalizeTitle(step.title),
    timestamp: Number(step.timestamp),
  }));

  const firstTitle = normalizedSteps[0].title;
  const lastTitle = normalizedSteps[normalizedSteps.length - 1].title;

  if (firstTitle.toLowerCase() !== normalizeTitle(payload.origin).toLowerCase()) {
    return c.json(
      {
        valid: false,
        reason: 'origin_mismatch',
        expected: payload.origin,
        received: firstTitle,
      },
      422
    );
  }

  if (lastTitle.toLowerCase() !== normalizeTitle(payload.target).toLowerCase()) {
    return c.json(
      {
        valid: false,
        reason: 'target_mismatch',
        expected: payload.target,
        received: lastTitle,
      },
      422
    );
  }

  // Verifica ordem cronológica dos timestamps
  for (let i = 0; i < normalizedSteps.length - 1; i++) {
    if (
      Number.isNaN(normalizedSteps[i].timestamp) ||
      normalizedSteps[i + 1].timestamp < normalizedSteps[i].timestamp
    ) {
      return c.json(
        {
          valid: false,
          reason: 'invalid_timestamps',
        },
        422
      );
    }
  }

  const clicks = normalizedSteps.length - 1;
  const elapsedSeconds = Math.max(
    0,
    Math.floor((normalizedSteps[normalizedSteps.length - 1].timestamp - payload.startedAt) / 1000)
  );

  // Verifica limites customizáveis quando ativos
  if (payload.limits.maxClicks !== null && clicks > payload.limits.maxClicks) {
    return c.json(
      {
        valid: false,
        reason: 'max_clicks_exceeded',
        limit: payload.limits.maxClicks,
        clicks,
      },
      422
    );
  }

  if (payload.limits.maxTimeSeconds !== null && elapsedSeconds > payload.limits.maxTimeSeconds) {
    return c.json(
      {
        valid: false,
        reason: 'max_time_exceeded',
        limit: payload.limits.maxTimeSeconds,
        elapsedSeconds,
      },
      422
    );
  }

  const userAgent = getUserAgent(c.env);
  const titles = normalizedSteps.map((s) => s.title);

  // Validação anti-cheat de links na MediaWiki Action API
  const linkCheck = await verifyPathLinks(payload.lang, titles, userAgent);
  if (!linkCheck.valid) {
    return c.json(
      {
        valid: false,
        reason: 'invalid_wiki_link',
        invalidTransition: linkCheck.invalidTransition,
      },
      422
    );
  }

  // Resolve tópicos caso existam modificadores de tópico ativos
  let articleTopicsMap: Record<string, string[]> = {};
  if (payload.modifiers.topicModifiers.length > 0) {
    const visitedAfterOrigin = titles.slice(1);
    articleTopicsMap = await resolveArticlesTopics(
      payload.lang,
      visitedAfterOrigin,
      getKnownPoolTopicsMap(payload.lang),
      userAgent
    );
  }

  const score = calculateScore(
    normalizedSteps,
    payload.modifiers,
    payload.startedAt,
    articleTopicsMap
  );

  return c.json({
    valid: true,
    match: {
      mode: payload.mode,
      lang: payload.lang,
      difficulty: payload.difficulty,
      origin: payload.origin,
      target: payload.target,
    },
    score,
    path: normalizedSteps,
  });
});
