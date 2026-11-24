import type { PathStep, RoundModifiers, ScoreBreakdownItem, ScoreResult } from '../types.js';

export const BASE_SCORE = 1000;

export function normalizeTitle(title: string): string {
  return decodeURIComponent(title).replace(/_/g, ' ').trim();
}

/**
 * Calcula a pontuação final a partir da base de 1.000 pontos.
 * Aplica descontos lineares de cliques e segundos e soma/desconta modificadores ativos.
 */
export function calculateScore(
  path: PathStep[],
  modifiers: RoundModifiers,
  startedAt: number,
  articleTopicsMap: Record<string, string[]>
): ScoreResult {
  const clicks = Math.max(0, path.length - 1);
  const lastTimestamp = path.length > 0 ? path[path.length - 1].timestamp : startedAt;
  const elapsedSeconds = Math.max(0, Math.floor((lastTimestamp - startedAt) / 1000));

  const breakdown: ScoreBreakdownItem[] = [];

  const clickDelta = -(modifiers.clickPenalty * clicks);
  breakdown.push({
    label: 'clicks',
    count: clicks,
    multiplier: -modifiers.clickPenalty,
    delta: clickDelta,
  });

  const timeDelta = -(modifiers.timePenalty * elapsedSeconds);
  breakdown.push({
    label: 'time_seconds',
    count: elapsedSeconds,
    multiplier: -modifiers.timePenalty,
    delta: timeDelta,
  });

  // Artigos visitados após a origem
  const visitedTitles = path.slice(1).map((step) => normalizeTitle(step.title));

  // Modificadores de tópico (mesmo formato linear: count * points)
  for (const topicMod of modifiers.topicModifiers) {
    let matchCount = 0;
    for (const title of visitedTitles) {
      const topics = articleTopicsMap[title] ?? [];
      const matchesTopic = topics.some(
        (t) => t === topicMod.topic || t.startsWith(`${topicMod.topic}.`)
      );
      if (matchesTopic) {
        matchCount += 1;
      }
    }

    const topicDelta = matchCount * topicMod.points;
    breakdown.push({
      label: `topic:${topicMod.topic}`,
      count: matchCount,
      multiplier: topicMod.points,
      delta: topicDelta,
    });
  }

  // Modificador de checkpoint
  let checkpointReached = false;
  if (modifiers.checkpoint) {
    const checkpointTitle = normalizeTitle(modifiers.checkpoint.title);
    checkpointReached = visitedTitles.some(
      (title) => title.toLowerCase() === checkpointTitle.toLowerCase()
    );

    if (checkpointReached) {
      breakdown.push({
        label: `checkpoint:${checkpointTitle}`,
        count: 1,
        multiplier: Math.abs(modifiers.checkpoint.points),
        delta: Math.abs(modifiers.checkpoint.points),
      });
    } else if (modifiers.checkpoint.required) {
      breakdown.push({
        label: `checkpoint_missed:${checkpointTitle}`,
        count: 1,
        multiplier: -Math.abs(modifiers.checkpoint.points),
        delta: -Math.abs(modifiers.checkpoint.points),
      });
    } else {
      breakdown.push({
        label: `checkpoint_optional:${checkpointTitle}`,
        count: 0,
        multiplier: Math.abs(modifiers.checkpoint.points),
        delta: 0,
      });
    }
  }

  const totalDelta = breakdown.reduce((acc, item) => acc + item.delta, 0);
  const finalScore = BASE_SCORE + totalDelta;

  return {
    baseScore: BASE_SCORE,
    finalScore,
    clicks,
    elapsedSeconds,
    checkpointReached,
    breakdown,
  };
}
