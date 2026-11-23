import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  Clock,
  Download,
  FileText,
  FlaskConical,
  Moon,
  Radio,
  Sun,
  Wallet,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import type { TimezonePreference } from '../lib/timezone.ts';

export type WorkspaceTab =
  | 'opportunities'
  | 'live'
  | 'alerts'
  | 'model-lab'
  | 'bankroll'
  | 'stats'
  | 'reports';

export interface SidebarMarketSummary {
  positiveCount: number;
  matchCount: number;
  highConsensusCount: number;
  topEv: number | null;
  topMatchLabel: string | null;
  avgPositiveEv: number;
  modelName: string;
  feedLabel: string;
  streamConnected: boolean;
  updatedLabel: string;
}

interface SidebarProps {
  activeTab: WorkspaceTab;
  onSelectTab: (tab: WorkspaceTab) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  timezonePref: TimezonePreference;
  onChangeTimezonePref: (pref: TimezonePreference) => void;
  localTzLabel: string;
  unreadAlerts: number;
  liveMatchCount: number;
  currentBankroll: number;
  currencySymbol: string;
  marketSummary: SidebarMarketSummary;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: WorkspaceTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'opportunities', label: 'Oportunidades +EV', icon: Activity },
  { id: 'live', label: 'En Vivo', icon: Radio },
  { id: 'alerts', label: 'Alertas', icon: Bell },
  { id: 'model-lab', label: 'Laboratorio de Modelos', icon: FlaskConical },
  { id: 'bankroll', label: 'Bankroll e Historial', icon: Wallet },
  { id: 'stats', label: 'Deportes y Modelos', icon: BarChart3 },
  { id: 'reports', label: 'Reportes PDF', icon: FileText },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  theme,
  onToggleTheme,
  timezonePref,
  onChangeTimezonePref,
  localTzLabel,
  unreadAlerts,
  liveMatchCount,
  currentBankroll,
  currencySymbol,
  marketSummary,
  mobileOpen,
  onCloseMobile,
}) => {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const navContent = (
    <div className="flex h-full flex-col bg-white dark:bg-[#090909]/70 dark:backdrop-blur-2xl border-r border-slate-200 dark:border-white/[0.08]">
      {/* Brand Zone */}
      <div className="flex h-16 items-center justify-between px-6 border-b border-slate-200 dark:border-white/[0.08] shrink-0">
        <button
          type="button"
          onClick={() => {
            onSelectTab('opportunities');
            onCloseMobile();
          }}
          className="text-left text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F] rounded"
        >
          LambdaQuant
        </button>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Cerrar menú"
          className="lg:hidden p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 rounded-md"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Primary Workspace Navigation */}
      <nav aria-label="Navegación principal" className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F] ${
                isActive
                  ? 'bg-slate-900 text-white dark:bg-white/[0.1] dark:text-[#ABF43F] dark:border dark:border-white/[0.1]'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/[0.06]'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    item.id === 'live' ? 'text-[#FF3B4B]' : ''
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {item.id === 'live' && (
                <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-[11px] font-semibold px-1.5 py-0.5 rounded bg-[#FF3B4B]/15 text-[#FF3B4B] border border-[#FF3B4B]/30 shrink-0">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B4B]" />
                  {liveMatchCount}
                </span>
              )}
              {item.id === 'alerts' && unreadAlerts > 0 && (
                <span
                  className={`font-mono tabular-nums text-xs shrink-0 ${
                    isActive
                      ? 'text-[#ABF43F]'
                      : 'text-slate-900 dark:text-[#ABF43F] font-semibold'
                  }`}
                >
                  {unreadAlerts}
                </span>
              )}
            </button>
          );
        })}
        {/* Collapsible Market Summary (hidden by default inside side menu) */}
        <div className="pt-3 mt-3 border-t border-slate-200 dark:border-white/[0.08]">
          <button
            type="button"
            aria-expanded={summaryOpen}
            onClick={() => setSummaryOpen((prev) => !prev)}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F]"
          >
            <span className="flex items-center gap-2 min-w-0">
              {marketSummary.streamConnected && (
                <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B4B] shrink-0" />
              )}
              <span className="truncate">Resumen de mercado</span>
            </span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                summaryOpen ? 'rotate-180 text-[#ABF43F]' : ''
              }`}
            />
          </button>

          {summaryOpen && (
            <div className="mt-2 space-y-2 px-1">
              <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.04] p-2.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Picks +EV detectados
                </p>
                <p className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {marketSummary.positiveCount}{' '}
                  <span className="text-[11px] font-sans font-normal text-slate-500 dark:text-slate-400">
                    en {marketSummary.matchCount} partidos
                  </span>
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                  {marketSummary.highConsensusCount} con consenso ≥ 3/4
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.04] p-2.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Mayor ventaja (+EV)
                </p>
                <p
                  className={`mt-0.5 font-mono tabular-nums text-sm font-semibold ${
                    marketSummary.topEv !== null && marketSummary.topEv < 0
                      ? 'text-[#FF3B4B]'
                      : 'text-slate-900 dark:text-[#ABF43F]'
                  }`}
                >
                  {marketSummary.topEv !== null
                    ? `${marketSummary.topEv >= 0 ? '+' : ''}${(marketSummary.topEv * 100).toFixed(2)}%`
                    : '—'}
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {marketSummary.topMatchLabel ?? 'Esperando datos'}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.04] p-2.5">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  EV medio en valor positivo
                </p>
                <p className="mt-0.5 font-mono tabular-nums text-sm font-semibold text-slate-900 dark:text-[#3FF4E5]">
                  +{marketSummary.avgPositiveEv.toFixed(2)}%
                </p>
                <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 truncate">
                  {marketSummary.modelName}
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 dark:border-white/[0.08] bg-slate-50 dark:bg-white/[0.04] p-2.5">
                <div className="flex items-center justify-between gap-1">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Flujo en vivo</p>
                  {marketSummary.streamConnected && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#FF3B4B]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B4B]" />
                      En vivo
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {marketSummary.feedLabel}
                </p>
                <p className="mt-0.5 text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                  Actualizado {marketSummary.updatedLabel}
                </p>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Bottom Workspace Summary, Timezone, PDF Shortcut & Theme Switch */}
      <div className="p-4 border-t border-slate-200 dark:border-white/[0.08] space-y-3 shrink-0">
        {/* Compact Bankroll Readout */}
        <div className="px-2 py-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">Bankroll disponible</p>
          <p className="mt-0.5 font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-50">
            {currencySymbol}
            {currentBankroll.toLocaleString('es-ES', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>

        {/* 24h Timezone Selector moved from header */}
        <div className="pt-2 border-t border-slate-200 dark:border-white/[0.08] space-y-2">
          <div className="flex items-center justify-between px-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3 w-3 shrink-0" />
              <span>Horario 24h</span>
            </span>
          </div>
          <div
            role="group"
            aria-label="Zona horaria (24h)"
            className="grid grid-cols-2 gap-1 p-1 rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-100/80 dark:bg-white/[0.04]"
          >
            <button
              type="button"
              onClick={() => onChangeTimezonePref('gmt-6')}
              title="Horario estándar GMT-6 (24h)"
              className={`px-2 py-1.5 text-[11px] font-mono font-medium rounded-md transition-colors whitespace-nowrap ${
                timezonePref === 'gmt-6'
                  ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              GMT-6
            </button>
            <button
              type="button"
              onClick={() => onChangeTimezonePref('local')}
              title={`Usar ubicación del usuario (${localTzLabel}, 24h)`}
              className={`px-2 py-1.5 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap truncate ${
                timezonePref === 'local'
                  ? 'bg-slate-900 text-white dark:bg-[#3FF4E5] dark:text-[#090909]'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Local ({localTzLabel})
            </button>
          </div>
        </div>

        {/* Reporte PDF CTA moved from header */}
        <button
          type="button"
          onClick={() => {
            onSelectTab('reports');
            onCloseMobile();
          }}
          className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 dark:bg-[#ABF43F] dark:text-neutral-950 dark:hover:bg-[#bbf85f] transition-colors whitespace-nowrap"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Reporte PDF</span>
        </button>

        <div className="pt-2 border-t border-slate-200 dark:border-white/[0.08]">
          <button
            type="button"
            onClick={onToggleTheme}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.06] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F]"
          >
            <span className="flex items-center gap-2.5 whitespace-nowrap">
              {theme === 'dark' ? (
                <Sun className="h-4 w-4 text-[#3FF4E5]" />
              ) : (
                <Moon className="h-4 w-4 text-slate-500" />
              )}
              <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {theme === 'dark' ? 'Noche' : 'Día'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop fixed rail */}
      <aside className="hidden lg:block w-[248px] shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-[264px] max-w-[82vw] h-full">{navContent}</aside>
        </div>
      )}
    </>
  );
};
