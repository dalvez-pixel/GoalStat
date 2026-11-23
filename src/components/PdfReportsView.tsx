import { Check, Download, FileText } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { exportMonthlyPdfReport } from '../lib/pdfReport.ts';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type { BankrollConfig, BetRecord, SportId } from '../types/quant.ts';

interface PdfReportsViewProps {
  bets: BetRecord[];
  bankrollConfig: BankrollConfig;
  currentBankroll: number;
  currencySymbol: string;
}

const MONTH_NAMES_ES: Record<string, string> = {
  '01': 'Enero',
  '02': 'Febrero',
  '03': 'Marzo',
  '04': 'Abril',
  '05': 'Mayo',
  '06': 'Junio',
  '07': 'Julio',
  '08': 'Agosto',
  '09': 'Septiembre',
  '10': 'Octubre',
  '11': 'Noviembre',
  '12': 'Diciembre',
};

function formatMonthKey(key: string): string {
  if (key === 'all') return 'Historial Completo';
  const [year, month] = key.split('-');
  return `${MONTH_NAMES_ES[month] ?? month} ${year}`;
}

export const PdfReportsView: React.FC<PdfReportsViewProps> = ({
  bets,
  bankrollConfig,
  currentBankroll,
  currencySymbol,
}) => {
  const availableMonths = useMemo(() => {
    const keys = Array.from(new Set(bets.map((b) => b.monthKey))).sort((a, b) =>
      b.localeCompare(a)
    );
    return keys;
  }, [bets]);

  const [selectedMonth, setSelectedMonth] = useState<string>(availableMonths[0] ?? 'all');
  const [sportFilter, setSportFilter] = useState<SportId | 'all'>('all');
  const [notes, setNotes] = useState<string>(
    'Consolidación positiva del modelo principal Poisson Bivariado + xG + Elo en Fútbol junto a NBA, NHL y NFL/NCAAF, contrastado con Dixon-Coles, Binomial Negativa y ML GBDT bajo Kelly Fraccional.'
  );
  const [exported, setExported] = useState(false);

  const reportBets = useMemo(() => {
    return bets
      .filter((b) => {
        if (selectedMonth !== 'all' && b.monthKey !== selectedMonth) return false;
        if (sportFilter !== 'all' && b.sport !== sportFilter) return false;
        return true;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [bets, selectedMonth, sportFilter]);

  const summary = useMemo(() => {
    const settled = reportBets.filter((b) => b.status === 'won' || b.status === 'lost');
    const won = settled.filter((b) => b.status === 'won');
    const staked = settled.reduce((a, b) => a + b.stake, 0);
    const pnl = settled.reduce((a, b) => a + b.pnl, 0);
    const yieldPct = staked > 0 ? (pnl / staked) * 100 : 0;
    const winRate = settled.length > 0 ? (won.length / settled.length) * 100 : 0;
    const avgEv =
      reportBets.length > 0
        ? (reportBets.reduce((a, b) => a + b.ev, 0) / reportBets.length) * 100
        : 0;
    return {
      totalCount: reportBets.length,
      settledCount: settled.length,
      wonCount: won.length,
      staked,
      pnl,
      yieldPct,
      winRate,
      avgEv,
    };
  }, [reportBets]);

  const handleExport = () => {
    exportMonthlyPdfReport({
      monthKey: selectedMonth,
      monthLabel: formatMonthKey(selectedMonth),
      sportFilter,
      bets: reportBets,
      bankrollConfig,
      currentBankroll,
      notes,
    });
    setExported(true);
    setTimeout(() => setExported(false), 2600);
  };

  return (
    <div className="space-y-6 overflow-visible">
      {/* Configuration Bar */}
      <section className="glass-panel glass-panel-hover border border-slate-200 rounded-xl bg-white p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1 max-w-xl">
            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Periodo mensual del reporte
              </span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="mt-1.5 w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-[#141418] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              >
                {availableMonths.map((mk) => (
                  <option key={mk} value={mk}>
                    {formatMonthKey(mk)}
                  </option>
                ))}
                <option value="all">Historial Completo</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Filtrar por deporte
              </span>
              <select
                value={sportFilter}
                onChange={(e) => setSportFilter(e.target.value as SportId | 'all')}
                className="mt-1.5 w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-[#141418] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
              >
                <option value="all">Todos los deportes</option>
                <option value="soccer">Fútbol (Principal)</option>
                <option value="nba">NBA</option>
                <option value="nhl">NHL</option>
                <option value="football">NFL / NCAAF</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            onClick={handleExport}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#ABF43F] hover:bg-[#bdf762] text-[#090909] text-sm font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F]"
          >
            {exported ? (
              <>
                <Check className="h-4 w-4" />
                <span>PDF descargado</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>Exportar reporte PDF</span>
              </>
            )}
          </button>
        </div>

        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            Notas ejecutivas (se incluyen en el documento PDF)
          </span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1.5 w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.05] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
          />
        </label>
      </section>

      {/* Live Document Preview */}
      <section className="glass-panel border border-slate-200 rounded-xl bg-white overflow-visible">
        <div className="px-6 py-5 rounded-t-xl bg-slate-900 dark:bg-white/[0.04] dark:border-b dark:border-white/[0.08] text-slate-50 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-[#ABF43F] shrink-0" />
            <div>
              <h2 className="text-base font-semibold">
                Vista Previa · Reporte {formatMonthKey(selectedMonth)}
              </h2>
              <p className="text-xs text-slate-400">
                LambdaQuant ·{' '}
                {sportFilter === 'all' ? 'Todos los deportes' : SPORT_META[sportFilter].name}
              </p>
            </div>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-400">
            {summary.totalCount} registros en el periodo
          </span>
        </div>

        {/* Preview KPIs — 4 Glassmorphism + Hover Scale Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-5 border-b border-slate-200 dark:border-white/[0.08] overflow-visible">
          <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">Beneficio Neto</p>
            <p
              className={`mt-1 font-mono tabular-nums text-xl font-semibold ${
                summary.pnl >= 0
                  ? 'text-slate-900 dark:text-[#ABF43F]'
                  : 'text-[#FF3B4B]'
              }`}
            >
              {summary.pnl >= 0 ? '+' : ''}
              {currencySymbol}
              {summary.pnl.toFixed(2)}
            </p>
          </div>
          <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">Yield del Periodo</p>
            <p
              className={`mt-1 font-mono tabular-nums text-xl font-semibold ${
                summary.yieldPct < 0 ? 'text-[#FF3B4B]' : 'text-slate-900 dark:text-slate-50'
              }`}
            >
              {summary.yieldPct >= 0 ? '+' : ''}
              {summary.yieldPct.toFixed(2)}%
            </p>
          </div>
          <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">Tasa de Acierto</p>
            <p className="mt-1 font-mono tabular-nums text-xl font-semibold text-slate-900 dark:text-slate-50">
              {summary.winRate.toFixed(1)}% ({summary.wonCount}/{summary.settledCount})
            </p>
          </div>
          <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">EV Promedio</p>
            <p className="mt-1 font-mono tabular-nums text-xl font-semibold text-slate-900 dark:text-[#3FF4E5]">
              +{summary.avgEv.toFixed(2)}%
            </p>
          </div>
        </div>

        {/* Preview Ledger */}
        <div className="overflow-x-auto rounded-b-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-white/[0.08] bg-slate-50/80 dark:bg-white/[0.03] text-slate-500 dark:text-slate-400">
                <th className="py-2.5 px-4 font-medium">Fecha</th>
                <th className="py-2.5 px-3 font-medium">Deporte</th>
                <th className="py-2.5 px-3 font-medium">Partido</th>
                <th className="py-2.5 px-3 font-medium">Modelo</th>
                <th className="py-2.5 px-3 font-medium">Mercado</th>
                <th className="py-2.5 px-3 font-medium text-right">Cuota</th>
                <th className="py-2.5 px-3 font-medium text-right">Stake</th>
                <th className="py-2.5 px-4 font-medium text-right">P&L</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80 dark:divide-white/[0.06]">
              {reportBets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400">
                    No existen operaciones registradas para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                reportBets.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/70 dark:hover:bg-white/[0.04] transition-colors">
                    <td className="py-2.5 px-4 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {new Date(b.date).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: '2-digit',
                      })}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                      {SPORT_META[b.sport].shortName}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-900 dark:text-slate-100">
                      {b.matchLabel}
                    </td>
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      {MODEL_META[b.modelUsed]?.shortName ?? b.modelUsed}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                      {b.side === 'over' ? `Más ${b.line}` : `Menos ${b.line}`}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {b.odds.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {currencySymbol}
                      {b.stake.toFixed(2)}
                    </td>
                    <td
                      className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                        b.status === 'pending'
                          ? 'text-slate-700 dark:text-[#3FF4E5]'
                          : b.pnl >= 0
                            ? 'text-slate-900 dark:text-[#ABF43F]'
                            : 'text-[#FF3B4B]'
                      }`}
                    >
                      {b.status === 'pending'
                        ? 'Pendiente'
                        : `${b.pnl >= 0 ? '+' : ''}${currencySymbol}${b.pnl.toFixed(2)}`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
