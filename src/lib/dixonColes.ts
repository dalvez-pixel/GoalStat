import type {
  BankrollConfig,
  BetSide,
  EvaluatedPick,
  LiveMatch,
  MarketLine,
  MatchMlFeatures,
  ModelComparisonRow,
  ModelType,
  ScoreCell,
  SportId,
  TotalGoalBin,
} from '../types/quant.ts';

// Precomputed log-factorials up to 260 for exact discrete distributions
const LOG_FACT: number[] = [0];
for (let i = 1; i <= 260; i++) {
  LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
}

/**
 * Lanczos approximation for ln(Gamma(z)), accurate to ~1e-12 for z > 0.
 */
function logGamma(z: number): number {
  const g = 7;
  const p = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  const zm = z - 1;
  let x = p[0];
  for (let i = 1; i < g + 2; i++) {
    x += p[i] / (zm + i);
  }
  const t = zm + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zm + 0.5) * Math.log(t) - t + Math.log(x);
}

function logFact(k: number): number {
  if (k <= 260) return LOG_FACT[k];
  return logGamma(k + 1);
}

export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isFinite(lambda) || lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logFact(k));
}

/**
 * Exact Bivariate Poisson PMF (Holgate 1964 / Karlis & Ntzoufras 2003):
 * X = U1 + U3, Y = U2 + U3 where U1 ~ Pois(l1), U2 ~ Pois(l2), U3 ~ Pois(l3).
 * Covariance(X, Y) = l3 >= 0, capturing shared match tempo / openness.
 */
export function bivariatePoissonPmf(
  x: number,
  y: number,
  homeRate: number,
  awayRate: number,
  covLambda3: number
): number {
  const l3 = Math.max(0, Math.min(covLambda3, Math.min(homeRate, awayRate) * 0.65));
  const l1 = Math.max(1e-5, homeRate - l3);
  const l2 = Math.max(1e-5, awayRate - l3);

  if (l3 <= 1e-6) {
    return poissonPmf(x, homeRate) * poissonPmf(y, awayRate);
  }

  const baseLog = -(l1 + l2 + l3);
  const minXY = Math.min(x, y);
  let sum = 0;

  for (let k = 0; k <= minXY; k++) {
    const termLog =
      baseLog +
      (x - k) * Math.log(l1) -
      logFact(x - k) +
      (y - k) * Math.log(l2) -
      logFact(y - k) +
      k * Math.log(l3) -
      logFact(k);
    sum += Math.exp(termLog);
  }
  return sum;
}

/**
 * Negative Binomial PMF parameterized by mean (mu) and overdispersion (alpha > 0):
 * Variance = mu + alpha * mu^2; r = 1 / alpha; p = r / (r + mu).
 */
export function negativeBinomialPmf(k: number, mu: number, alpha: number): number {
  if (k < 0 || !Number.isFinite(mu) || mu <= 0) return k === 0 ? 1 : 0;
  if (!Number.isFinite(alpha) || alpha <= 1e-4) {
    return poissonPmf(k, mu);
  }
  const r = 1 / alpha;
  const p = r / (r + mu);
  const logProb =
    logGamma(k + r) -
    logGamma(r) -
    logFact(k) +
    r * Math.log(p) +
    k * Math.log(1 - p);
  return Math.exp(logProb);
}

/**
 * Standard Normal CDF via Abramowitz-Stegun erf approximation (for high-scoring NBA/NFL totals).
 */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x));
  return 0.5 * (1 + sign * y);
}

function normalPdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / Math.max(sd, 0.1);
  return Math.exp(-0.5 * z * z) / (Math.max(sd, 0.1) * Math.sqrt(2 * Math.PI));
}

/**
 * Dixon-Coles (1997) tau correlation adjustment for low-scoring outcomes (0-0, 1-0, 0-1, 1-1).
 */
export function dixonColesTau(
  x: number,
  y: number,
  lambda: number,
  mu: number,
  rho: number
): number {
  if (rho === 0) return 1;
  const maxRho = Math.min(1 / Math.max(lambda * mu, 1e-6), 0.99);
  const minRho = Math.max(-1 / Math.max(lambda, 1e-6), -1 / Math.max(mu, 1e-6), -0.99);
  const safeRho = Math.max(minRho * 0.95, Math.min(maxRho * 0.95, rho));

  if (x === 0 && y === 0) return Math.max(0, 1 - lambda * mu * safeRho);
  if (x === 0 && y === 1) return Math.max(0, 1 + lambda * safeRho);
  if (x === 1 && y === 0) return Math.max(0, 1 + mu * safeRho);
  if (x === 1 && y === 1) return Math.max(0, 1 - safeRho);
  return 1;
}

/**
 * Elo + xG rate calibration:
 * Translates Elo rating differential & average team quality into adjusted scoring rates.
 * High-Elo clashes slightly raise technical efficiency; large Elo gaps tilt scoring toward favorite
 * and slightly increase total expected output in soccer/football mismatches.
 */
export function calibrateRatesWithElo(
  homeXg: number,
  awayXg: number,
  homeElo: number,
  awayElo: number,
  sport: SportId
): { calHome: number; calAway: number; eloWinProbHome: number } {
  const homeAdvElo = sport === 'soccer' ? 55 : sport === 'nba' ? 65 : sport === 'nhl' ? 35 : 50;
  const eloDiff = homeElo + homeAdvElo - awayElo;
  const eloWinProbHome = 1 / (1 + Math.pow(10, -eloDiff / 400));

  // Tilt relative to neutral 0.50 expectation (bounded gently so xG stays primary anchor)
  const strengthTilt = (eloWinProbHome - 0.5) * (sport === 'soccer' ? 0.22 : sport === 'nhl' ? 0.14 : 0.08);
  // Mismatch / elite quality total boost
  const avgElo = (homeElo + awayElo) / 2;
  const qualityFactor = 1 + Math.max(-0.04, Math.min(0.05, ((avgElo - 1650) / 1000) * 0.08));
  const mismatchFactor =
    1 + Math.min(0.045, (Math.abs(homeElo - awayElo) / 600) * (sport === 'soccer' ? 0.04 : 0.025));

  const calHome = Math.max(0.2, homeXg * (1 + strengthTilt) * qualityFactor * mismatchFactor);
  const calAway = Math.max(0.2, awayXg * (1 - strengthTilt * 0.85) * qualityFactor * mismatchFactor);

  return { calHome, calAway, eloWinProbHome };
}

/**
 * Gradient Boosted Decision Tree (GBDT) nonlinear interaction scorer.
 */
export function computeMlGbdtParameters(
  homeLambda: number,
  awayLambda: number,
  homeElo: number,
  awayElo: number,
  features: MatchMlFeatures,
  sport: SportId
): { adjHomeLambda: number; adjAwayLambda: number; tailAlpha: number; overBoostLogit: number } {
  const { paceIndex, volatilityIndex, shotQualityDiff, defensiveFragility, restAdvantage } = features;

  // Tree 1: Pace x Defensive fragility interaction
  let tree1 = 0;
  if (paceIndex >= 1.07 && defensiveFragility >= 1.06) {
    tree1 = 0.075;
  } else if (paceIndex <= 0.94 && defensiveFragility <= 0.94) {
    tree1 = -0.07;
  } else {
    tree1 = (paceIndex - 1.0) * 0.3 + (defensiveFragility - 1.0) * 0.22;
  }

  // Tree 2: Shot quality / EPA efficiency
  let tree2 = 0;
  if (shotQualityDiff > 0.08) tree2 = 0.04;
  else if (shotQualityDiff < -0.08) tree2 = -0.036;
  else tree2 = shotQualityDiff * 0.28;

  // Tree 3: Elo competitiveness & rest interaction
  const eloGap = Math.abs(homeElo - awayElo);
  let tree3 = 0;
  if (eloGap < 70 && paceIndex >= 1.03) {
    // Tight high-tempo games stay competitive late (OT / empty net / late fouls in NBA)
    tree3 = sport === 'nba' || sport === 'nhl' ? 0.028 : 0.022;
  } else if (eloGap > 240 && sport === 'soccer') {
    tree3 = -0.018;
  }
  const restEffect = Math.max(-0.025, Math.min(0.025, restAdvantage * 0.01));

  // Scale down multiplier for high-scoring sports where 4% = ~9 points in NBA
  const scaleDamp = sport === 'nba' ? 0.38 : sport === 'football' ? 0.58 : 0.78;
  const totalMultiplier = Math.max(
    0.9,
    Math.min(1.12, 1 + scaleDamp * (tree1 + tree2 + tree3))
  );

  const adjHomeLambda = Math.max(0.2, homeLambda * totalMultiplier * (1 + restEffect));
  const adjAwayLambda = Math.max(0.2, awayLambda * totalMultiplier * (1 - restEffect * 0.5));

  const tailAlpha = Math.max(
    0.015,
    Math.min(0.38, volatilityIndex * (sport === 'nba' ? 0.14 : sport === 'football' ? 0.35 : 0.82))
  );
  const overBoostLogit = (tree1 + tree2) * 0.28;

  return { adjHomeLambda, adjAwayLambda, tailAlpha, overBoostLogit };
}

export interface TotalsDistributionResult {
  overProb: number;
  underProb: number;
  pushProb: number;
  scoreMatrix: ScoreCell[];
  matrixMaxGoals: number;
  totalDistribution: TotalGoalBin[];
  expectedTotal: number;
}

const DEFAULT_ML_FEATURES: MatchMlFeatures = {
  paceIndex: 1.02,
  volatilityIndex: 0.16,
  shotQualityDiff: 0.02,
  defensiveFragility: 1.01,
  restAdvantage: 0,
};

function computeSingleModelDistribution(
  homeLambda: number,
  awayLambda: number,
  line: number,
  rho: number,
  alpha: number,
  bivariateCov: number,
  homeElo: number,
  awayElo: number,
  mlFeatures: MatchMlFeatures,
  modelType: Exclude<ModelType, 'ensemble'>,
  sport: SportId
): TotalsDistributionResult {
  const eloCal = calibrateRatesWithElo(homeLambda, awayLambda, homeElo, awayElo, sport);
  const mlParams =
    modelType === 'ml-gbdt'
      ? computeMlGbdtParameters(eloCal.calHome, eloCal.calAway, homeElo, awayElo, mlFeatures, sport)
      : null;

  // Bivariate Poisson + xG + Elo uses Elo-calibrated xG rates + shared covariance lambda_3
  const hMean =
    modelType === 'bivariate-poisson-xg-elo'
      ? eloCal.calHome
      : modelType === 'ml-gbdt'
        ? mlParams!.adjHomeLambda
        : homeLambda;
  const aMean =
    modelType === 'bivariate-poisson-xg-elo'
      ? eloCal.calAway
      : modelType === 'ml-gbdt'
        ? mlParams!.adjAwayLambda
        : awayLambda;

  // High-scoring sports: NBA (~225 pts) & NFL/NCAAF (~46 pts)
  if (sport === 'nba' || sport === 'football') {
    const totalMean = Math.max(12, hMean + aMean);
    // Base standard deviation calibrated to empirical NBA / NFL-NCAAF totals volatility
    const baseSd = sport === 'nba' ? 18.2 : 13.4;
    const covBoost =
      modelType === 'bivariate-poisson-xg-elo' ? Math.sqrt(Math.max(0, bivariateCov)) * 0.9 : 0;
    const dispBoost =
      modelType === 'negative-binomial'
        ? Math.sqrt(1 + alpha * (sport === 'nba' ? 5.5 : 3.2))
        : modelType === 'ml-gbdt'
          ? 1 + mlParams!.tailAlpha * 0.35
          : 1;
    const sd = baseSd * dispBoost + covBoost;

    const isIntegerLine = Math.abs(line - Math.round(line)) < 1e-6;
    let overProb: number;
    let underProb: number;
    let pushProb = 0;

    if (isIntegerLine) {
      // Continuity correction around integer total
      underProb = normalCdf((line - 0.5 - totalMean) / sd);
      overProb = 1 - normalCdf((line + 0.5 - totalMean) / sd);
      pushProb = Math.max(0, 1 - overProb - underProb);
    } else {
      underProb = normalCdf((line - totalMean) / sd);
      overProb = 1 - underProb;
    }

    if (mlParams && Math.abs(mlParams.overBoostLogit) > 1e-4 && overProb > 0.03 && underProb > 0.03) {
      const nonPush = Math.max(0.01, overProb + underProb);
      const ratio = overProb / nonPush;
      const logit = Math.log(ratio / (1 - ratio)) + mlParams.overBoostLogit;
      const adjRatio = 1 / (1 + Math.exp(-logit));
      overProb = adjRatio * nonPush;
      underProb = (1 - adjRatio) * nonPush;
    }

    // Build focused bucketed distribution chart around the line
    const binStep = sport === 'nba' ? 4 : 3;
    const centerLine = Math.round(line);
    const totalDistribution: TotalGoalBin[] = [];
    for (let offset = -5; offset <= 5; offset++) {
      const binVal = centerLine + offset * binStep;
      const binProb =
        normalCdf((binVal + binStep / 2 - totalMean) / sd) -
        normalCdf((binVal - binStep / 2 - totalMean) / sd);
      totalDistribution.push({
        goals: binVal,
        label: String(binVal),
        modelProb: Math.max(0, binProb),
        isOver: binVal > line,
        isPush: Math.abs(binVal - line) < 0.5,
      });
    }

    // Build compact score grid around projected home/away points
    const stepPts = sport === 'nba' ? 5 : 3;
    const hCenter = Math.round(hMean / stepPts) * stepPts;
    const aCenter = Math.round(aMean / stepPts) * stepPts;
    const teamSd = sd / Math.SQRT2;
    const scoreMatrix: ScoreCell[] = [];
    for (let hi = -2; hi <= 3; hi++) {
      for (let ai = -2; ai <= 3; ai++) {
        const hPts = Math.max(0, hCenter + hi * stepPts);
        const aPts = Math.max(0, aCenter + ai * stepPts);
        const prob =
          normalPdf(hPts, hMean, teamSd) *
          stepPts *
          normalPdf(aPts, aMean, teamSd) *
          stepPts;
        scoreMatrix.push({
          homeGoals: hPts,
          awayGoals: aPts,
          probability: prob,
          totalGoals: hPts + aPts,
        });
      }
    }

    return {
      overProb,
      underProb,
      pushProb,
      scoreMatrix,
      matrixMaxGoals: 5,
      totalDistribution,
      expectedTotal: totalMean,
    };
  }

  // Exact discrete bivariate grid for Fútbol (Soccer) and NHL
  const maxGoals = sport === 'soccer' ? 11 : 14;
  const displayMax = sport === 'soccer' ? 5 : 6;
  const effectiveAlpha =
    modelType === 'negative-binomial'
      ? Math.max(0.01, alpha)
      : modelType === 'ml-gbdt'
        ? mlParams!.tailAlpha
        : 0;
  const effectiveRho = modelType === 'dixon-coles' ? rho : 0;
  const useBivariate = modelType === 'bivariate-poisson-xg-elo';

  const rawGrid: number[][] = [];
  let sumAll = 0;

  for (let h = 0; h <= maxGoals; h++) {
    rawGrid[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      let p: number;
      if (useBivariate) {
        // Exact Holgate / Karlis-Ntzoufras Bivariate Poisson with xG + Elo rates & covariance lambda_3
        p = bivariatePoissonPmf(h, a, hMean, aMean, bivariateCov);
      } else if (effectiveAlpha > 0) {
        p = negativeBinomialPmf(h, hMean, effectiveAlpha) * negativeBinomialPmf(a, aMean, effectiveAlpha);
      } else {
        const ph = poissonPmf(h, hMean);
        const pa = poissonPmf(a, aMean);
        const tau = effectiveRho !== 0 ? dixonColesTau(h, a, hMean, aMean, effectiveRho) : 1;
        p = ph * pa * tau;
      }
      rawGrid[h][a] = p;
      sumAll += p;
    }
  }

  let overProb = 0;
  let underProb = 0;
  let pushProb = 0;
  const totalMap = new Map<number, number>();
  const scoreMatrix: ScoreCell[] = [];

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = sumAll > 0 ? rawGrid[h][a] / sumAll : 0;
      const tot = h + a;
      totalMap.set(tot, (totalMap.get(tot) ?? 0) + p);

      if (Math.abs(tot - line) < 1e-6) {
        pushProb += p;
      } else if (tot > line) {
        overProb += p;
      } else {
        underProb += p;
      }

      if (h <= displayMax && a <= displayMax) {
        scoreMatrix.push({
          homeGoals: h,
          awayGoals: a,
          probability: p,
          totalGoals: tot,
        });
      }
    }
  }

  if (mlParams && Math.abs(mlParams.overBoostLogit) > 1e-4 && overProb > 0.02 && underProb > 0.02) {
    const nonPush = Math.max(0.01, overProb + underProb);
    const baseRatio = overProb / nonPush;
    const logit = Math.log(baseRatio / (1 - baseRatio)) + mlParams.overBoostLogit;
    const adjustedRatio = 1 / (1 + Math.exp(-logit));
    overProb = adjustedRatio * nonPush;
    underProb = (1 - adjustedRatio) * nonPush;
  }

  const maxChartGoal = sport === 'soccer' ? 8 : 11;
  const totalDistribution: TotalGoalBin[] = [];
  for (let g = 0; g <= maxChartGoal; g++) {
    const p = totalMap.get(g) ?? 0;
    totalDistribution.push({
      goals: g,
      label: g === maxChartGoal ? `${g}+` : String(g),
      modelProb:
        g === maxChartGoal
          ? Array.from(totalMap.entries())
              .filter(([k]) => k >= maxChartGoal)
              .reduce((acc, [, v]) => acc + v, 0)
          : p,
      isOver: g > line,
      isPush: Math.abs(g - line) < 1e-6,
    });
  }

  return {
    overProb,
    underProb,
    pushProb,
    scoreMatrix,
    matrixMaxGoals: displayMax,
    totalDistribution,
    expectedTotal: hMean + aMean,
  };
}

/**
 * Computes totals distribution for any model including Ensemble
 * (35% Bivariate Poisson xG+Elo · 20% Dixon-Coles · 20% Neg. Binomial · 25% ML GBDT).
 */
export function computeTotalsDistribution(
  homeLambda: number,
  awayLambda: number,
  line: number,
  rho: number,
  modelType: ModelType,
  sport: SportId,
  alpha = 0.15,
  mlFeatures: MatchMlFeatures = DEFAULT_ML_FEATURES,
  bivariateCov = 0.14,
  homeElo = 1750,
  awayElo = 1720
): TotalsDistributionResult {
  if (modelType !== 'ensemble') {
    return computeSingleModelDistribution(
      homeLambda,
      awayLambda,
      line,
      rho,
      alpha,
      bivariateCov,
      homeElo,
      awayElo,
      mlFeatures,
      modelType,
      sport
    );
  }

  const biv = computeSingleModelDistribution(
    homeLambda,
    awayLambda,
    line,
    rho,
    alpha,
    bivariateCov,
    homeElo,
    awayElo,
    mlFeatures,
    'bivariate-poisson-xg-elo',
    sport
  );
  const dc = computeSingleModelDistribution(
    homeLambda,
    awayLambda,
    line,
    rho,
    alpha,
    bivariateCov,
    homeElo,
    awayElo,
    mlFeatures,
    'dixon-coles',
    sport
  );
  const nb = computeSingleModelDistribution(
    homeLambda,
    awayLambda,
    line,
    rho,
    alpha,
    bivariateCov,
    homeElo,
    awayElo,
    mlFeatures,
    'negative-binomial',
    sport
  );
  const ml = computeSingleModelDistribution(
    homeLambda,
    awayLambda,
    line,
    rho,
    alpha,
    bivariateCov,
    homeElo,
    awayElo,
    mlFeatures,
    'ml-gbdt',
    sport
  );

  const wBiv = 0.35;
  const wDc = 0.2;
  const wNb = 0.2;
  const wMl = 0.25;

  const overProb = biv.overProb * wBiv + dc.overProb * wDc + nb.overProb * wNb + ml.overProb * wMl;
  const underProb =
    biv.underProb * wBiv + dc.underProb * wDc + nb.underProb * wNb + ml.underProb * wMl;
  const pushProb = biv.pushProb * wBiv + dc.pushProb * wDc + nb.pushProb * wNb + ml.pushProb * wMl;

  const scoreMap = new Map<string, ScoreCell>();
  const addCells = (cells: ScoreCell[], weight: number) => {
    for (const c of cells) {
      const key = `${c.homeGoals}-${c.awayGoals}`;
      const existing = scoreMap.get(key);
      if (existing) {
        existing.probability += c.probability * weight;
      } else {
        scoreMap.set(key, { ...c, probability: c.probability * weight });
      }
    }
  };
  addCells(biv.scoreMatrix, wBiv);
  addCells(dc.scoreMatrix, wDc);
  addCells(nb.scoreMatrix, wNb);
  addCells(ml.scoreMatrix, wMl);

  const totalDistribution: TotalGoalBin[] = biv.totalDistribution.map((bin, i) => ({
    ...bin,
    modelProb:
      bin.modelProb * wBiv +
      (dc.totalDistribution[i]?.modelProb ?? bin.modelProb) * wDc +
      (nb.totalDistribution[i]?.modelProb ?? bin.modelProb) * wNb +
      (ml.totalDistribution[i]?.modelProb ?? bin.modelProb) * wMl,
  }));

  return {
    overProb,
    underProb,
    pushProb,
    scoreMatrix: Array.from(scoreMap.values()),
    matrixMaxGoals: biv.matrixMaxGoals,
    totalDistribution,
    expectedTotal:
      biv.expectedTotal * wBiv +
      dc.expectedTotal * wDc +
      nb.expectedTotal * wNb +
      ml.expectedTotal * wMl,
  };
}

export function calculateStake(
  ev: number,
  kellyFull: number,
  currentBankroll: number,
  config: BankrollConfig
): { stake: number; stakePct: number } {
  if (ev <= 0 || currentBankroll <= 0) {
    return { stake: 0, stakePct: 0 };
  }

  let rawPct = 0;
  switch (config.strategy) {
    case 'kelly-quarter':
      rawPct = kellyFull * 0.25 * 100;
      break;
    case 'kelly-half':
      rawPct = kellyFull * 0.5 * 100;
      break;
    case 'kelly-full':
      rawPct = kellyFull * 100;
      break;
    case 'flat-percent':
      rawPct = config.flatPercent;
      break;
    case 'flat-fixed':
      rawPct = (config.flatFixed / currentBankroll) * 100;
      break;
  }

  const cappedPct = Math.max(0, Math.min(rawPct, config.maxStakePercent));
  const stake = Math.round((cappedPct / 100) * currentBankroll * 100) / 100;
  return {
    stake,
    stakePct: Math.round(cappedPct * 100) / 100,
  };
}

const BASE_MODELS: Exclude<ModelType, 'ensemble'>[] = [
  'bivariate-poisson-xg-elo',
  'dixon-coles',
  'negative-binomial',
  'ml-gbdt',
];

export function evaluateMarketLine(
  match: LiveMatch,
  marketLine: MarketLine,
  modelType: ModelType,
  currentBankroll: number,
  bankrollConfig: BankrollConfig
): [EvaluatedPick, EvaluatedPick] {
  const baseDists = new Map<Exclude<ModelType, 'ensemble'>, TotalsDistributionResult>();
  for (const m of BASE_MODELS) {
    baseDists.set(
      m,
      computeSingleModelDistribution(
        match.homeLambda,
        match.awayLambda,
        marketLine.line,
        match.rho,
        match.alpha,
        match.bivariateCov,
        match.homeElo,
        match.awayElo,
        match.mlFeatures,
        m,
        match.sport
      )
    );
  }

  const activeDist =
    modelType === 'ensemble'
      ? computeTotalsDistribution(
          match.homeLambda,
          match.awayLambda,
          marketLine.line,
          match.rho,
          'ensemble',
          match.sport,
          match.alpha,
          match.mlFeatures,
          match.bivariateCov,
          match.homeElo,
          match.awayElo
        )
      : baseDists.get(modelType)!;

  const impOver = 1 / marketLine.overOdds;
  const impUnder = 1 / marketLine.underOdds;
  const overround = impOver + impUnder - 1;
  const fairOver = impOver / (impOver + impUnder);
  const fairUnder = impUnder / (impOver + impUnder);

  const buildSide = (
    side: BetSide,
    odds: number,
    prevOdds: number | undefined,
    oppositeOdds: number,
    modelProb: number,
    impliedProb: number,
    fairMarketProb: number
  ): EvaluatedPick => {
    const loseProb = Math.max(0, 1 - modelProb - activeDist.pushProb);
    const ev = modelProb * (odds - 1) - loseProb;
    const edge = modelProb - impliedProb;
    const fairEdge = modelProb - fairMarketProb;
    const effectiveWinProb =
      activeDist.pushProb < 0.99 ? modelProb / (1 - activeDist.pushProb) : modelProb;
    const fairOdds = effectiveWinProb > 0.001 ? 1 / effectiveWinProb : 99;
    const b = odds - 1;
    const kellyFull = b > 0 && ev > 0 ? Math.max(0, ev / b) : 0;

    const { stake, stakePct } = calculateStake(ev, kellyFull, currentBankroll, bankrollConfig);

    const modelComparisons: ModelComparisonRow[] = BASE_MODELS.map((m) => {
      const d = baseDists.get(m)!;
      const mProb = side === 'over' ? d.overProb : d.underProb;
      const mLose = Math.max(0, 1 - mProb - d.pushProb);
      const mEv = mProb * (odds - 1) - mLose;
      const mEdge = mProb - impliedProb;
      const mEff = d.pushProb < 0.99 ? mProb / (1 - d.pushProb) : mProb;
      return {
        modelType: m,
        modelProb: mProb,
        fairOdds: mEff > 0.001 ? 1 / mEff : 99,
        edge: mEdge,
        ev: mEv,
        isPositiveEv: mEv > 0.005,
      };
    });

    const consensusCount = modelComparisons.filter((c) => c.isPositiveEv).length;

    let confidenceTier: EvaluatedPick['confidenceTier'] = 'sin-valor';
    if (ev >= 0.055 && edge >= 0.03) confidenceTier = 'alto';
    else if (ev >= 0.025 && edge >= 0.015) confidenceTier = 'moderado';
    else if (ev > 0) confidenceTier = 'marginal';

    return {
      pickId: `${match.id}-${marketLine.line}-${side}`,
      match,
      marketLine,
      side,
      odds,
      prevOdds,
      oppositeOdds,
      modelType,
      modelProb,
      pushProb: activeDist.pushProb,
      impliedProb,
      fairMarketProb,
      overround,
      edge,
      fairEdge,
      ev,
      fairOdds,
      kellyFull,
      recommendedStakePct: stakePct,
      recommendedStake: stake,
      confidenceTier,
      scoreMatrix: activeDist.scoreMatrix,
      matrixMaxGoals: activeDist.matrixMaxGoals,
      totalDistribution: activeDist.totalDistribution,
      modelComparisons,
      consensusCount,
    };
  };

  return [
    buildSide(
      'over',
      marketLine.overOdds,
      marketLine.prevOverOdds,
      marketLine.underOdds,
      activeDist.overProb,
      impOver,
      fairOver
    ),
    buildSide(
      'under',
      marketLine.underOdds,
      marketLine.prevUnderOdds,
      marketLine.overOdds,
      activeDist.underProb,
      impUnder,
      fairUnder
    ),
  ];
}

export function evaluateAllMatches(
  matches: LiveMatch[],
  modelType: ModelType,
  currentBankroll: number,
  bankrollConfig: BankrollConfig
): EvaluatedPick[] {
  const picks: EvaluatedPick[] = [];
  for (const match of matches) {
    for (const line of match.lines) {
      const [overPick, underPick] = evaluateMarketLine(
        match,
        line,
        modelType,
        currentBankroll,
        bankrollConfig
      );
      picks.push(overPick.ev >= underPick.ev ? overPick : underPick);
    }
  }
  return picks.sort((a, b) => b.ev - a.ev);
}
