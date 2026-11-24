import type { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { TimezonePreference } from './timezone.ts';
import type {
  AlertSettings,
  BankrollConfig,
  BetRecord,
  BetStatus,
  MarketCategory,
  MatchMlFeatures,
  ModelType,
  ParlayLeg,
  SelectionKey,
  SportId,
} from '../types/quant.ts';
import { db, handleFirestoreError, OperationType } from './firebase.ts';

export interface UserWorkspaceDoc {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  theme: 'dark' | 'light';
  timezonePref: TimezonePreference;
  activeModel: ModelType;
  bankrollConfig: BankrollConfig;
  alertSettings: AlertSettings;
}

const VALID_SPORTS: ReadonlySet<SportId> = new Set(['soccer', 'nba', 'nhl', 'football']);
const VALID_MODELS: ReadonlySet<ModelType> = new Set([
  'bivariate-poisson-xg-elo',
  'dixon-coles',
  'negative-binomial',
  'ml-gbdt',
  'ensemble',
]);
const VALID_STRATEGIES: ReadonlySet<BankrollConfig['strategy']> = new Set([
  'kelly-quarter',
  'kelly-half',
  'kelly-full',
  'flat-percent',
  'flat-fixed',
]);
const VALID_MARKET_TYPES: ReadonlySet<MarketCategory> = new Set([
  'totals',
  'btts',
  '1x2',
  'asian-handicap',
  'parlay',
]);
const VALID_SELECTION_KEYS: ReadonlySet<SelectionKey> = new Set([
  'over',
  'under',
  'btts_yes',
  'btts_no',
  'home',
  'draw',
  'away',
  'ah_home',
  'ah_away',
  'parlay',
]);

/**
 * Deterministically maps any raw identifier to a hardened Firestore document ID
 * strictly matching ^[a-zA-Z0-9_\-]+$ (1..128 chars).
 */
export function toFirestoreDocId(rawId: string): string {
  const cleaned = rawId
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned.length > 0 ? cleaned : `doc-${Date.now()}`;
}

function sanitizeString(value: unknown, minLen: number, maxLen: number, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  const candidate = raw.length >= minLen ? raw : fallback;
  return candidate.slice(0, maxLen);
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeSport(value: unknown): SportId {
  return typeof value === 'string' && VALID_SPORTS.has(value as SportId)
    ? (value as SportId)
    : 'soccer';
}

function sanitizeModel(value: unknown): ModelType {
  return typeof value === 'string' && VALID_MODELS.has(value as ModelType)
    ? (value as ModelType)
    : 'bivariate-poisson-xg-elo';
}

export function sanitizeBankrollConfig(cfg: BankrollConfig): BankrollConfig {
  return {
    initialBankroll: clampNum(cfg.initialBankroll, 0, 100000000, 2500),
    strategy: VALID_STRATEGIES.has(cfg.strategy) ? cfg.strategy : 'kelly-quarter',
    flatPercent: clampNum(cfg.flatPercent, 0.1, 50, 2),
    flatFixed: clampNum(cfg.flatFixed, 1, 1000000, 50),
    maxStakePercent: clampNum(cfg.maxStakePercent, 0.5, 50, 5),
    dailyStopLossPercent: clampNum(cfg.dailyStopLossPercent, 1, 100, 10),
    minEvThreshold: clampNum(cfg.minEvThreshold, 0, 100, 2.5),
    currency: cfg.currency === 'USD' ? 'USD' : 'EUR',
  };
}

export function sanitizeAlertSettings(settings: AlertSettings): AlertSettings {
  return {
    pushEnabled: Boolean(settings.pushEnabled),
    soundEnabled: Boolean(settings.soundEnabled),
    minEvPercent: clampNum(settings.minEvPercent, 0, 100, 4.5),
    minEdgePercent: clampNum(settings.minEdgePercent, 0, 100, 2.5),
    sports: {
      soccer: Boolean(settings.sports?.soccer ?? true),
      nba: Boolean(settings.sports?.nba ?? true),
      nhl: Boolean(settings.sports?.nhl ?? true),
      football: Boolean(settings.sports?.football ?? true),
    },
  };
}

function sanitizeMlFeatures(f: MatchMlFeatures): MatchMlFeatures {
  return {
    paceIndex: clampNum(f?.paceIndex, 0.5, 2.0, 1.0),
    volatilityIndex: clampNum(f?.volatilityIndex, 0, 2.0, 0.2),
    shotQualityDiff: clampNum(f?.shotQualityDiff, -2.0, 2.0, 0),
    defensiveFragility: clampNum(f?.defensiveFragility, 0.5, 2.0, 1.0),
    restAdvantage: clampNum(f?.restAdvantage, -10, 10, 0),
  };
}

function buildBetCreatePayload(uid: string, bet: BetRecord): Record<string, unknown> {
  const safeDate = sanitizeString(bet.date, 10, 40, new Date().toISOString());
  const safeMonthKey = /^[0-9]{4}-[0-9]{2}$/.test(bet.monthKey)
    ? bet.monthKey
    : safeDate.slice(0, 7);

  const payload: Record<string, unknown> = {
    ownerId: uid,
    date: safeDate,
    monthKey: safeMonthKey,
    sport: sanitizeSport(bet.sport),
    league: sanitizeString(bet.league, 1, 100, 'Liga'),
    matchLabel: sanitizeString(bet.matchLabel, 1, 160, 'Partido'),
    side: bet.side === 'under' ? 'under' : 'over',
    line: clampNum(bet.line, -100, 500, 2.5),
    bookmaker: sanitizeString(bet.bookmaker, 1, 80, 'Pinnacle'),
    odds: clampNum(bet.odds, 1.01, 1000, 1.9),
    closingOdds: clampNum(bet.closingOdds, 1.01, 1000, clampNum(bet.odds, 1.01, 1000, 1.9)),
    modelProb: clampNum(bet.modelProb, 0, 1, 0.5),
    edge: clampNum(bet.edge, -1, 1, 0),
    ev: clampNum(bet.ev, -1, 100, 0),
    stake: clampNum(bet.stake, 0.01, 10000000, 25),
    status:
      bet.status === 'won' || bet.status === 'lost' || bet.status === 'void'
        ? bet.status
        : 'pending',
    pnl: clampNum(bet.pnl, -10000000, 100000000, 0),
    modelUsed: sanitizeModel(bet.modelUsed),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (bet.matchId && bet.matchId.trim().length > 0) {
    payload.matchId = sanitizeString(bet.matchId, 1, 128, 'match');
  }
  if (bet.marketType && VALID_MARKET_TYPES.has(bet.marketType)) {
    payload.marketType = bet.marketType;
  }
  if (bet.selectionKey && VALID_SELECTION_KEYS.has(bet.selectionKey)) {
    payload.selectionKey = bet.selectionKey;
  }
  if (bet.marketLabel && bet.marketLabel.trim().length > 0) {
    payload.marketLabel = sanitizeString(bet.marketLabel, 1, 240, 'Totales');
  }
  if (bet.finalScore && bet.finalScore.trim().length > 0) {
    payload.finalScore = sanitizeString(bet.finalScore, 1, 40, '0-0');
  }

  return payload;
}

function buildParlayLegCreatePayload(uid: string, leg: ParlayLeg): Record<string, unknown> {
  const validMarketType =
    leg.marketType === 'btts' || leg.marketType === '1x2' || leg.marketType === 'asian-handicap'
      ? leg.marketType
      : 'totals';
  const rawSel: string = leg.selectionKey;
  const validSel =
    VALID_SELECTION_KEYS.has(rawSel as SelectionKey) && rawSel !== 'parlay'
      ? (rawSel as Exclude<SelectionKey, 'parlay'>)
      : 'over';

  const payload: Record<string, unknown> = {
    ownerId: uid,
    legId: sanitizeString(leg.id, 1, 180, 'leg'),
    matchId: sanitizeString(leg.matchId, 1, 128, 'match'),
    sport: sanitizeSport(leg.sport),
    league: sanitizeString(leg.league, 1, 100, 'Liga'),
    matchLabel: sanitizeString(leg.matchLabel, 1, 160, 'Partido'),
    homeTeam: sanitizeString(leg.homeTeam, 1, 80, 'Local'),
    awayTeam: sanitizeString(leg.awayTeam, 1, 80, 'Visitante'),
    marketType: validMarketType,
    selectionKey: validSel,
    marketLabel: sanitizeString(leg.marketLabel, 1, 160, 'Selección'),
    line: clampNum(leg.line, -100, 500, 2.5),
    bookmaker: sanitizeString(leg.bookmaker, 1, 80, 'Pinnacle'),
    odds: clampNum(leg.odds, 1.01, 1000, 1.9),
    modelProb: clampNum(leg.modelProb, 0, 1, 0.5),
    pushProb: clampNum(leg.pushProb, 0, 1, 0),
    ev: clampNum(leg.ev, -1, 100, 0),
    modelType: sanitizeModel(leg.modelType),
    homeLambda: clampNum(leg.homeLambda, 0, 300, 1.3),
    awayLambda: clampNum(leg.awayLambda, 0, 300, 1.1),
    homeElo: clampNum(leg.homeElo, 500, 3000, 1600),
    awayElo: clampNum(leg.awayElo, 500, 3000, 1600),
    bivariateCov: clampNum(leg.bivariateCov, 0, 50, 0.14),
    rho: clampNum(leg.rho, -1, 1, -0.05),
    alpha: clampNum(leg.alpha, 0, 10, 0.14),
    mlFeatures: sanitizeMlFeatures(leg.mlFeatures),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (leg.homeLogo && leg.homeLogo.trim().length > 0) {
    payload.homeLogo = leg.homeLogo.trim().slice(0, 500);
  }
  if (leg.awayLogo && leg.awayLogo.trim().length > 0) {
    payload.awayLogo = leg.awayLogo.trim().slice(0, 500);
  }

  return payload;
}

/**
 * Ensures the parent `/users/{uid}` workspace document exists BEFORE any subcollection
 * reads/writes so the Firestore Master Gate invariant is always satisfied.
 */
export async function ensureUserWorkspace(
  user: User,
  defaults: {
    theme: 'dark' | 'light';
    timezonePref: TimezonePreference;
    activeModel: ModelType;
    bankrollConfig: BankrollConfig;
    alertSettings: AlertSettings;
  }
): Promise<{ created: boolean; workspace: UserWorkspaceDoc }> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);

  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const safeEmail = sanitizeString(user.email, 3, 254, 'usuario@lambdaquant.app');
  const safeDisplayName = sanitizeString(
    user.displayName || user.email?.split('@')[0],
    1,
    120,
    'Analista LambdaQuant'
  );
  const safePhoto = user.photoURL ? user.photoURL.trim().slice(0, 500) : undefined;

  if (!snap.exists()) {
    const createPayload: Record<string, unknown> = {
      uid: user.uid,
      email: safeEmail,
      displayName: safeDisplayName,
      theme: defaults.theme === 'light' ? 'light' : 'dark',
      timezonePref: defaults.timezonePref === 'local' ? 'local' : 'gmt-6',
      activeModel: sanitizeModel(defaults.activeModel),
      bankrollConfig: sanitizeBankrollConfig(defaults.bankrollConfig),
      alertSettings: sanitizeAlertSettings(defaults.alertSettings),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (safePhoto) {
      createPayload.photoURL = safePhoto;
    }

    try {
      await setDoc(ref, createPayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }

    return {
      created: true,
      workspace: {
        uid: user.uid,
        email: safeEmail,
        displayName: safeDisplayName,
        ...(safePhoto ? { photoURL: safePhoto } : {}),
        theme: createPayload.theme as 'dark' | 'light',
        timezonePref: createPayload.timezonePref as TimezonePreference,
        activeModel: createPayload.activeModel as ModelType,
        bankrollConfig: createPayload.bankrollConfig as BankrollConfig,
        alertSettings: createPayload.alertSettings as AlertSettings,
      },
    };
  }

  const data = snap.data() as Partial<UserWorkspaceDoc>;

  // Sync updated Google profile name/photo if changed (action-based profile update)
  if (data.displayName !== safeDisplayName || (safePhoto && data.photoURL !== safePhoto)) {
    const profilePatch: Record<string, unknown> = {
      displayName: safeDisplayName,
      updatedAt: serverTimestamp(),
    };
    if (safePhoto) {
      profilePatch.photoURL = safePhoto;
    }
    try {
      await updateDoc(ref, profilePatch);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  return {
    created: false,
    workspace: {
      uid: user.uid,
      email: data.email ?? safeEmail,
      displayName: safeDisplayName,
      photoURL: safePhoto ?? data.photoURL,
      theme: data.theme === 'light' ? 'light' : 'dark',
      timezonePref: data.timezonePref === 'local' ? 'local' : 'gmt-6',
      activeModel: sanitizeModel(data.activeModel ?? defaults.activeModel),
      bankrollConfig: sanitizeBankrollConfig(data.bankrollConfig ?? defaults.bankrollConfig),
      alertSettings: sanitizeAlertSettings(data.alertSettings ?? defaults.alertSettings),
    },
  };
}

export async function updateCloudBankrollConfig(
  uid: string,
  config: BankrollConfig
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      bankrollConfig: sanitizeBankrollConfig(config),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateCloudAlertSettings(
  uid: string,
  settings: AlertSettings
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      alertSettings: sanitizeAlertSettings(settings),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateCloudPreferences(
  uid: string,
  prefs: {
    theme: 'dark' | 'light';
    timezonePref: TimezonePreference;
    activeModel: ModelType;
  }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      theme: prefs.theme === 'light' ? 'light' : 'dark',
      timezonePref: prefs.timezonePref === 'local' ? 'local' : 'gmt-6',
      activeModel: sanitizeModel(prefs.activeModel),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function seedCloudBetsIfEmpty(uid: string, localBets: BetRecord[]): Promise<boolean> {
  const path = `users/${uid}/bets`;
  let existingSnap;
  try {
    const q = query(collection(db, 'users', uid, 'bets'), where('ownerId', '==', uid));
    existingSnap = await getDocs(q);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }

  if (!existingSnap.empty || localBets.length === 0) {
    return false;
  }

  const batch = writeBatch(db);
  for (const bet of localBets.slice(0, 200)) {
    const docId = toFirestoreDocId(bet.id);
    batch.set(doc(db, 'users', uid, 'bets', docId), buildBetCreatePayload(uid, bet));
  }

  try {
    await batch.commit();
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function createCloudBet(uid: string, bet: BetRecord): Promise<void> {
  const docId = toFirestoreDocId(bet.id);
  const path = `users/${uid}/bets/${docId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'bets', docId), buildBetCreatePayload(uid, bet));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function settleCloudBet(
  uid: string,
  betId: string,
  patch: {
    status: Exclude<BetStatus, 'pending'>;
    pnl: number;
    closingOdds?: number;
    finalScore?: string;
  }
): Promise<void> {
  const docId = toFirestoreDocId(betId);
  const path = `users/${uid}/bets/${docId}`;
  const updatePayload: Record<string, unknown> = {
    status: patch.status,
    pnl: clampNum(patch.pnl, -10000000, 100000000, 0),
    updatedAt: serverTimestamp(),
  };
  if (typeof patch.closingOdds === 'number' && Number.isFinite(patch.closingOdds) && patch.closingOdds >= 1.01) {
    updatePayload.closingOdds = clampNum(patch.closingOdds, 1.01, 1000, 1.9);
  }
  if (patch.finalScore && patch.finalScore.trim().length > 0) {
    updatePayload.finalScore = sanitizeString(patch.finalScore, 1, 40, '0-0');
  }

  try {
    await updateDoc(doc(db, 'users', uid, 'bets', docId), updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCloudBet(uid: string, betId: string): Promise<void> {
  const docId = toFirestoreDocId(betId);
  const path = `users/${uid}/bets/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'bets', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function createCloudParlayLeg(uid: string, leg: ParlayLeg): Promise<void> {
  const docId = toFirestoreDocId(leg.id);
  const path = `users/${uid}/parlayLegs/${docId}`;
  try {
    await setDoc(doc(db, 'users', uid, 'parlayLegs', docId), buildParlayLegCreatePayload(uid, leg));
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCloudParlayLeg(uid: string, legId: string): Promise<void> {
  const docId = toFirestoreDocId(legId);
  const path = `users/${uid}/parlayLegs/${docId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'parlayLegs', docId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearCloudParlayLegs(uid: string, legs: ParlayLeg[]): Promise<void> {
  if (legs.length === 0) return;
  const path = `users/${uid}/parlayLegs`;
  const batch = writeBatch(db);
  for (const leg of legs) {
    const docId = toFirestoreDocId(leg.id);
    batch.delete(doc(db, 'users', uid, 'parlayLegs', docId));
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToUserWorkspace(
  uid: string,
  onData: (workspace: UserWorkspaceDoc) => void,
  onFatalError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() as Partial<UserWorkspaceDoc>;
      if (!data.bankrollConfig || !data.alertSettings) return;
      onData({
        uid,
        email: data.email ?? '',
        displayName: data.displayName ?? 'Analista',
        photoURL: data.photoURL,
        theme: data.theme === 'light' ? 'light' : 'dark',
        timezonePref: data.timezonePref === 'local' ? 'local' : 'gmt-6',
        activeModel: sanitizeModel(data.activeModel),
        bankrollConfig: sanitizeBankrollConfig(data.bankrollConfig),
        alertSettings: sanitizeAlertSettings(data.alertSettings),
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onFatalError(wrapped as Error);
      }
    }
  );
}

export function subscribeToCloudBets(
  uid: string,
  onData: (bets: BetRecord[]) => void,
  onFatalError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/bets`;
  const q = query(collection(db, 'users', uid, 'bets'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: BetRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          date: String(d.date ?? new Date().toISOString()),
          monthKey: String(d.monthKey ?? new Date().toISOString().slice(0, 7)),
          sport: sanitizeSport(d.sport),
          league: String(d.league ?? ''),
          matchId: typeof d.matchId === 'string' ? d.matchId : undefined,
          matchLabel: String(d.matchLabel ?? ''),
          side: d.side === 'under' ? 'under' : 'over',
          line: Number(d.line ?? 0),
          marketType: typeof d.marketType === 'string' ? (d.marketType as MarketCategory) : undefined,
          selectionKey:
            typeof d.selectionKey === 'string' ? (d.selectionKey as SelectionKey) : undefined,
          marketLabel: typeof d.marketLabel === 'string' ? d.marketLabel : undefined,
          finalScore: typeof d.finalScore === 'string' ? d.finalScore : undefined,
          bookmaker: String(d.bookmaker ?? 'Pinnacle'),
          odds: Number(d.odds ?? 1.9),
          closingOdds: Number(d.closingOdds ?? d.odds ?? 1.9),
          modelProb: Number(d.modelProb ?? 0.5),
          edge: Number(d.edge ?? 0),
          ev: Number(d.ev ?? 0),
          stake: Number(d.stake ?? 0),
          status:
            d.status === 'won' || d.status === 'lost' || d.status === 'void'
              ? d.status
              : 'pending',
          pnl: Number(d.pnl ?? 0),
          modelUsed: sanitizeModel(d.modelUsed),
        };
      });
      items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onFatalError(wrapped as Error);
      }
    }
  );
}

export function subscribeToCloudParlayLegs(
  uid: string,
  onData: (legs: ParlayLeg[]) => void,
  onFatalError: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}/parlayLegs`;
  const q = query(collection(db, 'users', uid, 'parlayLegs'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: ParlayLeg[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        return {
          id: String(d.legId ?? docSnap.id),
          matchId: String(d.matchId ?? ''),
          sport: sanitizeSport(d.sport),
          league: String(d.league ?? ''),
          matchLabel: String(d.matchLabel ?? ''),
          homeTeam: String(d.homeTeam ?? ''),
          awayTeam: String(d.awayTeam ?? ''),
          homeLogo: typeof d.homeLogo === 'string' ? d.homeLogo : undefined,
          awayLogo: typeof d.awayLogo === 'string' ? d.awayLogo : undefined,
          marketType:
            d.marketType === 'btts' || d.marketType === '1x2' || d.marketType === 'asian-handicap'
              ? d.marketType
              : 'totals',
          selectionKey:
            typeof d.selectionKey === 'string' && d.selectionKey !== 'parlay'
              ? (d.selectionKey as Exclude<SelectionKey, 'parlay'>)
              : 'over',
          marketLabel: String(d.marketLabel ?? ''),
          line: Number(d.line ?? 2.5),
          bookmaker: String(d.bookmaker ?? 'Pinnacle'),
          odds: Number(d.odds ?? 1.9),
          modelProb: Number(d.modelProb ?? 0.5),
          pushProb: Number(d.pushProb ?? 0),
          ev: Number(d.ev ?? 0),
          modelType: sanitizeModel(d.modelType),
          homeLambda: Number(d.homeLambda ?? 1.3),
          awayLambda: Number(d.awayLambda ?? 1.1),
          homeElo: Number(d.homeElo ?? 1600),
          awayElo: Number(d.awayElo ?? 1600),
          bivariateCov: Number(d.bivariateCov ?? 0.14),
          rho: Number(d.rho ?? -0.05),
          alpha: Number(d.alpha ?? 0.14),
          mlFeatures: sanitizeMlFeatures(d.mlFeatures as MatchMlFeatures),
        };
      });
      onData(items.slice(0, 10));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onFatalError(wrapped as Error);
      }
    }
  );
}
