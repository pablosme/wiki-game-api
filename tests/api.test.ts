import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { calculateScore } from '../src/services/scoring.js';
import * as wikimedia from '../src/services/wikimedia.js';

describe('wikipedia-game-api', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna status ok no endpoint /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; stateless: boolean };
    expect(body.status).toBe('ok');
    expect(body.stateless).toBe(true);
  });

  it('gera partida determinística para o Desafio do Dia por data e idioma', async () => {
    const reqPayload = {
      mode: 'daily',
      lang: 'pt',
      date: '2026-11-23',
    };

    const res1 = await app.request('/game/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqPayload),
    });
    const res2 = await app.request('/game/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqPayload),
    });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const data1 = (await res1.json()) as { match: { origin: string; target: string; modifiers: unknown } };
    const data2 = (await res2.json()) as { match: { origin: string; target: string; modifiers: unknown } };

    expect(data1.match.origin).toBe(data2.match.origin);
    expect(data1.match.target).toBe(data2.match.target);
    expect(data1.match.modifiers).toEqual(data2.match.modifiers);
  });

  it('suporta limites customizáveis e opção de desligar limites no Jogo Livre', async () => {
    const res = await app.request('/game/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'free',
        lang: 'en',
        difficulty: 'easy',
        limits: { maxTimeSeconds: null, maxClicks: 15 },
      }),
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      token: string;
      match: { limits: { maxTimeSeconds: number | null; maxClicks: number | null } };
    };
    expect(data.token).toBeTypeOf('string');
    expect(data.match.limits.maxTimeSeconds).toBeNull();
    expect(data.match.limits.maxClicks).toBe(15);
  });

  it('calcula pontuação com base 1000 e formato linear uniforme para cliques, segundos e modificadores', () => {
    const startedAt = 1_700_000_000_000;
    const path = [
      { title: 'Brasil', timestamp: startedAt },
      { title: 'Albert Einstein', timestamp: startedAt + 10_000 },
      { title: 'Portugal', timestamp: startedAt + 25_000 },
    ];

    const score = calculateScore(
      path,
      {
        clickPenalty: 10,
        timePenalty: 2,
        topicModifiers: [{ topic: 'STEM.Physics', points: 40 }],
        checkpoint: { title: 'Albert Einstein', points: 100, required: false },
      },
      startedAt,
      {
        'Albert Einstein': ['STEM.Physics'],
        Portugal: ['Geography.Regions.Europe.Southern_Europe'],
      }
    );

    // Base 1000 - (10 * 2 cliques = 20) - (2 * 25 segundos = 50) + (40 * 1 tópico) + (100 * 1 checkpoint) = 1070
    expect(score.baseScore).toBe(1000);
    expect(score.clicks).toBe(2);
    expect(score.elapsedSeconds).toBe(25);
    expect(score.checkpointReached).toBe(true);
    expect(score.finalScore).toBe(1070);
  });

  it('valida partida completa no endpoint /game/finish com JWT assinado', async () => {
    vi.spyOn(wikimedia, 'verifyPathLinks').mockResolvedValue({ valid: true });
    vi.spyOn(wikimedia, 'resolveArticlesTopics').mockResolvedValue({});

    const startRes = await app.request('/game/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'free',
        lang: 'pt',
        difficulty: 'easy',
        enableModifiers: false,
        limits: { maxTimeSeconds: 120, maxClicks: 10 },
      }),
    });

    const startData = (await startRes.json()) as {
      token: string;
      match: { origin: string; target: string; startedAt: number };
    };
    const { token, match } = startData;

    const finishRes = await app.request('/game/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        path: [
          { title: match.origin, timestamp: match.startedAt },
          { title: 'Artigo Intermediário', timestamp: match.startedAt + 5_000 },
          { title: match.target, timestamp: match.startedAt + 12_000 },
        ],
      }),
    });

    expect(finishRes.status).toBe(200);
    const finishData = (await finishRes.json()) as {
      valid: boolean;
      score: { finalScore: number };
    };
    expect(finishData.valid).toBe(true);
    // Base 1000 - (10 * 2 cliques) - (2 * 12 segundos) = 956
    expect(finishData.score.finalScore).toBe(956);
  });
});
