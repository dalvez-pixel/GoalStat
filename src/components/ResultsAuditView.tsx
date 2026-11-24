import {
  Check,
  ChevronDown,
  ChevronUp,
  Minus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { getChartTheme } from '../lib/chartTheme.ts';
import { computeSoccerDerivedMarkets, evaluateMarketLine } from '../lib/dixonColes.ts';
import { DEFAULT_BANKROLL_CONFIG } from '../lib/seedHistory.ts';
import { formatTime24h } from '../lib/timezone.ts';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type {
  BetRecord,
  FinishedAuditMatch,
  LiveMatch,
  ModelType,
  SportId,
} from '../types/quant.ts';
import { TeamCrest } from './TeamCrest.tsx';

interface ResultsAuditViewProps {
  theme: 'dark' | 'light';
  bets: BetRecord[];
  activeModel: ModelType;
  onChangeModel: (model: ModelType) => void;
  sportFilter: SportId | 'all';
  onChangeSportFilter: (sport: SportId | 'all') => void;
  timeZone: string;
  tzLabel: string;
}

type AuditMarketMode = 'totals' | '1x2' | 'btts' | 'asian-handicap';
type OutcomeStatus = 'won' | 'lost' | 'void';
type OutcomeFilter = 'all' | OutcomeStatus;
type PeriodFilter = 'all' | 'today' | 'yesterday' | 'older';

interface ModelPickEvaluation {
  modelType: ModelType;
  marketLabel: string;
  odds: number;
  fairOdds: number;
  modelProb: number;
  ev: number;
  edge: number;
  consensusCount: number;
  outcome: OutcomeStatus;
  unitPnl: number; // Simulated at 1 unit flat stake
}

interface EvaluatedAuditRow {
  match: FinishedAuditMatch;
  dayBucket: Exclude<PeriodFilter, 'all'>;
  byModel: Record<ModelType, ModelPickEvaluation>;
  activeEval: ModelPickEvaluation;
  wasBetByUser: boolean;
}

const ALL_MODELS: ModelType[] = [
  'bivariate-poisson-xg-elo',
  'ensemble',
  'dixon-coles',
  'negative-binomial',
  'ml-gbdt',
];

const MARKET_MODES: Array<{ id: AuditMarketMode; label: string; soccerOnly?: boolean }> = [
  { id: 'totals', label: 'Totales O/U' },
  { id: '1x2', label: 'Fútbol 1X2', soccerOnly: true },
  { id: 'btts', label: 'Ambos Marcan', soccerOnly: true },
  { id: 'asian-handicap', label: 'Hándicap Asiático', soccerOnly: true },
];

const SPORT_FILTERS: Array<{ id: SportId | 'all'; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'soccer', label: 'Fútbol' },
  { id: 'nba', label: 'NBA' },
  { id: 'nhl', label: 'NHL' },
  { id: 'football', label: 'NFL / NCAAF' },
];

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getYmdInTimeZone(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function settleSelection(
  marketMode: AuditMarketMode,
  selectionKey: string,
  line: number,
  h: number,
  a: number
): OutcomeStatus {
  const total = h + a;
  if (marketMode === 'totals') {
    if (Math.abs(total - line) < 1e-6) return 'void';
    if (selectionKey === 'over') return total > line ? 'won' : 'lost';
    return total < line ? 'won' : 'lost';
  }
  if (marketMode === 'btts') {
    const both = h >= 1 && a >= 1;
    if (selectionKey === 'btts_yes') return both ? 'won' : 'lost';
    return !both ? 'won' : 'lost';
  }
  if (marketMode === '1x2') {
    if (selectionKey === 'home') return h > a ? 'won' : 'lost';
    if (selectionKey === 'draw') return h === a ? 'won' : 'lost';
    return a > h ? 'won' : 'lost';
  }
  // Asian Handicap
  const diff = selectionKey === 'ah_home' ? h - a + line : a - h + line;
  if (Math.abs(diff) < 1e-6) return 'void';
  return diff > 0 ? 'won' : 'lost';
}

function toLiveMatchAdapter(m: FinishedAuditMatch): LiveMatch {
  return {
    id: m.id,
    sport: m.sport,
    league: m.league,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    homeLogo: m.homeLogo,
    awayLogo: m.awayLogo,
    homeAbbr: m.homeAbbr,
    awayAbbr: m.awayAbbr,
    homeColor: m.homeColor,
    awayColor: m.awayColor,
    kickoffTime: m.kickoffTime,
    status: 'prematch',
    homeLambda: m.homeLambda,
    awayLambda: m.awayLambda,
    homeElo: m.homeElo,
    awayElo: m.awayElo,
    bivariateCov: m.bivariateCov,
    rho: m.rho,
    alpha: m.alpha,
    mlFeatures: m.mlFeatures,
    homeXgAvg: m.homeLambda,
    awayXgAvg: m.awayLambda,
    lines: [m.marketLine],
    updatedAt: m.kickoffTime,
    source: 'espn-live',
  };
}

export const ResultsAuditView: React.FC<ResultsAuditViewProps> = ({
  theme,
  bets,
  activeModel,
  onChangeModel,
  sportFilter,
  onChangeSportFilter,
  timeZone,
  tzLabel,
}) => {
  const chartTheme = useMemo(() => getChartTheme(theme), [theme]);

  const [finishedMatches, setFinishedMatches] = useState<FinishedAuditMatch[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  // Filters
  const [marketMode, setMarketMode] = useState<AuditMarketMode>('totals');
  const [leagueFilter, setLeagueFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>('all');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [onlyPositiveEv, setOnlyPositiveEv] = useState<boolean>(false);
  const [minConsensus, setMinConsensus] = useState<number>(0);
  const [onlyUserBets, setOnlyUserBets] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedMatchId, setExpandedMatchId] = useState<string | null>(null);

  const fetchResults = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = forceRefresh ? '/api/results?sport=all&refresh=1' : '/api/results?sport=all';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Error al obtener resultados oficiales');
      const data = await res.json();
      setFinishedMatches(Array.isArray(data.matches) ? data.matches : []);
      setUpdatedAt(data.updatedAt ?? new Date().toISOString());
    } catch {
      setError('No se pudieron cargar los resultados oficiales desde ESPN.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults(false);
  }, [fetchResults]);

  // Reset soccer-only market mode and league filter whenever sport changes externally (e.g. mobile Liquid Glass bar)
  useEffect(() => {
    setLeagueFilter('all');
    if (sportFilter !== 'soccer' && sportFilter !== 'all') {
      setMarketMode('totals');
    }
  }, [sportFilter]);

  // If user selects a soccer-only derived market, restrict sport filter cleanly to soccer
  const handleSelectMarketMode = (next: AuditMarketMode) => {
    setMarketMode(next);
    if (next !== 'totals' && sportFilter !== 'soccer') {
      onChangeSportFilter('soccer');
      setLeagueFilter('all');
    }
  };

  // Pre-compute normalized bet match labels for fast cross-referencing ("Solo apostados")
  const userBetSignatures = useMemo(() => {
    return bets.map((b) => ({
      sport: b.sport,
      norm: normalizeName(b.matchLabel),
    }));
  }, [bets]);

  // Evaluate ALL finished matches across ALL 5 models for the active market mode
  const evaluatedRows = useMemo<EvaluatedAuditRow[]>(() => {
    const todayYmd = getYmdInTimeZone(new Date(), timeZone);
    const yesterdayYmd = getYmdInTimeZone(
      new Date(Date.now() - 24 * 60 * 60 * 1000),
      timeZone
    );

    const eligibleMatches =
      marketMode === 'totals'
        ? finishedMatches
        : finishedMatches.filter((m) => m.sport === 'soccer');

    return eligibleMatches.map((match) => {
      const adapter = toLiveMatchAdapter(match);
      const matchYmd = getYmdInTimeZone(new Date(match.kickoffTime), timeZone);
      const dayBucket: Exclude<PeriodFilter, 'all'> =
        matchYmd === todayYmd
          ? 'today'
          : matchYmd === yesterdayYmd
            ? 'yesterday'
            : 'older';

      const byModel = {} as Record<ModelType, ModelPickEvaluation>;

      if (marketMode === 'totals') {
        for (const mType of ALL_MODELS) {
          const [overPick, underPick] = evaluateMarketLine(
            adapter,
            match.marketLine,
            mType,
            1000,
            DEFAULT_BANKROLL_CONFIG
          );
          const best = overPick.ev >= underPick.ev ? overPick : underPick;
          const outcome = settleSelection(
            'totals',
            best.side,
            match.marketLine.line,
            match.homeScore,
            match.awayScore
          );
          const unitPnl =
            outcome === 'won' ? best.odds - 1 : outcome === 'lost' ? -1 : 0;

          byModel[mType] = {
            modelType: mType,
            marketLabel:
              best.side === 'over'
                ? `Más de ${match.marketLine.line}`
                : `Menos de ${match.marketLine.line}`,
            odds: best.odds,
            fairOdds: best.fairOdds,
            modelProb: best.modelProb,
            ev: best.ev,
            edge: best.edge,
            consensusCount: best.consensusCount,
            outcome,
            unitPnl,
          };
        }
      } else {
        // Evaluate Soccer derived market (1x2, btts, asian-handicap) across all 5 models
        const baseModelBestKey: Record<string, number> = {};
        const perModelOptions = {} as Record<
          ModelType,
          {
            selectionKey: string;
            label: string;
            line: number;
            odds: number;
            fairOdds: number;
            modelProb: number;
            ev: number;
            edge: number;
          }
        >;

        for (const mType of ALL_MODELS) {
          const derived = computeSoccerDerivedMarkets(
            adapter,
            mType,
            1000,
            DEFAULT_BANKROLL_CONFIG
          );
          const opts =
            marketMode === '1x2'
              ? derived.oneXTwo
              : marketMode === 'btts'
                ? derived.btts
                : derived.asianHandicap.options;
          const bestOpt = [...opts].sort((a, b) => b.ev - a.ev)[0];
          perModelOptions[mType] = {
            selectionKey: bestOpt.selectionKey,
            label: bestOpt.shortLabel,
            line: bestOpt.line,
            odds: bestOpt.odds,
            fairOdds: bestOpt.fairOdds,
            modelProb: bestOpt.modelProb,
            ev: bestOpt.ev,
            edge: bestOpt.edge,
          };
          if (mType !== 'ensemble' && bestOpt.ev > 0) {
            baseModelBestKey[bestOpt.selectionKey] =
              (baseModelBestKey[bestOpt.selectionKey] ?? 0) + 1;
          }
        }

        for (const mType of ALL_MODELS) {
          const opt = perModelOptions[mType];
          const outcome = settleSelection(
            marketMode,
            opt.selectionKey,
            opt.line,
            match.homeScore,
            match.awayScore
          );
          const unitPnl =
            outcome === 'won' ? opt.odds - 1 : outcome === 'lost' ? -1 : 0;

          byModel[mType] = {
            modelType: mType,
            marketLabel: opt.label,
            odds: opt.odds,
            fairOdds: opt.fairOdds,
            modelProb: opt.modelProb,
            ev: opt.ev,
            edge: opt.edge,
            consensusCount: baseModelBestKey[opt.selectionKey] ?? 0,
            outcome,
            unitPnl,
          };
        }
      }

      const normHome = normalizeName(match.homeTeam);
      const normAway = normalizeName(match.awayTeam);
      const wasBetByUser = userBetSignatures.some(
        (sig) =>
          sig.sport === match.sport &&
          (sig.norm.includes(normHome) || sig.norm.includes(normAway))
      );

      return {
        match,
        dayBucket,
        byModel,
        activeEval: byModel[activeModel],
        wasBetByUser,
      };
    });
  }, [finishedMatches, marketMode, activeModel, timeZone, userBetSignatures]);

  // Available leagues for the selected sport
  const availableLeagues = useMemo(() => {
    const set = new Set<string>();
    for (const r of evaluatedRows) {
      if (sportFilter !== 'all' && r.match.sport !== sportFilter) continue;
      set.add(r.match.league);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [evaluatedRows, sportFilter]);

  useEffect(() => {
    if (leagueFilter !== 'all' && !availableLeagues.includes(leagueFilter)) {
      setLeagueFilter('all');
    }
  }, [availableLeagues, leagueFilter]);

  // Base scope filtered by sport, league, period, search & user-bet (shared across all 5 models for fair benchmark comparison)
  const baseScopedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return evaluatedRows.filter((row) => {
      if (sportFilter !== 'all' && row.match.sport !== sportFilter) return false;
      if (leagueFilter !== 'all' && row.match.league !== leagueFilter) return false;
      if (periodFilter !== 'all' && row.dayBucket !== periodFilter) return false;
      if (onlyUserBets && !row.wasBetByUser) return false;
      if (q) {
        const hay =
          `${row.match.homeTeam} ${row.match.awayTeam} ${row.match.league} ${row.match.marketLine.bookmaker}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [evaluatedRows, sportFilter, leagueFilter, periodFilter, onlyUserBets, searchQuery]);

  // Rows filtered additionally by active model's +EV, Consensus, and Outcome
  const filteredRows = useMemo(() => {
    return baseScopedRows.filter((row) => {
      const ev = row.activeEval;
      if (onlyPositiveEv && ev.ev <= 0.005) return false;
      if (minConsensus > 0 && ev.consensusCount < minConsensus) return false;
      if (outcomeFilter !== 'all' && ev.outcome !== outcomeFilter) return false;
      return true;
    });
  }, [baseScopedRows, onlyPositiveEv, minConsensus, outcomeFilter]);

  // Dynamic KPIs for the active filtered selection
  const kpis = useMemo(() => {
    const decided = filteredRows.filter((r) => r.activeEval.outcome !== 'void');
    const won = decided.filter((r) => r.activeEval.outcome === 'won');
    const lost = decided.filter((r) => r.activeEval.outcome === 'lost');
    const voids = filteredRows.length - decided.length;

    const netUnits = filteredRows.reduce((acc, r) => acc + r.activeEval.unitPnl, 0);
    const yieldPct = decided.length > 0 ? (netUnits / decided.length) * 100 : 0;
    const winRate = decided.length > 0 ? (won.length / decided.length) * 100 : 0;
    const expectedWinRate =
      decided.length > 0
        ? (decided.reduce((acc, r) => acc + r.activeEval.modelProb, 0) / decided.length) * 100
        : 0;
    const avgEv =
      filteredRows.length > 0
        ? (filteredRows.reduce((acc, r) => acc + r.activeEval.ev, 0) / filteredRows.length) * 100
        : 0;
    const brierScore =
      decided.length > 0
        ? decided.reduce((acc, r) => {
            const y = r.activeEval.outcome === 'won' ? 1 : 0;
            return acc + Math.pow(r.activeEval.modelProb - y, 2);
          }, 0) / decided.length
        : 0;

    return {
      total: filteredRows.length,
      won: won.length,
      lost: lost.length,
      voids,
      netUnits,
      yieldPct,
      winRate,
      expectedWinRate,
      avgEv,
      brierScore,
    };
  }, [filteredRows]);

  // 5-Model Side-by-Side Benchmark over the same baseScopedRows (respecting +EV & Consensus toggles)
  const modelBenchmark = useMemo(() => {
    return ALL_MODELS.map((mType) => {
      const qualifying = baseScopedRows.filter((row) => {
        const ev = row.byModel[mType];
        if (onlyPositiveEv && ev.ev <= 0.005) return false;
        if (minConsensus > 0 && ev.consensusCount < minConsensus) return false;
        return true;
      });
      const decided = qualifying.filter((r) => r.byModel[mType].outcome !== 'void');
      const won = decided.filter((r) => r.byModel[mType].outcome === 'won');
      const units = qualifying.reduce((acc, r) => acc + r.byModel[mType].unitPnl, 0);
      const yieldPct = decided.length > 0 ? (units / decided.length) * 100 : 0;
      const winRate = decided.length > 0 ? (won.length / decided.length) * 100 : 0;

      return {
        modelType: mType,
        shortName: MODEL_META[mType].shortName,
        name: MODEL_META[mType].name,
        picks: qualifying.length,
        won: won.length,
        decided: decided.length,
        units: Math.round(units * 100) / 100,
        yieldPct: Math.round(yieldPct * 100) / 100,
        winRate: Math.round(winRate * 10) / 10,
      };
    });
  }, [baseScopedRows, onlyPositiveEv, minConsensus]);

  const leadingModel = useMemo(() => {
    const withPicks = modelBenchmark.filter((m) => m.decided > 0);
    if (withPicks.length === 0) return null;
    return [...withPicks].sort((a, b) => b.yieldPct - a.yieldPct)[0];
  }, [modelBenchmark]);

  const resetAllFilters = () => {
    setMarketMode('totals');
    onChangeSportFilter('all');
    setLeagueFilter('all');
    setOutcomeFilter('all');
    setPeriodFilter('all');
    setOnlyPositiveEv(false);
    setMinConsensus(0);
    setOnlyUserBets(false);
    setSearchQuery('');
  };

  return (
    <div className="space-y-6 overflow-visible">
      {/* Top Row: Model Switcher + Market Mode + Refresh */}
      <section className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Model Selector */}
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white/60 dark:bg-white/[0.04] border border-slate-900/[0.08] dark:border-white/[0.08] backdrop-blur-md w-fit">
            {ALL_MODELS.map((mKey) => (
              <button
                key={mKey}
                type="button"
                onClick={() => onChangeModel(mKey)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activeModel === mKey
                    ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {MODEL_META[mKey].shortName}
              </button>
            ))}
          </div>

          {/* Market Selector */}
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white/60 dark:bg-white/[0.04] border border-slate-900/[0.08] dark:border-white/[0.08] backdrop-blur-md w-fit">
            {MARKET_MODES.map((mm) => (
              <button
                key={mm.id}
                type="button"
                onClick={() => handleSelectMarketMode(mm.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  marketMode === mm.id
                    ? 'bg-slate-900 text-white dark:bg-[#3FF4E5] dark:text-[#090909]'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {mm.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 self-start xl:self-center">
          {updatedAt && (
            <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
              Act. {formatTime24h(updatedAt, timeZone, true)} {tzLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => fetchResults(true)}
            disabled={loading}
            className="glass-card inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-xl text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar resultados</span>
          </button>
        </div>
      </section>

      {/* Dynamic 4-Card KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 py-1 overflow-visible">
        <div className="glass-card rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Acierto del Modelo ({MODEL_META[activeModel].shortName})
          </p>
          <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {kpis.winRate.toFixed(1)}%{' '}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              ({kpis.won}G - {kpis.lost}P{kpis.voids > 0 ? ` - ${kpis.voids}N` : ''})
            </span>
          </p>
          <p className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Esperado modelo: {kpis.expectedWinRate.toFixed(1)}% · {kpis.total} partidos
          </p>
        </div>

        <div className="glass-card rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Balance Simulado (1u plano) y Yield
          </p>
          <p
            className={`mt-1.5 font-mono tabular-nums text-2xl font-semibold ${
              kpis.netUnits >= 0
                ? 'text-slate-900 dark:text-[#ABF43F]'
                : 'text-[#FF3B4B]'
            }`}
          >
            {kpis.netUnits >= 0 ? '+' : ''}
            {kpis.netUnits.toFixed(2)} u
          </p>
          <p className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Yield:{' '}
            <span
              className={
                kpis.yieldPct >= 0
                  ? 'text-slate-900 dark:text-[#ABF43F] font-semibold'
                  : 'text-[#FF3B4B] font-semibold'
              }
            >
              {kpis.yieldPct >= 0 ? '+' : ''}
              {kpis.yieldPct.toFixed(2)}%
            </span>
          </p>
        </div>

        <div className="glass-card rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Calibración (Brier Score) y EV Medio
          </p>
          <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {kpis.brierScore > 0 ? kpis.brierScore.toFixed(3) : '—'}
          </p>
          <p className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            EV proyectado:{' '}
            <span className={kpis.avgEv < 0 ? 'text-[#FF3B4B]' : 'text-slate-800 dark:text-[#3FF4E5]'}>
              {kpis.avgEv >= 0 ? '+' : ''}
              {kpis.avgEv.toFixed(2)}%
            </span>
          </p>
        </div>

        <div className="glass-card rounded-xl p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Mejor Modelo en este Filtro
          </p>
          {leadingModel ? (
            <>
              <p className="mt-1.5 text-lg font-semibold text-slate-900 dark:text-slate-50 truncate">
                {leadingModel.shortName}
              </p>
              <p className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span
                  className={
                    leadingModel.yieldPct >= 0
                      ? 'text-slate-900 dark:text-[#ABF43F] font-semibold'
                      : 'text-[#FF3B4B] font-semibold'
                  }
                >
                  {leadingModel.yieldPct >= 0 ? '+' : ''}
                  {leadingModel.yieldPct.toFixed(2)}% yield
                </span>{' '}
                · {leadingModel.winRate.toFixed(1)}% acierto
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Sin muestra suficiente</p>
          )}
        </div>
      </section>

      {/* Side-by-Side 5-Model Yield Comparison Chart (Adaptive Light/Dark) */}
      {baseScopedRows.length > 0 && (
        <section className="glass-panel glass-panel-hover rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Comparativa de Yield (%) entre los 5 Modelos sobre Partidos Finalizados
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Haz clic en cualquier modelo para inspeccionar sus aciertos y fallos partido a partido
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono tabular-nums">
              {modelBenchmark.map((mb) => (
                <button
                  key={mb.modelType}
                  type="button"
                  onClick={() => onChangeModel(mb.modelType)}
                  className={`px-2 py-1 rounded-md border transition-colors ${
                    activeModel === mb.modelType
                      ? 'border-[#ABF43F] bg-[#ABF43F]/20 text-slate-950 dark:text-[#ABF43F] font-semibold'
                      : 'border-slate-900/[0.08] dark:border-white/[0.08] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {mb.shortName}: {mb.yieldPct >= 0 ? '+' : ''}
                  {mb.yieldPct.toFixed(1)}%
                </button>
              ))}
            </div>
          </div>

          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={modelBenchmark}
                margin={{ top: 8, right: 12, left: -14, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.gridStroke} />
                <XAxis
                  dataKey="shortName"
                  tick={{ fontSize: 11, fill: chartTheme.axisTickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fontSize: 11, fill: chartTheme.axisTickFill }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine y={0} stroke={chartTheme.axisTickFill} strokeOpacity={0.35} />
                <Tooltip
                  cursor={{ fill: chartTheme.cursorFill }}
                  formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, 'Yield (1u)']}
                  contentStyle={chartTheme.tooltipContentStyle}
                  labelStyle={chartTheme.tooltipLabelStyle}
                  itemStyle={chartTheme.tooltipItemStyle}
                />
                <Bar
                  dataKey="yieldPct"
                  radius={[4, 4, 0, 0]}
                  onClick={(barData) => {
                    const mType = (barData as { modelType?: ModelType })?.modelType;
                    if (mType) onChangeModel(mType);
                  }}
                  className="cursor-pointer"
                >
                  {modelBenchmark.map((entry) => (
                    <Cell
                      key={entry.modelType}
                      fill={
                        entry.yieldPct < 0
                          ? '#FF3B4B'
                          : entry.modelType === activeModel
                            ? '#ABF43F'
                            : '#3FF4E5'
                      }
                      fillOpacity={entry.modelType === activeModel ? 0.95 : 0.65}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Multi-Facet Filter Toolbar */}
      <section className="glass-panel rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Sport Filter */}
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white/60 dark:bg-white/[0.04] border border-slate-900/[0.08] dark:border-white/[0.08] backdrop-blur-md">
            {SPORT_FILTERS.map((sf) => {
              const disabled = marketMode !== 'totals' && sf.id !== 'soccer';
              return (
                <button
                  key={sf.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChangeSportFilter(sf.id);
                    setLeagueFilter('all');
                  }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap disabled:opacity-35 disabled:cursor-not-allowed ${
                    sportFilter === sf.id
                      ? 'bg-slate-900 text-white dark:bg-white/[0.16] dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {sf.label}
                </button>
              );
            })}
          </div>

          {/* Outcome Filter */}
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white/60 dark:bg-white/[0.04] border border-slate-900/[0.08] dark:border-white/[0.08] backdrop-blur-md">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'won', label: 'Ganados' },
                { id: 'lost', label: 'Perdidos' },
                { id: 'void', label: 'Nulos' },
              ] as Array<{ id: OutcomeFilter; label: string }>
            ).map((of) => (
              <button
                key={of.id}
                type="button"
                onClick={() => setOutcomeFilter(of.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  outcomeFilter === of.id
                    ? of.id === 'lost'
                      ? 'bg-[#FF3B4B] text-white'
                      : of.id === 'won'
                        ? 'bg-[#ABF43F] text-[#090909]'
                        : 'bg-slate-900 text-white dark:bg-white/[0.16] dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {of.label}
              </button>
            ))}
          </div>

          {/* Period Filter */}
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white/60 dark:bg-white/[0.04] border border-slate-900/[0.08] dark:border-white/[0.08] backdrop-blur-md">
            {(
              [
                { id: 'all', label: 'Últ. 4 días' },
                { id: 'today', label: 'Hoy' },
                { id: 'yesterday', label: 'Ayer' },
                { id: 'older', label: 'Hace 2–3d' },
              ] as Array<{ id: PeriodFilter; label: string }>
            ).map((pf) => (
              <button
                key={pf.id}
                type="button"
                onClick={() => setPeriodFilter(pf.id)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  periodFilter === pf.id
                    ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {pf.label}
              </button>
            ))}
          </div>
        </div>

        {/* Second Toolbar Row: Search, League dropdown & Quantitative Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-slate-900/[0.06] dark:border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[220px]">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar equipo o liga..."
                aria-label="Buscar partidos finalizados"
                className="w-full sm:w-56 pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-900/[0.08] dark:border-white/[0.08] bg-white/70 dark:bg-white/[0.04] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              />
            </div>

            <select
              aria-label="Filtrar por liga"
              value={leagueFilter}
              onChange={(e) => setLeagueFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-900/[0.08] dark:border-white/[0.1] bg-white/75 dark:bg-[#141418] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
            >
              <option value="all">Todas las ligas ({availableLeagues.length})</option>
              {availableLeagues.map((lg) => (
                <option key={lg} value={lg}>
                  {lg}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setOnlyPositiveEv((prev) => !prev)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                onlyPositiveEv
                  ? 'bg-[#ABF43F] border-[#ABF43F] text-[#090909]'
                  : 'border-slate-900/[0.08] dark:border-white/[0.08] bg-white/65 dark:bg-white/[0.04] text-slate-700 dark:text-slate-300 hover:bg-white/85 dark:hover:bg-white/[0.08]'
              }`}
            >
              Solo +EV
            </button>

            <button
              type="button"
              onClick={() => setMinConsensus((prev) => (prev === 3 ? 0 : 3))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                minConsensus >= 3
                  ? 'bg-slate-900 border-slate-900 text-white dark:bg-[#3FF4E5] dark:border-[#3FF4E5] dark:text-[#090909]'
                  : 'border-slate-900/[0.08] dark:border-white/[0.08] bg-white/65 dark:bg-white/[0.04] text-slate-700 dark:text-slate-300 hover:bg-white/85 dark:hover:bg-white/[0.08]'
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Consenso ≥ 3/4</span>
            </button>

            <button
              type="button"
              onClick={() => setOnlyUserBets((prev) => !prev)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                onlyUserBets
                  ? 'bg-slate-900 border-slate-900 text-white dark:bg-[#3FF4E5] dark:border-[#3FF4E5] dark:text-[#090909]'
                  : 'border-slate-900/[0.08] dark:border-white/[0.08] bg-white/65 dark:bg-white/[0.04] text-slate-700 dark:text-slate-300 hover:bg-white/85 dark:hover:bg-white/[0.08]'
              }`}
            >
              Solo apostados
            </button>
          </div>
        </div>
      </section>

      {/* Error Banner */}
      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-[#FF3B4B]/40 bg-[#FF3B4B]/10 flex items-center justify-between gap-4 text-sm text-[#FF3B4B]"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => fetchResults(true)}
            className="text-xs font-semibold underline whitespace-nowrap"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Match-by-Match Audit Ledger */}
      <section className="glass-panel rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-900/[0.08] dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Registro Global de Partidos Finalizados ({filteredRows.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Haz clic en cualquier encuentro para ver qué predijo cada uno de los 5 modelos y si acertó
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Fuente oficial: ESPN Scoreboard
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-900/[0.08] dark:border-white/[0.08] bg-slate-900/[0.03] dark:bg-white/[0.03] text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Fecha y Liga</th>
                <th className="py-3 px-3 font-medium">Partido y Marcador Final</th>
                <th className="py-3 px-3 font-medium">Pick ({MODEL_META[activeModel].shortName})</th>
                <th className="py-3 px-3 font-medium text-right">Cuota / Prob.</th>
                <th className="py-3 px-3 font-medium text-right">EV Proy.</th>
                <th className="py-3 px-3 font-medium text-right">Resultado</th>
                <th className="py-3 px-4 font-medium text-right">P&amp;L (1u)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/[0.06] dark:divide-white/[0.06]">
              {loading && finishedMatches.length === 0 ? (
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={`audit-skel-${idx}`} className="animate-pulse">
                    <td colSpan={7} className="py-4 px-4">
                      <div className="h-5 bg-slate-200/80 dark:bg-white/10 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 px-6 text-center">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      No hay partidos finalizados que coincidan con los filtros actuales
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Prueba a ampliar el rango de fechas, desactivar Solo +EV o cambiar de deporte/liga.
                    </p>
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="mt-3 px-4 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]"
                    >
                      Restablecer filtros
                    </button>
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const { match, activeEval } = row;
                  const isExpanded = expandedMatchId === match.id;
                  const sportInfo = SPORT_META[match.sport];
                  const dateShort = new Date(match.kickoffTime).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: 'short',
                  });
                  const timeShort = formatTime24h(match.kickoffTime, timeZone);
                  const totalScore = match.homeScore + match.awayScore;

                  return (
                    <React.Fragment key={match.id}>
                      <tr
                        onClick={() =>
                          setExpandedMatchId((prev) => (prev === match.id ? null : match.id))
                        }
                        className="cursor-pointer hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.05] transition-colors"
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <p className="font-mono tabular-nums text-slate-800 dark:text-slate-200 font-medium">
                            {dateShort} · {timeShort}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {sportInfo.shortName} · {match.league}
                          </p>
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2.5 min-w-[210px]">
                            <div className="flex items-center -space-x-1.5 shrink-0">
                              <TeamCrest
                                teamName={match.homeTeam}
                                sport={match.sport}
                                logoUrl={match.homeLogo}
                                abbr={match.homeAbbr}
                                primaryColor={match.homeColor}
                                size="sm"
                              />
                              <TeamCrest
                                teamName={match.awayTeam}
                                sport={match.sport}
                                logoUrl={match.awayLogo}
                                abbr={match.awayAbbr}
                                primaryColor={match.awayColor}
                                size="sm"
                              />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                {match.homeTeam}{' '}
                                <span className="font-mono tabular-nums font-bold px-1 text-slate-950 dark:text-[#3FF4E5]">
                                  {match.homeScore} - {match.awayScore}
                                </span>{' '}
                                {match.awayTeam}
                              </p>
                              <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                Total: {totalScore} {sportInfo.unit} · Línea {match.marketLine.line}
                                {row.wasBetByUser ? ' · Apostado por ti' : ''}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {activeEval.marketLabel}
                          </p>
                          <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {match.marketLine.bookmaker} · Consenso {activeEval.consensusCount}/4
                          </p>
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">
                            {activeEval.odds.toFixed(2)}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {(activeEval.modelProb * 100).toFixed(1)}% · J{' '}
                            {activeEval.fairOdds.toFixed(2)}
                          </p>
                        </td>

                        <td
                          className={`py-3 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                            activeEval.ev >= 0.025
                              ? 'text-slate-900 dark:text-[#ABF43F]'
                              : activeEval.ev > 0
                                ? 'text-slate-800 dark:text-[#3FF4E5]'
                                : 'text-[#FF3B4B]'
                          }`}
                        >
                          {activeEval.ev >= 0 ? '+' : ''}
                          {(activeEval.ev * 100).toFixed(2)}%
                        </td>

                        <td className="py-3 px-3 text-right whitespace-nowrap">
                          {activeEval.outcome === 'won' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-slate-950 dark:text-[#ABF43F]">
                              <Check className="h-3.5 w-3.5" />
                              <span>Ganado</span>
                            </span>
                          ) : activeEval.outcome === 'lost' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-[#FF3B4B]">
                              <X className="h-3.5 w-3.5" />
                              <span>Perdido</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-slate-600 dark:text-[#3FF4E5]">
                              <Minus className="h-3.5 w-3.5" />
                              <span>Nulo</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            <span
                              className={`font-semibold ${
                                activeEval.unitPnl > 0
                                  ? 'text-slate-950 dark:text-[#ABF43F]'
                                  : activeEval.unitPnl < 0
                                    ? 'text-[#FF3B4B]'
                                    : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {activeEval.unitPnl > 0 ? '+' : ''}
                              {activeEval.unitPnl.toFixed(2)} u
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expandable 5-Model Breakdown for this Match */}
                      {isExpanded && (
                        <tr className="bg-slate-900/[0.025] dark:bg-white/[0.025]">
                          <td colSpan={7} className="px-5 py-4">
                            <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
                              Comparativa de los 5 modelos en {match.homeTeam} {match.homeScore}-
                              {match.awayScore} {match.awayTeam}
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                              {ALL_MODELS.map((mKey) => {
                                const ev = row.byModel[mKey];
                                const isSel = mKey === activeModel;
                                return (
                                  <div
                                    key={mKey}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onChangeModel(mKey);
                                    }}
                                    className={`rounded-lg border p-2.5 cursor-pointer transition-colors ${
                                      isSel
                                        ? 'border-[#ABF43F]/75 bg-[#ABF43F]/10'
                                        : 'border-slate-900/[0.08] dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white/80 dark:hover:bg-white/[0.06]'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between gap-1 text-[11px]">
                                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                        {MODEL_META[mKey].shortName}
                                      </span>
                                      <span
                                        className={`font-semibold ${
                                          ev.outcome === 'won'
                                            ? 'text-slate-950 dark:text-[#ABF43F]'
                                            : ev.outcome === 'lost'
                                              ? 'text-[#FF3B4B]'
                                              : 'text-slate-500 dark:text-[#3FF4E5]'
                                        }`}
                                      >
                                        {ev.outcome === 'won'
                                          ? 'Ganado'
                                          : ev.outcome === 'lost'
                                            ? 'Perdido'
                                            : 'Nulo'}
                                      </span>
                                    </div>
                                    <p className="mt-1 text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                                      {ev.marketLabel} @ {ev.odds.toFixed(2)}
                                    </p>
                                    <div className="mt-1 flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                      <span>Prob {(ev.modelProb * 100).toFixed(1)}%</span>
                                      <span>
                                        EV {ev.ev >= 0 ? '+' : ''}
                                        {(ev.ev * 100).toFixed(1)}%
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
