import {
  Activity,
  BarChart3,
  Bell,
  ChevronDown,
  ClipboardCheck,
  Cloud,
  Download,
  FileText,
  FlaskConical,
  Globe2,
  LogIn,
  LogOut,
  Moon,
  Radio,
  Sun,
  Wallet,
  X,
} from 'lucide-react';
import React, { useState } from 'react';
import type { SportId } from '../types/quant.ts';

export type WorkspaceTab =
  | 'opportunities'
  | 'live'
  | 'results'
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
  unreadAlerts: number;
  liveMatchCount: number;
  currentBankroll: number;
  currencySymbol: string;
  marketSummary: SidebarMarketSummary;
  authUser: {
    uid: string;
    displayName: string;
    email: string;
    photoURL?: string;
  } | null;
  authLoading: boolean;
  cloudSyncing: boolean;
  authError: string | null;
  onSignInGoogle: () => void;
  onSignOut: () => void;
  selectedSport: SportId | 'all';
  onSelectSport: (sport: SportId | 'all') => void;
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
  { id: 'results', label: 'Resultados y Auditoría', icon: ClipboardCheck },
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
  unreadAlerts,
  liveMatchCount,
  currentBankroll,
  currencySymbol,
  marketSummary,
  authUser,
  authLoading,
  cloudSyncing,
  authError,
  onSignInGoogle,
  onSignOut,
  selectedSport,
  onSelectSport,
  mobileOpen,
  onCloseMobile,
}) => {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  React.useEffect(() => {
    setAvatarFailed(false);
  }, [authUser?.photoURL]);
  const navContent = (
    <div className="flex h-full flex-col glass-surface border-r border-slate-900/[0.08] dark:border-white/[0.08]">
      {/* Brand Zone */}
      <div className="flex h-16 items-center justify-between px-6 border-b border-slate-900/[0.08] dark:border-white/[0.08] shrink-0">
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
          className="md:hidden p-2 text-slate-400 hover:text-slate-100 rounded-md"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Unified Single-Column Scrollable Sidebar Body */}
      <div className="flex-1 overflow-y-auto overflow-x-visible px-4 py-4 flex flex-col gap-4">
        {/* Primary Workspace Navigation */}
        <nav aria-label="Navegación principal" className="flex flex-col gap-2 overflow-visible">
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
                className={`glass-card w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F] ${
                  isActive
                    ? 'glass-card-active text-slate-950 font-semibold dark:text-[#ABF43F]'
                    : 'text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-slate-50'
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
                  <span className="font-mono tabular-nums text-xs font-semibold text-slate-900 dark:text-[#ABF43F] shrink-0">
                    {unreadAlerts}
                  </span>
                )}
              </button>
            );
          })}

          {/* Cross-Sport / Todos los deportes quick access */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => {
                onSelectSport('all');
                onCloseMobile();
              }}
              className={`glass-card w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F] ${
                selectedSport === 'all'
                  ? 'glass-card-active text-slate-950 font-semibold dark:text-[#3FF4E5]'
                  : 'text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-slate-50'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Globe2 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Todos los deportes (Cross-Sport)</span>
              </span>
            </button>
          </div>

          {/* Collapsible Market Summary (hidden by default inside side menu) */}
          <div className="pt-3 mt-1 border-t border-slate-900/[0.08] dark:border-white/[0.08] overflow-visible">
            <button
              type="button"
              aria-expanded={summaryOpen}
              onClick={() => setSummaryOpen((prev) => !prev)}
              className="glass-card w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-medium text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F]"
            >
              <span className="flex items-center gap-2 min-w-0">
                {marketSummary.streamConnected && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#FF3B4B] shrink-0" />
                )}
                <span className="truncate">Resumen de mercado</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                  summaryOpen ? 'rotate-180 text-slate-900 dark:text-[#ABF43F]' : ''
                }`}
              />
            </button>

            {summaryOpen && (
              <div className="mt-2.5 flex flex-col gap-2.5 py-1 overflow-visible">
                <div className="glass-card rounded-xl border border-slate-200 bg-slate-50 p-2.5">
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

                <div className="glass-card rounded-xl border border-slate-200 bg-slate-50 p-2.5">
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

                <div className="glass-card rounded-xl border border-slate-200 bg-slate-50 p-2.5">
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

                <div className="glass-card rounded-xl border border-slate-200 bg-slate-50 p-2.5">
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

        {/* Workspace Account, Bankroll, Timezone, PDF Shortcut & Theme Switch in the same single column */}
        <div className="pt-4 border-t border-slate-200 dark:border-white/[0.08] flex flex-col gap-3 overflow-visible">
          {/* Firebase Account & Cloud Persistence Card */}
          <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 space-y-2">
            {authUser ? (
              <>
                <div className="flex items-center gap-2.5 min-w-0">
                  {authUser.photoURL && !avatarFailed ? (
                    <img
                      src={authUser.photoURL}
                      alt={authUser.displayName}
                      referrerPolicy="no-referrer"
                      onError={() => setAvatarFailed(true)}
                      className="h-8 w-8 rounded-full object-cover border border-slate-300 dark:border-white/15 shrink-0"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909] flex items-center justify-center text-xs font-bold shrink-0">
                      {(authUser.displayName || authUser.email || 'U').slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {authUser.displayName}
                    </p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                      {authUser.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-slate-700 dark:text-[#ABF43F]">
                    <Cloud className="h-3 w-3 shrink-0" />
                    <span>{cloudSyncing ? 'Sincronizando...' : 'Nube sincronizada'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={onSignOut}
                    disabled={authLoading}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium text-slate-600 hover:text-[#FF3B4B] dark:text-slate-400 dark:hover:text-[#FF3B4B] hover:bg-slate-200/60 dark:hover:bg-white/[0.06] transition-colors disabled:opacity-50"
                  >
                    <LogOut className="h-3 w-3" />
                    <span>Salir</span>
                  </button>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                    <Cloud className="h-3.5 w-3.5 text-slate-500 dark:text-[#3FF4E5]" />
                    <span>Respaldo en la nube</span>
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">Local</span>
                </div>
                <button
                  type="button"
                  onClick={onSignInGoogle}
                  disabled={authLoading}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-white/15 bg-white/80 dark:bg-white/[0.06] text-slate-900 dark:text-slate-100 hover:border-slate-900 dark:hover:border-[#ABF43F] hover:text-slate-950 dark:hover:text-[#ABF43F] transition-colors disabled:opacity-50"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>{authLoading ? 'Conectando...' : 'Iniciar con Google'}</span>
                </button>
              </div>
            )}
            {authError && (
              <p className="text-[10px] text-[#FF3B4B] leading-snug">{authError}</p>
            )}
          </div>

          {/* Compact Bankroll Readout */}
          <div className="glass-card rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5">
            <p className="text-xs text-slate-500 dark:text-slate-400">Bankroll disponible</p>
            <p className="mt-0.5 font-mono tabular-nums text-lg font-semibold text-slate-900 dark:text-slate-50">
              {currencySymbol}
              {currentBankroll.toLocaleString('es-ES', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </p>
          </div>

          {/* Reporte PDF CTA */}
          <button
            type="button"
            onClick={() => {
              onSelectTab('reports');
              onCloseMobile();
            }}
            className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-semibold rounded-xl bg-slate-900 text-white hover:bg-slate-800 dark:bg-[#ABF43F] dark:text-neutral-950 dark:hover:bg-[#bbf85f] transition-all duration-300 hover:scale-[1.04] hover:shadow-[0_10px_28px_-4px_rgba(171,244,63,0.35)] whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Reporte PDF</span>
          </button>

          <div className="pt-1 pb-2 overflow-visible">
            <button
              type="button"
              onClick={onToggleTheme}
              className="glass-card w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F]"
            >
              <span className="flex items-center gap-2.5 whitespace-nowrap">
                {theme === 'dark' ? (
                  <Sun className="h-4 w-4 text-[#3FF4E5]" />
                ) : (
                  <Moon className="h-4 w-4 text-slate-600" />
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
    </div>
  );

  return (
    <>
      {/* Desktop fixed rail (>= 768px) */}
      <aside className="hidden md:block w-[264px] shrink-0 h-screen sticky top-0 z-20 overflow-visible">
        {navContent}
      </aside>

      {/* Mobile Slide-over Drawer (< 768px) — High-contrast iOS Safari crystal panel */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] md:hidden flex">
          <div
            className="fixed inset-0 mobile-drawer-backdrop"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="dark relative z-[60] w-[280px] max-w-[84vw] h-full mobile-drawer-panel text-slate-100 shadow-2xl">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
};
