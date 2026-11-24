import { onAuthStateChanged, type User } from 'firebase/auth';
import { Bell, Layers, Menu } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertsView } from './components/AlertsView.tsx';
import { BankrollHistoryView } from './components/BankrollHistoryView.tsx';
import { MobileLiquidGlassNav } from './components/MobileLiquidGlassNav.tsx';
import { ModelLabView } from './components/ModelLabView.tsx';
import { OpportunitiesView } from './components/OpportunitiesView.tsx';
import { ParlaySlip } from './components/ParlaySlip.tsx';
import { PdfReportsView } from './components/PdfReportsView.tsx';
import { PickInspector } from './components/PickInspector.tsx';
import { ResultsAuditView } from './components/ResultsAuditView.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import type { SidebarMarketSummary, WorkspaceTab } from './components/Sidebar.tsx';
import { SportStatsView } from './components/SportStatsView.tsx';
import { evaluateAllMatches } from './lib/dixonColes.ts';
import { auth, signInWithGoogle, signOutUser } from './lib/firebase.ts';
import {
  clearCloudParlayLegs,
  createCloudBet,
  createCloudParlayLeg,
  deleteCloudBet,
  deleteCloudParlayLeg,
  ensureUserWorkspace,
  seedCloudBetsIfEmpty,
  settleCloudBet,
  subscribeToCloudBets,
  subscribeToCloudParlayLegs,
  subscribeToUserWorkspace,
  toFirestoreDocId,
  updateCloudAlertSettings,
  updateCloudBankrollConfig,
  updateCloudPreferences,
} from './lib/firestoreSync.ts';
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
  DerivedSoccerOption,
  EvaluatedPick,
  LiveMatch,
  ModelType,
  ParlayLeg,
  SettlementProposal,
  SportId,
} from './types/quant.ts';

const STORAGE_KEYS = {
  theme: 'lq_theme_v1',
  bets: 'lq_bets_v3',
  bankroll: 'lq_bankroll_v1',
  alertSettings: 'lq_alert_settings_v2',
  timezonePref: 'lq_tz_pref_v1',
  parlayLegs: 'lq_parlay_legs_v1',
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
  results: {
    breadcrumb: 'Resultados y Auditoría',
    title: 'Auditoría Global de Picks y Resultados',
    subtitle:
      'Seguimiento automático de todos los partidos finalizados en Fútbol, NBA, NHL y NFL/NCAAF con evaluación por modelo predictivo y balance a 1 unidad.',
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
  const [selectedSport, setSelectedSport] = useState<SportId | 'all'>('all');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Firebase Auth & Cloud Firestore Sync State
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [authBusy, setAuthBusy] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState<boolean>(false);
  const [cloudSyncing, setCloudSyncing] = useState<boolean>(false);
  const [fatalFirestoreError, setFatalFirestoreError] = useState<Error | null>(null);

  const bankrollSyncTimerRef = useRef<number | null>(null);
  const alertSyncTimerRef = useRef<number | null>(null);

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

  // Pick Inspector, Parlay Slip & Dedicated Alerts Tab State
  const [inspectedPickId, setInspectedPickId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [parlayOpen, setParlayOpen] = useState<boolean>(false);
  const [parlayLegs, setParlayLegs] = useState<ParlayLeg[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.parlayLegs);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.parlayLegs, JSON.stringify(parlayLegs));
    } catch {
      // ignore
    }
  }, [parlayLegs]);

  const parlayLegIds = useMemo(() => new Set(parlayLegs.map((l) => l.id)), [parlayLegs]);

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

  // Keep latest local defaults in refs for initial cloud hydration without re-triggering auth effect
  const localDefaultsRef = useRef({
    theme,
    timezonePref,
    activeModel,
    bankrollConfig,
    alertSettings,
    bets,
    parlayLegs,
  });
  localDefaultsRef.current = {
    theme,
    timezonePref,
    activeModel,
    bankrollConfig,
    alertSettings,
    bets,
    parlayLegs,
  };

  // Surface any fatal Firestore error directly to React ErrorBoundary
  if (fatalFirestoreError) {
    throw fatalFirestoreError;
  }

  // Subscribe to Firebase Auth state first (never touch Firestore before authReady)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setAuthReady(true);
      if (!user) {
        setCloudReady(false);
        setCloudSyncing(false);
      }
    });
    return () => unsub();
  }, []);

  // Initialize /users/{uid} workspace (Master Gate) & attach real-time onSnapshot listeners
  useEffect(() => {
    if (!authReady || !firebaseUser) return;

    if (!firebaseUser.emailVerified) {
      setAuthError('Tu cuenta de Google debe tener el correo verificado para sincronizar datos.');
      return;
    }

    let cancelled = false;
    let unsubWorkspace: (() => void) | null = null;
    let unsubBets: (() => void) | null = null;
    let unsubParlay: (() => void) | null = null;

    const bootstrapCloud = async () => {
      setCloudSyncing(true);
      setAuthError(null);
      try {
        const snapshotDefaults = localDefaultsRef.current;
        const { workspace } = await ensureUserWorkspace(firebaseUser, {
          theme: snapshotDefaults.theme,
          timezonePref: snapshotDefaults.timezonePref,
          activeModel: snapshotDefaults.activeModel,
          bankrollConfig: snapshotDefaults.bankrollConfig,
          alertSettings: snapshotDefaults.alertSettings,
        });
        if (cancelled) return;

        // Hydrate workspace settings from cloud
        setTheme(workspace.theme);
        setTimezonePref(workspace.timezonePref);
        setActiveModel(workspace.activeModel);
        setBankrollConfig(workspace.bankrollConfig);
        setAlertSettings(workspace.alertSettings);

        // Migrate local bet ledger on first sign-in if cloud ledger is empty
        await seedCloudBetsIfEmpty(firebaseUser.uid, snapshotDefaults.bets);
        if (cancelled) return;

        setCloudReady(true);

        // Attach live onSnapshot subscriptions
        unsubWorkspace = subscribeToUserWorkspace(
          firebaseUser.uid,
          (nextWorkspace) => {
            if (cancelled) return;
            setTheme(nextWorkspace.theme);
            setTimezonePref(nextWorkspace.timezonePref);
            setActiveModel(nextWorkspace.activeModel);
            setBankrollConfig(nextWorkspace.bankrollConfig);
            setAlertSettings(nextWorkspace.alertSettings);
          },
          (err) => {
            if (!cancelled) setFatalFirestoreError(err);
          }
        );

        unsubBets = subscribeToCloudBets(
          firebaseUser.uid,
          (cloudBets) => {
            if (cancelled) return;
            setBets(cloudBets);
            setCloudSyncing(false);
          },
          (err) => {
            if (!cancelled) setFatalFirestoreError(err);
          }
        );

        unsubParlay = subscribeToCloudParlayLegs(
          firebaseUser.uid,
          (cloudLegs) => {
            if (cancelled) return;
            setParlayLegs(cloudLegs);
          },
          (err) => {
            if (!cancelled) setFatalFirestoreError(err);
          }
        );
      } catch (err) {
        if (!cancelled) {
          setCloudSyncing(false);
          setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    void bootstrapCloud();

    return () => {
      cancelled = true;
      unsubWorkspace?.();
      unsubBets?.();
      unsubParlay?.();
    };
  }, [authReady, firebaseUser]);

  // Clear pending debounce timers on unmount
  useEffect(() => {
    return () => {
      if (bankrollSyncTimerRef.current) window.clearTimeout(bankrollSyncTimerRef.current);
      if (alertSyncTimerRef.current) window.clearTimeout(alertSyncTimerRef.current);
    };
  }, []);

  const handleSignInGoogle = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      const code = (error as { code?: string })?.code ?? '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError(null);
      } else if (code === 'auth/popup-blocked') {
        setAuthError('Permite ventanas emergentes para iniciar sesión con Google.');
      } else {
        setAuthError('No se pudo iniciar sesión con Google. Inténtalo de nuevo.');
      }
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOutUser();
    } catch {
      setAuthError('Error al cerrar sesión.');
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const syncPrefsIfSignedIn = useCallback(
    (nextTheme: 'dark' | 'light', nextTz: TimezonePreference, nextModel: ModelType) => {
      if (!firebaseUser || !cloudReady) return;
      void updateCloudPreferences(firebaseUser.uid, {
        theme: nextTheme,
        timezonePref: nextTz,
        activeModel: nextModel,
      }).catch((err) => setFatalFirestoreError(err instanceof Error ? err : new Error(String(err))));
    },
    [firebaseUser, cloudReady]
  );

  const handleToggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      syncPrefsIfSignedIn(next, timezonePref, activeModel);
      return next;
    });
  }, [syncPrefsIfSignedIn, timezonePref, activeModel]);

  const handleChangeTimezonePref = useCallback(
    (pref: TimezonePreference) => {
      setTimezonePref(pref);
      syncPrefsIfSignedIn(theme, pref, activeModel);
    },
    [syncPrefsIfSignedIn, theme, activeModel]
  );

  const handleChangeActiveModel = useCallback(
    (model: ModelType) => {
      setActiveModel(model);
      syncPrefsIfSignedIn(theme, timezonePref, model);
    },
    [syncPrefsIfSignedIn, theme, timezonePref]
  );

  const handleUpdateBankrollConfig = useCallback(
    (next: BankrollConfig) => {
      setBankrollConfig(next);
      if (!firebaseUser || !cloudReady) return;
      if (bankrollSyncTimerRef.current) window.clearTimeout(bankrollSyncTimerRef.current);
      const uid = firebaseUser.uid;
      bankrollSyncTimerRef.current = window.setTimeout(() => {
        void updateCloudBankrollConfig(uid, next).catch((err) =>
          setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
        );
      }, 350);
    },
    [firebaseUser, cloudReady]
  );

  const handleUpdateAlertSettings = useCallback(
    (next: AlertSettings) => {
      setAlertSettings(next);
      if (!firebaseUser || !cloudReady) return;
      if (alertSyncTimerRef.current) window.clearTimeout(alertSyncTimerRef.current);
      const uid = firebaseUser.uid;
      alertSyncTimerRef.current = window.setTimeout(() => {
        void updateCloudAlertSettings(uid, next).catch((err) =>
          setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
        );
      }, 350);
    },
    [firebaseUser, cloudReady]
  );

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

  const persistNewBet = useCallback(
    (newRecord: BetRecord) => {
      const normalizedRecord: BetRecord = {
        ...newRecord,
        id: toFirestoreDocId(newRecord.id),
      };
      setBets((prev) => [normalizedRecord, ...prev]);
      if (firebaseUser && cloudReady) {
        void createCloudBet(firebaseUser.uid, normalizedRecord).catch((err) =>
          setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
        );
      }
    },
    [firebaseUser, cloudReady]
  );

  const handlePlaceBet = (pick: EvaluatedPick, customStake?: number) => {
    const stake = customStake ?? (pick.recommendedStake > 0 ? pick.recommendedStake : 25);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const marketLabel =
      pick.side === 'over'
        ? `Más de ${pick.marketLine.line}`
        : `Menos de ${pick.marketLine.line}`;
    const newRecord: BetRecord = {
      id: `bet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: now.toISOString(),
      monthKey,
      sport: pick.match.sport,
      league: pick.match.league,
      matchId: pick.match.id,
      matchLabel: `${pick.match.homeTeam} vs ${pick.match.awayTeam}`,
      side: pick.side,
      line: pick.marketLine.line,
      marketType: 'totals',
      selectionKey: pick.side,
      marketLabel,
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
    persistNewBet(newRecord);
  };

  const handlePlaceDerivedBet = (
    match: LiveMatch,
    option: DerivedSoccerOption,
    modelType: ModelType,
    customStake?: number
  ) => {
    const stake = customStake ?? (option.recommendedStake > 0 ? option.recommendedStake : 25);
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const newRecord: BetRecord = {
      id: `bet-drv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: now.toISOString(),
      monthKey,
      sport: match.sport,
      league: match.league,
      matchId: match.id,
      matchLabel: `${match.homeTeam} vs ${match.awayTeam}`,
      side: option.selectionKey === 'btts_no' || option.selectionKey === 'away' ? 'under' : 'over',
      line: option.line,
      marketType: option.marketType,
      selectionKey: option.selectionKey,
      marketLabel: option.label,
      bookmaker: option.bookmaker,
      odds: option.odds,
      closingOdds: option.odds,
      modelProb: option.modelProb,
      edge: option.edge,
      ev: option.ev,
      stake: Math.round(stake * 100) / 100,
      status: 'pending',
      pnl: 0,
      modelUsed: modelType,
    };
    persistNewBet(newRecord);
  };

  const handleToggleParlayLeg = useCallback(
    (leg: ParlayLeg) => {
      const exists = parlayLegs.some((item) => item.id === leg.id);
      if (exists) {
        setParlayLegs((prev) => prev.filter((item) => item.id !== leg.id));
        if (firebaseUser && cloudReady) {
          void deleteCloudParlayLeg(firebaseUser.uid, leg.id).catch((err) =>
            setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
          );
        }
      } else {
        if (parlayLegs.length >= 10) return;
        setParlayLegs((prev) => [...prev, leg].slice(0, 10));
        if (firebaseUser && cloudReady) {
          void createCloudParlayLeg(firebaseUser.uid, leg).catch((err) =>
            setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
          );
        }
      }
    },
    [parlayLegs, firebaseUser, cloudReady]
  );

  const handleRemoveParlayLeg = useCallback(
    (legId: string) => {
      setParlayLegs((prev) => prev.filter((item) => item.id !== legId));
      if (firebaseUser && cloudReady) {
        void deleteCloudParlayLeg(firebaseUser.uid, legId).catch((err) =>
          setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
        );
      }
    },
    [firebaseUser, cloudReady]
  );

  const handleClearParlayLegs = useCallback(() => {
    const currentLegs = parlayLegs;
    setParlayLegs([]);
    if (firebaseUser && cloudReady && currentLegs.length > 0) {
      void clearCloudParlayLegs(firebaseUser.uid, currentLegs).catch((err) =>
        setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
      );
    }
  }, [parlayLegs, firebaseUser, cloudReady]);

  const handlePlaceParlay = (payload: {
    legs: ParlayLeg[];
    odds: number;
    modelProb: number;
    edge: number;
    ev: number;
    stake: number;
  }) => {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const firstLeg = payload.legs[0];
    const summaryLabel = payload.legs
      .map((l) => `${l.homeTeam.split(' ')[0]}: ${l.marketLabel}`)
      .join(' + ');
    const newRecord: BetRecord = {
      id: `bet-parlay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      date: now.toISOString(),
      monthKey,
      sport: firstLeg?.sport ?? 'soccer',
      league: `Combinada (${payload.legs.length} sel.)`,
      matchLabel: `Parlay ${payload.legs.length}x · ${payload.legs
        .map((l) => `${l.homeTeam.split(' ')[0]} vs ${l.awayTeam.split(' ')[0]}`)
        .slice(0, 2)
        .join(' / ')}${payload.legs.length > 2 ? '…' : ''}`,
      side: 'over',
      line: payload.legs.length,
      marketType: 'parlay',
      selectionKey: 'parlay',
      marketLabel: summaryLabel,
      bookmaker: firstLeg?.bookmaker ?? 'Pinnacle',
      odds: payload.odds,
      closingOdds: payload.odds,
      modelProb: payload.modelProb,
      edge: payload.edge,
      ev: payload.ev,
      stake: Math.round(payload.stake * 100) / 100,
      status: 'pending',
      pnl: 0,
      modelUsed: activeModel,
    };
    persistNewBet(newRecord);
    const legsToClear = parlayLegs;
    setParlayLegs([]);
    if (firebaseUser && cloudReady && legsToClear.length > 0) {
      void clearCloudParlayLegs(firebaseUser.uid, legsToClear).catch((err) =>
        setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
      );
    }
  };

  const handleLogCustomBet = (betData: Omit<BetRecord, 'id'>) => {
    const newRecord: BetRecord = {
      ...betData,
      id: `bet-lab-${Date.now()}`,
    };
    persistNewBet(newRecord);
  };

  const handleSettleBet = (betId: string, status: Exclude<BetStatus, 'pending'>) => {
    const target = bets.find((b) => b.id === betId);
    if (!target || target.status !== 'pending') return;

    let pnl = 0;
    if (status === 'won') pnl = Math.round(target.stake * (target.odds - 1) * 100) / 100;
    else if (status === 'lost') pnl = -target.stake;

    setBets((prev) =>
      prev.map((b) => (b.id === betId && b.status === 'pending' ? { ...b, status, pnl } : b))
    );

    if (firebaseUser && cloudReady) {
      void settleCloudBet(firebaseUser.uid, betId, { status, pnl }).catch((err) =>
        setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
      );
    }
  };

  const handleCheckAutoSettle = useCallback(
    async (
      forceRefresh = false
    ): Promise<{ proposals: SettlementProposal[]; checkedFinishedCount: number }> => {
      const pendingBets = bets.filter(
        (b) => b.status === 'pending' && b.marketType !== 'parlay'
      );
      if (pendingBets.length === 0) {
        return { proposals: [], checkedFinishedCount: 0 };
      }

      const res = await fetch('/api/settlements/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceRefresh,
          bets: pendingBets.map((b) => ({
            id: b.id,
            sport: b.sport,
            matchLabel: b.matchLabel,
            side: b.side,
            line: b.line,
            marketType: b.marketType ?? 'totals',
            selectionKey: b.selectionKey ?? b.side,
            odds: b.odds,
          })),
        }),
      });
      if (!res.ok) {
        throw new Error('Error al consultar resultados finales en ESPN');
      }
      const data = await res.json();
      return {
        proposals: Array.isArray(data.proposals) ? data.proposals : [],
        checkedFinishedCount: Number(data.checkedFinishedCount) || 0,
      };
    },
    [bets]
  );

  const handleApplySettlements = useCallback(
    (proposals: SettlementProposal[]) => {
      if (proposals.length === 0) return;
      const byId = new Map(proposals.map((p) => [p.betId, p]));
      const cloudUpdates: Array<{
        betId: string;
        status: Exclude<BetStatus, 'pending'>;
        pnl: number;
        closingOdds?: number;
        finalScore?: string;
      }> = [];

      for (const b of bets) {
        const prop = byId.get(b.id);
        if (!prop || b.status !== 'pending') continue;
        let pnl = 0;
        if (prop.suggestedStatus === 'won') {
          pnl = Math.round(b.stake * (b.odds - 1) * 100) / 100;
        } else if (prop.suggestedStatus === 'lost') {
          pnl = -b.stake;
        }
        cloudUpdates.push({
          betId: b.id,
          status: prop.suggestedStatus,
          pnl,
          closingOdds: prop.closingOdds > 1.01 ? prop.closingOdds : b.closingOdds,
          finalScore: prop.scoreLabel,
        });
      }

      setBets((prev) =>
        prev.map((b) => {
          const prop = byId.get(b.id);
          if (!prop || b.status !== 'pending') return b;
          let pnl = 0;
          if (prop.suggestedStatus === 'won') {
            pnl = Math.round(b.stake * (b.odds - 1) * 100) / 100;
          } else if (prop.suggestedStatus === 'lost') {
            pnl = -b.stake;
          }
          return {
            ...b,
            status: prop.suggestedStatus,
            pnl,
            closingOdds: prop.closingOdds > 1.01 ? prop.closingOdds : b.closingOdds,
            finalScore: prop.scoreLabel,
          };
        })
      );

      if (firebaseUser && cloudReady && cloudUpdates.length > 0) {
        for (const item of cloudUpdates) {
          void settleCloudBet(firebaseUser.uid, item.betId, {
            status: item.status,
            pnl: item.pnl,
            closingOdds: item.closingOdds,
            finalScore: item.finalScore,
          }).catch((err) =>
            setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
          );
        }
      }
    },
    [bets, firebaseUser, cloudReady]
  );

  const handleDeleteBet = (betId: string) => {
    setBets((prev) => prev.filter((b) => b.id !== betId));
    if (firebaseUser && cloudReady) {
      void deleteCloudBet(firebaseUser.uid, betId).catch((err) =>
        setFatalFirestoreError(err instanceof Error ? err : new Error(String(err)))
      );
    }
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

  const handleMobileSelectSport = useCallback((sport: SportId) => {
    setSelectedSport(sport);
    setMobileMenuOpen(false);
    setActiveTab((prev) =>
      prev === 'opportunities' ||
      prev === 'live' ||
      prev === 'results' ||
      prev === 'bankroll' ||
      prev === 'stats'
        ? prev
        : 'opportunities'
    );
  }, []);

  const unreadAlerts = alerts.filter((a) => !a.read).length;
  const currentMeta = TAB_TITLES[activeTab];

  return (
    <div className="min-h-screen flex bg-transparent text-slate-900 dark:bg-transparent dark:text-slate-100">
      {/* Dynamic Animated Light Orbs Backdrop (Light Mode) */}
      <div className="block dark:hidden light-orbs-backdrop" aria-hidden="true">
        <div className="light-orb light-orb-lime" />
        <div className="light-orb light-orb-cyan" />
        <div className="light-orb light-orb-lime-secondary" />
      </div>

      {/* Dynamic Animated Light Orbs Backdrop (Dark Mode) */}
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
        onToggleTheme={handleToggleTheme}
        timezonePref={timezonePref}
        onChangeTimezonePref={handleChangeTimezonePref}
        localTzLabel={localTzLabel}
        unreadAlerts={unreadAlerts}
        liveMatchCount={liveMatchCount}
        currentBankroll={currentBankroll}
        currencySymbol={currencySymbol}
        marketSummary={marketSummary}
        authUser={
          firebaseUser
            ? {
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Analista',
                email: firebaseUser.email || '',
                photoURL: firebaseUser.photoURL ?? undefined,
              }
            : null
        }
        authLoading={!authReady || authBusy}
        cloudSyncing={cloudSyncing}
        authError={authError}
        onSignInGoogle={handleSignInGoogle}
        onSignOut={handleSignOut}
        selectedSport={selectedSport}
        onSelectSport={setSelectedSport}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      {/* Main Content Viewport */}
      <div className="flex-1 min-w-0 flex flex-col overflow-visible">
        {/* Clean Contextual Top Bar (Sidebar Workspace Contract) */}
        <header className="sticky top-0 z-30 h-16 px-5 sm:px-10 flex items-center justify-between gap-4 border-b border-slate-900/[0.08] dark:border-white/[0.08] glass-surface shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir navegación"
              className="md:hidden p-2 -ml-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-900/[0.06] dark:hover:bg-white/[0.07]"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500 dark:text-slate-500 hidden sm:inline whitespace-nowrap">
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
              onClick={() => setParlayOpen(true)}
              className={`glass-card inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-xl whitespace-nowrap shrink-0 ${
                parlayLegs.length > 0 || parlayOpen
                  ? 'glass-card-active text-slate-950 font-semibold dark:text-[#ABF43F]'
                  : 'text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Combinada{parlayLegs.length > 0 ? ` (${parlayLegs.length})` : ''}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('alerts')}
              className={`glass-card inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-xl whitespace-nowrap shrink-0 ${
                activeTab === 'alerts'
                  ? 'glass-card-active text-slate-950 font-semibold dark:text-[#ABF43F]'
                  : 'text-slate-700 hover:text-slate-950 dark:text-slate-200 dark:hover:text-white'
              }`}
            >
              <Bell className="h-3.5 w-3.5" />
              <span>Alertas{unreadAlerts > 0 ? ` (${unreadAlerts})` : ''}</span>
            </button>
          </div>
        </header>

        {/* Workspace Canvas (generous padding + overflow-visible so glass hover zoom & lime glow never clip) */}
        <main className="mobile-safe-bottom flex-1 w-full max-w-[1380px] mx-auto px-5 sm:px-10 py-7 space-y-6 overflow-visible">
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
              onChangeModel={handleChangeActiveModel}
              sportFilter={selectedSport}
              onChangeSportFilter={setSelectedSport}
              liveOnlyView={activeTab === 'live'}
              timeZone={activeTimeZone}
              tzLabel={activeTzLabel}
              currencySymbol={currencySymbol}
              parlayLegIds={parlayLegIds}
              onRefresh={() => fetchMarkets(true)}
              onInspectPick={(p) => setInspectedPickId(p.pickId)}
              onQuickBet={(p) => handlePlaceBet(p)}
              onToggleParlayLeg={handleToggleParlayLeg}
            />
          )}

          {activeTab === 'results' && (
            <ResultsAuditView
              theme={theme}
              bets={bets}
              activeModel={activeModel}
              onChangeModel={handleChangeActiveModel}
              sportFilter={selectedSport}
              onChangeSportFilter={setSelectedSport}
              timeZone={activeTimeZone}
              tzLabel={activeTzLabel}
            />
          )}

          {activeTab === 'alerts' && (
            <AlertsView
              alerts={alerts}
              settings={alertSettings}
              timeZone={activeTimeZone}
              onUpdateSettings={handleUpdateAlertSettings}
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
              theme={theme}
              currentBankroll={currentBankroll}
              bankrollConfig={bankrollConfig}
              currencySymbol={currencySymbol}
              onLogCustomBet={handleLogCustomBet}
            />
          )}

          {activeTab === 'bankroll' && (
            <BankrollHistoryView
              theme={theme}
              bets={bets}
              bankrollConfig={bankrollConfig}
              currentBankroll={currentBankroll}
              currencySymbol={currencySymbol}
              sportFilter={selectedSport}
              onChangeSportFilter={setSelectedSport}
              onUpdateConfig={handleUpdateBankrollConfig}
              onSettleBet={handleSettleBet}
              onDeleteBet={handleDeleteBet}
              onCheckAutoSettle={handleCheckAutoSettle}
              onApplySettlements={handleApplySettlements}
            />
          )}

          {activeTab === 'stats' && (
            <SportStatsView
              theme={theme}
              bets={bets}
              currencySymbol={currencySymbol}
              sportFilter={selectedSport}
              onChangeSportFilter={setSelectedSport}
            />
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

      {/* Mobile Floating "Liquid Glass" Pill Navigation (< 768px) */}
      <MobileLiquidGlassNav
        selectedSport={selectedSport}
        drawerOpen={mobileMenuOpen}
        onSelectSport={handleMobileSelectSport}
        onToggleDrawer={() => setMobileMenuOpen((prev) => !prev)}
      />

      {/* Quantitative Pick Inspector Drawer */}
      <PickInspector
        pick={inspectedPick}
        theme={theme}
        activeModel={activeModel}
        currentBankroll={currentBankroll}
        bankrollConfig={bankrollConfig}
        currencySymbol={currencySymbol}
        timeZone={activeTimeZone}
        tzLabel={activeTzLabel}
        parlayLegIds={parlayLegIds}
        onClose={() => setInspectedPickId(null)}
        onPlaceBet={(pick, stake) => handlePlaceBet(pick, stake)}
        onPlaceDerivedBet={handlePlaceDerivedBet}
        onToggleParlayLeg={handleToggleParlayLeg}
      />

      {/* Parlay +EV & Same-Game Correlation Calculator Slip */}
      <ParlaySlip
        open={parlayOpen}
        legs={parlayLegs}
        currentBankroll={currentBankroll}
        bankrollConfig={bankrollConfig}
        currencySymbol={currencySymbol}
        onClose={() => setParlayOpen(false)}
        onRemoveLeg={handleRemoveParlayLeg}
        onClearLegs={handleClearParlayLegs}
        onPlaceParlay={handlePlaceParlay}
      />
    </div>
  );
}
