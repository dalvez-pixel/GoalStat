import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { classifyMatchDayInTimeZone, formatTime24h } from '../lib/timezone.ts';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type { EvaluatedPick, LiveMatch, ModelType, SportId } from '../types/quant.ts';
import { TeamCrest } from './TeamCrest.tsx';

interface OpportunitiesViewProps {
  picks: EvaluatedPick[];
  loading: boolean;
  error: string | null;
  activeModel: ModelType;
  onChangeModel: (model: ModelType) => void;
  liveOnlyView?: boolean;
  timeZone: string;
  tzLabel: string;
  currencySymbol: string;
  onRefresh: () => void;
  onInspectPick: (pick: EvaluatedPick) => void;
  onQuickBet: (pick: EvaluatedPick) => void;
}

interface MatchGroup {
  match: LiveMatch;
  picks: EvaluatedPick[];
  bestPick: EvaluatedPick;
}

const SPORT_FILTERS: Array<{ id: SportId | 'all'; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'soccer', label: 'Fútbol' },
  { id: 'nba', label: 'NBA' },
  { id: 'nhl', label: 'NHL' },
  { id: 'football', label: 'NFL / NCAAF' },
];

const MODEL_ORDER: ModelType[] = [
  'bivariate-poisson-xg-elo',
  'ensemble',
  'dixon-coles',
  'negative-binomial',
  'ml-gbdt',
];

type DayFilter = 'all' | 'live' | 'today' | 'tomorrow';

export const OpportunitiesView: React.FC<OpportunitiesViewProps> = ({
  picks,
  loading,
  error,
  activeModel,
  onChangeModel,
  liveOnlyView = false,
  timeZone,
  tzLabel,
  currencySymbol,
  onRefresh,
  onInspectPick,
  onQuickBet,
}) => {
  const [sportFilter, setSportFilter] = useState<SportId | 'all'>('all');
  const [dayFilter, setDayFilter] = useState<DayFilter>(liveOnlyView ? 'live' : 'all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [onlyPositiveEv, setOnlyPositiveEv] = useState<boolean>(false);
  const [minConsensus, setMinConsensus] = useState<number>(0);
  const [selectedPickByMatch, setSelectedPickByMatch] = useState<Record<string, string>>({});
  const [recentBetPickId, setRecentBetPickId] = useState<string | null>(null);

  useEffect(() => {
    setDayFilter(liveOnlyView ? 'live' : 'all');
  }, [liveOnlyView]);

  // Strictly restrict all displayed picks to Today and Tomorrow matches in the active timezone
  const todayTomorrowPicks = useMemo(() => {
    return picks.filter(
      (p) =>
        classifyMatchDayInTimeZone(
          p.match.kickoffTime,
          p.match.status,
          timeZone,
          p.match.matchDay
        ) !== null
    );
  }, [picks, timeZone]);

  const liveMatchCount = useMemo(() => {
    const ids = new Set<string>();
    for (const p of todayTomorrowPicks) {
      if (p.match.status === 'live') ids.add(p.match.id);
    }
    return ids.size;
  }, [todayTomorrowPicks]);

  const filteredPicks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return todayTomorrowPicks.filter((p) => {
      const mDay = classifyMatchDayInTimeZone(
        p.match.kickoffTime,
        p.match.status,
        timeZone,
        p.match.matchDay
      );
      if (!mDay) return false;
      if (dayFilter === 'live') {
        if (p.match.status !== 'live') return false;
      } else if (dayFilter !== 'all' && mDay !== dayFilter) {
        return false;
      }
      if (sportFilter !== 'all' && p.match.sport !== sportFilter) return false;
      if (onlyPositiveEv && p.ev <= 0.005) return false;
      if (minConsensus > 0 && p.consensusCount < minConsensus) return false;
      if (q) {
        const hay = `${p.match.homeTeam} ${p.match.awayTeam} ${p.match.league} ${p.marketLine.bookmaker}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [todayTomorrowPicks, dayFilter, sportFilter, onlyPositiveEv, minConsensus, searchQuery, timeZone]);

  // Group qualifying picks into individual Match Cards (1 card per match, ordered strictly by kickoff schedule across all sports)
  const matchGroups = useMemo<MatchGroup[]>(() => {
    const byMatch = new Map<string, EvaluatedPick[]>();
    for (const p of filteredPicks) {
      const list = byMatch.get(p.match.id);
      if (list) {
        list.push(p);
      } else {
        byMatch.set(p.match.id, [p]);
      }
    }

    const groups: MatchGroup[] = [];
    for (const [, matchPicks] of byMatch.entries()) {
      const sorted = [...matchPicks].sort((a, b) => b.ev - a.ev);
      groups.push({
        match: sorted[0].match,
        picks: sorted,
        bestPick: sorted[0],
      });
    }

    groups.sort((a, b) => {
      const timeDiff =
        new Date(a.match.kickoffTime).getTime() - new Date(b.match.kickoffTime).getTime();
      if (timeDiff !== 0) return timeDiff;
      return b.bestPick.ev - a.bestPick.ev;
    });
    return groups;
  }, [filteredPicks]);

  const handleQuickBetClick = (pick: EvaluatedPick) => {
    onQuickBet(pick);
    setRecentBetPickId(pick.pickId);
    setTimeout(() => {
      setRecentBetPickId((prev) => (prev === pick.pickId ? null : prev));
    }, 1800);
  };

  return (
    <div className="space-y-6 overflow-visible">

      {/* Model Switcher + Description Bar */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-1">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-slate-200/70 dark:bg-white/[0.04] dark:border dark:border-white/[0.08] dark:backdrop-blur-md w-fit">
            {MODEL_ORDER.map((mKey) => {
              const active = activeModel === mKey;
              return (
                <button
                  key={mKey}
                  type="button"
                  onClick={() => onChangeModel(mKey)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F] ${
                    active
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-[#ABF43F] dark:text-neutral-950'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {MODEL_META[mKey].shortName}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {MODEL_META[activeModel].description}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="self-start lg:self-center inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-white/[0.04] dark:backdrop-blur-md text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.08] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Actualizar cuotas</span>
        </button>
      </section>

      {/* Filters Toolbar */}
      <section className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08] dark:backdrop-blur-md w-fit">
            {SPORT_FILTERS.map((sf) => (
              <button
                key={sf.id}
                type="button"
                onClick={() => setSportFilter(sf.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sportFilter === sf.id
                    ? 'bg-slate-900 text-white dark:bg-white/[0.14] dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`}
              >
                {sf.label}
              </button>
            ))}
          </div>

          <div
            aria-label="Filtrar por estado y jornada (solo hoy y mañana)"
            className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08] dark:backdrop-blur-md w-fit"
          >
            {(
              [
                { id: 'all', label: 'Hoy y Mañana' },
                { id: 'live', label: 'En Vivo', count: liveMatchCount },
                { id: 'today', label: 'Hoy' },
                { id: 'tomorrow', label: 'Mañana' },
              ] as Array<{ id: DayFilter; label: string; count?: number }>
            ).map((df) => {
              const isLiveTab = df.id === 'live';
              const isActive = dayFilter === df.id;
              return (
                <button
                  key={df.id}
                  type="button"
                  onClick={() => setDayFilter(df.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? isLiveTab
                        ? 'bg-[#FF3B4B] text-white'
                        : 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                      : isLiveTab
                        ? 'text-[#FF3B4B] hover:bg-[#FF3B4B]/10'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                  }`}
                >
                  {isLiveTab && (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isActive ? 'bg-white' : 'bg-[#FF3B4B]'
                      }`}
                    />
                  )}
                  <span>{df.label}</span>
                  {typeof df.count === 'number' && (
                    <span
                      className={`font-mono tabular-nums text-[11px] px-1 rounded ${
                        isActive
                          ? 'bg-black/20 text-white'
                          : 'bg-[#FF3B4B]/15 text-[#FF3B4B]'
                      }`}
                    >
                      {df.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:flex-initial">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar equipo, liga o casa..."
              aria-label="Buscar partidos"
              className="w-full sm:w-56 pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] dark:backdrop-blur-md text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
            />
          </div>

          <button
            type="button"
            onClick={() => setOnlyPositiveEv((prev) => !prev)}
            className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              onlyPositiveEv
                ? 'bg-[#ABF43F] border-[#ABF43F] text-[#090909]'
                : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] dark:backdrop-blur-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.08]'
            }`}
          >
            Solo +EV
          </button>

          <button
            type="button"
            onClick={() => setMinConsensus((prev) => (prev === 3 ? 0 : 3))}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              minConsensus >= 3
                ? 'bg-slate-900 border-slate-900 text-white dark:bg-[#3FF4E5] dark:border-[#3FF4E5] dark:text-[#090909]'
                : 'border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] dark:backdrop-blur-md text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.08]'
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>Consenso ≥ 3/4</span>
          </button>
        </div>
      </section>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-[#FF3B4B]/40 bg-[#FF3B4B]/10 flex items-center justify-between gap-4 text-sm text-[#FF3B4B]"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs font-semibold underline whitespace-nowrap"
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Individual Match Cards Grid (with Team Crests + Glassmorphism Hover Scale) */}
      <section aria-label="Tarjetas de partidos y oportunidades" className="overflow-visible">
        {loading && picks.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 py-2 overflow-visible">
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={`skel-card-${idx}`}
                className="rounded-xl border border-slate-200 dark:border-white/[0.08] bg-white dark:bg-white/[0.04] p-5 space-y-4 animate-pulse"
              >
                <div className="flex justify-between">
                  <div className="h-3 w-28 bg-slate-200 dark:bg-white/10 rounded" />
                  <div className="h-3 w-14 bg-slate-200 dark:bg-white/10 rounded" />
                </div>
                <div className="flex items-center justify-between gap-3 py-2">
                  <div className="flex items-center gap-3">
                    <div className="h-11 w-11 rounded-xl bg-slate-200 dark:bg-white/10" />
                    <div className="h-4 w-24 bg-slate-200 dark:bg-white/10 rounded" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="h-4 w-24 bg-slate-200 dark:bg-white/10 rounded" />
                    <div className="h-11 w-11 rounded-xl bg-slate-200 dark:bg-white/10" />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 pt-3 border-t border-slate-100 dark:border-white/[0.06]">
                  {Array.from({ length: 4 }).map((__, i) => (
                    <div key={i} className="h-8 bg-slate-200 dark:bg-white/10 rounded" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : matchGroups.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white glass-panel py-14 px-6 text-center">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              No hay partidos que coincidan con los filtros actuales
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Prueba a cambiar el deporte, el modelo predictivo o desactivar los filtros activos.
            </p>
            <button
              type="button"
              onClick={() => {
                setSportFilter('all');
                setDayFilter('all');
                setSearchQuery('');
                setOnlyPositiveEv(false);
                setMinConsensus(0);
              }}
              className="mt-4 px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909] transition-colors"
            >
              Restablecer filtros
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 py-2 overflow-visible">
            {matchGroups.map(({ match, picks: matchPicks, bestPick }) => {
              const selectedId = selectedPickByMatch[match.id];
              const activePick =
                matchPicks.find((p) => p.pickId === selectedId) ?? bestPick;

              const sportMeta = SPORT_META[match.sport];
              const isHighScoring = match.sport === 'nba' || match.sport === 'football';
              const kickoff = formatTime24h(match.kickoffTime, timeZone);
              const oddsMovedUp =
                typeof activePick.prevOdds === 'number' &&
                activePick.odds > activePick.prevOdds;
              const oddsMovedDown =
                typeof activePick.prevOdds === 'number' &&
                activePick.odds < activePick.prevOdds;

              const marketSideText =
                activePick.side === 'over'
                  ? `Más de ${activePick.marketLine.line}`
                  : `Menos de ${activePick.marketLine.line}`;

              const tierLabel =
                activePick.confidenceTier === 'alto'
                  ? 'Valor alto'
                  : activePick.confidenceTier === 'moderado'
                    ? 'Valor medio'
                    : activePick.confidenceTier === 'marginal'
                      ? 'Marginal'
                      : 'Sin valor';

              const isRecentlyPlaced = recentBetPickId === activePick.pickId;
              const altPicks = matchPicks.slice(0, 3);
              const dayBucket = classifyMatchDayInTimeZone(
                match.kickoffTime,
                match.status,
                timeZone,
                match.matchDay
              );
              const dayLabel = dayBucket === 'tomorrow' ? 'Mañana' : 'Hoy';

              return (
                <article
                  key={match.id}
                  onClick={() => onInspectPick(activePick)}
                  className="glass-card rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between gap-4 cursor-pointer"
                >
                  {/* Top quiet metadata row (zero-pill discipline) */}
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div className="flex items-center gap-1.5 min-w-0 truncate">
                      <span className="font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">
                        {sportMeta.shortName}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">{match.league}</span>
                    </div>
                    <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
                      {match.status === 'live' ? (
                        <span className="inline-flex items-center gap-1.5 text-[#FF3B4B] font-semibold">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B4B]" />
                          Hoy · En vivo {match.liveClock ?? ''}
                        </span>
                      ) : (
                        `${dayLabel} · ${kickoff} ${tzLabel}`
                      )}
                    </span>
                  </div>

                  {/* Teams Matchup with Individual Crests */}
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-1">
                    {/* Home Team */}
                    <div className="flex flex-col items-center text-center min-w-0 gap-2">
                      <TeamCrest
                        teamName={match.homeTeam}
                        sport={match.sport}
                        logoUrl={match.homeLogo}
                        abbr={match.homeAbbr}
                        primaryColor={match.homeColor}
                        size="lg"
                      />
                      <div className="min-w-0 w-full">
                        <p
                          className="text-sm font-semibold text-slate-900 dark:text-slate-50 leading-snug line-clamp-2"
                          title={match.homeTeam}
                        >
                          {match.homeTeam}
                        </p>
                        <p className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {sportMeta.rateLabel}{' '}
                          {match.homeLambda.toFixed(isHighScoring ? 1 : 2)} · Elo {match.homeElo}
                        </p>
                      </div>
                    </div>

                    {/* Center VS / Live Score */}
                    <div className="flex flex-col items-center justify-center px-1 shrink-0">
                      {match.status === 'live' && match.liveScore ? (
                        <div className="font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-50 tracking-tight">
                          {match.liveScore.home} - {match.liveScore.away}
                        </div>
                      ) : (
                        <span className="text-xs font-mono font-semibold text-slate-400 dark:text-slate-500">
                          vs
                        </span>
                      )}
                      <span className="mt-1 text-[10px] font-mono tabular-nums text-slate-400 dark:text-slate-500 whitespace-nowrap">
                        Σ {(match.homeLambda + match.awayLambda).toFixed(isHighScoring ? 1 : 2)}
                      </span>
                    </div>

                    {/* Away Team */}
                    <div className="flex flex-col items-center text-center min-w-0 gap-2">
                      <TeamCrest
                        teamName={match.awayTeam}
                        sport={match.sport}
                        logoUrl={match.awayLogo}
                        abbr={match.awayAbbr}
                        primaryColor={match.awayColor}
                        size="lg"
                      />
                      <div className="min-w-0 w-full">
                        <p
                          className="text-sm font-semibold text-slate-900 dark:text-slate-50 leading-snug line-clamp-2"
                          title={match.awayTeam}
                        >
                          {match.awayTeam}
                        </p>
                        <p className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {sportMeta.rateLabel}{' '}
                          {match.awayLambda.toFixed(isHighScoring ? 1 : 2)} · Elo {match.awayElo}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Line / Side Interactive Selector (when multiple lines/sides qualify for this match) */}
                  {altPicks.length > 1 && (
                    <div
                      className="flex items-center gap-1 p-1 rounded-lg bg-slate-100/90 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.07]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {altPicks.map((cand) => {
                        const isSel = cand.pickId === activePick.pickId;
                        const shortSide =
                          cand.side === 'over'
                            ? `Más ${cand.marketLine.line}`
                            : `Menos ${cand.marketLine.line}`;
                        return (
                          <button
                            key={cand.pickId}
                            type="button"
                            onClick={() =>
                              setSelectedPickByMatch((prev) => ({
                                ...prev,
                                [match.id]: cand.pickId,
                              }))
                            }
                            className={`flex-1 px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap truncate ${
                              isSel
                                ? 'bg-white text-slate-900 shadow-xs dark:bg-[#ABF43F] dark:text-[#090909]'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                            }`}
                          >
                            {shortSide}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Recommended Pick & Quantitative Edge Block */}
                  <div className="pt-3.5 border-t border-slate-200/90 dark:border-white/[0.08] space-y-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {marketSideText}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {activePick.marketLine.bookmaker} · {tierLabel} · Consenso{' '}
                          <span className="font-mono tabular-nums">
                            {activePick.consensusCount}/4
                          </span>
                        </p>
                      </div>

                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className="inline-flex items-center justify-end gap-0.5 text-base font-bold text-slate-900 dark:text-slate-50">
                          <span>{activePick.odds.toFixed(2)}</span>
                          {oddsMovedUp && (
                            <ArrowUpRight
                              aria-label="Cuota al alza"
                              className="h-3.5 w-3.5 text-[#ABF43F]"
                            />
                          )}
                          {oddsMovedDown && (
                            <ArrowDownRight
                              aria-label="Cuota a la baja"
                              className="h-3.5 w-3.5 text-[#FF3B4B]"
                            />
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Justa {activePick.fairOdds.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {/* 4-Metric Quantitative Strip */}
                    <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.06] text-xs">
                      <div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">Modelo</p>
                        <p className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {(activePick.modelProb * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">Edge</p>
                        <p
                          className={`mt-0.5 font-mono tabular-nums font-semibold ${
                            activePick.edge >= 0
                              ? 'text-slate-900 dark:text-[#ABF43F]'
                              : 'text-[#FF3B4B]'
                          }`}
                        >
                          {activePick.edge >= 0 ? '+' : ''}
                          {(activePick.edge * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">Valor EV</p>
                        <p
                          className={`mt-0.5 font-mono tabular-nums font-semibold ${
                            activePick.ev >= 0.045
                              ? 'text-slate-900 dark:text-[#ABF43F]'
                              : activePick.ev > 0
                                ? 'text-slate-800 dark:text-[#3FF4E5]'
                                : 'text-[#FF3B4B]'
                          }`}
                        >
                          {activePick.ev >= 0 ? '+' : ''}
                          {(activePick.ev * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">Kelly</p>
                        <p className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                          {activePick.recommendedStake > 0
                            ? `${currencySymbol}${activePick.recommendedStake.toFixed(0)}`
                            : '—'}
                        </p>
                      </div>
                    </div>

                    {/* Model vs Implied Comparison Bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        <span>Modelo {(activePick.modelProb * 100).toFixed(1)}%</span>
                        <span>Implícita {(activePick.impliedProb * 100).toFixed(1)}%</span>
                      </div>
                      <div className="relative h-1.5 w-full rounded-full bg-slate-100 dark:bg-white/[0.08] overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full bg-[#3FF4E5]/45"
                          style={{ width: `${Math.min(100, activePick.impliedProb * 100)}%` }}
                        />
                        <div
                          className={`absolute inset-y-0 left-0 rounded-full ${
                            activePick.ev >= 0
                              ? 'bg-[#ABF43F]'
                              : 'bg-[#FF3B4B]'
                          }`}
                          style={{
                            width: `${Math.min(100, activePick.modelProb * 100)}%`,
                            opacity: 0.9,
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Card Footer Actions */}
                  <div
                    className="pt-3 border-t border-slate-200/90 dark:border-white/[0.08] flex items-center justify-between gap-2.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onInspectPick(activePick)}
                      className="flex-1 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/[0.1] bg-transparent dark:bg-white/[0.03] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors whitespace-nowrap"
                    >
                      Analizar
                    </button>
                    {activePick.ev > 0 && (
                      <button
                        type="button"
                        onClick={() => handleQuickBetClick(activePick)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-[#ABF43F] hover:bg-[#bdf762] text-[#090909] transition-colors whitespace-nowrap"
                      >
                        {isRecentlyPlaced ? (
                          <>
                            <Check className="h-3.5 w-3.5" />
                            <span>Registrada</span>
                          </>
                        ) : (
                          <span>Apostar</span>
                        )}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
