import {
  ArrowUpDown,
  Check,
  GitCompareArrows,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getChartTheme } from '../lib/chartTheme.ts';
import { evaluateMarketLine } from '../lib/dixonColes.ts';
import { formatTime24h } from '../lib/timezone.ts';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type {
  BankrollConfig,
  BetRecord,
  BetSide,
  EvaluatedPick,
  LiveMatch,
  MarketLine,
  ModelType,
  SportId,
} from '../types/quant.ts';
import { TeamCrest } from './TeamCrest.tsx';

export interface LoadedMatchSimulation {
  sport: SportId;
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
  mlFeatures: LiveMatch['mlFeatures'];
}

interface SportAlgorithmMatrixProps {
  theme: 'dark' | 'light';
  matches: LiveMatch[];
  loadingMarkets: boolean;
  timeZone: string;
  tzLabel: string;
  sportFilter: SportId | 'all';
  onChangeSportFilter: (sport: SportId | 'all') => void;
  currentBankroll: number;
  bankrollConfig: BankrollConfig;
  currencySymbol: string;
  onLogCustomBet: (bet: Omit<BetRecord, 'id'>) => void;
  onLoadMatchIntoSimulator: (sim: LoadedMatchSimulation) => void;
}

const SPORTS_ORDER: SportId[] = ['soccer', 'nba', 'nhl', 'football'];

const ALL_MODELS: ModelType[] = [
  'bivariate-poisson-xg-elo',
  'dixon-coles',
  'negative-binomial',
  'ml-gbdt',
  'ensemble',
];

const MODEL_SHORT_COL: Record<ModelType, string> = {
  'bivariate-poisson-xg-elo': 'Biv. xG+Elo',
  'dixon-coles': 'Dixon-Coles',
  'negative-binomial': 'Neg. Bin.',
  'ml-gbdt': 'ML GBDT',
  ensemble: 'Ensemble',
};

const STORAGE_KEY_SPORT_MODELS = 'quant_lab_sport_models_v1';

const AUDIT_OPTIMAL_MODELS: Record<SportId, ModelType> = {
  soccer: 'ensemble',
  nba: 'ml-gbdt',
  nhl: 'bivariate-poisson-xg-elo',
  football: 'bivariate-poisson-xg-elo',
};

const MODEL_PRESETS: Array<{
  id: string;
  label: string;
  mapping: Record<SportId, ModelType>;
}> = [
  {
    id: 'audit-optimal',
    label: 'Óptimo por auditoría',
    mapping: AUDIT_OPTIMAL_MODELS,
  },
  {
    id: 'all-ensemble',
    label: 'Todos Ensemble',
    mapping: {
      soccer: 'ensemble',
      nba: 'ensemble',
      nhl: 'ensemble',
      football: 'ensemble',
    },
  },
  {
    id: 'all-bivariate',
    label: 'Todos Biv. xG+Elo',
    mapping: {
      soccer: 'bivariate-poisson-xg-elo',
      nba: 'bivariate-poisson-xg-elo',
      nhl: 'bivariate-poisson-xg-elo',
      football: 'bivariate-poisson-xg-elo',
    },
  },
  {
    id: 'all-dixon',
    label: 'Todos Dixon-Coles',
    mapping: {
      soccer: 'dixon-coles',
      nba: 'dixon-coles',
      nhl: 'dixon-coles',
      football: 'dixon-coles',
    },
  },
  {
    id: 'all-ml',
    label: 'Todos ML GBDT',
    mapping: {
      soccer: 'ml-gbdt',
      nba: 'ml-gbdt',
      nhl: 'ml-gbdt',
      football: 'ml-gbdt',
    },
  },
];

type ValueFilterMode = 'all' | 'positive' | 'strong' | 'divergent';
type ChartMetricMode = 'evCount' | 'avgEv' | 'kellyStake';

interface MatchModelEval {
  match: LiveMatch;
  marketLine: MarketLine;
  byModel: Record<ModelType, EvaluatedPick>;
  activeModel: ModelType;
  activePick: EvaluatedPick;
  baselinePick: EvaluatedPick;
  deltaEv: number;
  sideFlipped: boolean;
  valueFlipped: boolean;
  hasDivergence: boolean;
  positiveModelCount: number;
}

function loadSavedSportModels(): Record<SportId, ModelType> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SPORT_MODELS);
    if (!raw) return { ...AUDIT_OPTIMAL_MODELS };
    const parsed = JSON.parse(raw) as Partial<Record<SportId, ModelType>>;
    const result: Record<SportId, ModelType> = { ...AUDIT_OPTIMAL_MODELS };
    for (const sid of SPORTS_ORDER) {
      if (parsed[sid] && ALL_MODELS.includes(parsed[sid]!)) {
        result[sid] = parsed[sid]!;
      }
    }
    return result;
  } catch {
    return { ...AUDIT_OPTIMAL_MODELS };
  }
}

function formatEvSigned(ev: number): string {
  const pct = ev * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function formatPpSigned(delta: number): string {
  const pp = delta * 100;
  return `${pp >= 0 ? '+' : ''}${pp.toFixed(2)} pp`;
}

function formatSideShort(side: BetSide): string {
  return side === 'over' ? 'Más' : 'Menos';
}

export const SportAlgorithmMatrix: React.FC<SportAlgorithmMatrixProps> = ({
  theme,
  matches,
  loadingMarkets,
  timeZone,
  tzLabel,
  sportFilter,
  onChangeSportFilter,
  currentBankroll,
  bankrollConfig,
  currencySymbol,
  onLogCustomBet,
  onLoadMatchIntoSimulator,
}) => {
  const chartTheme = useMemo(() => getChartTheme(theme), [theme]);
  const [sportModels, setSportModels] = useState<Record<SportId, ModelType>>(loadSavedSportModels);
  const [baselineModel, setBaselineModel] = useState<ModelType>('ensemble');
  const [valueFilter, setValueFilter] = useState<ValueFilterMode>('all');
  const [chartMetric, setChartMetric] = useState<ChartMetricMode>('evCount');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'ev' | 'delta' | 'kickoff'>('ev');
  const [loggedIds, setLoggedIds] = useState<Record<string, boolean>>({});

  const updateSportModel = (sport: SportId, model: ModelType) => {
    setSportModels((prev) => {
      const next = { ...prev, [sport]: model };
      try {
        localStorage.setItem(STORAGE_KEY_SPORT_MODELS, JSON.stringify(next));
      } catch {
        // Ignore storage quota errors
      }
      return next;
    });
  };

  const applyPresetMapping = (mapping: Record<SportId, ModelType>) => {
    setSportModels({ ...mapping });
    try {
      localStorage.setItem(STORAGE_KEY_SPORT_MODELS, JSON.stringify(mapping));
    } catch {
      // Ignore storage quota errors
    }
  };

  const activePresetId = useMemo(() => {
    const found = MODEL_PRESETS.find((preset) =>
      SPORTS_ORDER.every((sid) => preset.mapping[sid] === sportModels[sid])
    );
    return found?.id ?? null;
  }, [sportModels]);

  // Evaluate every match's primary market line across all 5 algorithms
  const evaluatedRows = useMemo<MatchModelEval[]>(() => {
    const rows: MatchModelEval[] = [];

    for (const match of matches) {
      if (!match.lines || match.lines.length === 0) continue;
      const primaryLine = match.lines[0];

      const byModel = {} as Record<ModelType, EvaluatedPick>;
      for (const m of ALL_MODELS) {
        const [overPick, underPick] = evaluateMarketLine(
          match,
          primaryLine,
          m,
          currentBankroll,
          bankrollConfig
        );
        byModel[m] = overPick.ev >= underPick.ev ? overPick : underPick;
      }

      const activeModel = sportModels[match.sport];
      const activePick = byModel[activeModel];
      const baselinePick = byModel[baselineModel];

      const sideFlipped = activePick.side !== baselinePick.side;
      const activePositive = activePick.ev > 0.005;
      const baselinePositive = baselinePick.ev > 0.005;
      const valueFlipped = activePositive !== baselinePositive;

      // Cross-model divergence: models disagree on positive EV status or preferred side
      const sidesSet = new Set(ALL_MODELS.map((m) => byModel[m].side));
      const positiveCount = ALL_MODELS.filter((m) => byModel[m].ev > 0.005).length;
      const hasDivergence =
        sideFlipped ||
        valueFlipped ||
        sidesSet.size > 1 ||
        (positiveCount > 0 && positiveCount < ALL_MODELS.length);

      rows.push({
        match,
        marketLine: primaryLine,
        byModel,
        activeModel,
        activePick,
        baselinePick,
        deltaEv: activePick.ev - baselinePick.ev,
        sideFlipped,
        valueFlipped,
        hasDivergence,
        positiveModelCount: positiveCount,
      });
    }

    return rows;
  }, [matches, sportModels, baselineModel, currentBankroll, bankrollConfig]);

  // Per-sport summary cards data
  const sportSummaries = useMemo(() => {
    return SPORTS_ORDER.map((sid) => {
      const sportRows = evaluatedRows.filter((r) => r.match.sport === sid);
      const activePos = sportRows.filter((r) => r.activePick.ev > 0.005);
      const basePos = sportRows.filter((r) => r.baselinePick.ev > 0.005);
      const avgActiveEv =
        activePos.length > 0
          ? activePos.reduce((acc, r) => acc + r.activePick.ev, 0) / activePos.length
          : 0;
      const avgBaseEv =
        basePos.length > 0
          ? basePos.reduce((acc, r) => acc + r.baselinePick.ev, 0) / basePos.length
          : 0;
      const totalStake = activePos.reduce((acc, r) => acc + r.activePick.recommendedStake, 0);

      return {
        sport: sid,
        matchCount: sportRows.length,
        assignedModel: sportModels[sid],
        positiveCount: activePos.length,
        deltaCount: activePos.length - basePos.length,
        avgPositiveEv: avgActiveEv,
        deltaAvgEv: avgActiveEv - avgBaseEv,
        totalStake,
      };
    });
  }, [evaluatedRows, sportModels]);

  // Scoped rows by sportFilter (used for portfolio KPIs, chart, and algorithm breakdown)
  const scopedRows = useMemo(() => {
    if (sportFilter === 'all') return evaluatedRows;
    return evaluatedRows.filter((r) => r.match.sport === sportFilter);
  }, [evaluatedRows, sportFilter]);

  // Portfolio-level KPI metrics (active custom mix vs baseline)
  const portfolioStats = useMemo(() => {
    const activePos = scopedRows.filter((r) => r.activePick.ev > 0.005);
    const basePos = scopedRows.filter((r) => r.baselinePick.ev > 0.005);
    const activeAvgEv =
      activePos.length > 0
        ? activePos.reduce((acc, r) => acc + r.activePick.ev, 0) / activePos.length
        : 0;
    const baseAvgEv =
      basePos.length > 0
        ? basePos.reduce((acc, r) => acc + r.baselinePick.ev, 0) / basePos.length
        : 0;
    const activeStake = activePos.reduce((acc, r) => acc + r.activePick.recommendedStake, 0);
    const baseStake = basePos.reduce((acc, r) => acc + r.baselinePick.recommendedStake, 0);
    const changedDecisions = scopedRows.filter((r) => r.sideFlipped || r.valueFlipped).length;

    return {
      totalMatches: scopedRows.length,
      activePositiveCount: activePos.length,
      deltaPositiveCount: activePos.length - basePos.length,
      activeAvgEv,
      deltaAvgEv: activeAvgEv - baseAvgEv,
      activeStake,
      deltaStake: activeStake - baseStake,
      changedDecisions,
    };
  }, [scopedRows]);

  // Algorithm sensitivity comparison across all 5 algorithms + active custom mix
  const algorithmComparison = useMemo(() => {
    const rows = ALL_MODELS.map((m) => {
      const picks = scopedRows.map((r) => r.byModel[m]);
      const posPicks = picks.filter((p) => p.ev > 0.005);
      const strongPicks = picks.filter((p) => p.ev >= 0.025);
      const avgPosEv =
        posPicks.length > 0
          ? posPicks.reduce((acc, p) => acc + p.ev, 0) / posPicks.length
          : 0;
      const avgPosEdge =
        posPicks.length > 0
          ? posPicks.reduce((acc, p) => acc + p.edge, 0) / posPicks.length
          : 0;
      const totalStake = posPicks.reduce((acc, p) => acc + p.recommendedStake, 0);

      return {
        key: m,
        label: MODEL_SHORT_COL[m],
        fullName: MODEL_META[m].name,
        evCount: posPicks.length,
        strongCount: strongPicks.length,
        avgEvPct: Number((avgPosEv * 100).toFixed(2)),
        avgEdgePct: Number((avgPosEdge * 100).toFixed(2)),
        kellyStake: Math.round(totalStake),
        isActiveMix: false,
      };
    });

    // Append "Mix por Deporte" bar when viewing all sports so user compares their custom hybrid vs each uniform model
    if (sportFilter === 'all') {
      const activePicks = scopedRows.map((r) => r.activePick);
      const posPicks = activePicks.filter((p) => p.ev > 0.005);
      const strongPicks = activePicks.filter((p) => p.ev >= 0.025);
      const avgPosEv =
        posPicks.length > 0
          ? posPicks.reduce((acc, p) => acc + p.ev, 0) / posPicks.length
          : 0;
      const avgPosEdge =
        posPicks.length > 0
          ? posPicks.reduce((acc, p) => acc + p.edge, 0) / posPicks.length
          : 0;
      const totalStake = posPicks.reduce((acc, p) => acc + p.recommendedStake, 0);

      rows.push({
        key: 'ensemble', // placeholder typed key; distinguished by isActiveMix
        label: 'Mix Activo',
        fullName: 'Tu asignación individual por deporte',
        evCount: posPicks.length,
        strongCount: strongPicks.length,
        avgEvPct: Number((avgPosEv * 100).toFixed(2)),
        avgEdgePct: Number((avgPosEdge * 100).toFixed(2)),
        kellyStake: Math.round(totalStake),
        isActiveMix: true,
      });
    }

    return rows;
  }, [scopedRows, sportFilter]);

  // Filtered and sorted rows for the pre-bet match table
  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = scopedRows.filter((row) => {
      if (valueFilter === 'positive' && row.activePick.ev <= 0.005) return false;
      if (valueFilter === 'strong' && row.activePick.ev < 0.025) return false;
      if (valueFilter === 'divergent' && !row.hasDivergence) return false;
      if (q) {
        const hay =
          `${row.match.homeTeam} ${row.match.awayTeam} ${row.match.league} ${SPORT_META[row.match.sport].name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      if (sortBy === 'delta') {
        return Math.abs(b.deltaEv) - Math.abs(a.deltaEv);
      }
      if (sortBy === 'kickoff') {
        return new Date(a.match.kickoffTime).getTime() - new Date(b.match.kickoffTime).getTime();
      }
      return b.activePick.ev - a.activePick.ev;
    });
  }, [scopedRows, valueFilter, searchQuery, sortBy]);

  const handleLogPreBet = (row: MatchModelEval) => {
    const pick = row.activePick;
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const stakeToUse =
      pick.recommendedStake > 0
        ? pick.recommendedStake
        : Math.max(10, Math.round(currentBankroll * 0.01));

    onLogCustomBet({
      date: now.toISOString(),
      monthKey,
      sport: row.match.sport,
      league: row.match.league,
      matchId: row.match.id,
      matchLabel: `${row.match.homeTeam} vs ${row.match.awayTeam}`,
      side: pick.side,
      line: pick.marketLine.line,
      marketType: 'totals',
      selectionKey: pick.side,
      marketLabel: `${formatSideShort(pick.side)} ${pick.marketLine.line} ${SPORT_META[row.match.sport].unit}`,
      bookmaker: pick.marketLine.bookmaker,
      odds: pick.odds,
      closingOdds: pick.odds,
      modelProb: pick.modelProb,
      edge: pick.edge,
      ev: pick.ev,
      stake: stakeToUse,
      status: 'pending',
      pnl: 0,
      modelUsed: row.activeModel,
    });

    setLoggedIds((prev) => ({ ...prev, [row.match.id]: true }));
    window.setTimeout(() => {
      setLoggedIds((prev) => {
        const next = { ...prev };
        delete next[row.match.id];
        return next;
      });
    }, 2600);
  };

  const handleLoadIntoSim = (row: MatchModelEval) => {
    onLoadMatchIntoSimulator({
      sport: row.match.sport,
      homeTeam: row.match.homeTeam,
      awayTeam: row.match.awayTeam,
      league: row.match.league,
      homeLambda: row.match.homeLambda,
      awayLambda: row.match.awayLambda,
      homeElo: row.match.homeElo,
      awayElo: row.match.awayElo,
      bivariateCov: row.match.bivariateCov,
      rho: row.match.rho,
      alpha: row.match.alpha,
      line: row.marketLine.line,
      overOdds: row.marketLine.overOdds,
      underOdds: row.marketLine.underOdds,
      mlFeatures: { ...row.match.mlFeatures },
    });
  };

  const resetFilters = () => {
    onChangeSportFilter('all');
    setValueFilter('all');
    setSearchQuery('');
  };

  const activeScopeLabel =
    sportFilter === 'all' ? 'Todos los deportes' : SPORT_META[sportFilter].name;

  const chartDataKey =
    chartMetric === 'evCount'
      ? 'evCount'
      : chartMetric === 'avgEv'
        ? 'avgEvPct'
        : 'kellyStake';

  return (
    <div className="space-y-6">
      {/* Preset & Baseline Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-white/60 dark:bg-white/[0.04] backdrop-blur-md border border-slate-900/[0.08] dark:border-white/[0.08]">
          {MODEL_PRESETS.map((preset) => {
            const isCurrent = activePresetId === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPresetMapping(preset.mapping)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  isCurrent
                    ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2.5">
          <label
            htmlFor="lab-baseline-select"
            className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap"
          >
            Comparar Δ vs:
          </label>
          <select
            id="lab-baseline-select"
            value={baselineModel}
            onChange={(e) => setBaselineModel(e.target.value as ModelType)}
            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/80 dark:bg-[#141414] border border-slate-900/[0.12] dark:border-white/[0.12] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:focus:ring-[#ABF43F]"
          >
            {ALL_MODELS.map((m) => (
              <option key={m} value={m}>
                {MODEL_META[m].name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Per-Sport Individual Algorithm Matrix (4 Sports) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {sportSummaries.map((item) => {
          const isFocused = sportFilter === item.sport;
          const sportMeta = SPORT_META[item.sport];
          const modelMeta = MODEL_META[item.assignedModel];

          return (
            <div
              key={item.sport}
              className={`glass-panel rounded-xl p-4 transition-colors ${
                isFocused
                  ? 'border-emerald-600/50 dark:border-[#ABF43F]/50 ring-1 ring-emerald-600/20 dark:ring-[#ABF43F]/20'
                  : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {sportMeta.name}
                    </h3>
                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      · {item.matchCount}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChangeSportFilter(isFocused ? 'all' : item.sport)
                  }
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    isFocused
                      ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.06] dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/[0.06]'
                  }`}
                >
                  {isFocused ? 'Enfocado' : 'Enfocar'}
                </button>
              </div>

              <label
                htmlFor={`sport-model-${item.sport}`}
                className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1"
              >
                Algoritmo asignado
              </label>
              <select
                id={`sport-model-${item.sport}`}
                value={item.assignedModel}
                onChange={(e) =>
                  updateSportModel(item.sport, e.target.value as ModelType)
                }
                className="w-full px-3 py-2 text-xs font-medium rounded-lg bg-white/85 dark:bg-[#141414] border border-slate-900/[0.12] dark:border-white/[0.12] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:focus:ring-[#ABF43F]"
              >
                {ALL_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {MODEL_META[m].name}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                {modelMeta.description}
              </p>

              <div className="mt-4 pt-3 border-t border-slate-900/[0.08] dark:border-white/[0.08] grid grid-cols-3 gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Picks +EV
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-1 font-mono tabular-nums">
                    <span className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {item.positiveCount}
                    </span>
                    {item.deltaCount !== 0 && (
                      <span
                        className={`text-[11px] font-semibold ${
                          item.deltaCount > 0
                            ? 'text-emerald-600 dark:text-[#ABF43F]'
                            : 'text-rose-600 dark:text-[#FF3B4B]'
                        }`}
                      >
                        {item.deltaCount > 0 ? `+${item.deltaCount}` : item.deltaCount}
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    EV Medio
                  </div>
                  <div
                    className={`mt-0.5 text-sm font-mono font-bold tabular-nums ${
                      item.avgPositiveEv > 0
                        ? 'text-emerald-600 dark:text-[#ABF43F]'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {item.positiveCount > 0 ? formatEvSigned(item.avgPositiveEv) : '0.00%'}
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Kelly
                  </div>
                  <div className="mt-0.5 text-sm font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {currencySymbol}
                    {Math.round(item.totalStake)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Cohesive Portfolio KPI Strip */}
      <div className="glass-panel rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-slate-900/[0.08] dark:divide-white/[0.08]">
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Picks +EV detectados · {activeScopeLabel}
          </div>
          <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {portfolioStats.activePositiveCount}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              de {portfolioStats.totalMatches} partidos
            </span>
          </div>
          <div
            className={`mt-1 text-xs font-mono tabular-nums ${
              portfolioStats.deltaPositiveCount > 0
                ? 'text-emerald-600 dark:text-[#ABF43F]'
                : portfolioStats.deltaPositiveCount < 0
                  ? 'text-rose-600 dark:text-[#FF3B4B]'
                  : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {portfolioStats.deltaPositiveCount > 0
              ? `+${portfolioStats.deltaPositiveCount}`
              : portfolioStats.deltaPositiveCount}{' '}
            picks vs {MODEL_SHORT_COL[baselineModel]}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            EV medio sobre picks +EV
          </div>
          <div className="mt-1.5 font-mono tabular-nums text-2xl font-bold text-emerald-600 dark:text-[#ABF43F]">
            {portfolioStats.activePositiveCount > 0
              ? formatEvSigned(portfolioStats.activeAvgEv)
              : '0.00%'}
          </div>
          <div
            className={`mt-1 text-xs font-mono tabular-nums ${
              portfolioStats.deltaAvgEv > 0.0005
                ? 'text-emerald-600 dark:text-[#ABF43F]'
                : portfolioStats.deltaAvgEv < -0.0005
                  ? 'text-rose-600 dark:text-[#FF3B4B]'
                  : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {formatPpSigned(portfolioStats.deltaAvgEv)} vs {MODEL_SHORT_COL[baselineModel]}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Cambios de decisión vs base
          </div>
          <div className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {portfolioStats.changedDecisions}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">partidos</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Entran/salen de +EV o cambian Más ↔ Menos
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Capital Kelly sugerido
          </div>
          <div className="mt-1.5 font-mono tabular-nums text-2xl font-bold text-slate-900 dark:text-slate-100">
            {currencySymbol}
            {Math.round(portfolioStats.activeStake)}
          </div>
          <div
            className={`mt-1 text-xs font-mono tabular-nums ${
              portfolioStats.deltaStake > 0
                ? 'text-cyan-700 dark:text-[#3FF4E5]'
                : portfolioStats.deltaStake < 0
                  ? 'text-slate-500 dark:text-slate-400'
                  : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {portfolioStats.deltaStake >= 0 ? '+' : '-'}
            {currencySymbol}
            {Math.abs(Math.round(portfolioStats.deltaStake))} vs {MODEL_SHORT_COL[baselineModel]}
          </div>
        </div>
      </div>

      {/* Algorithm Sensitivity Chart + Benchmark Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 glass-panel rounded-xl p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Sensibilidad de detección +EV por algoritmo
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Alcance: {activeScopeLabel} · {scopedRows.length} partidos evaluados en vivo
              </p>
            </div>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900/[0.04] dark:bg-white/[0.04] border border-slate-900/[0.08] dark:border-white/[0.08]">
              {(
                [
                  { id: 'evCount', label: 'Picks +EV' },
                  { id: 'avgEv', label: 'EV Medio %' },
                  { id: 'kellyStake', label: 'Stake Kelly' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setChartMetric(m.id)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    chartMetric === m.id
                      ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-[240px] w-full">
            {scopedRows.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                {loadingMarkets
                  ? 'Cargando partidos en vivo...'
                  : 'Sin partidos disponibles en este deporte para comparar.'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={algorithmComparison}
                  margin={{ top: 8, right: 12, left: -8, bottom: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={chartTheme.gridStroke}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: chartTheme.axisTickFill, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: chartTheme.axisTickFill, fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) =>
                      chartMetric === 'avgEv'
                        ? `${v}%`
                        : chartMetric === 'kellyStake'
                          ? `${currencySymbol}${v}`
                          : String(v)
                    }
                  />
                  <Tooltip
                    cursor={{ fill: chartTheme.cursorFill }}
                    contentStyle={chartTheme.tooltipContentStyle}
                    labelStyle={chartTheme.tooltipLabelStyle}
                    itemStyle={chartTheme.tooltipItemStyle}
                    formatter={(val: unknown) => {
                      const num = Number(val);
                      if (chartMetric === 'avgEv') return [`+${num.toFixed(2)}%`, 'EV Medio (+EV)'];
                      if (chartMetric === 'kellyStake') return [`${currencySymbol}${num}`, 'Stake Kelly'];
                      return [`${num} picks`, 'Picks +EV (>0.5%)'];
                    }}
                  />
                  <Bar dataKey={chartDataKey} radius={[6, 6, 0, 0]} maxBarSize={44}>
                    {algorithmComparison.map((entry, idx) => {
                      const isSportSelectedModel =
                        sportFilter !== 'all' &&
                        !entry.isActiveMix &&
                        sportModels[sportFilter] === entry.key;
                      const highlight = entry.isActiveMix || isSportSelectedModel;
                      const fill = highlight
                        ? theme === 'dark'
                          ? '#ABF43F'
                          : '#059669'
                        : theme === 'dark'
                          ? 'rgba(63, 244, 229, 0.55)'
                          : 'rgba(15, 23, 42, 0.28)';
                      return <Cell key={`${entry.label}-${idx}`} fill={fill} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Benchmark Breakdown Panel */}
        <div className="lg:col-span-5 glass-panel rounded-xl p-5 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Comparativa agregada · {activeScopeLabel}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {sportFilter !== 'all'
                  ? 'Haz clic en un algoritmo para asignarlo a este deporte'
                  : 'Compara cada modelo uniforme frente a tu mix por deporte'}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto -mx-2 px-2 flex-1">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-900/[0.08] dark:border-white/[0.08] text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-2">Algoritmo</th>
                  <th className="py-2 px-2 text-right">+EV</th>
                  <th className="py-2 px-2 text-right">≥2.5%</th>
                  <th className="py-2 px-2 text-right">EV Med.</th>
                  <th className="py-2 pl-2 text-right">Kelly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/[0.06] dark:divide-white/[0.06] text-xs">
                {algorithmComparison.map((row, idx) => {
                  const isAssigned =
                    (sportFilter !== 'all' &&
                      !row.isActiveMix &&
                      sportModels[sportFilter] === row.key) ||
                    row.isActiveMix;
                  const canAssign = sportFilter !== 'all' && !row.isActiveMix;

                  return (
                    <tr
                      key={`${row.label}-${idx}`}
                      onClick={() => {
                        if (canAssign) {
                          updateSportModel(sportFilter, row.key);
                        }
                      }}
                      className={`transition-colors ${
                        canAssign ? 'cursor-pointer hover:bg-slate-900/[0.03] dark:hover:bg-white/[0.03]' : ''
                      } ${
                        isAssigned
                          ? 'bg-emerald-500/[0.06] dark:bg-[#ABF43F]/[0.07]'
                          : ''
                      }`}
                    >
                      <td className="py-2.5 pr-2 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {isAssigned && (
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 dark:bg-[#ABF43F]" />
                          )}
                          <span>{row.label}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {row.evCount}
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {row.strongCount}
                      </td>
                      <td
                        className={`py-2.5 px-2 text-right font-mono tabular-nums font-semibold ${
                          row.avgEvPct > 0
                            ? 'text-emerald-600 dark:text-[#ABF43F]'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {row.evCount > 0 ? `+${row.avgEvPct.toFixed(2)}%` : '0.00%'}
                      </td>
                      <td className="py-2.5 pl-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {currencySymbol}
                        {row.kellyStake}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pre-Bet Live Match-by-Match Comparative Matrix */}
      <div className="glass-panel rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-900/[0.08] dark:border-white/[0.08] flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Matriz pre-apuesta: variación de +EV por partido y algoritmo
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Haz clic en cualquier celda de algoritmo para aplicarlo a ese deporte · Horario local ({tzLabel})
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Buscar equipo o liga..."
                  className="pl-8 pr-3 py-1.5 text-xs rounded-lg bg-white/80 dark:bg-[#141414] border border-slate-900/[0.12] dark:border-white/[0.12] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-emerald-600 dark:focus:ring-[#ABF43F] w-48"
                />
              </div>

              <button
                type="button"
                onClick={() =>
                  setSortBy((prev) =>
                    prev === 'ev' ? 'delta' : prev === 'delta' ? 'kickoff' : 'ev'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-900/[0.12] dark:border-white/[0.12] text-slate-700 dark:text-slate-200 hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.05] whitespace-nowrap shrink-0"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                Orden:{' '}
                {sortBy === 'ev' ? '+EV Activo' : sortBy === 'delta' ? 'Mayor Δ EV' : 'Hora'}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Sport filter */}
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-900/[0.04] dark:bg-white/[0.04] border border-slate-900/[0.08] dark:border-white/[0.08]">
              <button
                type="button"
                onClick={() => onChangeSportFilter('all')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sportFilter === 'all'
                    ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                Todos ({evaluatedRows.length})
              </button>
              {SPORTS_ORDER.map((sid) => {
                const count = evaluatedRows.filter((r) => r.match.sport === sid).length;
                return (
                  <button
                    key={sid}
                    type="button"
                    onClick={() => onChangeSportFilter(sid)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                      sportFilter === sid
                        ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                    }`}
                  >
                    {SPORT_META[sid].shortName} ({count})
                  </button>
                );
              })}
            </div>

            {/* Value filter */}
            <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-900/[0.04] dark:bg-white/[0.04] border border-slate-900/[0.08] dark:border-white/[0.08]">
              {(
                [
                  { id: 'all', label: 'Todos' },
                  { id: 'positive', label: 'Solo +EV' },
                  { id: 'strong', label: 'EV ≥ +2.5%' },
                  { id: 'divergent', label: 'Divergencias' },
                ] as const
              ).map((vf) => (
                <button
                  key={vf.id}
                  type="button"
                  onClick={() => setValueFilter(vf.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    valueFilter === vf.id
                      ? 'bg-slate-900 text-white dark:bg-[#3FF4E5] dark:text-[#090909]'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {vf.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Table Body */}
        {loadingMarkets && evaluatedRows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Cargando cartelera en vivo para comparar algoritmos...
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <GitCompareArrows className="h-8 w-8 mx-auto text-slate-400 dark:text-slate-600" />
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No hay partidos que coincidan con los filtros actuales.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909] whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restablecer filtros
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[1040px]">
              <thead>
                <tr className="border-b border-slate-900/[0.08] dark:border-white/[0.08] text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400 bg-slate-900/[0.02] dark:bg-white/[0.02]">
                  <th className="py-3 pl-5 pr-3">Partido y Línea</th>
                  <th className="py-3 px-2.5">Selección Activa</th>
                  {ALL_MODELS.map((m) => (
                    <th key={m} className="py-3 px-2 text-right whitespace-nowrap">
                      {MODEL_SHORT_COL[m]}
                    </th>
                  ))}
                  <th className="py-3 px-2.5 text-right whitespace-nowrap">
                    Δ vs {MODEL_SHORT_COL[baselineModel]}
                  </th>
                  <th className="py-3 pl-2.5 pr-5 text-right">Pre-Apuesta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/[0.06] dark:divide-white/[0.06] text-xs">
                {visibleRows.map((row) => {
                  const isLogged = Boolean(loggedIds[row.match.id]);
                  const activePos = row.activePick.ev > 0.005;

                  return (
                    <tr
                      key={row.match.id}
                      className="hover:bg-slate-900/[0.02] dark:hover:bg-white/[0.02] transition-colors"
                    >
                      {/* Match + Line */}
                      <td className="py-3 pl-5 pr-3 align-middle">
                        <div className="flex items-center gap-2.5">
                          <div className="flex items-center -space-x-1.5 shrink-0">
                            <TeamCrest
                              teamName={row.match.homeTeam}
                              sport={row.match.sport}
                              logoUrl={row.match.homeLogo}
                              abbr={row.match.homeAbbr}
                              primaryColor={row.match.homeColor}
                              size="sm"
                            />
                            <TeamCrest
                              teamName={row.match.awayTeam}
                              sport={row.match.sport}
                              logoUrl={row.match.awayLogo}
                              abbr={row.match.awayAbbr}
                              primaryColor={row.match.awayColor}
                              size="sm"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[220px]">
                              {row.match.homeTeam} vs {row.match.awayTeam}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                              {row.match.league} · {formatTime24h(row.match.kickoffTime, timeZone)} · Línea{' '}
                              {row.marketLine.line}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Active Sport Algorithm Selection */}
                      <td className="py-3 px-2.5 align-middle whitespace-nowrap">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 font-mono tabular-nums">
                          {formatSideShort(row.activePick.side)} {row.marketLine.line} @{' '}
                          {row.activePick.odds.toFixed(2)}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                          {MODEL_SHORT_COL[row.activeModel]} · P {(row.activePick.modelProb * 100).toFixed(1)}%
                          {row.activePick.recommendedStake > 0
                            ? ` · ${currencySymbol}${Math.round(row.activePick.recommendedStake)}`
                            : ''}
                        </div>
                      </td>

                      {/* 5 Algorithm Cells */}
                      {ALL_MODELS.map((m) => {
                        const pick = row.byModel[m];
                        const isAssignedForSport = row.activeModel === m;
                        const isPos = pick.ev > 0.005;
                        const sideDiffersFromActive = pick.side !== row.activePick.side;

                        return (
                          <td key={m} className="py-2 px-1.5 text-right align-middle">
                            <button
                              type="button"
                              onClick={() => updateSportModel(row.match.sport, m)}
                              title={`Aplicar ${MODEL_META[m].name} a ${SPORT_META[row.match.sport].name}`}
                              className={`w-full px-2 py-1.5 rounded-lg text-right font-mono tabular-nums transition-colors ${
                                isAssignedForSport
                                  ? 'bg-emerald-600/10 dark:bg-[#ABF43F]/12 ring-1 ring-emerald-600/40 dark:ring-[#ABF43F]/40'
                                  : 'hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06]'
                              }`}
                            >
                              <div
                                className={`text-xs font-semibold ${
                                  isPos
                                    ? 'text-emerald-700 dark:text-[#ABF43F]'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {formatEvSigned(pick.ev)}
                              </div>
                              <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-end gap-1">
                                <span>{formatSideShort(pick.side)}</span>
                                {sideDiffersFromActive && (
                                  <span
                                    className="text-cyan-700 dark:text-[#3FF4E5] font-semibold"
                                    title="Prefiere el lado opuesto al algoritmo activo"
                                  >
                                    ≠
                                  </span>
                                )}
                              </div>
                            </button>
                          </td>
                        );
                      })}

                      {/* Delta vs Baseline */}
                      <td className="py-3 px-2.5 text-right align-middle whitespace-nowrap font-mono tabular-nums">
                        <div
                          className={`text-xs font-semibold ${
                            row.deltaEv > 0.002
                              ? 'text-emerald-600 dark:text-[#ABF43F]'
                              : row.deltaEv < -0.002
                                ? 'text-rose-600 dark:text-[#FF3B4B]'
                                : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {formatPpSigned(row.deltaEv)}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">
                          {row.sideFlipped
                            ? 'Cambia lado'
                            : row.valueFlipped
                              ? activePos
                                ? 'Activa +EV'
                                : 'Filtra +EV'
                              : `${row.positiveModelCount}/5 +EV`}
                        </div>
                      </td>

                      {/* Pre-bet Actions */}
                      <td className="py-3 pl-2.5 pr-5 text-right align-middle whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleLoadIntoSim(row)}
                            title="Cargar parámetros reales en el Simulador Manual"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-slate-900/[0.12] dark:border-white/[0.12] text-slate-700 dark:text-slate-200 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06] whitespace-nowrap shrink-0"
                          >
                            <SlidersHorizontal className="h-3 w-3" />
                            Simular
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLogPreBet(row)}
                            className={`inline-flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                              isLogged
                                ? 'bg-emerald-600 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                                : activePos
                                  ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-[#ABF43F] dark:text-[#090909] dark:hover:bg-[#9BE332]'
                                  : 'border border-slate-900/[0.14] dark:border-white/[0.14] text-slate-700 dark:text-slate-300 hover:bg-slate-900/[0.05] dark:hover:bg-white/[0.06]'
                            }`}
                          >
                            {isLogged ? (
                              <>
                                <Check className="h-3 w-3" />
                                Registrada
                              </>
                            ) : (
                              'Apostar'
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
