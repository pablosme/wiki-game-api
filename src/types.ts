export type Language = 'pt' | 'en';

export type GameMode = 'free' | 'daily';

export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Faixa de conectividade do artigo no pool estático:
 * 1 = Alta conectividade (Tier 1)
 * 2 = Média conectividade (Tier 2)
 * 3 = Menor conectividade (Tier 3)
 */
export type ConnectivityTier = 1 | 2 | 3;

export interface PoolArticle {
  title: string;
  pageId: number;
  views: number;
  inDegree: number;
  tier: ConnectivityTier;
  topics: string[];
}

export interface GameLimits {
  maxTimeSeconds: number | null;
  maxClicks: number | null;
}

export interface TopicModifier {
  topic: string;
  /** Valor adicionado (positivo) ou descontado (negativo) por artigo visitado neste tópico */
  points: number;
}

export interface CheckpointModifier {
  title: string;
  /** Bônus adicionado se visitado (ou penalidade descontada se obrigatório e não visitado) */
  points: number;
  required: boolean;
}

export interface RoundModifiers {
  /** Valor X descontado por clique: -(X * cliques) */
  clickPenalty: number;
  /** Valor Y descontado por segundo: -(Y * segundos) */
  timePenalty: number;
  /** Bonificações ou penalidades por tópico (Outlink Topic Model / Lift Wing) */
  topicModifiers: TopicModifier[];
  /** Parada obrigatória ou opcional em um artigo intermediário */
  checkpoint: CheckpointModifier | null;
}

export interface GameTokenPayload {
  mode: GameMode;
  lang: Language;
  difficulty: Difficulty;
  origin: string;
  target: string;
  modifiers: RoundModifiers;
  limits: GameLimits;
  startedAt: number;
  iat: number;
  exp: number;
  [key: string]: unknown;
}

export interface PathStep {
  title: string;
  timestamp: number;
}

export interface StartGameRequest {
  mode: GameMode;
  lang: Language;
  difficulty?: Difficulty;
  limits?: Partial<GameLimits>;
  enableModifiers?: boolean;
  /** Data opcional YYYY-MM-DD para o Desafio do Dia (padrão: data UTC atual) */
  date?: string;
}

export interface FinishGameRequest {
  token: string;
  path: PathStep[];
}

export interface ScoreBreakdownItem {
  label: string;
  count: number;
  multiplier: number;
  delta: number;
}

export interface ScoreResult {
  baseScore: number;
  finalScore: number;
  clicks: number;
  elapsedSeconds: number;
  checkpointReached: boolean;
  breakdown: ScoreBreakdownItem[];
}
