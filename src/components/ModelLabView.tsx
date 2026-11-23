import { Check, FlaskConical, RefreshCw } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { calculateStake, computeTotalsDistribution } from '../lib/dixonColes.ts';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type {
  BankrollConfig,
  BetRecord,
  BetSide,
  MatchMlFeatures,
  ModelType,
  SportId,
} from '../types/quant.ts';

interface ModelLabViewProps {
  currentBankroll: number;
  bankrollConfig: BankrollConfig;
  currencySymbol: string;
  onLogCustomBet: (bet: Omit<BetRecord, 'id'>) => void;
}

const SPORT_PRESETS: Record<
  SportId,
  {
    homeTeam: string;
    awayTeam: string;
    league: string;
    homeLambda: number;
    awayLambda: number;
    homeElo: number;
    awayElo: number;
    bivariateCov: number;
    rho: number;
    alpha: number;
    line: number;
    overOdds: number;
    underOdds: number;
    mlFeatures: MatchMlFeatures;
  }
> = {
  soccer: {
    homeTeam: 'FC Barcelona',
    awayTeam: 'Athletic Club',
    league: 'La Liga',
    homeLambda: 1.94,
    awayLambda: 1.18,
    homeElo: 1968,
    awayElo: 1835,
    bivariateCov: 0.17,
    rho: -0.072,
    alpha: 0.16,
    line: 2.5,
    overOdds: 1.86,
    underOdds: 2.02,
    mlFeatures: {
      paceIndex: 1.12,
      volatilityIndex: 0.21,
      shotQualityDiff: 0.09,
      defensiveFragility: 1.06,
      restAdvantage: 1,
    },
  },
  nba: {
    homeTeam: 'Boston Celtics',
    awayTeam: 'Indiana Pacers',
    league: 'NBA',
    homeLambda: 120.8,
    awayLambda: 114.4,
    homeElo: 1718,
    awayElo: 1585,
    bivariateCov: 2.8,
    rho: 0,
    alpha: 0.032,
    line: 233.5,
    overOdds: 1.93,
    underOdds: 1.91,
    mlFeatures: {
      paceIndex: 1.15,
      volatilityIndex: 0.24,
      shotQualityDiff: 0.12,
      defensiveFragility: 1.08,
      restAdvantage: 1,
    },
  },
  nhl: {
    homeTeam: 'Edmonton Oilers',
    awayTeam: 'Dallas Stars',
    league: 'NHL',
    homeLambda: 3.45,
    awayLambda: 2.98,
    homeElo: 1642,
    awayElo: 1618,
    bivariateCov: 0.26,
    rho: -0.032,
    alpha: 0.2,
    line: 6.5,
    overOdds: 2.1,
    underOdds: 1.81,
    mlFeatures: {
      paceIndex: 1.15,
      volatilityIndex: 0.24,
      shotQualityDiff: 0.11,
      defensiveFragility: 1.08,
      restAdvantage: 0,
    },
  },
  football: {
    homeTeam: 'Buffalo Bills',
    awayTeam: 'Kansas City Chiefs',
    league: 'NFL',
    homeLambda: 26.2,
    awayLambda: 24.4,
    homeElo: 1692,
    awayElo: 1714,
    bivariateCov: 1.9,
    rho: 0,
    alpha: 0.092,
    line: 48.5,
    overOdds: 1.94,
    underOdds: 1.91,
    mlFeatures: {
      paceIndex: 1.12,
      volatilityIndex: 0.22,
      shotQualityDiff: 0.11,
      defensiveFragility: 1.06,
      restAdvantage: 0,
    },
  },
};

const ALL_MODELS: ModelType[] = [
  'bivariate-poisson-xg-elo',
  'dixon-coles',
  'negative-binomial',
  'ml-gbdt',
  'ensemble',
];

export const ModelLabView: React.FC<ModelLabViewProps> = ({
  currentBankroll,
  bankrollConfig,
  currencySymbol,
  onLogCustomBet,
}) => {
  const [sport, setSport] = useState<SportId>('soccer');
  const [homeTeam, setHomeTeam] = useState(SPORT_PRESETS.soccer.homeTeam);
  const [awayTeam, setAwayTeam] = useState(SPORT_PRESETS.soccer.awayTeam);
  const [league, setLeague] = useState(SPORT_PRESETS.soccer.league);
  const [homeLambda, setHomeLambda] = useState(SPORT_PRESETS.soccer.homeLambda);
  const [awayLambda, setAwayLambda] = useState(SPORT_PRESETS.soccer.awayLambda);
  const [homeElo, setHomeElo] = useState(SPORT_PRESETS.soccer.homeElo);
  const [awayElo, setAwayElo] = useState(SPORT_PRESETS.soccer.awayElo);
  const [bivariateCov, setBivariateCov] = useState(SPORT_PRESETS.soccer.bivariateCov);
  const [rho, setRho] = useState(SPORT_PRESETS.soccer.rho);
  const [alpha, setAlpha] = useState(SPORT_PRESETS.soccer.alpha);
  const [line, setLine] = useState(SPORT_PRESETS.soccer.line);
  const [overOdds, setOverOdds] = useState(SPORT_PRESETS.soccer.overOdds);
  const [underOdds, setUnderOdds] = useState(SPORT_PRESETS.soccer.underOdds);
  const [mlFeatures, setMlFeatures] = useState<MatchMlFeatures>(
    SPORT_PRESETS.soccer.mlFeatures
  );
  const [serverVerified, setServerVerified] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  const applyPreset = (nextSport: SportId) => {
    const p = SPORT_PRESETS[nextSport];
    setSport(nextSport);
    setHomeTeam(p.homeTeam);
    setAwayTeam(p.awayTeam);
    setLeague(p.league);
    setHomeLambda(p.homeLambda);
    setAwayLambda(p.awayLambda);
    setHomeElo(p.homeElo);
    setAwayElo(p.awayElo);
    setBivariateCov(p.bivariateCov);
    setRho(p.rho);
    setAlpha(p.alpha);
    setLine(p.line);
    setOverOdds(p.overOdds);
    setUnderOdds(p.underOdds);
    setMlFeatures(p.mlFeatures);
    setServerVerified(null);
  };

  const modelRows = useMemo(() => {
    const impOver = 1 / Math.max(1.01, overOdds);
    const impUnder = 1 / Math.max(1.01, underOdds);

    return ALL_MODELS.map((m) => {
      const dist = computeTotalsDistribution(
        homeLambda,
        awayLambda,
        line,
        rho,
        m,
        sport,
        alpha,
        mlFeatures,
        bivariateCov,
        homeElo,
        awayElo
      );
      const loseOver = Math.max(0, 1 - dist.overProb - dist.pushProb);
      const loseUnder = Math.max(0, 1 - dist.underProb - dist.pushProb);
      const overEv = dist.overProb * (overOdds - 1) - loseOver;
      const underEv = dist.underProb * (underOdds - 1) - loseUnder;
      const bestSide: BetSide = overEv >= underEv ? 'over' : 'under';
      const bestEv = Math.max(overEv, underEv);
      const bestOdds = bestSide === 'over' ? overOdds : underOdds;
      const bestProb = bestSide === 'over' ? dist.overProb : dist.underProb;
      const bestEdge = bestProb - (bestSide === 'over' ? impOver : impUnder);
      const kellyFull = bestEv > 0 && bestOdds > 1 ? bestEv / (bestOdds - 1) : 0;
      const { stake } = calculateStake(bestEv, kellyFull, currentBankroll, bankrollConfig);

      return {
        modelType: m,
        name: MODEL_META[m].shortName,
        fullName: MODEL_META[m].name,
        overProb: dist.overProb,
        underProb: dist.underProb,
        pushProb: dist.pushProb,
        overEv,
        underEv,
        bestSide,
        bestEv,
        bestOdds,
        bestProb,
        bestEdge,
        recommendedStake: stake,
        expectedTotal: dist.expectedTotal,
      };
    });
  }, [
    homeLambda,
    awayLambda,
    homeElo,
    awayElo,
    bivariateCov,
    line,
    rho,
    alpha,
    sport,
    overOdds,
    underOdds,
    mlFeatures,
    currentBankroll,
    bankrollConfig,
  ]);

  const primaryBaseline = modelRows.find((r) => r.modelType === 'bivariate-poisson-xg-elo')!;
  const ensembleRow = modelRows.find((r) => r.modelType === 'ensemble')!;
  const overround = (1 / Math.max(1.01, overOdds) + 1 / Math.max(1.01, underOdds) - 1) * 100;
  const sportInfo = SPORT_META[sport];
  const isHighScoring = sport === 'nba' || sport === 'football';
  const lambdaMin = sport === 'nba' ? 85 : sport === 'football' ? 10 : 0.3;
  const lambdaMax = sport === 'nba' ? 138 : sport === 'football' ? 42 : 6;
  const lambdaStep = isHighScoring ? 0.5 : 0.05;

  const chartData = modelRows.map((r) => ({
    modelo: r.name,
    'Más (%)': Number((r.overProb * 100).toFixed(2)),
    'Menos (%)': Number((r.underProb * 100).toFixed(2)),
  }));

  const handleServerEvaluate = async () => {
    setVerifying(true);
    setServerVerified(null);
    try {
      const res = await fetch('/api/model/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport,
          homeLambda,
          awayLambda,
          homeElo,
          awayElo,
          bivariateCov,
          rho,
          alpha,
          line,
          overOdds,
          underOdds,
          mlFeatures,
        }),
      });
      if (!res.ok) throw new Error('Error de validación');
      const data = await res.json();
      const biv = data.results?.find(
        (r: { modelType: string }) => r.modelType === 'bivariate-poisson-xg-elo'
      );
      if (biv) {
        setServerVerified(
          `Verificado en API · Poisson Bivariado xG+Elo Más ${line}: ${(biv.overProb * 100).toFixed(2)}% (EV ${biv.overEv >= 0 ? '+' : ''}${(biv.overEv * 100).toFixed(2)}%)`
        );
      }
    } catch {
      setServerVerified('No se pudo validar en servidor. Revisa los parámetros.');
    } finally {
      setVerifying(false);
    }
  };

  const handleLogPick = (row: (typeof modelRows)[number]) => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    onLogCustomBet({
      date: now.toISOString(),
      monthKey,
      sport,
      league: league.trim() || SPORT_META[sport].name,
      matchLabel: `${homeTeam.trim() || 'Local'} vs ${awayTeam.trim() || 'Visitante'}`,
      side: row.bestSide,
      line,
      bookmaker: 'Laboratorio Manual',
      odds: row.bestOdds,
      closingOdds: row.bestOdds,
      modelProb: row.bestProb,
      edge: row.bestEdge,
      ev: row.bestEv,
      stake: row.recommendedStake > 0 ? row.recommendedStake : 25,
      status: 'pending',
      pnl: 0,
      modelUsed: row.modelType,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2400);
  };

  return (
    <div className="space-y-6">
      {/* Sport Preset Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {(['soccer', 'nba', 'nhl', 'football'] as SportId[]).map((sid) => (
            <button
              key={sid}
              type="button"
              onClick={() => applyPreset(sid)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                sport === sid
                  ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
              }`}
            >
              {sid === 'soccer' ? 'Fútbol (Principal)' : SPORT_META[sid].name}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleServerEvaluate}
          disabled={verifying}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] dark:backdrop-blur-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.08] transition-colors whitespace-nowrap"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${verifying ? 'animate-spin' : ''}`} />
          <span>Validar cálculo en API</span>
        </button>
      </div>

      {serverVerified && (
        <div className="px-4 py-2.5 rounded-lg border border-[#ABF43F]/40 bg-[#ABF43F]/10 text-xs font-mono tabular-nums text-slate-900 dark:text-[#ABF43F]">
          {serverVerified}
        </div>
      )}

      {savedNotice && (
        <div className="px-4 py-2.5 rounded-lg border border-[#ABF43F]/40 bg-[#ABF43F]/10 text-xs font-medium text-slate-900 dark:text-[#ABF43F] flex items-center gap-2">
          <Check className="h-4 w-4" />
          <span>Pick registrado en tu historial de bankroll.</span>
        </div>
      )}

      {/* Main Split */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start overflow-visible">
        {/* Left: Quantitative, Elo & ML Feature Controls */}
        <div className="xl:col-span-5 border border-slate-200 rounded-xl bg-white glass-panel glass-panel-hover p-5 space-y-5">
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-white/[0.08] pb-3">
            <FlaskConical className="h-4 w-4 text-slate-900 dark:text-[#ABF43F]" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
              Parámetros Poisson Bivariado, xG, Elo y ML
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Equipo Local</span>
              <input
                type="text"
                value={homeTeam}
                onChange={(e) => setHomeTeam(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.05] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Equipo Visitante</span>
              <input
                type="text"
                value={awayTeam}
                onChange={(e) => setAwayTeam(e.target.value)}
                className="mt-1 w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.05] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              />
            </label>
          </div>

          {/* Market Line & Odds */}
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Línea Total</span>
              <input
                type="number"
                step={0.5}
                min={0.5}
                max={300}
                value={line}
                onChange={(e) => setLine(Math.max(0.5, Number(e.target.value)))}
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.05] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Cuota Más</span>
              <input
                type="number"
                step={0.02}
                min={1.05}
                max={20}
                value={overOdds}
                onChange={(e) => setOverOdds(Math.max(1.05, Number(e.target.value)))}
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.05] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              />
            </label>
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Cuota Menos</span>
              <input
                type="number"
                step={0.02}
                min={1.05}
                max={20}
                value={underOdds}
                onChange={(e) => setUnderOdds(Math.max(1.05, Number(e.target.value)))}
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.05] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              />
            </label>
          </div>

          {/* Core Bivariate Poisson + xG + Elo Rates */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Poisson Bivariado + {sportInfo.rateLabel} + Elo
            </p>
            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">
                    {sportInfo.rateLabel} Local
                  </span>
                  <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    {homeLambda.toFixed(isHighScoring ? 1 : 2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={lambdaMin}
                  max={lambdaMax}
                  step={lambdaStep}
                  value={homeLambda}
                  onChange={(e) => setHomeLambda(Number(e.target.value))}
                  className="w-full accent-[#ABF43F]"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">
                    {sportInfo.rateLabel} Visitante
                  </span>
                  <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    {awayLambda.toFixed(isHighScoring ? 1 : 2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={lambdaMin}
                  max={lambdaMax}
                  step={lambdaStep}
                  value={awayLambda}
                  onChange={(e) => setAwayLambda(Number(e.target.value))}
                  className="w-full accent-[#ABF43F]"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Elo Local</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    {homeElo}
                  </span>
                </div>
                <input
                  type="range"
                  min={1350}
                  max={2150}
                  step={5}
                  value={homeElo}
                  onChange={(e) => setHomeElo(Number(e.target.value))}
                  className="w-full accent-[#ABF43F]"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Elo Visitante</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                    {awayElo}
                  </span>
                </div>
                <input
                  type="range"
                  min={1350}
                  max={2150}
                  step={5}
                  value={awayElo}
                  onChange={(e) => setAwayElo(Number(e.target.value))}
                  className="w-full accent-[#ABF43F]"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Covarianza λ₃ (Biv.)</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-[#ABF43F]">
                    {bivariateCov.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={isHighScoring ? 5 : 0.6}
                  step={isHighScoring ? 0.1 : 0.01}
                  value={bivariateCov}
                  onChange={(e) => setBivariateCov(Number(e.target.value))}
                  className="w-full accent-[#ABF43F]"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Sobredispersión α (NB)</span>
                  <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-[#3FF4E5]">
                    {alpha.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0.01}
                  max={0.45}
                  step={0.01}
                  value={alpha}
                  onChange={(e) => setAlpha(Number(e.target.value))}
                  className="w-full accent-[#3FF4E5]"
                />
              </label>
            </div>
          </div>

          {/* ML Gradient Boosting Features */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-white/[0.08]">
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Variables del Modelo ML (Gradient Boosting) y Dixon-Coles
            </p>
            <div className="grid grid-cols-2 gap-4">
              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Índice de Ritmo</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-[#3FF4E5]">
                    {mlFeatures.paceIndex.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.8}
                  max={1.3}
                  step={0.02}
                  value={mlFeatures.paceIndex}
                  onChange={(e) =>
                    setMlFeatures({ ...mlFeatures, paceIndex: Number(e.target.value) })
                  }
                  className="w-full accent-[#3FF4E5]"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Fragilidad Defensiva</span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-[#3FF4E5]">
                    {mlFeatures.defensiveFragility.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.8}
                  max={1.25}
                  step={0.02}
                  value={mlFeatures.defensiveFragility}
                  onChange={(e) =>
                    setMlFeatures({ ...mlFeatures, defensiveFragility: Number(e.target.value) })
                  }
                  className="w-full accent-[#3FF4E5]"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Correlación ρ (DC)</span>
                  <span
                    className={`font-mono tabular-nums ${
                      rho < 0 ? 'text-[#FF3B4B]' : 'text-slate-900 dark:text-[#3FF4E5]'
                    }`}
                  >
                    {rho.toFixed(3)}
                  </span>
                </div>
                <input
                  type="range"
                  min={-0.18}
                  max={0.12}
                  step={0.005}
                  value={rho}
                  onChange={(e) => setRho(Number(e.target.value))}
                  className="w-full accent-[#3FF4E5]"
                />
              </label>

              <label className="block space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-400">Calidad xG / EPA</span>
                  <span
                    className={`font-mono tabular-nums ${
                      mlFeatures.shotQualityDiff < 0
                        ? 'text-[#FF3B4B]'
                        : 'text-slate-900 dark:text-[#ABF43F]'
                    }`}
                  >
                    {mlFeatures.shotQualityDiff >= 0 ? '+' : ''}
                    {mlFeatures.shotQualityDiff.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={-0.25}
                  max={0.25}
                  step={0.01}
                  value={mlFeatures.shotQualityDiff}
                  onChange={(e) =>
                    setMlFeatures({ ...mlFeatures, shotQualityDiff: Number(e.target.value) })
                  }
                  className="w-full accent-[#ABF43F]"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Right: Side-by-Side 5-Model Comparison */}
        <div className="xl:col-span-7 space-y-6 overflow-visible">
          {/* Summary Cards Row (Glassmorphism + Hover Scale) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-1 overflow-visible">
            <div className="rounded-xl border border-slate-200 bg-white glass-card p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Modelo Principal (Biv. xG+Elo)</p>
              <p className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-50">
                {primaryBaseline.bestSide === 'over' ? `Más de ${line}` : `Menos de ${line}`} @{' '}
                <span className="font-mono tabular-nums">
                  {primaryBaseline.bestOdds.toFixed(2)}
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white glass-card p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">EV Ensemble / Principal</p>
              <p
                className={`mt-1 font-mono tabular-nums text-base font-semibold ${
                  ensembleRow.bestEv >= 0
                    ? 'text-slate-900 dark:text-[#ABF43F]'
                    : 'text-[#FF3B4B]'
                }`}
              >
                {ensembleRow.bestEv >= 0 ? '+' : ''}
                {(ensembleRow.bestEv * 100).toFixed(2)}%{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  / {primaryBaseline.bestEv >= 0 ? '+' : ''}
                  {(primaryBaseline.bestEv * 100).toFixed(2)}%
                </span>
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white glass-card p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">ΔElo / Margen Vig</p>
              <p className="mt-1 font-mono tabular-nums text-base font-semibold text-slate-900 dark:text-slate-50">
                <span className={homeElo - awayElo < 0 ? 'text-[#FF3B4B]' : ''}>
                  {homeElo - awayElo >= 0 ? '+' : ''}
                  {homeElo - awayElo}
                </span>{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  · {overround.toFixed(2)}% vig
                </span>
              </p>
            </div>
          </div>

          {/* 5-Model Comparison Table */}
          <div className="border border-slate-200 rounded-xl bg-white glass-panel overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-white/[0.08] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Comparativa: Poisson Bivariado xG+Elo vs Dixon-Coles vs Neg. Binomial vs ML
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Línea {line}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-white/[0.04] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/[0.08]">
                  <tr>
                    <th className="text-left font-medium py-2.5 px-4">Modelo</th>
                    <th className="text-right font-medium py-2.5 px-3">P(Más)</th>
                    <th className="text-right font-medium py-2.5 px-3">P(Menos)</th>
                    <th className="text-right font-medium py-2.5 px-3">Δ vs Biv.</th>
                    <th className="text-right font-medium py-2.5 px-3">Mejor +EV</th>
                    <th className="text-right font-medium py-2.5 px-3">Stake</th>
                    <th className="text-right font-medium py-2.5 px-4">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/[0.06]">
                  {modelRows.map((r) => {
                    const deltaVsPrimary = (r.overProb - primaryBaseline.overProb) * 100;
                    return (
                      <tr
                        key={r.modelType}
                        className={
                          r.modelType === 'bivariate-poisson-xg-elo'
                            ? 'bg-[#ABF43F]/10 font-medium'
                            : r.modelType === 'ensemble'
                              ? 'bg-[#3FF4E5]/10 font-medium'
                              : 'hover:bg-slate-50 dark:hover:bg-white/[0.04]'
                        }
                      >
                        <td className="py-3 px-4 text-slate-900 dark:text-slate-100 font-medium whitespace-nowrap">
                          {r.fullName}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {(r.overProb * 100).toFixed(2)}%
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {(r.underProb * 100).toFixed(2)}%
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-mono tabular-nums ${
                            r.modelType !== 'bivariate-poisson-xg-elo' && deltaVsPrimary < 0
                              ? 'text-[#FF3B4B]'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {r.modelType === 'bivariate-poisson-xg-elo'
                            ? 'Base'
                            : `${deltaVsPrimary >= 0 ? '+' : ''}${deltaVsPrimary.toFixed(2)} pp`}
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                            r.bestEv > 0.02
                              ? 'text-slate-900 dark:text-[#ABF43F]'
                              : r.bestEv > 0
                                ? 'text-slate-800 dark:text-[#3FF4E5]'
                                : 'text-[#FF3B4B]'
                          }`}
                        >
                          {r.bestSide === 'over' ? 'Más' : 'Menos'} {r.bestEv >= 0 ? '+' : ''}
                          {(r.bestEv * 100).toFixed(2)}%
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {r.recommendedStake > 0
                            ? `${currencySymbol}${r.recommendedStake.toFixed(2)}`
                            : '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleLogPick(r)}
                            className="text-xs font-medium text-slate-900 dark:text-[#ABF43F] hover:underline whitespace-nowrap"
                          >
                            Registrar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Probability Comparison Chart */}
          <div className="border border-slate-200 rounded-xl bg-white glass-panel glass-panel-hover p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
              Distribución Comparativa de Probabilidades por Modelo
            </h3>
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis
                    dataKey="modelo"
                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tickFormatter={(v: number) => `${v}%`}
                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(val: unknown) => [`${Number(val).toFixed(2)}%`]}
                    contentStyle={{
                      backgroundColor: 'rgba(12, 12, 14, 0.92)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      color: '#F8FAFC',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  <Bar dataKey="Más (%)" fill="#ABF43F" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Menos (%)" fill="#3FF4E5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
