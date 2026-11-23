import { Check, RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { evaluateMarketLine } from '../lib/dixonColes.ts';
import { formatTime24h } from '../lib/timezone.ts';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type {
  BankrollConfig,
  BetSide,
  EvaluatedPick,
  FormResult,
  ModelType,
} from '../types/quant.ts';
import { TeamCrest } from './TeamCrest.tsx';

const FORM_BADGE_STYLES: Record<FormResult, { className: string; title: string }> = {
  G: {
    className:
      'bg-[#ABF43F]/20 text-[#ABF43F] border border-[#ABF43F]/40',
    title: 'Victoria (Ganado)',
  },
  P: {
    className:
      'bg-[#FF3B4B]/20 text-[#FF3B4B] border border-[#FF3B4B]/40',
    title: 'Derrota (Perdido)',
  },
  E: {
    className:
      'bg-[#3FF4E5]/20 text-[#3FF4E5] border border-[#3FF4E5]/40',
    title: 'Empate',
  },
};

interface PickInspectorProps {
  pick: EvaluatedPick | null;
  activeModel: ModelType;
  currentBankroll: number;
  bankrollConfig: BankrollConfig;
  currencySymbol: string;
  timeZone: string;
  tzLabel: string;
  onClose: () => void;
  onPlaceBet: (pick: EvaluatedPick, customStake: number) => void;
}

export const PickInspector: React.FC<PickInspectorProps> = ({
  pick,
  activeModel,
  currentBankroll,
  bankrollConfig,
  currencySymbol,
  timeZone,
  tzLabel,
  onClose,
  onPlaceBet,
}) => {
  const [selectedSide, setSelectedSide] = useState<BetSide>('over');
  const [selectedModel, setSelectedModel] = useState<ModelType>(activeModel);
  const [adjHomeLambda, setAdjHomeLambda] = useState<number>(1.5);
  const [adjAwayLambda, setAdjAwayLambda] = useState<number>(1.2);
  const [adjHomeElo, setAdjHomeElo] = useState<number>(1820);
  const [adjAwayElo, setAdjAwayElo] = useState<number>(1760);
  const [adjCov, setAdjCov] = useState<number>(0.15);
  const [adjRho, setAdjRho] = useState<number>(-0.068);
  const [adjAlpha, setAdjAlpha] = useState<number>(0.15);
  const [stakeInput, setStakeInput] = useState<string>('');
  const [showStressTest, setShowStressTest] = useState<boolean>(false);
  const [justPlaced, setJustPlaced] = useState<boolean>(false);

  useEffect(() => {
    if (!pick) return;
    setSelectedSide(pick.side);
    setSelectedModel(activeModel);
    setAdjHomeLambda(pick.match.homeLambda);
    setAdjAwayLambda(pick.match.awayLambda);
    setAdjHomeElo(pick.match.homeElo);
    setAdjAwayElo(pick.match.awayElo);
    setAdjCov(pick.match.bivariateCov);
    setAdjRho(pick.match.rho);
    setAdjAlpha(pick.match.alpha);
    setStakeInput(pick.recommendedStake > 0 ? pick.recommendedStake.toFixed(2) : '25.00');
    setJustPlaced(false);
  }, [pick, activeModel]);

  const evaluated = useMemo(() => {
    if (!pick) return null;
    const adjustedMatch = {
      ...pick.match,
      homeLambda: adjHomeLambda,
      awayLambda: adjAwayLambda,
      homeElo: adjHomeElo,
      awayElo: adjAwayElo,
      bivariateCov: adjCov,
      rho: adjRho,
      alpha: adjAlpha,
    };
    const [overP, underP] = evaluateMarketLine(
      adjustedMatch,
      pick.marketLine,
      selectedModel,
      currentBankroll,
      bankrollConfig
    );
    return selectedSide === 'over' ? overP : underP;
  }, [
    pick,
    adjHomeLambda,
    adjAwayLambda,
    adjHomeElo,
    adjAwayElo,
    adjCov,
    adjRho,
    adjAlpha,
    selectedModel,
    selectedSide,
    currentBankroll,
    bankrollConfig,
  ]);

  useEffect(() => {
    if (evaluated && evaluated.recommendedStake > 0) {
      setStakeInput(evaluated.recommendedStake.toFixed(2));
    }
  }, [evaluated?.recommendedStake, selectedSide, selectedModel]);

  if (!pick || !evaluated) return null;

  const sportInfo = SPORT_META[pick.match.sport];
  const sideText =
    selectedSide === 'over'
      ? `Más de ${pick.marketLine.line}`
      : `Menos de ${pick.marketLine.line}`;
  const isPositiveEv = evaluated.ev > 0;
  const maxCellProb = Math.max(...evaluated.scoreMatrix.map((c) => c.probability), 0.01);

  const homeAxis = Array.from(new Set(evaluated.scoreMatrix.map((c) => c.homeGoals))).sort(
    (a, b) => a - b
  );
  const awayAxis = Array.from(new Set(evaluated.scoreMatrix.map((c) => c.awayGoals))).sort(
    (a, b) => a - b
  );
  const cellLookup = new Map<string, number>();
  for (const c of evaluated.scoreMatrix) {
    cellLookup.set(`${c.homeGoals}-${c.awayGoals}`, c.probability);
  }

  const kickoffLabel = `${formatTime24h(pick.match.kickoffTime, timeZone)} ${tzLabel}`;

  const handleConfirmBet = () => {
    const parsedStake = Math.max(1, Number(stakeInput) || evaluated.recommendedStake || 25);
    onPlaceBet(evaluated, Math.round(parsedStake * 100) / 100);
    setJustPlaced(true);
    setTimeout(() => setJustPlaced(false), 2200);
  };

  const resetAdjustments = () => {
    setAdjHomeLambda(pick.match.homeLambda);
    setAdjAwayLambda(pick.match.awayLambda);
    setAdjHomeElo(pick.match.homeElo);
    setAdjAwayElo(pick.match.awayElo);
    setAdjCov(pick.match.bivariateCov);
    setAdjRho(pick.match.rho);
    setAdjAlpha(pick.match.alpha);
  };

  const isModified =
    Math.abs(adjHomeLambda - pick.match.homeLambda) > 0.001 ||
    Math.abs(adjAwayLambda - pick.match.awayLambda) > 0.001 ||
    adjHomeElo !== pick.match.homeElo ||
    adjAwayElo !== pick.match.awayElo ||
    Math.abs(adjCov - pick.match.bivariateCov) > 0.001 ||
    Math.abs(adjRho - pick.match.rho) > 0.001 ||
    Math.abs(adjAlpha - pick.match.alpha) > 0.001;

  const isHighScoring = pick.match.sport === 'nba' || pick.match.sport === 'football';
  const lambdaMin = pick.match.sport === 'nba' ? 85 : pick.match.sport === 'football' ? 10 : 0.3;
  const lambdaMax = pick.match.sport === 'nba' ? 138 : pick.match.sport === 'football' ? 42 : 6;
  const lambdaStep = isHighScoring ? 0.5 : 0.05;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        aria-label="Inspector cuantitativo de apuesta"
        className="relative z-10 w-full max-w-[610px] h-full bg-white dark:bg-[#0c0c0e]/90 dark:backdrop-blur-2xl border-l border-slate-200 dark:border-white/[0.1] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-200 dark:border-white/[0.08] shrink-0">
          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{sportInfo.name}</span>
              <span aria-hidden="true">·</span>
              <span>{pick.match.league}</span>
              <span aria-hidden="true">·</span>
              <span>{pick.marketLine.bookmaker}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {pick.match.status === 'live' ? (
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#FF3B4B]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B4B]" />
                    En vivo {pick.match.liveClock ?? ''}
                  </span>
                ) : (
                  kickoffLabel
                )}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2.5 min-w-0">
              <div className="flex items-center gap-1.5 shrink-0">
                <TeamCrest
                  teamName={pick.match.homeTeam}
                  sport={pick.match.sport}
                  logoUrl={pick.match.homeLogo}
                  abbr={pick.match.homeAbbr}
                  primaryColor={pick.match.homeColor}
                  size="sm"
                />
                <TeamCrest
                  teamName={pick.match.awayTeam}
                  sport={pick.match.sport}
                  logoUrl={pick.match.awayLogo}
                  abbr={pick.match.awayAbbr}
                  primaryColor={pick.match.awayColor}
                  size="sm"
                />
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50 truncate">
                {pick.match.homeTeam} vs {pick.match.awayTeam}
              </h2>
            </div>
            <p className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Elo {adjHomeElo} vs {adjAwayElo} (Δ {adjHomeElo - adjAwayElo >= 0 ? '+' : ''}
              {adjHomeElo - adjAwayElo}) · {sportInfo.rateLabel} {adjHomeLambda.toFixed(isHighScoring ? 1 : 2)} /{' '}
              {adjAwayLambda.toFixed(isHighScoring ? 1 : 2)} · λ₃ {adjCov.toFixed(2)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar inspector"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/[0.08] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Side & Model Switchers */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-white/[0.05] dark:border dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSelectedSide('over')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  selectedSide === 'over'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-[#ABF43F] dark:text-[#090909]'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Más de {pick.marketLine.line} ({pick.marketLine.overOdds.toFixed(2)})
              </button>
              <button
                type="button"
                onClick={() => setSelectedSide('under')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  selectedSide === 'under'
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-[#ABF43F] dark:text-[#090909]'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Menos de {pick.marketLine.line} ({pick.marketLine.underOdds.toFixed(2)})
              </button>
            </div>

            <select
              aria-label="Modelo activo"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value as ModelType)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#141418] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
            >
              {(Object.keys(MODEL_META) as ModelType[]).map((mKey) => (
                <option key={mKey} value={mKey}>
                  {MODEL_META[mKey].name}
                </option>
              ))}
            </select>
          </div>

          {/* Last 5 Matches Form Streak (Racha de los últimos 5 partidos) */}
          <div className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-slate-950/[0.92] dark:bg-white/[0.04] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-slate-100">
                Racha de los últimos 5 partidos
              </h3>
              <div className="flex items-center gap-2.5 text-[10px] font-mono tabular-nums text-slate-400">
                <span className="text-[#ABF43F]">G Victoria</span>
                <span className="text-[#3FF4E5]">E Empate</span>
                <span className="text-[#FF3B4B]">P Derrota</span>
              </div>
            </div>

            <div className="space-y-2.5">
              {(
                [
                  {
                    role: 'Local',
                    name: pick.match.homeTeam,
                    logo: pick.match.homeLogo,
                    abbr: pick.match.homeAbbr,
                    color: pick.match.homeColor,
                    form:
                      pick.match.homeForm && pick.match.homeForm.length > 0
                        ? pick.match.homeForm
                        : (['G', 'G', 'E', 'P', 'G'] as FormResult[]),
                  },
                  {
                    role: 'Visitante',
                    name: pick.match.awayTeam,
                    logo: pick.match.awayLogo,
                    abbr: pick.match.awayAbbr,
                    color: pick.match.awayColor,
                    form:
                      pick.match.awayForm && pick.match.awayForm.length > 0
                        ? pick.match.awayForm
                        : (['G', 'P', 'E', 'G', 'P'] as FormResult[]),
                  },
                ] as const
              ).map((team) => (
                <div
                  key={team.role}
                  className="flex items-center justify-between gap-3 py-1.5 border-t border-white/[0.06] first:border-t-0 first:pt-0"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <TeamCrest
                      teamName={team.name}
                      sport={pick.match.sport}
                      logoUrl={team.logo}
                      abbr={team.abbr}
                      primaryColor={team.color}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-100 truncate">{team.name}</p>
                      <p className="text-[10px] text-slate-400">{team.role}</p>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1.5 shrink-0"
                    aria-label={`Últimos 5 partidos de ${team.name}`}
                  >
                    {team.form.slice(-5).map((res, idx) => {
                      const badge = FORM_BADGE_STYLES[res];
                      return (
                        <span
                          key={`${team.role}-${idx}`}
                          title={badge.title}
                          className={`h-7 w-7 rounded-md font-mono text-xs font-bold flex items-center justify-center ${badge.className}`}
                        >
                          {res}
                        </span>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Primary Quantitative Metrics Strip — 4 Glassmorphism + Hover Scale Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-1 overflow-visible">
            <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Valor Esperado</p>
              <p
                className={`mt-1 font-mono tabular-nums text-lg font-semibold ${
                  evaluated.ev >= 0.025
                    ? 'text-slate-900 dark:text-[#ABF43F]'
                    : evaluated.ev > 0
                      ? 'text-slate-800 dark:text-[#3FF4E5]'
                      : 'text-[#FF3B4B]'
                }`}
              >
                {evaluated.ev >= 0 ? '+' : ''}
                {(evaluated.ev * 100).toFixed(2)}%
              </p>
            </div>
            <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Ventaja (Edge)</p>
              <p
                className={`mt-1 font-mono tabular-nums text-lg font-semibold ${
                  evaluated.edge >= 0
                    ? 'text-slate-900 dark:text-[#ABF43F]'
                    : 'text-[#FF3B4B]'
                }`}
              >
                {evaluated.edge >= 0 ? '+' : ''}
                {(evaluated.edge * 100).toFixed(2)} pp
              </p>
            </div>
            <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Cuota / Justa</p>
              <p className="mt-1 font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-50">
                {evaluated.odds.toFixed(2)}{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                  / {evaluated.fairOdds.toFixed(2)}
                </span>
              </p>
            </div>
            <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Consenso</p>
              <p className="mt-1 font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-50">
                {evaluated.consensusCount}/4{' '}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">+EV</span>
              </p>
            </div>
          </div>

          {/* Probability Visual Bar */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Probabilidad Estimada vs Implícita del Mercado ({sideText})
              </span>
              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Margen casa (Vig): {(evaluated.overround * 100).toFixed(2)}%
              </span>
            </div>

            <div className="space-y-2.5">
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 dark:text-slate-300">
                    Modelo {MODEL_META[selectedModel].shortName}
                  </span>
                  <span
                    className={`font-mono tabular-nums font-semibold ${
                      evaluated.ev >= 0
                        ? 'text-slate-900 dark:text-[#ABF43F]'
                        : 'text-[#FF3B4B]'
                    }`}
                  >
                    {(evaluated.modelProb * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-white/[0.08] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${
                      evaluated.ev >= 0 ? 'bg-[#ABF43F]' : 'bg-[#FF3B4B]'
                    }`}
                    style={{ width: `${Math.min(100, evaluated.modelProb * 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 dark:text-slate-400">
                    Mercado sin margen (Fair)
                  </span>
                  <span className="font-mono tabular-nums text-slate-700 dark:text-[#3FF4E5]">
                    {(evaluated.fairMarketProb * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#3FF4E5] transition-all duration-200"
                    style={{ width: `${Math.min(100, evaluated.fairMarketProb * 100)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-600 dark:text-slate-400">
                    Implícita en cuota ({evaluated.odds.toFixed(2)})
                  </span>
                  <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {(evaluated.impliedProb * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-slate-500 dark:bg-white/35 transition-all duration-200"
                    style={{ width: `${Math.min(100, evaluated.impliedProb * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Multi-Model Comparison Table */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Comparativa entre Modelos Predictivos ({sideText})
            </h3>
            <div className="overflow-x-auto border border-slate-200 dark:border-white/[0.08] rounded-xl dark:bg-white/[0.03]">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-white/[0.04] text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/[0.08]">
                  <tr>
                    <th className="text-left font-medium py-2.5 px-3">Modelo</th>
                    <th className="text-right font-medium py-2.5 px-3">Prob.</th>
                    <th className="text-right font-medium py-2.5 px-3">Justa</th>
                    <th className="text-right font-medium py-2.5 px-3">Edge</th>
                    <th className="text-right font-medium py-2.5 px-3">+EV</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-white/[0.06]">
                  {evaluated.modelComparisons.map((row) => (
                    <tr
                      key={row.modelType}
                      onClick={() => setSelectedModel(row.modelType)}
                      className={`cursor-pointer transition-colors ${
                        selectedModel === row.modelType
                          ? 'bg-[#ABF43F]/15 dark:bg-[#ABF43F]/[0.1]'
                          : 'hover:bg-slate-50 dark:hover:bg-white/[0.05]'
                      }`}
                    >
                      <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                        {MODEL_META[row.modelType].name}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {(row.modelProb * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {row.fairOdds.toFixed(2)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums ${
                          row.edge >= 0
                            ? 'text-slate-900 dark:text-[#ABF43F]'
                            : 'text-[#FF3B4B]'
                        }`}
                      >
                        {row.edge >= 0 ? '+' : ''}
                        {(row.edge * 100).toFixed(1)}%
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${
                          row.ev > 0.02
                            ? 'text-slate-900 dark:text-[#ABF43F]'
                            : row.ev > 0
                              ? 'text-slate-800 dark:text-[#3FF4E5]'
                              : 'text-[#FF3B4B]'
                        }`}
                      >
                        {row.ev >= 0 ? '+' : ''}
                        {(row.ev * 100).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Total Goals/Points Distribution Chart */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Distribución Esperada de {isHighScoring ? 'Puntos Totales' : 'Goles Totales'}
              </h3>
              <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                Total = {(adjHomeLambda + adjAwayLambda).toFixed(isHighScoring ? 1 : 2)}{' '}
                {sportInfo.unit}
              </span>
            </div>
            <div className="h-44 w-full border border-slate-200 dark:border-white/[0.08] rounded-xl p-3 bg-slate-50/40 dark:bg-white/[0.03]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={evaluated.totalDistribution}
                  margin={{ top: 8, right: 8, left: -22, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: '#94A3B8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
                    tick={{ fontSize: 10, fill: '#94A3B8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value: unknown) => [
                      `${(Number(value) * 100).toFixed(2)}%`,
                      'Probabilidad',
                    ]}
                    labelFormatter={(lbl) => `${lbl} ${sportInfo.unit}`}
                    contentStyle={{
                      backgroundColor: 'rgba(12, 12, 14, 0.92)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      borderRadius: '10px',
                      color: '#F8FAFC',
                      fontSize: '12px',
                      backdropFilter: 'blur(12px)',
                    }}
                  />
                  <ReferenceLine
                    x={String(Math.floor(pick.marketLine.line))}
                    stroke="#3FF4E5"
                    strokeDasharray="3 3"
                  />
                  <Bar dataKey="modelProb" radius={[3, 3, 0, 0]}>
                    {evaluated.totalDistribution.map((entry) => {
                      const isWinningBin =
                        selectedSide === 'over' ? entry.isOver : !entry.isOver && !entry.isPush;
                      return (
                        <Cell
                          key={entry.label}
                          fill={isWinningBin ? '#ABF43F' : '#FF3B4B'}
                          fillOpacity={isWinningBin ? 0.9 : 0.35}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Exact Scoreline Probability Heatmap */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                Matriz de Marcadores ({isHighScoring ? 'Bandas de Puntos' : 'Marcadores Exactos'})
              </h3>
              <span className="text-slate-500 dark:text-slate-400">Verde neón: gana {sideText}</span>
            </div>
            <div className="overflow-x-auto border border-slate-200 dark:border-white/[0.08] rounded-xl p-3 bg-slate-50/40 dark:bg-white/[0.03]">
              <div
                className="grid gap-1 text-center font-mono tabular-nums text-[11px]"
                style={{
                  gridTemplateColumns: `44px repeat(${awayAxis.length}, minmax(44px, 1fr))`,
                }}
              >
                <div className="text-[10px] text-slate-400 flex items-center justify-center">
                  L \ V
                </div>
                {awayAxis.map((a) => (
                  <div
                    key={`ah-${a}`}
                    className="py-1 font-semibold text-slate-500 dark:text-slate-400"
                  >
                    {a}
                  </div>
                ))}
                {homeAxis.map((h) => (
                  <React.Fragment key={`row-${h}`}>
                    <div className="py-1.5 font-semibold text-slate-500 dark:text-slate-400 flex items-center justify-center">
                      {h}
                    </div>
                    {awayAxis.map((a) => {
                      const prob = cellLookup.get(`${h}-${a}`) ?? 0;
                      const tot = h + a;
                      const wins =
                        selectedSide === 'over'
                          ? tot > pick.marketLine.line
                          : tot < pick.marketLine.line;
                      const intensity = Math.min(1, prob / maxCellProb);
                      return (
                        <div
                          key={`${h}-${a}`}
                          title={`${pick.match.homeTeam} ${h} - ${a} ${pick.match.awayTeam}: ${(prob * 100).toFixed(2)}%`}
                          className="py-1.5 rounded-md border border-slate-200/70 dark:border-white/[0.06] transition-colors"
                          style={{
                            backgroundColor: wins
                              ? `rgba(171, 244, 63, ${0.12 + intensity * 0.45})`
                              : `rgba(148, 163, 184, ${0.06 + intensity * 0.2})`,
                          }}
                        >
                          <span
                            className={
                              wins
                                ? 'text-slate-900 dark:text-[#ABF43F] font-medium'
                                : 'text-slate-600 dark:text-slate-400'
                            }
                          >
                            {(prob * 100).toFixed(1)}%
                          </span>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>

          {/* Interactive Parameter Stress Testing */}
          <div className="border-t border-slate-200 dark:border-white/[0.08] pt-4">
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowStressTest((prev) => !prev)}
                className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:text-slate-950 dark:hover:text-[#ABF43F] transition-colors"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>
                  {showStressTest ? 'Ocultar' : 'Ajustar'} sensibilidad ({sportInfo.rateLabel}, Elo, λ₃, ρ, α)
                </span>
              </button>
              {isModified && (
                <button
                  type="button"
                  onClick={resetAdjustments}
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                >
                  <RotateCcw className="h-3 w-3" />
                  Restaurar
                </button>
              )}
            </div>

            {showStressTest && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400">
                      {sportInfo.rateLabel} Local
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {adjHomeLambda.toFixed(isHighScoring ? 1 : 2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={lambdaMin}
                    max={lambdaMax}
                    step={lambdaStep}
                    value={adjHomeLambda}
                    onChange={(e) => setAdjHomeLambda(Number(e.target.value))}
                    className="w-full accent-[#ABF43F]"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400">
                      {sportInfo.rateLabel} Visitante
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {adjAwayLambda.toFixed(isHighScoring ? 1 : 2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={lambdaMin}
                    max={lambdaMax}
                    step={lambdaStep}
                    value={adjAwayLambda}
                    onChange={(e) => setAdjAwayLambda(Number(e.target.value))}
                    className="w-full accent-[#ABF43F]"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400">Elo Local</span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {adjHomeElo}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1350}
                    max={2150}
                    step={5}
                    value={adjHomeElo}
                    onChange={(e) => setAdjHomeElo(Number(e.target.value))}
                    className="w-full accent-[#ABF43F]"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400">Elo Visitante</span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {adjAwayElo}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1350}
                    max={2150}
                    step={5}
                    value={adjAwayElo}
                    onChange={(e) => setAdjAwayElo(Number(e.target.value))}
                    className="w-full accent-[#ABF43F]"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400">
                      Covarianza Bivariada (λ₃)
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-[#ABF43F]">
                      {adjCov.toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={isHighScoring ? 5 : 0.6}
                    step={isHighScoring ? 0.1 : 0.01}
                    value={adjCov}
                    onChange={(e) => setAdjCov(Number(e.target.value))}
                    className="w-full accent-[#ABF43F]"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400">
                      Sobredispersión NB (α)
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-[#3FF4E5]">
                      {adjAlpha.toFixed(3)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.01}
                    max={0.45}
                    step={0.01}
                    value={adjAlpha}
                    onChange={(e) => setAdjAlpha(Number(e.target.value))}
                    className="w-full accent-[#3FF4E5]"
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        {/* Sticky Execution Footer */}
        <div className="px-6 py-4 border-t border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.03] shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Stake sugerido ({bankrollConfig.strategy}) · Kelly completo:{' '}
                <span className="font-mono tabular-nums text-slate-800 dark:text-slate-200">
                  {(evaluated.kellyFull * 100).toFixed(2)}%
                </span>
              </p>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Importe ({currencySymbol}):
                </span>
                <input
                  type="number"
                  min={1}
                  step={0.5}
                  value={stakeInput}
                  onChange={(e) => setStakeInput(e.target.value)}
                  className="w-28 px-2.5 py-1.5 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-white/[0.12] bg-white dark:bg-white/[0.05] text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
                />
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  {currentBankroll > 0
                    ? `${(((Number(stakeInput) || 0) / currentBankroll) * 100).toFixed(2)}% bank`
                    : ''}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleConfirmBet}
              className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F] ${
                justPlaced
                  ? 'bg-[#ABF43F] text-[#090909]'
                  : isPositiveEv
                    ? 'bg-[#ABF43F] hover:bg-[#bdf762] text-[#090909]'
                    : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-slate-200 text-white dark:text-slate-950'
              }`}
            >
              {justPlaced ? (
                <>
                  <Check className="h-4 w-4" />
                  <span>Apuesta registrada</span>
                </>
              ) : (
                <span>Registrar apuesta</span>
              )}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};
