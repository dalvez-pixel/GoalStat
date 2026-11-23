import { Bell, Menu } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertsView } from './components/AlertsView.tsx';
import { BankrollHistoryView } from './components/BankrollHistoryView.tsx';
import { ModelLabView } from './components/ModelLabView.tsx';
import { OpportunitiesView } from './components/OpportunitiesView.tsx';
import { PdfReportsView } from './components/PdfReportsView.tsx';
import { PickInspector } from './components/PickInspector.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import type { SidebarMarketSummary, WorkspaceTab } from './components/Sidebar.tsx';
import { SportStatsView } from './components/SportStatsView.tsx';
import { evaluateAllMatches } from './lib/dixonColes.ts';
import { DEFAULT_BANKROLL_CONFIG, INITIAL_BET_HISTORY } from './lib/seedHistory.ts';
import {
  formatTime24h,
  getBrowserTimeZone,
  getShortOffsetLabel,
  resolveIanaTimeZone,
} from './lib/timezone.ts';
import type { TimezonePreference } from './lib/timezone.ts';
import { MODEL_META } from './types/quant.ts';
import type {
  AlertItem,
  AlertSettings,
  BankrollConfig,
  BetRecord,
  BetStatus,
  EvaluatedPick,
  LiveMatch,
  ModelType,
} from './types/quant.ts';

const STORAGE_KEYS = {
  theme: 'lq_theme_v1',
  bets: 'lq_bets_v3',
  bankroll: 'lq_bankroll_v1',
  alertSettings: 'lq_alert_settings_v2',
  timezonePref: 'lq_tz_pref_v1',
};

const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  pushEnabled: true,
  soundEnabled: false,
  minEvPercent: 4.5,
  minEdgePercent: 2.5,
  sports: {
    soccer: true,
    nba: true,
    nhl: true,
    football: true,
  },
};

const TAB_TITLES: Record<WorkspaceTab, { breadcrumb: string; title: string; subtitle?: string }> = {
  opportunities: {
    breadcrumb: 'Oportunidades +EV',
    title: 'Escáner Cuantitativo',
  },
  live: {
    breadcrumb: 'En Vivo',
    title: 'Partidos en Vivo',
    subtitle: 'Encuentros disputándose en tiempo real con cuotas, marcador y modelos cuantitativos activos.',
  },
  alerts: {
    breadcrumb: 'Alertas',
    title: 'Centro de Alertas +EV en Tiempo Real',
    subtitle:
      'Todas las oportunidades detectadas que superan tus umbrales cuantitativos se centralizan aquí sin ventanas emergentes.',
  },
  'model-lab': {
    breadcrumb: 'Laboratorio de Modelos',
    title: 'Simulador Multi-Modelo de Totales',
    subtitle:
      'Contrasta Poisson Bivariado + xG + Elo, Dixon-Coles, Binomial Negativa, ML Gradient Boosting y Ensemble.',
  },
  bankroll: {
    breadcrumb: 'Bankroll e Historial',
    title: 'Gestión de Bankroll y Registro de Rendimiento',
    subtitle:
      'Dimensionamiento automatizado bajo Kelly Fraccional, rangos de fecha personalizados, curva de capital real vs EV esperado y liquidación de picks.',
  },
  stats: {
    breadcrumb: 'Deportes y Modelos',
    title: 'Estadísticas por Deporte y Calibración de Modelos',
    subtitle:
      'Benchmark histórico de Yield, CLV y Brier Score desglosado por disciplina y modelo predictivo.',
  },
  reports: {
    breadcrumb: 'Reportes PDF',
    title: 'Exportación de Reportes Mensuales',
    subtitle:
      'Genera informes ejecutivos en PDF con KPIs, desglose por deporte y libro completo de operaciones.',
  },
};

function playSubtleChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.26);
  } catch {
    // Audio blocked by browser autoplay policy
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('opportunities');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Timezone Preference: GMT-6 default, toggleable to user's detected location timezone (24h format)
  const [timezonePref, setTimezonePref] = useState<TimezonePreference>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.timezonePref);
      return saved === 'local' ? 'local' : 'gmt-6';
    } catch {
      return 'gmt-6';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.timezonePref, timezonePref);
    } catch {
      // Ignore storage quota errors
    }
  }, [timezonePref]);

  const activeTimeZone = useMemo(() => resolveIanaTimeZone(timezonePref), [timezonePref]);
  const localTzLabel = useMemo(() => getShortOffsetLabel(getBrowserTimeZone()), []);
  const activeTzLabel = useMemo(() => getShortOffsetLabel(activeTimeZone), [activeTimeZone]);

  // Dual Theme (Dark default for nocturnal analysis, persisted)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.theme);
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch {
      // Ignore storage quota errors
    }
  }, [theme]);

  // Bankroll & Bet Ledger State
  const [bankrollConfig, setBankrollConfig] = useState<BankrollConfig>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.bankroll);
      return raw ? { ...DEFAULT_BANKROLL_CONFIG, ...JSON.parse(raw) } : DEFAULT_BANKROLL_CONFIG;
    } catch {
      return DEFAULT_BANKROLL_CONFIG;
    }
  });

  const [bets, setBets] = useState<BetRecord[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.bets);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // Fallback to seed history
    }
    return INITIAL_BET_HISTORY;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.bankroll, JSON.stringify(bankrollConfig));
    } catch {
      // ignore
    }
  }, [bankrollConfig]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.bets, JSON.stringify(bets));
    } catch {
      // ignore
    }
  }, [bets]);

  const currentBankroll = useMemo(() => {
    const netSettledPnl = bets
      .filter((b) => b.status === 'won' || b.status === 'lost')
      .reduce((acc, b) => acc + b.pnl, 0);
    return Math.max(0, Math.round((bankrollConfig.initialBankroll + netSettledPnl) * 100) / 100);
  }, [bets, bankrollConfig.initialBankroll]);

  const currencySymbol = bankrollConfig.currency === 'USD' ? '$' : '€';

  // Live Market Feed & Model Selection (defaults to primary Bivariate Poisson + xG + Elo)
  const [activeModel, setActiveModel] = useState<ModelType>('bivariate-poisson-xg-elo');
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState<boolean>(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);
  const [feedSource, setFeedSource] = useState<'the-odds-api' | 'espn-live' | 'market-feed'>(
    'market-feed'
  );
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [streamConnected, setStreamConnected] = useState<boolean>(false);

  // Pick Inspector & Dedicated Alerts Tab State (no pop-ups or floating toasts)
  const [inspectedPickId, setInspectedPickId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  const [alertSettings, setAlertSettings] = useState<AlertSettings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.alertSettings);
      return raw ? { ...DEFAULT_ALERT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_ALERT_SETTINGS;
    } catch {
      return DEFAULT_ALERT_SETTINGS;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.alertSettings, JSON.stringify(alertSettings));
    } catch {
      // ignore
    }
  }, [alertSettings]);

  const alertedPickKeysRef = useRef<Set<string>>(new Set());

  const evaluatedPicks = useMemo(
    () => evaluateAllMatches(matches, activeModel, currentBankroll, bankrollConfig),
    [matches, activeModel, currentBankroll, bankrollConfig]
  );

  const inspectedPick = useMemo(
    () => evaluatedPicks.find((p) => p.pickId === inspectedPickId) ?? null,
    [evaluatedPicks, inspectedPickId]
  );

  // Record Alert silently into the Alerts tab (zero pop-ups / zero browser toast overlays)
  const recordAlert = useCallback(
    (pick: EvaluatedPick) => {
      const sideText =
        pick.side === 'over'
          ? `Más de ${pick.marketLine.line}`
          : `Menos de ${pick.marketLine.line}`;
      const newAlert: AlertItem = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        matchId: pick.match.id,
        pickId: pick.pickId,
        sport: pick.match.sport,
        league: pick.match.league,
        homeTeam: pick.match.homeTeam,
        awayTeam: pick.match.awayTeam,
        homeLogo: pick.match.homeLogo,
        awayLogo: pick.match.awayLogo,
        matchLabel: `${pick.match.homeTeam} vs ${pick.match.awayTeam}`,
        marketLabel: sideText,
        odds: pick.odds,
        ev: pick.ev,
        edge: pick.edge,
        modelProb: pick.modelProb,
        bookmaker: pick.marketLine.bookmaker,
        modelType: pick.modelType,
        read: false,
      };

      setAlerts((prev) => [newAlert, ...prev].slice(0, 40));

      if (alertSettings.soundEnabled) {
        playSubtleChime();
      }
    },
    [alertSettings.soundEnabled]
  );

  // Fetch initial markets from server API
  const fetchMarkets = useCallback(async (forceRefresh = false) => {
    setLoadingMarkets(true);
    setMarketsError(null);
    try {
      const endpoint = forceRefresh ? '/api/markets/refresh' : '/api/markets?sport=all';
      const res = await fetch(endpoint, { method: forceRefresh ? 'POST' : 'GET' });
      if (!res.ok) throw new Error('Error al obtener mercados en vivo');
      const data = await res.json();
      setMatches(Array.isArray(data.matches) ? data.matches : []);
      if (data.feedSource) setFeedSource(data.feedSource);
      setLastUpdated(data.updatedAt ?? new Date().toISOString());
    } catch {
      setMarketsError('No se pudo conectar con la API de mercados en vivo.');
    } finally {
      setLoadingMarkets(false);
    }
  }, []);

  useEffect(() => {
    fetchMarkets(false);
  }, [fetchMarkets]);

  // Connect to live Server-Sent Events stream for real-time odds movements
  useEffect(() => {
    const es = new EventSource('/api/stream');

    es.onopen = () => {
      setStreamConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') {
          setStreamConnected(true);
          if (msg.feedSource) setFeedSource(msg.feedSource);
        } else if (msg.type === 'market-tick' && Array.isArray(msg.matches)) {
          setMatches(msg.matches);
          setLastUpdated(msg.updatedAt ?? new Date().toISOString());
        }
      } catch {
        // Ignore malformed tick
      }
    };

    es.onerror = () => {
      setStreamConnected(false);
    };

    return () => {
      es.close();
    };
  }, []);

  // Monitor live evaluated picks for new +EV opportunities crossing alert thresholds
  useEffect(() => {
    if (evaluatedPicks.length === 0) return;

    const minEv = alertSettings.minEvPercent / 100;
    const minEdge = alertSettings.minEdgePercent / 100;

    // Seed initial top alerts silently into the Alerts tab on first load
    if (alertedPickKeysRef.current.size === 0) {
      const initialQualifying = evaluatedPicks
        .filter((p) => alertSettings.sports[p.match.sport] && p.ev >= minEv && p.edge >= minEdge)
        .slice(0, 4);

      const seeded: AlertItem[] = initialQualifying.map((p) => {
        const key = `${p.pickId}-${p.odds.toFixed(2)}`;
        alertedPickKeysRef.current.add(key);
        return {
          id: `init-${p.pickId}`,
          timestamp: p.match.updatedAt,
          matchId: p.match.id,
          pickId: p.pickId,
          sport: p.match.sport,
          league: p.match.league,
          homeTeam: p.match.homeTeam,
          awayTeam: p.match.awayTeam,
          homeLogo: p.match.homeLogo,
          awayLogo: p.match.awayLogo,
          matchLabel: `${p.match.homeTeam} vs ${p.match.awayTeam}`,
          marketLabel:
            p.side === 'over' ? `Más de ${p.marketLine.line}` : `Menos de ${p.marketLine.line}`,
          odds: p.odds,
          ev: p.ev,
          edge: p.edge,
          modelProb: p.modelProb,
          bookmaker: p.marketLine.bookmaker,
          modelType: p.modelType,
          read: false,
        };
      });
      if (seeded.length > 0) {
        setAlerts(seeded);
      }
      return;
    }

    if (!alertSettings.pushEnabled) return;

    // Silently record newly qualifying live tick opportunities into the Alerts tab
    for (const p of evaluatedPicks) {
      if (!alertSettings.sports[p.match.sport]) continue;
      if (p.ev < minEv || p.edge < minEdge) continue;
      const key = `${p.pickId}-${p.odds.toFixed(2)}`;
      if (!alertedPickKeysRef.current.has(key)) {
        alertedPickKeysRef.current.add(key);
        recordAlert(p);
        break;
      }
    }
  }, [evaluatedPicks, alertSettings, recordAlert]);

  const handleTestAlert = () => {
    const samplePick = evaluatedPicks[0];
    if (samplePick) {
      recordAlert(samplePick);
    }
  };

  const handlePlaceBet = (pick: EvaluatedPick, customStake?: number) => {
    const stake = customStake ?? (pick.recommendedStake > 0 ? pick.recommendedStake : 25);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const newRecord: BetRecord = {
      id: `bet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: now.toISOString(),
      monthKey,
      sport: pick.match.sport,
      league: pick.match.league,
      matchLabel: `${pick.match.homeTeam} vs ${pick.match.awayTeam}`,
      side: pick.side,
      line: pick.marketLine.line,
      bookmaker: pick.marketLine.bookmaker,
      odds: pick.odds,
      closingOdds: pick.odds,
      modelProb: pick.modelProb,
      edge: pick.edge,
      ev: pick.ev,
      stake: Math.round(stake * 100) / 100,
      status: 'pending',
      pnl: 0,
      modelUsed: pick.modelType,
    };
    setBets((prev) => [newRecord, ...prev]);
  };

  const handleLogCustomBet = (betData: Omit<BetRecord, 'id'>) => {
    const newRecord: BetRecord = {
      ...betData,
      id: `bet-lab-${Date.now()}`,
    };
    setBets((prev) => [newRecord, ...prev]);
  };

  const handleSettleBet = (betId: string, status: Exclude<BetStatus, 'pending'>) => {
    setBets((prev) =>
      prev.map((b) => {
        if (b.id !== betId) return b;
        let pnl = 0;
        if (status === 'won') pnl = Math.round(b.stake * (b.odds - 1) * 100) / 100;
        else if (status === 'lost') pnl = -b.stake;
        return { ...b, status, pnl };
      })
    );
  };

  const handleDeleteBet = (betId: string) => {
    setBets((prev) => prev.filter((b) => b.id !== betId));
  };

  const marketSummary = useMemo<SidebarMarketSummary>(() => {
    const positivePicks = evaluatedPicks.filter((p) => p.ev >= 0.015);
    const uniqueMatchIds = new Set(evaluatedPicks.map((p) => p.match.id));
    const topPick = positivePicks[0] ?? evaluatedPicks[0] ?? null;
    const avgPositiveEv =
      positivePicks.length > 0
        ? (positivePicks.reduce((acc, p) => acc + p.ev, 0) / positivePicks.length) * 100
        : 0;
    const highConsensusCount = positivePicks.filter((p) => p.consensusCount >= 3).length;

    const feedLabel =
      feedSource === 'the-odds-api'
        ? 'The Odds API (Cuotas en vivo)'
        : feedSource === 'espn-live'
          ? 'ESPN Live API + Mercado Calibrado'
          : 'Feed Cuantitativo en Vivo';

    const updatedLabel = lastUpdated
      ? `${formatTime24h(lastUpdated, activeTimeZone, true)} ${activeTzLabel}`
      : '—';

    return {
      positiveCount: positivePicks.length,
      matchCount: uniqueMatchIds.size,
      highConsensusCount,
      topEv: topPick ? topPick.ev : null,
      topMatchLabel: topPick ? `${topPick.match.homeTeam} vs ${topPick.match.awayTeam}` : null,
      avgPositiveEv,
      modelName: MODEL_META[activeModel].name,
      feedLabel,
      streamConnected,
      updatedLabel,
    };
  }, [evaluatedPicks, activeModel, feedSource, streamConnected, lastUpdated, activeTimeZone, activeTzLabel]);

  const liveMatchCount = useMemo(() => {
    return matches.filter((m) => m.status === 'live').length;
  }, [matches]);

  const unreadAlerts = alerts.filter((a) => !a.read).length;
  const currentMeta = TAB_TITLES[activeTab];

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 dark:bg-transparent dark:text-slate-100">
      {/* Dynamic Animated Light Orbs Backdrop (Dark Mode Only) */}
      <div className="hidden dark:block dark-orbs-backdrop" aria-hidden="true">
        <div className="dark-orb dark-orb-lime" />
        <div className="dark-orb dark-orb-cyan" />
        <div className="dark-orb dark-orb-lime-secondary" />
      </div>

      {/* Left Navigation Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        timezonePref={timezonePref}
        onChangeTimezonePref={setTimezonePref}
        localTzLabel={localTzLabel}
        unreadAlerts={unreadAlerts}
        liveMatchCount={liveMatchCount}
        currentBankroll={currentBankroll}
        currencySymbol={currencySymbol}
        marketSummary={marketSummary}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Content Viewport */}
      <div className="flex-1 min-w-0 flex flex-col overflow-visible">
        {/* Clean Contextual Top Bar (Sidebar Workspace Contract) */}
        <header className="sticky top-0 z-30 h-16 px-5 sm:px-10 flex items-center justify-between gap-4 border-b border-slate-200 dark:border-white/[0.08] bg-white/90 dark:bg-[#090909]/65 backdrop-blur-xl shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir navegación"
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.07]"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 dark:text-slate-500 hidden sm:inline whitespace-nowrap">
                LambdaQuant
              </span>
              <span
                aria-hidden="true"
                className="text-slate-300 dark:text-slate-700 hidden sm:inline"
              >
                /
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {currentMeta.breadcrumb}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'alerts'
                  ? 'border-slate-900 bg-slate-900 text-white dark:border-[#ABF43F] dark:bg-white/[0.1] dark:text-[#ABF43F]'
                  : 'border-slate-200 dark:border-white/[0.1] bg-transparent dark:bg-white/[0.04] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.08]'
              }`}
            >
              <Bell className="h-3.5 w-3.5" />
              <span>Alertas{unreadAlerts > 0 ? ` (${unreadAlerts})` : ''}</span>
            </button>
          </div>
        </header>

        {/* Workspace Canvas (generous padding + overflow-visible so glass hover zoom & lime glow never clip) */}
        <main className="flex-1 w-full max-w-[1380px] mx-auto px-5 sm:px-10 py-7 space-y-6 overflow-visible">
          <div className="max-w-3xl">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 [text-wrap:balance]">
              {currentMeta.title}
            </h1>
            {currentMeta.subtitle && (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {currentMeta.subtitle}
              </p>
            )}
          </div>

          {(activeTab === 'opportunities' || activeTab === 'live') && (
            <OpportunitiesView
              picks={evaluatedPicks}
              loading={loadingMarkets}
              error={marketsError}
              activeModel={activeModel}
              onChangeModel={setActiveModel}
              liveOnlyView={activeTab === 'live'}
              timeZone={activeTimeZone}
              tzLabel={activeTzLabel}
              currencySymbol={currencySymbol}
              onRefresh={() => fetchMarkets(true)}
              onInspectPick={(p) => setInspectedPickId(p.pickId)}
              onQuickBet={(p) => handlePlaceBet(p)}
            />
          )}

          {activeTab === 'alerts' && (
            <AlertsView
              alerts={alerts}
              settings={alertSettings}
              timeZone={activeTimeZone}
              onUpdateSettings={setAlertSettings}
              onMarkAllRead={() => setAlerts((prev) => prev.map((a) => ({ ...a, read: true })))}
              onMarkRead={(id) =>
                setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, read: true } : a)))
              }
              onTestAlert={handleTestAlert}
              onInspectAlert={(alert) => {
                setInspectedPickId(alert.pickId);
              }}
            />
          )}

          {activeTab === 'model-lab' && (
            <ModelLabView
              currentBankroll={currentBankroll}
              bankrollConfig={bankrollConfig}
              currencySymbol={currencySymbol}
              onLogCustomBet={handleLogCustomBet}
            />
          )}

          {activeTab === 'bankroll' && (
            <BankrollHistoryView
              bets={bets}
              bankrollConfig={bankrollConfig}
              currentBankroll={currentBankroll}
              currencySymbol={currencySymbol}
              onUpdateConfig={setBankrollConfig}
              onSettleBet={handleSettleBet}
              onDeleteBet={handleDeleteBet}
            />
          )}

          {activeTab === 'stats' && (
            <SportStatsView bets={bets} currencySymbol={currencySymbol} />
          )}

          {activeTab === 'reports' && (
            <PdfReportsView
              bets={bets}
              bankrollConfig={bankrollConfig}
              currentBankroll={currentBankroll}
              currencySymbol={currencySymbol}
            />
          )}
        </main>
      </div>

      {/* Quantitative Pick Inspector Drawer */}
      <PickInspector
        pick={inspectedPick}
        activeModel={activeModel}
        currentBankroll={currentBankroll}
        bankrollConfig={bankrollConfig}
        currencySymbol={currencySymbol}
        timeZone={activeTimeZone}
        tzLabel={activeTzLabel}
        onClose={() => setInspectedPickId(null)}
        onPlaceBet={(pick, stake) => handlePlaceBet(pick, stake)}
      />
    </div>
  );
}
