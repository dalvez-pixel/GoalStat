import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getChartTheme } from '../lib/chartTheme.ts';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type { BetRecord, ModelType, SportId } from '../types/quant.ts';
import { ModelOverlayD3Chart } from './ModelOverlayD3Chart.tsx';

interface SportStatsViewProps {
  theme: 'dark' | 'light';
  bets: BetRecord[];
  currencySymbol: string;
  sportFilter?: SportId | 'all';
  onChangeSportFilter?: (sport: SportId | 'all') => void;
}

const SPORT_IDS: SportId[] = ['soccer', 'nba', 'nhl', 'football'];
const MODEL_IDS: ModelType[] = [
  'bivariate-poisson-xg-elo',
  'ensemble',
  'dixon-coles',
  'negative-binomial',
  'ml-gbdt',
];

export const SportStatsView: React.FC<SportStatsViewProps> = ({
  theme,
  bets,
  currencySymbol,
  sportFilter,
  onChangeSportFilter,
}) => {
  const chartTheme = useMemo(() => getChartTheme(theme), [theme]);
  const [internalSport, setInternalSport] = useState<SportId | 'all'>('all');
  const selectedSport = sportFilter ?? internalSport;
  const setSelectedSport = (next: SportId | 'all') => {
    if (onChangeSportFilter) {
      onChangeSportFilter(next);
    } else {
      setInternalSport(next);
    }
  };

  const settled = useMemo(
    () => bets.filter((b) => b.status === 'won' || b.status === 'lost'),
    [bets]
  );

  // Per-sport detailed stats
  const sportMetrics = useMemo(() => {
    return SPORT_IDS.map((sid) => {
      const rows = settled.filter((b) => b.sport === sid);
      const won = rows.filter((b) => b.status === 'won');
      const staked = rows.reduce((a, b) => a + b.stake, 0);
      const pnl = rows.reduce((a, b) => a + b.pnl, 0);
      const yieldPct = staked > 0 ? (pnl / staked) * 100 : 0;
      const winRate = rows.length > 0 ? (won.length / rows.length) * 100 : 0;
      const expectedWinRate =
        rows.length > 0
          ? (rows.reduce((a, b) => a + b.modelProb, 0) / rows.length) * 100
          : 0;
      const avgClv =
        rows.length > 0
          ? (rows.reduce((a, b) => a + (b.odds / b.closingOdds - 1), 0) / rows.length) * 100
          : 0;
      const brierScore =
        rows.length > 0
          ? rows.reduce((acc, b) => {
              const y = b.status === 'won' ? 1 : 0;
              return acc + Math.pow(b.modelProb - y, 2);
            }, 0) / rows.length
          : 0;
      const overs = rows.filter((b) => b.side === 'over');
      const unders = rows.filter((b) => b.side === 'under');
      const overYield =
        overs.reduce((a, b) => a + b.stake, 0) > 0
          ? (overs.reduce((a, b) => a + b.pnl, 0) / overs.reduce((a, b) => a + b.stake, 0)) * 100
          : 0;
      const underYield =
        unders.reduce((a, b) => a + b.stake, 0) > 0
          ? (unders.reduce((a, b) => a + b.pnl, 0) / unders.reduce((a, b) => a + b.stake, 0)) *
            100
          : 0;

      return {
        sport: sid,
        name: SPORT_META[sid].name,
        shortName: SPORT_META[sid].shortName,
        color: SPORT_META[sid].color,
        picks: rows.length,
        won: won.length,
        staked,
        pnl,
        yieldPct: Math.round(yieldPct * 100) / 100,
        winRate,
        expectedWinRate,
        avgClv,
        brierScore,
        overCount: overs.length,
        underCount: unders.length,
        overYield,
        underYield,
      };
    });
  }, [settled]);

  // Comparative model performance benchmark (filtered by selected sport or all)
  const modelMetrics = useMemo(() => {
    const scope =
      selectedSport === 'all' ? settled : settled.filter((b) => b.sport === selectedSport);

    return MODEL_IDS.map((mid) => {
      const rows = scope.filter((b) => b.modelUsed === mid);
      const won = rows.filter((b) => b.status === 'won');
      const staked = rows.reduce((a, b) => a + b.stake, 0);
      const pnl = rows.reduce((a, b) => a + b.pnl, 0);
      const yieldPct = staked > 0 ? (pnl / staked) * 100 : 0;
      const winRate = rows.length > 0 ? (won.length / rows.length) * 100 : 0;
      const avgEv =
        rows.length > 0 ? (rows.reduce((a, b) => a + b.ev, 0) / rows.length) * 100 : 0;
      const avgClv =
        rows.length > 0
          ? (rows.reduce((a, b) => a + (b.odds / b.closingOdds - 1), 0) / rows.length) * 100
          : 0;
      const brierScore =
        rows.length > 0
          ? rows.reduce((acc, b) => {
              const y = b.status === 'won' ? 1 : 0;
              return acc + Math.pow(b.modelProb - y, 2);
            }, 0) / rows.length
          : 0;

      return {
        modelType: mid,
        name: MODEL_META[mid].name,
        shortName: MODEL_META[mid].shortName,
        color: MODEL_META[mid].accentColor,
        picks: rows.length,
        won: won.length,
        staked,
        pnl,
        yieldPct: Math.round(yieldPct * 100) / 100,
        winRate,
        avgEv,
        avgClv,
        brierScore,
      };
    });
  }, [settled, selectedSport]);

  const activeSportDetail =
    selectedSport === 'all'
      ? null
      : sportMetrics.find((s) => s.sport === selectedSport) ?? null;

  return (
    <div className="space-y-6 overflow-visible">
      {/* Sport Selector Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-white/60 dark:bg-white/[0.04] backdrop-blur-md border border-slate-900/[0.08] dark:border-white/[0.08]">
          <button
            type="button"
            onClick={() => setSelectedSport('all')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              selectedSport === 'all'
                ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            Vista global
          </button>
          {SPORT_IDS.map((sid) => (
            <button
              key={sid}
              type="button"
              onClick={() => setSelectedSport(sid)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                selectedSport === sid
                  ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {SPORT_META[sid].name}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Base analizada: <span className="font-mono tabular-nums">{settled.length}</span> picks liquidados
        </p>
      </div>

      {/* Per-Sport Summary Grid — 4 Glassmorphism + Hover Scale Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 py-1 overflow-visible">
        {sportMetrics.map((sm) => {
          const isFocused = selectedSport === sm.sport;
          return (
            <button
              key={sm.sport}
              type="button"
              onClick={() =>
                setSelectedSport(selectedSport === sm.sport ? 'all' : sm.sport)
              }
              className={`glass-card rounded-xl p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F] ${
                isFocused ? 'glass-card-active' : ''
              }`}
            >
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-800 dark:text-slate-200">{sm.name}</span>
                <span className="font-mono tabular-nums">{sm.picks} picks</span>
              </div>
              <p
                className={`mt-2 font-mono tabular-nums text-2xl font-semibold ${
                  sm.yieldPct >= 0
                    ? 'text-slate-900 dark:text-[#ABF43F]'
                    : 'text-[#FF3B4B]'
                }`}
              >
                {sm.yieldPct >= 0 ? '+' : ''}
                {sm.yieldPct.toFixed(2)}%{' '}
                <span className="text-xs font-sans font-normal text-slate-500 dark:text-slate-400">
                  yield
                </span>
              </p>
              <div className="mt-2 flex items-center justify-between text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                <span className={sm.pnl < 0 ? 'text-[#FF3B4B]' : ''}>
                  {sm.pnl >= 0 ? '+' : ''}
                  {currencySymbol}
                  {sm.pnl.toFixed(2)}
                </span>
                <span>Acierto {sm.winRate.toFixed(1)}%</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span className={sm.avgClv < 0 ? 'text-[#FF3B4B]' : ''}>
                  CLV {sm.avgClv >= 0 ? '+' : ''}{sm.avgClv.toFixed(2)}%
                </span>
                <span>Brier {sm.brierScore.toFixed(3)}</span>
              </div>
            </button>
          );
        })}
      </section>

      {/* Focused Sport Deep Dive Banner (when a single sport is selected) */}
      {activeSportDetail && (
        <section className="glass-panel glass-panel-hover border border-slate-200 rounded-xl bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-white/[0.08]">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Diagnóstico Detallado · {activeSportDetail.name}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Desglose entre mercados Más de (Over) y Menos de (Under) y calibración probabilística
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Esperado {activeSportDetail.expectedWinRate.toFixed(1)}% vs Real{' '}
              {activeSportDetail.winRate.toFixed(1)}%
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Yield en Más (Over)</p>
              <p
                className={`mt-1 font-mono tabular-nums text-lg font-semibold ${
                  activeSportDetail.overYield >= 0
                    ? 'text-slate-900 dark:text-[#ABF43F]'
                    : 'text-[#FF3B4B]'
                }`}
              >
                {activeSportDetail.overYield >= 0 ? '+' : ''}
                {activeSportDetail.overYield.toFixed(2)}%
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {activeSportDetail.overCount} operaciones
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Yield en Menos (Under)</p>
              <p
                className={`mt-1 font-mono tabular-nums text-lg font-semibold ${
                  activeSportDetail.underYield >= 0
                    ? 'text-slate-900 dark:text-[#ABF43F]'
                    : 'text-[#FF3B4B]'
                }`}
              >
                {activeSportDetail.underYield >= 0 ? '+' : ''}
                {activeSportDetail.underYield.toFixed(2)}%
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {activeSportDetail.underCount} operaciones
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Calibración (Brier Score)</p>
              <p className="mt-1 font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-50">
                {activeSportDetail.brierScore.toFixed(3)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Referencia aleatoria: 0.250
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Volumen apostado</p>
              <p className="mt-1 font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-50">
                {currencySymbol}
                {activeSportDetail.staked.toFixed(2)}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                CLV medio +{activeSportDetail.avgClv.toFixed(2)}%
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Interactive D3 Multi-Model Overlay Line Chart (Yield & Brier Score Over Time) */}
      <ModelOverlayD3Chart theme={theme} bets={bets} selectedSport={selectedSport} />

      {/* Charts Split: Yield by Sport + Model Benchmark Comparison */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 overflow-visible">
        <section className="glass-panel glass-panel-hover border border-slate-200 rounded-xl bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Yield (%) y Beneficio Neto por Deporte
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Rentabilidad porcentual sobre volumen apostado en cada disciplina
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sportMetrics} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
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
                <Tooltip
                  cursor={{ fill: chartTheme.cursorFill }}
                  formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, 'Yield']}
                  contentStyle={chartTheme.tooltipContentStyle}
                  labelStyle={chartTheme.tooltipLabelStyle}
                  itemStyle={chartTheme.tooltipItemStyle}
                />
                <Bar dataKey="yieldPct" radius={[4, 4, 0, 0]}>
                  {sportMetrics.map((entry) => (
                    <Cell
                      key={entry.sport}
                      fill={entry.yieldPct >= 0 ? entry.color : '#FF3B4B'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="glass-panel glass-panel-hover border border-slate-200 rounded-xl bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Rendimiento por Modelo Predictivo ({selectedSport === 'all' ? 'Todos' : SPORT_META[selectedSport].shortName})
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            Comparativa histórica de Yield (%) entre Poisson Bivariado xG+Elo, Dixon-Coles, Neg. Binomial, ML GBDT y Ensemble
          </p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelMetrics} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
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
                <Tooltip
                  cursor={{ fill: chartTheme.cursorFill }}
                  formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, 'Yield']}
                  contentStyle={chartTheme.tooltipContentStyle}
                  labelStyle={chartTheme.tooltipLabelStyle}
                  itemStyle={chartTheme.tooltipItemStyle}
                />
                <Legend wrapperStyle={{ ...chartTheme.legendStyle, fontSize: '11px' }} />
                <Bar dataKey="yieldPct" name="Yield (%)" radius={[4, 4, 0, 0]}>
                  {modelMetrics.map((entry) => (
                    <Cell
                      key={entry.modelType}
                      fill={entry.yieldPct >= 0 ? entry.color : '#FF3B4B'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      {/* Detailed Model Benchmark Table */}
      <section className="glass-panel border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.08]">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Tabla Comparativa de Modelos Cuantitativos y Calibración
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Evaluación de precisión (Brier Score menor = mejor calibración), Yield y ventaja frente al cierre (CLV)
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/[0.08] bg-slate-50/80 dark:bg-white/[0.03] text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Modelo Predictivo</th>
                <th className="py-3 px-3 font-medium text-right">Picks</th>
                <th className="py-3 px-3 font-medium text-right">Acierto</th>
                <th className="py-3 px-3 font-medium text-right">EV Medio</th>
                <th className="py-3 px-3 font-medium text-right">CLV Medio</th>
                <th className="py-3 px-3 font-medium text-right">Brier Score</th>
                <th className="py-3 px-3 font-medium text-right">P&L Neto</th>
                <th className="py-3 px-4 font-medium text-right">Yield</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-white/[0.06]">
              {modelMetrics.map((m) => (
                <tr
                  key={m.modelType}
                  className="hover:bg-slate-50/80 dark:hover:bg-white/[0.05] transition-colors"
                >
                  <td className="py-3 px-4">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{m.name}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {MODEL_META[m.modelType].description}
                    </p>
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {m.picks}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {m.picks > 0 ? `${m.winRate.toFixed(1)}%` : '—'}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {m.picks > 0 ? `+${m.avgEv.toFixed(2)}%` : '—'}
                  </td>
                  <td
                    className={`py-3 px-3 text-right font-mono tabular-nums ${
                      m.avgClv >= 0 ? 'text-slate-900 dark:text-[#3FF4E5]' : 'text-[#FF3B4B]'
                    }`}
                  >
                    {m.picks > 0 ? `${m.avgClv >= 0 ? '+' : ''}${m.avgClv.toFixed(2)}%` : '—'}
                  </td>
                  <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {m.picks > 0 ? m.brierScore.toFixed(3) : '—'}
                  </td>
                  <td
                    className={`py-3 px-3 text-right font-mono tabular-nums font-semibold ${
                      m.pnl >= 0
                        ? 'text-slate-900 dark:text-[#ABF43F]'
                        : 'text-[#FF3B4B]'
                    }`}
                  >
                    {m.picks > 0
                      ? `${m.pnl >= 0 ? '+' : ''}${currencySymbol}${m.pnl.toFixed(2)}`
                      : '—'}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-mono tabular-nums font-semibold ${
                      m.yieldPct >= 0
                        ? 'text-slate-900 dark:text-[#ABF43F]'
                        : 'text-[#FF3B4B]'
                    }`}
                  >
                    {m.picks > 0 ? `${m.yieldPct >= 0 ? '+' : ''}${m.yieldPct.toFixed(2)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
