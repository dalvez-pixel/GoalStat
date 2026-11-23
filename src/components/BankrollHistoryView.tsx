import { Calendar, Check, Minus, RotateCcw, Trash2, X } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type {
  BankrollConfig,
  BankrollStrategy,
  BetRecord,
  BetStatus,
  SportId,
} from '../types/quant.ts';

interface BankrollHistoryViewProps {
  bets: BetRecord[];
  bankrollConfig: BankrollConfig;
  currentBankroll: number;
  currencySymbol: string;
  onUpdateConfig: (next: BankrollConfig) => void;
  onSettleBet: (betId: string, status: Exclude<BetStatus, 'pending'>) => void;
  onDeleteBet: (betId: string) => void;
}

type DateRangePreset = 'all' | '7d' | '30d' | '90d' | 'month' | 'custom';

const DATE_PRESETS: Array<{ id: Exclude<DateRangePreset, 'custom'>; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: '90d', label: '90 días' },
  { id: 'month', label: 'Este mes' },
];

const STRATEGY_LABELS: Record<BankrollStrategy, string> = {
  'kelly-quarter': 'Kelly Fraccional (1/4)',
  'kelly-half': 'Kelly Medio (1/2)',
  'kelly-full': 'Kelly Completo (1x)',
  'flat-percent': 'Porcentaje Fijo del Bankroll',
  'flat-fixed': 'Importe Fijo Plano',
};

function toDateInputValue(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const BankrollHistoryView: React.FC<BankrollHistoryViewProps> = ({
  bets,
  bankrollConfig,
  currentBankroll,
  currencySymbol,
  onUpdateConfig,
  onSettleBet,
  onDeleteBet,
}) => {
  const [statusFilter, setStatusFilter] = useState<BetStatus | 'all'>('all');
  const [sportFilter, setSportFilter] = useState<SportId | 'all'>('all');
  const [datePreset, setDatePreset] = useState<DateRangePreset>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Anchor relative presets (7d, 30d, 90d, Este mes) to the latest bet date or today
  const anchorDate = useMemo(() => {
    const now = new Date();
    if (bets.length === 0) return now;
    const maxBetTime = Math.max(...bets.map((b) => new Date(b.date).getTime()));
    return new Date(Math.max(now.getTime(), maxBetTime));
  }, [bets]);

  const applyDatePreset = (preset: Exclude<DateRangePreset, 'custom'>) => {
    setDatePreset(preset);
    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
      return;
    }

    const end = new Date(anchorDate);
    const start = new Date(anchorDate);
    if (preset === '7d') {
      start.setDate(start.getDate() - 6);
    } else if (preset === '30d') {
      start.setDate(start.getDate() - 29);
    } else if (preset === '90d') {
      start.setDate(start.getDate() - 89);
    } else if (preset === 'month') {
      start.setDate(1);
    }

    setStartDate(toDateInputValue(start));
    setEndDate(toDateInputValue(end));
  };

  const isDateFiltered = Boolean(startDate || endDate);

  const rangeBounds = useMemo(() => {
    const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;
    return { startMs, endMs };
  }, [startDate, endDate]);

  const analytics = useMemo(() => {
    const chronological = [...bets].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const { startMs, endMs } = rangeBounds;

    // Bankroll carried into the selected period (initial + settled P&L strictly before startDate)
    const priorPnl =
      startMs !== null
        ? chronological
            .filter(
              (b) =>
                (b.status === 'won' || b.status === 'lost') &&
                new Date(b.date).getTime() < startMs
            )
            .reduce((acc, b) => acc + b.pnl, 0)
        : 0;

    const rangeStartBankroll = Math.max(
      0,
      Math.round((bankrollConfig.initialBankroll + priorPnl) * 100) / 100
    );

    const inRange = chronological.filter((b) => {
      const t = new Date(b.date).getTime();
      if (startMs !== null && t < startMs) return false;
      if (endMs !== null && t > endMs) return false;
      return true;
    });

    const settled = inRange.filter((b) => b.status === 'won' || b.status === 'lost');
    const pending = inRange.filter((b) => b.status === 'pending');
    const won = settled.filter((b) => b.status === 'won');

    const totalStaked = settled.reduce((acc, b) => acc + b.stake, 0);
    const netPnl = settled.reduce((acc, b) => acc + b.pnl, 0);
    const endingBankroll = Math.max(0, Math.round((rangeStartBankroll + netPnl) * 100) / 100);
    const yieldPct = totalStaked > 0 ? (netPnl / totalStaked) * 100 : 0;
    const roiBankroll =
      rangeStartBankroll > 0 ? (netPnl / rangeStartBankroll) * 100 : 0;
    const winRate = settled.length > 0 ? (won.length / settled.length) * 100 : 0;
    const pendingExposure = pending.reduce((acc, b) => acc + b.stake, 0);
    const avgClv =
      settled.length > 0
        ? (settled.reduce((acc, b) => acc + (b.odds / b.closingOdds - 1), 0) / settled.length) *
          100
        : 0;

    // Build Equity Curve (Real vs Expected EV) & Max Drawdown within selected range
    let runningReal = rangeStartBankroll;
    let runningExpected = rangeStartBankroll;
    let peak = rangeStartBankroll;
    let maxDrawdownPct = 0;

    const startLabel = startDate
      ? new Date(`${startDate}T12:00:00`).toLocaleDateString('es-ES', {
          day: '2-digit',
          month: 'short',
        })
      : 'Inicio';

    const curve: Array<{ label: string; real: number; esperado: number }> = [
      { label: startLabel, real: runningReal, esperado: runningExpected },
    ];

    for (const b of settled) {
      runningReal += b.pnl;
      runningExpected += b.stake * b.ev;
      if (runningReal > peak) peak = runningReal;
      const dd = peak > 0 ? ((peak - runningReal) / peak) * 100 : 0;
      if (dd > maxDrawdownPct) maxDrawdownPct = dd;

      const dLabel = new Date(b.date).toLocaleDateString('es-ES', {
        day: '2-digit',
        month: 'short',
      });
      curve.push({
        label: dLabel,
        real: Math.round(runningReal * 100) / 100,
        esperado: Math.round(runningExpected * 100) / 100,
      });
    }

    return {
      inRangeCount: inRange.length,
      rangeStartBankroll,
      endingBankroll,
      settledCount: settled.length,
      wonCount: won.length,
      pendingCount: pending.length,
      pendingExposure,
      totalStaked,
      netPnl,
      yieldPct,
      roiBankroll,
      winRate,
      avgClv,
      maxDrawdownPct,
      curve,
    };
  }, [bets, bankrollConfig.initialBankroll, rangeBounds, startDate]);

  const filteredBets = useMemo(() => {
    const { startMs, endMs } = rangeBounds;
    return [...bets]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .filter((b) => {
        const t = new Date(b.date).getTime();
        if (startMs !== null && t < startMs) return false;
        if (endMs !== null && t > endMs) return false;
        if (statusFilter !== 'all' && b.status !== statusFilter) return false;
        if (sportFilter !== 'all' && b.sport !== sportFilter) return false;
        return true;
      });
  }, [bets, statusFilter, sportFilter, rangeBounds]);

  const displayBankroll = isDateFiltered ? analytics.endingBankroll : currentBankroll;

  return (
    <div className="space-y-6 overflow-visible">
      {/* Custom Date Range Selector Bar */}
      <section
        aria-label="Selector de rango de fechas"
        className="glass-panel border border-slate-200 rounded-xl bg-white px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100 whitespace-nowrap">
            <Calendar className="h-4 w-4 text-slate-900 dark:text-[#ABF43F]" />
            <span>Rango temporal</span>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08]">
            {DATE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyDatePreset(preset.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  datePreset === preset.id
                    ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap">Desde</span>
            <input
              type="date"
              aria-label="Fecha de inicio"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => {
                setStartDate(e.target.value);
                setDatePreset(e.target.value || endDate ? 'custom' : 'all');
              }}
              className="px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-[#141418] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
            />
          </label>

          <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="whitespace-nowrap">Hasta</span>
            <input
              type="date"
              aria-label="Fecha de fin"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => {
                setEndDate(e.target.value);
                setDatePreset(startDate || e.target.value ? 'custom' : 'all');
              }}
              className="px-2.5 py-1.5 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-[#141418] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
            />
          </label>

          {isDateFiltered && (
            <button
              type="button"
              onClick={() => applyDatePreset('all')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors whitespace-nowrap"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Todo</span>
            </button>
          )}
        </div>
      </section>
      {/* KPI Summary Strip — 4 Glassmorphism + Hover Scale Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 py-1 overflow-visible">
        <div className="glass-card rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {isDateFiltered ? 'Bankroll al cierre del rango' : 'Bankroll actual'}
          </p>
          <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {currencySymbol}
            {displayBankroll.toLocaleString('es-ES', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
          <p
            className={`mt-1 text-xs font-mono tabular-nums ${
              analytics.roiBankroll >= 0
                ? 'text-slate-900 dark:text-[#ABF43F]'
                : 'text-[#FF3B4B]'
            }`}
          >
            {analytics.roiBankroll >= 0 ? '+' : ''}
            {analytics.roiBankroll.toFixed(2)}%{' '}
            {isDateFiltered
              ? `(inicio ${currencySymbol}${analytics.rangeStartBankroll.toFixed(0)})`
              : 'crecimiento s/ capital inicial'}
          </p>
        </div>

        <div className="glass-card rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Beneficio neto y Yield
          </p>
          <p
            className={`mt-1.5 font-mono tabular-nums text-2xl font-semibold ${
              analytics.netPnl >= 0
                ? 'text-slate-900 dark:text-[#ABF43F]'
                : 'text-[#FF3B4B]'
            }`}
          >
            {analytics.netPnl >= 0 ? '+' : ''}
            {currencySymbol}
            {analytics.netPnl.toFixed(2)}
          </p>
          <p className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Yield:{' '}
            <span className={analytics.yieldPct < 0 ? 'text-[#FF3B4B]' : ''}>
              {analytics.yieldPct >= 0 ? '+' : ''}
              {analytics.yieldPct.toFixed(2)}%
            </span>{' '}
            · Vol. {currencySymbol}
            {analytics.totalStaked.toFixed(0)}
          </p>
        </div>

        <div className="glass-card rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Acierto y CLV medio
          </p>
          <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {analytics.winRate.toFixed(1)}%{' '}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
              ({analytics.wonCount}/{analytics.settledCount})
            </span>
          </p>
          <p
            className={`mt-1 text-xs font-mono tabular-nums ${
              analytics.avgClv >= 0 ? 'text-slate-900 dark:text-[#3FF4E5]' : 'text-[#FF3B4B]'
            }`}
          >
            CLV vs cierre: {analytics.avgClv >= 0 ? '+' : ''}
            {analytics.avgClv.toFixed(2)}%
          </p>
        </div>

        <div className="glass-card rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Drawdown máximo y riesgo
          </p>
          <p
            className={`mt-1.5 font-mono tabular-nums text-2xl font-semibold ${
              analytics.maxDrawdownPct > 0
                ? 'text-[#FF3B4B]'
                : 'text-slate-900 dark:text-slate-50'
            }`}
          >
            -{analytics.maxDrawdownPct.toFixed(2)}%
          </p>
          <p className="mt-1 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
            Pendiente: {currencySymbol}
            {analytics.pendingExposure.toFixed(2)} ({analytics.pendingCount} picks)
          </p>
        </div>
      </section>

      {/* Equity Curve + Automated Bankroll Rules */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch overflow-visible">
        {/* Equity Curve */}
        <section className="xl:col-span-8 glass-panel glass-panel-hover border border-slate-200 rounded-xl bg-white p-5 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Curva de Capital (Real vs Valor Esperado Teórico)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isDateFiltered
                  ? `Mostrando ${analytics.settledCount} operaciones liquidadas en el rango seleccionado (inicio ${currencySymbol}${analytics.rangeStartBankroll.toFixed(2)})`
                  : 'Evolución acumulada del bankroll liquidado frente a la expectativa matemática (+EV)'}
              </p>
            </div>
          </div>

          <div className="h-72 w-full flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={analytics.curve}
                margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="realEquityGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ABF43F" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#ABF43F" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `${currencySymbol}${v}`}
                  tick={{ fontSize: 11, fill: '#94A3B8' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  formatter={(val: unknown, name: unknown) => [
                    `${currencySymbol}${Number(val).toFixed(2)}`,
                    name === 'real' ? 'Bankroll Real' : 'Curva +EV Esperada',
                  ]}
                  contentStyle={{
                    backgroundColor: 'rgba(12, 12, 14, 0.92)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    borderRadius: '10px',
                    color: '#F8FAFC',
                    fontSize: '12px',
                    backdropFilter: 'blur(12px)',
                  }}
                />
                <Legend
                  formatter={(v) => (v === 'real' ? 'Bankroll Real' : 'EV Esperado')}
                  wrapperStyle={{ fontSize: '12px' }}
                />
                <Area
                  type="monotone"
                  dataKey="real"
                  stroke="#ABF43F"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#realEquityGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="esperado"
                  stroke="#3FF4E5"
                  strokeWidth={1.75}
                  strokeDasharray="4 4"
                  fill="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Automated Bankroll Management Rules */}
        <section className="xl:col-span-4 glass-panel glass-panel-hover border border-slate-200 rounded-xl bg-white p-5 space-y-4">
          <div className="border-b border-slate-200 dark:border-white/[0.08] pb-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Gestión Automatizada de Bankroll
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Recalcula automáticamente los stakes sugeridos en tiempo real
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Capital inicial</span>
              <input
                type="number"
                min={100}
                step={50}
                value={bankrollConfig.initialBankroll}
                onChange={(e) =>
                  onUpdateConfig({
                    ...bankrollConfig,
                    initialBankroll: Math.max(100, Number(e.target.value) || 100),
                  })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.05] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              />
            </label>

            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">Divisa</span>
              <select
                value={bankrollConfig.currency}
                onChange={(e) =>
                  onUpdateConfig({
                    ...bankrollConfig,
                    currency: e.target.value as 'EUR' | 'USD',
                  })
                }
                className="mt-1 w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-[#141418] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              >
                <option value="EUR">EUR (€)</option>
                <option value="USD">USD ($)</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Método de dimensionamiento (Staking)
            </span>
            <select
              value={bankrollConfig.strategy}
              onChange={(e) =>
                onUpdateConfig({
                  ...bankrollConfig,
                  strategy: e.target.value as BankrollStrategy,
                })
              }
              className="mt-1 w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-[#141418] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
            >
              {(Object.keys(STRATEGY_LABELS) as BankrollStrategy[]).map((sKey) => (
                <option key={sKey} value={sKey}>
                  {STRATEGY_LABELS[sKey]}
                </option>
              ))}
            </select>
          </label>

          {bankrollConfig.strategy === 'flat-percent' && (
            <label className="block">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">Porcentaje plano por pick</span>
                <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {bankrollConfig.flatPercent.toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={6}
                step={0.25}
                value={bankrollConfig.flatPercent}
                onChange={(e) =>
                  onUpdateConfig({ ...bankrollConfig, flatPercent: Number(e.target.value) })
                }
                className="mt-1 w-full accent-[#ABF43F]"
              />
            </label>
          )}

          {bankrollConfig.strategy === 'flat-fixed' && (
            <label className="block">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Importe fijo por pick ({currencySymbol})
              </span>
              <input
                type="number"
                min={5}
                step={5}
                value={bankrollConfig.flatFixed}
                onChange={(e) =>
                  onUpdateConfig({
                    ...bankrollConfig,
                    flatFixed: Math.max(5, Number(e.target.value) || 5),
                  })
                }
                className="mt-1 w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.05] text-slate-900 dark:text-slate-100"
              />
            </label>
          )}

          <label className="block">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Tope máximo por apuesta</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {bankrollConfig.maxStakePercent.toFixed(1)}% ({currencySymbol}
                {((bankrollConfig.maxStakePercent / 100) * currentBankroll).toFixed(0)})
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={bankrollConfig.maxStakePercent}
              onChange={(e) =>
                onUpdateConfig({ ...bankrollConfig, maxStakePercent: Number(e.target.value) })
              }
              className="mt-1 w-full accent-[#ABF43F]"
            />
          </label>

          <label className="block">
            <div className="flex justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">Stop-loss diario</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {bankrollConfig.dailyStopLossPercent.toFixed(0)}% ({currencySymbol}
                {((bankrollConfig.dailyStopLossPercent / 100) * currentBankroll).toFixed(0)})
              </span>
            </div>
            <input
              type="range"
              min={3}
              max={25}
              step={1}
              value={bankrollConfig.dailyStopLossPercent}
              onChange={(e) =>
                onUpdateConfig({
                  ...bankrollConfig,
                  dailyStopLossPercent: Number(e.target.value),
                })
              }
              className="mt-1 w-full accent-[#3FF4E5]"
            />
          </label>
        </section>
      </div>

      {/* Detailed Ledger Table */}
      <section className="glass-panel border border-slate-200 rounded-xl bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Historial Detallado de Operaciones ({filteredBets.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Liquida picks pendientes en 1 clic para actualizar tu bankroll y curva de rendimiento
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08]">
              {(
                [
                  { id: 'all', label: 'Todas' },
                  { id: 'pending', label: 'Pendientes' },
                  { id: 'won', label: 'Ganadas' },
                  { id: 'lost', label: 'Perdidas' },
                ] as Array<{ id: BetStatus | 'all'; label: string }>
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setStatusFilter(st.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === st.id
                      ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>

            <select
              aria-label="Filtrar historial por deporte"
              value={sportFilter}
              onChange={(e) => setSportFilter(e.target.value as SportId | 'all')}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#141418] text-slate-700 dark:text-slate-200"
            >
              <option value="all">Todos los deportes</option>
              <option value="soccer">Fútbol (Principal)</option>
              <option value="nba">NBA</option>
              <option value="nhl">NHL</option>
              <option value="football">NFL / NCAAF</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/[0.08] bg-slate-50/80 dark:bg-white/[0.03] text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-medium">Fecha</th>
                <th className="py-3 px-3 font-medium">Partido y Modelo</th>
                <th className="py-3 px-3 font-medium">Mercado</th>
                <th className="py-3 px-3 font-medium text-right">Cuota</th>
                <th className="py-3 px-3 font-medium text-right">EV</th>
                <th className="py-3 px-3 font-medium text-right">Stake</th>
                <th className="py-3 px-3 font-medium text-right">Estado / P&L</th>
                <th className="py-3 px-4 font-medium text-right">Liquidar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-white/[0.06]">
              {filteredBets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    No hay operaciones que coincidan con este filtro.
                  </td>
                </tr>
              ) : (
                filteredBets.map((bet) => {
                  const dateLabel = new Date(bet.date).toLocaleDateString('es-ES', {
                    day: '2-digit',
                    month: 'short',
                    year: '2-digit',
                  });
                  const sideLabel =
                    bet.side === 'over' ? `Más ${bet.line}` : `Menos ${bet.line}`;

                  return (
                    <tr
                      key={bet.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-white/[0.05] transition-colors"
                    >
                      <td className="py-3 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {dateLabel}
                      </td>
                      <td className="py-3 px-3">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {bet.matchLabel}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {SPORT_META[bet.sport].shortName} · {bet.league} ·{' '}
                          {MODEL_META[bet.modelUsed]?.shortName ?? bet.modelUsed}
                        </p>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-slate-800 dark:text-slate-200">
                        {sideLabel}
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                          {bet.bookmaker}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {bet.odds.toFixed(2)}
                      </td>
                      <td
                        className={`py-3 px-3 text-right font-mono tabular-nums ${
                          bet.ev >= 0 ? 'text-slate-900 dark:text-[#ABF43F]' : 'text-[#FF3B4B]'
                        }`}
                      >
                        {bet.ev >= 0 ? '+' : ''}
                        {(bet.ev * 100).toFixed(1)}%
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                        {currencySymbol}
                        {bet.stake.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {bet.status === 'pending' ? (
                          <span className="text-slate-700 dark:text-[#3FF4E5] font-medium">
                            Pendiente
                          </span>
                        ) : bet.status === 'won' ? (
                          <span className="text-slate-900 dark:text-[#ABF43F] font-semibold">
                            Ganada · +{currencySymbol}
                            {bet.pnl.toFixed(2)}
                          </span>
                        ) : bet.status === 'lost' ? (
                          <span className="text-[#FF3B4B] font-semibold">
                            Perdida · -{currencySymbol}
                            {Math.abs(bet.pnl).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-slate-500 dark:text-slate-400">Nula · 0.00</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          {bet.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                title="Marcar como ganada"
                                onClick={() => onSettleBet(bet.id, 'won')}
                                className="p-1.5 rounded-md text-slate-900 dark:text-[#ABF43F] hover:bg-[#ABF43F]/15 transition-colors"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Marcar como perdida"
                                onClick={() => onSettleBet(bet.id, 'lost')}
                                className="p-1.5 rounded-md text-[#FF3B4B] hover:bg-[#FF3B4B]/15 transition-colors"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Marcar como nula (Push)"
                                onClick={() => onSettleBet(bet.id, 'void')}
                                className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.08] transition-colors"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            title="Eliminar registro"
                            onClick={() => onDeleteBet(bet.id)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
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
