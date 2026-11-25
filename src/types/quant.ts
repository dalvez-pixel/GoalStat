export type SportId = 'soccer' | 'nba' | 'nhl' | 'football';

export type ModelType =
  | 'bivariate-poisson-xg-elo'
  | 'dixon-coles'
  | 'negative-binomial'
  | 'ml-gbdt'
  | 'ensemble';

export type BetSide = 'over' | 'under';

export type BetStatus = 'pending' | 'won' | 'lost' | 'void';

export type FormResult = 'G' | 'P' | 'E';

export type BankrollStrategy =
  | 'kelly-quarter'
  | 'kelly-half'
  | 'kelly-full'
  | 'flat-percent'
  | 'flat-fixed';

export interface ModelMeta {
  id: ModelType;
  name: string;
  shortName: string;
  description: string;
  accentColor: string;
}

export const MODEL_META: Record<ModelType, ModelMeta> = {
  'bivariate-poisson-xg-elo': {
    id: 'bivariate-poisson-xg-elo',
    name: 'Poisson Bivariado + xG + Elo',
    shortName: 'Biv. xG+Elo',
    description:
      'Modelo principal: Poisson bivariado (covarianza λ₃) calibrado con tasas xG y diferencial de fuerza Elo.',
    accentColor: '#ABF43F',
  },
  'dixon-coles': {
    id: 'dixon-coles',
    name: 'Dixon-Coles (ρ)',
    shortName: 'Dixon-Coles',
    description:
      'Poisson bivariante con corrección de correlación en marcadores bajos (0-0, 1-0, 0-1, 1-1).',
    accentColor: '#3FF4E5',
  },
  'negative-binomial': {
    id: 'negative-binomial',
    name: 'Binomial Negativa (α)',
    shortName: 'Neg. Binomial',
    description:
      'Captura sobredispersión (Var > Media) en partidos abiertos de Fútbol, NBA, NHL y NFL/NCAAF.',
    accentColor: '#3FF4E5',
  },
  'ml-gbdt': {
    id: 'ml-gbdt',
    name: 'ML Gradient Boosting',
    shortName: 'ML (GBDT)',
    description:
      'Ensamble no lineal basado en xG/EPA, ritmo de posesiones, fragilidad defensiva, Elo y descanso.',
    accentColor: '#ABF43F',
  },
  ensemble: {
    id: 'ensemble',
    name: 'Consenso Ensemble',
    shortName: 'Ensemble',
    description:
      'Meta-modelo adaptativo por deporte con calibración Platt (prioriza Bivariado+Dixon-Coles en Fútbol, GBDT en NBA/NFL-NCAAF y Bivariado+NB en NHL).',
    accentColor: '#ABF43F',
  },
};

export interface MarketLine {
  line: number;
  overOdds: number;
  underOdds: number;
  bookmaker: string;
  prevOverOdds?: number;
  prevUnderOdds?: number;
}

export interface MatchMlFeatures {
  paceIndex: number; // 0.80 a 1.25 (ritmo de juego / posesiones)
  volatilityIndex: number; // 0.05 a 0.45
  shotQualityDiff: number; // -0.25 a +0.25 (xG por tiro o EPA/jugada)
  defensiveFragility: number; // 0.80 a 1.25
  restAdvantage: number; // días netos de descanso (-2 a +2)
}

export interface LiveMatch {
  id: string;
  sport: SportId;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  homeAbbr?: string;
  awayAbbr?: string;
  homeColor?: string;
  awayColor?: string;
  homeForm?: FormResult[];
  awayForm?: FormResult[];
  kickoffTime: string; // ISO string
  matchDay?: 'today' | 'tomorrow';
  status: 'prematch' | 'live';
  liveScore?: { home: number; away: number };
  liveClock?: string;
  homeLambda: number; // xG / expected points rate
  awayLambda: number;
  homeElo: number; // Elo rating (typical 1300-2100)
  awayElo: number;
  bivariateCov: number; // lambda_3 shared scoring covariance for Bivariate Poisson
  rho: number; // Dixon-Coles correlation parameter
  alpha: number; // Negative Binomial overdispersion parameter (> 0)
  mlFeatures: MatchMlFeatures;
  homeXgAvg: number;
  awayXgAvg: number;
  lines: MarketLine[];
  updatedAt: string;
  source: 'the-odds-api' | 'espn-live' | 'market-feed';
}

export interface ScoreCell {
  homeGoals: number;
  awayGoals: number;
  probability: number;
  totalGoals: number;
}

export interface TotalGoalBin {
  goals: number;
  label: string;
  modelProb: number;
  isOver: boolean;
  isPush: boolean;
}

export interface ModelComparisonRow {
  modelType: ModelType;
  modelProb: number;
  fairOdds: number;
  edge: number;
  ev: number;
  isPositiveEv: boolean;
}

export interface EvaluatedPick {
  pickId: string;
  match: LiveMatch;
  marketLine: MarketLine;
  side: BetSide;
  odds: number;
  prevOdds?: number;
  oppositeOdds: number;
  modelType: ModelType;
  modelProb: number;
  pushProb: number;
  impliedProb: number;
  fairMarketProb: number;
  overround: number;
  edge: number;
  fairEdge: number;
  ev: number;
  fairOdds: number;
  kellyFull: number;
  recommendedStakePct: number;
  recommendedStake: number;
  confidenceTier: 'alto' | 'moderado' | 'marginal' | 'sin-valor';
  scoreMatrix: ScoreCell[];
  matrixMaxGoals: number;
  totalDistribution: TotalGoalBin[];
  modelComparisons: ModelComparisonRow[];
  consensusCount: number; // How many of the 4 base models agree EV > 0
}

export type MarketCategory = 'totals' | 'btts' | '1x2' | 'asian-handicap' | 'parlay';

export type SelectionKey =
  | 'over'
  | 'under'
  | 'btts_yes'
  | 'btts_no'
  | 'home'
  | 'draw'
  | 'away'
  | 'ah_home'
  | 'ah_away'
  | 'parlay';

export interface DerivedSoccerOption {
  optionId: string;
  marketType: Exclude<MarketCategory, 'totals' | 'parlay'>;
  selectionKey: Exclude<SelectionKey, 'over' | 'under' | 'parlay'>;
  label: string;
  shortLabel: string;
  line: number; // 0 for 1X2/BTTS, handicap value for AH (e.g. -0.5, +0.5, -1)
  odds: number;
  modelProb: number;
  pushProb: number;
  impliedProb: number;
  fairOdds: number;
  edge: number;
  ev: number;
  kellyFull: number;
  recommendedStake: number;
  bookmaker: string;
}

export interface SoccerDerivedMarkets {
  oneXTwo: DerivedSoccerOption[]; // [home, draw, away]
  btts: DerivedSoccerOption[]; // [yes, no]
  asianHandicap: {
    homeLine: number;
    options: DerivedSoccerOption[]; // [ah_home, ah_away]
  };
}

export interface ParlayLeg {
  id: string;
  matchId: string;
  sport: SportId;
  league: string;
  matchLabel: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  marketType: Exclude<MarketCategory, 'parlay'>;
  selectionKey: Exclude<SelectionKey, 'parlay'>;
  marketLabel: string;
  line: number;
  bookmaker: string;
  odds: number;
  modelProb: number;
  pushProb: number;
  ev: number;
  modelType: ModelType;
  // Snapshot of match scoring rates so same-game correlation can be computed exactly from the joint matrix
  homeLambda: number;
  awayLambda: number;
  homeElo: number;
  awayElo: number;
  bivariateCov: number;
  rho: number;
  alpha: number;
  mlFeatures: MatchMlFeatures;
}

export interface SettlementProposal {
  betId: string;
  suggestedStatus: Exclude<BetStatus, 'pending'>;
  homeScore: number;
  awayScore: number;
  scoreLabel: string;
  closingOdds: number;
  reason: string;
  matchedEvent: string;
}

export interface FinishedAuditMatch {
  id: string;
  sport: SportId;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  homeAbbr?: string;
  awayAbbr?: string;
  homeColor?: string;
  awayColor?: string;
  kickoffTime: string;
  homeScore: number;
  awayScore: number;
  homeLambda: number;
  awayLambda: number;
  homeElo: number;
  awayElo: number;
  bivariateCov: number;
  rho: number;
  alpha: number;
  mlFeatures: MatchMlFeatures;
  marketLine: MarketLine;
}

export interface BetRecord {
  id: string;
  date: string;
  monthKey: string; // YYYY-MM
  sport: SportId;
  league: string;
  matchId?: string;
  matchLabel: string;
  side: BetSide;
  line: number;
  marketType?: MarketCategory;
  selectionKey?: SelectionKey;
  marketLabel?: string;
  finalScore?: string;
  bookmaker: string;
  odds: number;
  closingOdds: number;
  modelProb: number;
  edge: number;
  ev: number;
  stake: number;
  status: BetStatus;
  pnl: number;
  modelUsed: ModelType;
}

export interface BankrollConfig {
  initialBankroll: number;
  strategy: BankrollStrategy;
  flatPercent: number;
  flatFixed: number;
  maxStakePercent: number;
  dailyStopLossPercent: number;
  minEvThreshold: number;
  currency: 'EUR' | 'USD';
}

export interface AlertItem {
  id: string;
  timestamp: string;
  matchId: string;
  pickId: string;
  sport: SportId;
  league: string;
  homeTeam?: string;
  awayTeam?: string;
  homeLogo?: string;
  awayLogo?: string;
  matchLabel: string;
  marketLabel: string;
  odds: number;
  ev: number;
  edge: number;
  modelProb: number;
  bookmaker: string;
  modelType: ModelType;
  read: boolean;
}

export interface AlertSettings {
  pushEnabled: boolean;
  soundEnabled: boolean;
  minEvPercent: number;
  minEdgePercent: number;
  sports: Record<SportId, boolean>;
}

export const SPORT_META: Record<
  SportId,
  {
    name: string;
    shortName: string;
    tier: 'principal' | 'secundario';
    unit: string;
    rateLabel: string;
    defaultRho: number;
    defaultAlpha: number;
    defaultCov: number;
    typicalLine: number;
    color: string;
  }
> = {
  soccer: {
    name: 'Fútbol',
    shortName: 'Fútbol',
    tier: 'principal',
    unit: 'goles',
    rateLabel: 'xG',
    defaultRho: -0.068,
    defaultAlpha: 0.14,
    defaultCov: 0.14,
    typicalLine: 2.5,
    color: '#ABF43F',
  },
  nba: {
    name: 'NBA',
    shortName: 'NBA',
    tier: 'secundario',
    unit: 'pts',
    rateLabel: 'xPts',
    defaultRho: 0.0,
    defaultAlpha: 0.028,
    defaultCov: 2.4,
    typicalLine: 224.5,
    color: '#3FF4E5',
  },
  nhl: {
    name: 'NHL',
    shortName: 'NHL',
    tier: 'secundario',
    unit: 'goles',
    rateLabel: 'xG',
    defaultRho: -0.032,
    defaultAlpha: 0.17,
    defaultCov: 0.24,
    typicalLine: 6.0,
    color: '#3FF4E5',
  },
  football: {
    name: 'NFL / NCAAF',
    shortName: 'NFL/NCAAF',
    tier: 'secundario',
    unit: 'pts',
    rateLabel: 'xPts',
    defaultRho: 0.0,
    defaultAlpha: 0.085,
    defaultCov: 1.6,
    typicalLine: 46.5,
    color: '#ABF43F',
  },
};
