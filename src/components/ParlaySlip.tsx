import { AlertTriangle, Check, Layers, Trash2, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { evaluateParlay } from '../lib/parlay.ts';
import { SPORT_META } from '../types/quant.ts';
import type { BankrollConfig, ParlayLeg } from '../types/quant.ts';
import { TeamCrest } from './TeamCrest.tsx';

interface ParlaySlipProps {
  open: boolean;
  legs: ParlayLeg[];
  currentBankroll: number;
  bankrollConfig: BankrollConfig;
  currencySymbol: string;
  onClose: () => void;
  onRemoveLeg: (legId: string) => void;
  onClearLegs: () => void;
  onPlaceParlay: (payload: {
    legs: ParlayLeg[];
    odds: number;
    modelProb: number;
    edge: number;
    ev: number;
    stake: number;
  }) => void;
}

export const ParlaySlip: React.FC<ParlaySlipProps> = ({
  open,
  legs,
  currentBankroll,
  bankrollConfig,
  currencySymbol,
  onClose,
  onRemoveLeg,
  onClearLegs,
  onPlaceParlay,
}) => {
  const [customOddsInput, setCustomOddsInput] = useState<string>('');
  const [stakeInput, setStakeInput] = useState<string>('20.00');
  const [justPlaced, setJustPlaced] = useState<boolean>(false);

  const parsedCustomOdds = useMemo(() => {
    const n = Number(customOddsInput);
    return customOddsInput.trim() !== '' && Number.isFinite(n) && n > 1.01 ? n : null;
  }, [customOddsInput]);

  const evaluation = useMemo(
    () => evaluateParlay(legs, currentBankroll, bankrollConfig, parsedCustomOdds),
    [legs, currentBankroll, bankrollConfig, parsedCustomOdds]
  );

  useEffect(() => {
    if (evaluation.recommendedStake > 0) {
      setStakeInput(evaluation.recommendedStake.toFixed(2));
    } else if (legs.length > 0) {
      setStakeInput('15.00');
    }
  }, [evaluation.recommendedStake, legs.length]);

  if (!open) return null;

  const canPlace = legs.length >= 2 && !evaluation.hasConflict;

  const handleSubmit = () => {
    if (!canPlace) return;
    const stake = Math.max(1, Number(stakeInput) || evaluation.recommendedStake || 15);
    onPlaceParlay({
      legs,
      odds: evaluation.effectiveOdds,
      modelProb: evaluation.correlatedWinProb,
      edge: evaluation.edge,
      ev: evaluation.ev,
      stake: Math.round(stake * 100) / 100,
    });
    setJustPlaced(true);
    setTimeout(() => {
      setJustPlaced(false);
    }, 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="fixed inset-0 bg-slate-950/35 dark:bg-black/65 backdrop-blur-xs"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        aria-label="Boleto combinado y calculadora de correlación"
        className="relative z-10 w-full max-w-[520px] h-full glass-surface border-l border-slate-900/[0.08] dark:border-white/[0.1] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-900/[0.08] dark:border-white/[0.08] shrink-0">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Layers className="h-3.5 w-3.5 text-slate-900 dark:text-[#ABF43F]" />
              <span>Boleto Combinado · Parlay +EV</span>
            </div>
            <h2 className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-50">
              Calculadora de Correlación ({legs.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Calcula el +EV compuesto y detecta correlación exacta en selecciones del mismo partido.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar boleto"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-900/[0.06] dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/[0.08] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {legs.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center space-y-2">
              <Layers className="h-7 w-7 mx-auto text-slate-400" />
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Tu boleto combinado está vacío
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                Pulsa <span className="font-semibold text-slate-800 dark:text-slate-200">+ Parlay</span> en cualquier tarjeta de partido o en los mercados de fútbol (1X2, BTTS, Hándicap) para evaluar una combinada.
              </p>
            </div>
          ) : (
            <>
              {/* Selected Legs */}
              <div className="space-y-3 overflow-visible">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Selecciones en el boleto ({legs.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onClearLegs();
                      setCustomOddsInput('');
                    }}
                    className="inline-flex items-center gap-1 text-slate-500 hover:text-[#FF3B4B] dark:text-slate-400 dark:hover:text-[#FF3B4B] transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Vaciar</span>
                  </button>
                </div>

                {legs.map((leg) => (
                  <div
                    key={leg.id}
                    className="glass-card rounded-xl p-3.5 flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="flex items-center -space-x-1.5 pt-0.5 shrink-0">
                        <TeamCrest
                          teamName={leg.homeTeam}
                          sport={leg.sport}
                          logoUrl={leg.homeLogo}
                          size="sm"
                        />
                        <TeamCrest
                          teamName={leg.awayTeam}
                          sport={leg.sport}
                          logoUrl={leg.awayLogo}
                          size="sm"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {SPORT_META[leg.sport].shortName} · {leg.league} · {leg.bookmaker}
                        </p>
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-50 truncate">
                          {leg.matchLabel}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-slate-800 dark:text-[#3FF4E5]">
                          {leg.marketLabel}
                        </p>
                        <p className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          P. Mod {(leg.modelProb * 100).toFixed(1)}% · EV{' '}
                          <span
                            className={
                              leg.ev >= 0
                                ? 'text-slate-900 dark:text-[#ABF43F] font-semibold'
                                : 'text-[#FF3B4B] font-semibold'
                            }
                          >
                            {leg.ev >= 0 ? '+' : ''}
                            {(leg.ev * 100).toFixed(1)}%
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className="font-mono tabular-nums text-sm font-bold text-slate-900 dark:text-slate-50">
                        {leg.odds.toFixed(2)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onRemoveLeg(leg.id)}
                        aria-label={`Quitar ${leg.marketLabel}`}
                        className="p-1 rounded-md text-slate-400 hover:text-[#FF3B4B] transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Correlation Diagnostics */}
              {evaluation.pairNotices.length > 0 && (
                <div className="space-y-2.5 overflow-visible">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Diagnóstico de Correlación (Mismo Partido)
                  </p>
                  {evaluation.pairNotices.map((notice, idx) => {
                    const isDanger = notice.status === 'conflict' || notice.status === 'negative';
                    const isPos = notice.status === 'positive';
                    return (
                      <div
                        key={`${notice.matchId}-${idx}`}
                        className={`glass-card rounded-xl p-3.5 space-y-1.5 border ${
                          isDanger
                            ? 'border-[#FF3B4B]/50'
                            : isPos
                              ? 'border-[#ABF43F]/60'
                              : 'border-[#3FF4E5]/50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100 truncate">
                            <AlertTriangle
                              className={`h-3.5 w-3.5 shrink-0 ${
                                isDanger
                                  ? 'text-[#FF3B4B]'
                                  : isPos
                                    ? 'text-slate-900 dark:text-[#ABF43F]'
                                    : 'text-slate-900 dark:text-[#3FF4E5]'
                              }`}
                            />
                            <span className="truncate">{notice.matchLabel}</span>
                          </span>
                          <span
                            className={`font-mono tabular-nums text-[11px] font-semibold whitespace-nowrap ${
                              isDanger
                                ? 'text-[#FF3B4B]'
                                : isPos
                                  ? 'text-slate-900 dark:text-[#ABF43F]'
                                  : 'text-slate-700 dark:text-[#3FF4E5]'
                            }`}
                          >
                            {notice.status === 'conflict'
                              ? 'Conflicto'
                              : `ρ ${notice.correlation >= 0 ? '+' : ''}${notice.correlation.toFixed(2)}`}
                          </span>
                        </div>
                        <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {notice.legALabel} + {notice.legBLabel}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {notice.message}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {legs.length >= 2 && evaluation.pairNotices.length === 0 && (
                <div className="glass-card rounded-xl p-3.5 flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600 dark:text-slate-300">
                    Selecciones en partidos independientes (sin correlación directa)
                  </span>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-[#3FF4E5] whitespace-nowrap">
                    ρ = 0.00
                  </span>
                </div>
              )}

              {/* Compound Quantitative Metrics Grid */}
              {legs.length >= 2 && (
                <div className="grid grid-cols-2 gap-3 py-1 overflow-visible">
                  <div className="glass-card rounded-xl p-3.5">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      EV Compuesto {evaluation.sameGameGroups > 0 ? '(Ajustado ρ)' : ''}
                    </p>
                    <p
                      className={`mt-1 font-mono tabular-nums text-lg font-bold ${
                        evaluation.ev >= 0
                          ? 'text-slate-900 dark:text-[#ABF43F]'
                          : 'text-[#FF3B4B]'
                      }`}
                    >
                      {evaluation.hasConflict
                        ? 'Inválido'
                        : `${evaluation.ev >= 0 ? '+' : ''}${(evaluation.ev * 100).toFixed(2)}%`}
                    </p>
                    <p className="mt-0.5 text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      Edge:{' '}
                      <span className={evaluation.edge < 0 ? 'text-[#FF3B4B]' : ''}>
                        {evaluation.hasConflict
                          ? '—'
                          : `${evaluation.edge >= 0 ? '+' : ''}${(evaluation.edge * 100).toFixed(2)} pp`}
                      </span>
                    </p>
                  </div>

                  <div className="glass-card rounded-xl p-3.5">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Probabilidad Conjunta
                    </p>
                    <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-50">
                      {(evaluation.correlatedWinProb * 100).toFixed(2)}%
                    </p>
                    <p className="mt-0.5 text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      Indep: {(evaluation.independentWinProb * 100).toFixed(2)}% · Justa{' '}
                      {evaluation.fairOdds < 999 ? evaluation.fairOdds.toFixed(2) : '—'}
                    </p>
                  </div>

                  <div className="glass-card rounded-xl p-3.5">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Cuota Combinada
                    </p>
                    <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-slate-50">
                      {evaluation.effectiveOdds.toFixed(2)}
                    </p>
                    <p className="mt-0.5 text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      Producto bruto: {evaluation.rawCombinedOdds.toFixed(2)}
                    </p>
                  </div>

                  <div className="glass-card rounded-xl p-3.5">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Kelly Parlay Sugerido
                    </p>
                    <p className="mt-1 font-mono tabular-nums text-lg font-bold text-slate-900 dark:text-[#3FF4E5]">
                      {evaluation.recommendedStake > 0
                        ? `${currencySymbol}${evaluation.recommendedStake.toFixed(2)}`
                        : '—'}
                    </p>
                    <p className="mt-0.5 text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {evaluation.recommendedStakePct.toFixed(2)}% bankroll
                    </p>
                  </div>
                </div>
              )}

              {/* Optional Custom Bookmaker Odds Input (crucial for SGP price comparison) */}
              {legs.length >= 2 && (
                <div className="glass-card rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="parlay-custom-odds"
                      className="text-xs font-medium text-slate-800 dark:text-slate-200"
                    >
                      Cuota ofrecida por tu casa (opcional)
                    </label>
                    {customOddsInput && (
                      <button
                        type="button"
                        onClick={() => setCustomOddsInput('')}
                        className="text-[11px] text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
                      >
                        Usar estimada
                      </button>
                    )}
                  </div>
                  <input
                    id="parlay-custom-odds"
                    type="number"
                    min={1.05}
                    step={0.05}
                    placeholder={`Estimada: ${evaluation.effectiveOdds.toFixed(2)}`}
                    value={customOddsInput}
                    onChange={(e) => setCustomOddsInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums rounded-lg border border-slate-900/[0.1] dark:border-white/[0.12] bg-white/70 dark:bg-white/[0.05] text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    En combinadas del mismo partido (SGP), introduce la cuota exacta de tu bookmaker para auditar el +EV real.
                  </p>
                </div>
              )}

              {legs.length === 1 && (
                <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                  Añade al menos 1 selección más para calcular la combinada y su matriz de correlación.
                </p>
              )}
            </>
          )}
        </div>

        {/* Sticky Footer */}
        {legs.length >= 2 && (
          <div className="px-6 py-4 border-t border-slate-900/[0.08] dark:border-white/[0.08] bg-white/65 dark:bg-white/[0.03] backdrop-blur-md shrink-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Retorno potencial:{' '}
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                    {currencySymbol}
                    {((Number(stakeInput) || 0) * evaluation.effectiveOdds).toFixed(2)}
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
                    className="w-24 px-2.5 py-1.5 text-sm font-mono tabular-nums rounded-lg border border-slate-900/[0.12] dark:border-white/[0.12] bg-white/80 dark:bg-white/[0.05] text-slate-900 dark:text-slate-50 focus:outline-none focus:ring-2 focus:ring-[#ABF43F]"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={!canPlace}
                onClick={handleSubmit}
                className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap shrink-0 flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed ${
                  justPlaced || evaluation.ev > 0
                    ? 'bg-[#ABF43F] hover:bg-[#bdf762] text-[#090909]'
                    : 'bg-slate-900 hover:bg-slate-800 dark:bg-white/15 dark:hover:bg-white/25 text-white'
                }`}
              >
                {justPlaced ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Combinada registrada</span>
                  </>
                ) : (
                  <span>Registrar combinada</span>
                )}
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};
