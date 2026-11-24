import { calculateStake, computeFullDiscreteGrid } from './dixonColes.ts';
import type { BankrollConfig, ParlayLeg } from '../types/quant.ts';

export interface CorrelationPairNotice {
  matchId: string;
  matchLabel: string;
  legALabel: string;
  legBLabel: string;
  correlation: number; // Pearson rho in [-1, 1]
  jointProb: number;
  independentProb: number;
  status: 'conflict' | 'positive' | 'negative' | 'neutral';
  message: string;
}

export interface ParlayEvaluation {
  legCount: number;
  hasConflict: boolean;
  sameGameGroups: number;
  rawCombinedOdds: number;
  effectiveOdds: number;
  independentWinProb: number;
  correlatedWinProb: number;
  correlationMultiplier: number; // correlatedWinProb / independentWinProb
  fairOdds: number;
  impliedProb: number;
  edge: number;
  ev: number;
  kellyFull: number;
  recommendedStake: number;
  recommendedStakePct: number;
  pairNotices: CorrelationPairNotice[];
  sameLeagueCount: number;
}

function legWinsScore(leg: ParlayLeg, h: number, a: number): 'win' | 'push' | 'lose' {
  const tot = h + a;
  switch (leg.selectionKey) {
    case 'over':
      if (Math.abs(tot - leg.line) < 1e-6) return 'push';
      return tot > leg.line ? 'win' : 'lose';
    case 'under':
      if (Math.abs(tot - leg.line) < 1e-6) return 'push';
      return tot < leg.line ? 'win' : 'lose';
    case 'btts_yes':
      return h >= 1 && a >= 1 ? 'win' : 'lose';
    case 'btts_no':
      return h === 0 || a === 0 ? 'win' : 'lose';
    case 'home':
      return h > a ? 'win' : 'lose';
    case 'draw':
      return h === a ? 'win' : 'lose';
    case 'away':
      return a > h ? 'win' : 'lose';
    case 'ah_home': {
      const diff = h - a + leg.line;
      if (Math.abs(diff) < 1e-6) return 'push';
      return diff > 0 ? 'win' : 'lose';
    }
    case 'ah_away': {
      const diff = a - h + leg.line;
      if (Math.abs(diff) < 1e-6) return 'push';
      return diff > 0 ? 'win' : 'lose';
    }
  }
}

function legsDirectlyConflict(a: ParlayLeg, b: ParlayLeg): boolean {
  if (a.matchId !== b.matchId) return false;
  if (a.selectionKey === b.selectionKey && a.line === b.line) return true;

  // Opposite totals on incompatible lines
  if (a.selectionKey === 'over' && b.selectionKey === 'under' && a.line >= b.line) return true;
  if (b.selectionKey === 'over' && a.selectionKey === 'under' && b.line >= a.line) return true;

  // Opposite BTTS
  if (
    (a.selectionKey === 'btts_yes' && b.selectionKey === 'btts_no') ||
    (a.selectionKey === 'btts_no' && b.selectionKey === 'btts_yes')
  ) {
    return true;
  }

  // Multiple 1X2 selections on same match
  const is1x2 = (k: string) => k === 'home' || k === 'draw' || k === 'away';
  if (is1x2(a.selectionKey) && is1x2(b.selectionKey)) return true;

  // Opposite Asian Handicap
  if (
    (a.selectionKey === 'ah_home' && b.selectionKey === 'ah_away') ||
    (a.selectionKey === 'ah_away' && b.selectionKey === 'ah_home')
  ) {
    return true;
  }

  return false;
}

/**
 * Evaluates a multi-leg parlay (2+ legs) with exact bivariate score-matrix joint probabilities
 * for any Same-Game Parlay (SGP) combinations, Pearson correlation diagnostics, compound +EV,
 * and fractional Kelly stake sizing.
 */
export function evaluateParlay(
  legs: ParlayLeg[],
  currentBankroll: number,
  bankrollConfig: BankrollConfig,
  customBookmakerOdds?: number | null
): ParlayEvaluation {
  if (legs.length === 0) {
    return {
      legCount: 0,
      hasConflict: false,
      sameGameGroups: 0,
      rawCombinedOdds: 1,
      effectiveOdds: 1,
      independentWinProb: 0,
      correlatedWinProb: 0,
      correlationMultiplier: 1,
      fairOdds: 0,
      impliedProb: 0,
      edge: 0,
      ev: 0,
      kellyFull: 0,
      recommendedStake: 0,
      recommendedStakePct: 0,
      pairNotices: [],
      sameLeagueCount: 0,
    };
  }

  const byMatch = new Map<string, ParlayLeg[]>();
  const leagueCounts = new Map<string, number>();

  for (const leg of legs) {
    const arr = byMatch.get(leg.matchId);
    if (arr) arr.push(leg);
    else byMatch.set(leg.matchId, [leg]);
    leagueCounts.set(leg.league, (leagueCounts.get(leg.league) ?? 0) + 1);
  }

  const sameLeagueCount = Math.max(0, ...Array.from(leagueCounts.values()));
  let rawCombinedOdds = 1;
  let independentWinProb = 1;
  let correlatedWinProb = 1;
  let hasConflict = false;
  let sameGameGroups = 0;
  const pairNotices: CorrelationPairNotice[] = [];

  for (const leg of legs) {
    rawCombinedOdds *= leg.odds;
    independentWinProb *= leg.modelProb;
  }

  for (const [matchId, group] of byMatch.entries()) {
    if (group.length === 1) {
      correlatedWinProb *= group[0].modelProb;
      continue;
    }

    sameGameGroups += 1;
    const ref = group[0];

    // Check pairwise conflicts first
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (legsDirectlyConflict(group[i], group[j])) {
          hasConflict = true;
          pairNotices.push({
            matchId,
            matchLabel: ref.matchLabel,
            legALabel: group[i].marketLabel,
            legBLabel: group[j].marketLabel,
            correlation: -1,
            jointProb: 0,
            independentProb: group[i].modelProb * group[j].modelProb,
            status: 'conflict',
            message: 'Selecciones mutuamente excluyentes o duplicadas en el mismo partido.',
          });
        }
      }
    }

    if (hasConflict) {
      correlatedWinProb = 0;
      continue;
    }

    // Exact bivariate joint probability from discrete grid (Soccer & NHL)
    if (ref.sport === 'soccer' || ref.sport === 'nhl') {
      const grid = computeFullDiscreteGrid(
        ref.homeLambda,
        ref.awayLambda,
        ref.rho,
        ref.alpha,
        ref.bivariateCov,
        ref.homeElo,
        ref.awayElo,
        ref.mlFeatures,
        ref.modelType,
        ref.sport
      );

      let groupJointWin = 0;
      for (let h = 0; h < grid.length; h++) {
        for (let a = 0; a < grid[h].length; a++) {
          const allWin = group.every((lg) => legWinsScore(lg, h, a) === 'win');
          if (allWin) groupJointWin += grid[h][a];
        }
      }
      correlatedWinProb *= groupJointWin;

      // Pairwise Pearson correlation diagnostics for every pair in this match
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const la = group[i];
          const lb = group[j];
          let pA = 0;
          let pB = 0;
          let pAB = 0;
          for (let h = 0; h < grid.length; h++) {
            for (let a = 0; a < grid[h].length; a++) {
              const p = grid[h][a];
              const wA = legWinsScore(la, h, a) === 'win';
              const wB = legWinsScore(lb, h, a) === 'win';
              if (wA) pA += p;
              if (wB) pB += p;
              if (wA && wB) pAB += p;
            }
          }
          const indep = pA * pB;
          const denom = Math.sqrt(Math.max(1e-9, pA * (1 - pA) * pB * (1 - pB)));
          const rhoPair = Math.max(-1, Math.min(1, (pAB - indep) / denom));

          if (pAB <= 1e-6) {
            hasConflict = true;
            pairNotices.push({
              matchId,
              matchLabel: ref.matchLabel,
              legALabel: la.marketLabel,
              legBLabel: lb.marketLabel,
              correlation: -1,
              jointProb: 0,
              independentProb: indep,
              status: 'conflict',
              message: 'Combinación imposible en el marcador final.',
            });
          } else if (rhoPair >= 0.12) {
            pairNotices.push({
              matchId,
              matchLabel: ref.matchLabel,
              legALabel: la.marketLabel,
              legBLabel: lb.marketLabel,
              correlation: rhoPair,
              jointProb: pAB,
              independentProb: indep,
              status: 'positive',
              message: `Correlación positiva: ambos eventos tienden a cumplirse juntos (P real ${(pAB * 100).toFixed(1)}% vs ${(indep * 100).toFixed(1)}% indep.).`,
            });
          } else if (rhoPair <= -0.12) {
            pairNotices.push({
              matchId,
              matchLabel: ref.matchLabel,
              legALabel: la.marketLabel,
              legBLabel: lb.marketLabel,
              correlation: rhoPair,
              jointProb: pAB,
              independentProb: indep,
              status: 'negative',
              message: `Correlación negativa: las selecciones se restan probabilidad entre sí (P real ${(pAB * 100).toFixed(1)}% vs ${(indep * 100).toFixed(1)}% indep.).`,
            });
          } else {
            pairNotices.push({
              matchId,
              matchLabel: ref.matchLabel,
              legALabel: la.marketLabel,
              legBLabel: lb.marketLabel,
              correlation: rhoPair,
              jointProb: pAB,
              independentProb: indep,
              status: 'neutral',
              message: `Correlación baja entre selecciones del mismo encuentro (ρ ${rhoPair >= 0 ? '+' : ''}${rhoPair.toFixed(2)}).`,
            });
          }
        }
      }
    } else {
      // NBA / NFL: Same-match totals legs (e.g., Over 224.5 + Over 228.5 → dominated by stricter threshold)
      const overs = group.filter((l) => l.selectionKey === 'over');
      const unders = group.filter((l) => l.selectionKey === 'under');
      let pGroup = 1;
      if (overs.length > 0 && unders.length === 0) {
        pGroup = Math.min(...overs.map((o) => o.modelProb));
      } else if (unders.length > 0 && overs.length === 0) {
        pGroup = Math.min(...unders.map((u) => u.modelProb));
      } else {
        // Middle window (Over lower line AND Under higher line)
        const maxOver = Math.max(...overs.map((o) => o.line));
        const minUnder = Math.min(...unders.map((u) => u.line));
        if (maxOver >= minUnder) {
          hasConflict = true;
          pGroup = 0;
        } else {
          const pOverMin = Math.min(...overs.map((o) => o.modelProb));
          const pUnderMin = Math.min(...unders.map((u) => u.modelProb));
          pGroup = Math.max(0, pOverMin + pUnderMin - 1);
        }
      }
      correlatedWinProb *= pGroup;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const la = group[i];
          const lb = group[j];
          const indep = la.modelProb * lb.modelProb;
          const sameDir = la.selectionKey === lb.selectionKey;
          pairNotices.push({
            matchId,
            matchLabel: ref.matchLabel,
            legALabel: la.marketLabel,
            legBLabel: lb.marketLabel,
            correlation: sameDir ? 0.78 : -0.65,
            jointProb: pGroup,
            independentProb: indep,
            status: sameDir ? 'positive' : 'negative',
            message: sameDir
              ? 'Líneas alternativas del mismo partido: están altamente correlacionadas y la casa ajustará la cuota.'
              : 'Rango intermedio (Middle) en el mismo partido: probabilidad conjunta muy reducida.',
          });
        }
      }
    }
  }

  // Sportsbooks shade correlated SGP odds when positive correlation exists; allow user override
  const correlationMultiplier =
    independentWinProb > 1e-6 ? correlatedWinProb / independentWinProb : 1;
  const sgpAdjustedDefaultOdds =
    sameGameGroups > 0 && correlationMultiplier > 1.05
      ? Math.max(1.05, Math.round((rawCombinedOdds / Math.pow(correlationMultiplier, 0.72)) * 100) / 100)
      : Math.round(rawCombinedOdds * 100) / 100;

  const effectiveOdds =
    typeof customBookmakerOdds === 'number' && Number.isFinite(customBookmakerOdds) && customBookmakerOdds > 1.01
      ? customBookmakerOdds
      : sgpAdjustedDefaultOdds;

  const impliedProb = effectiveOdds > 0 ? 1 / effectiveOdds : 0;
  const ev = hasConflict ? -1 : correlatedWinProb * (effectiveOdds - 1) - (1 - correlatedWinProb);
  const edge = hasConflict ? -1 : correlatedWinProb - impliedProb;
  const fairOdds = correlatedWinProb > 0.0005 ? 1 / correlatedWinProb : 999;
  const kellyFull = !hasConflict && effectiveOdds > 1 && ev > 0 ? ev / (effectiveOdds - 1) : 0;

  // Slightly more conservative stake cap on parlays due to higher variance
  const parlayConfig: BankrollConfig = {
    ...bankrollConfig,
    maxStakePercent: Math.min(bankrollConfig.maxStakePercent, legs.length >= 3 ? 2.5 : 3.5),
  };
  const { stake, stakePct } = calculateStake(ev, kellyFull, currentBankroll, parlayConfig);

  return {
    legCount: legs.length,
    hasConflict,
    sameGameGroups,
    rawCombinedOdds: Math.round(rawCombinedOdds * 100) / 100,
    effectiveOdds,
    independentWinProb,
    correlatedWinProb,
    correlationMultiplier,
    fairOdds,
    impliedProb,
    edge,
    ev,
    kellyFull,
    recommendedStake: stake,
    recommendedStakePct: stakePct,
    pairNotices,
    sameLeagueCount,
  };
}
