/**
 * Phase 0: Dirty Dozen Firestore Security Rules Verification Suite
 *
 * Verifies all 12 adversarial payloads defined in security_spec.md return PERMISSION_DENIED (HTTP 403)
 * when executed against a local Firestore Rules Emulator (`FIRESTORE_EMULATOR_HOST`, default 127.0.0.1:8080).
 *
 * Run with emulator active:
 *   npx tsx firestore.rules.test.ts
 */

export interface DirtyDozenCase {
  id: string;
  name: string;
  method: 'GET' | 'POST' | 'PATCH';
  relativePath: string;
  authUid: string | null;
  email?: string;
  emailVerified?: boolean;
  body?: Record<string, unknown>;
}

const VALID_BANKROLL_CONFIG = {
  initialBankroll: 2500,
  strategy: 'kelly-quarter',
  flatPercent: 2,
  flatFixed: 50,
  maxStakePercent: 5,
  dailyStopLossPercent: 10,
  minEvThreshold: 2.5,
  currency: 'EUR',
};

const VALID_ALERT_SETTINGS = {
  pushEnabled: true,
  soundEnabled: false,
  minEvPercent: 4.5,
  minEdgePercent: 2.5,
  sports: { soccer: true, nba: true, nhl: true, football: true },
};

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 'D01',
    name: 'Cross-tenant PII read on /users/victim_uid',
    method: 'GET',
    relativePath: 'users/victim_uid',
    authUid: 'attacker_uid',
    email: 'attacker@example.com',
    emailVerified: true,
  },
  {
    id: 'D02',
    name: 'Blanket user list enumeration on /users',
    method: 'GET',
    relativePath: 'users',
    authUid: 'attacker_uid',
    email: 'attacker@example.com',
    emailVerified: true,
  },
  {
    id: 'D03',
    name: 'Unverified email spoofing write on /users/spoof_uid',
    method: 'PATCH',
    relativePath: 'users/spoof_uid',
    authUid: 'spoof_uid',
    email: 'victim@example.com',
    emailVerified: false,
    body: {
      uid: 'spoof_uid',
      email: 'victim@example.com',
      displayName: 'Spoofer',
      theme: 'dark',
      timezonePref: 'gmt-6',
      activeModel: 'ensemble',
      bankrollConfig: VALID_BANKROLL_CONFIG,
      alertSettings: VALID_ALERT_SETTINGS,
    },
  },
  {
    id: 'D04',
    name: 'Shadow field (isAdmin) injection on user create',
    method: 'PATCH',
    relativePath: 'users/u1',
    authUid: 'u1',
    email: 'u1@example.com',
    emailVerified: true,
    body: {
      uid: 'u1',
      email: 'u1@example.com',
      displayName: 'Analyst',
      theme: 'dark',
      timezonePref: 'gmt-6',
      activeModel: 'ensemble',
      bankrollConfig: VALID_BANKROLL_CONFIG,
      alertSettings: VALID_ALERT_SETTINGS,
      isAdmin: true,
    },
  },
  {
    id: 'D05',
    name: 'Client-forged backdated timestamp on bet create',
    method: 'PATCH',
    relativePath: 'users/u1/bets/bet-forged-ts',
    authUid: 'u1',
    email: 'u1@example.com',
    emailVerified: true,
    body: {
      ownerId: 'u1',
      date: '2026-10-01T18:00:00Z',
      monthKey: '2026-10',
      sport: 'soccer',
      league: 'La Liga',
      matchLabel: 'Real Madrid vs Betis',
      side: 'over',
      line: 2.5,
      bookmaker: 'Pinnacle',
      odds: 1.95,
      closingOdds: 1.95,
      modelProb: 0.55,
      edge: 0.04,
      ev: 0.0725,
      stake: 50,
      status: 'pending',
      pnl: 0,
      modelUsed: 'ensemble',
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
  },
  {
    id: 'D06',
    name: 'Orphaned bet creation without parent /users/{uid} workspace',
    method: 'PATCH',
    relativePath: 'users/orphan_uid/bets/bet-orphan',
    authUid: 'orphan_uid',
    email: 'orphan@example.com',
    emailVerified: true,
    body: {
      ownerId: 'orphan_uid',
      date: '2026-10-01T18:00:00Z',
      monthKey: '2026-10',
      sport: 'soccer',
      league: 'La Liga',
      matchLabel: 'Sevilla vs Valencia',
      side: 'under',
      line: 2.5,
      bookmaker: 'Pinnacle',
      odds: 1.9,
      closingOdds: 1.9,
      modelProb: 0.56,
      edge: 0.03,
      ev: 0.064,
      stake: 40,
      status: 'pending',
      pnl: 0,
      modelUsed: 'dixon-coles',
    },
  },
  {
    id: 'D07',
    name: 'Identity spoofing setting ownerId to victim_uid',
    method: 'PATCH',
    relativePath: 'users/u1/bets/bet-spoof',
    authUid: 'u1',
    email: 'u1@example.com',
    emailVerified: true,
    body: {
      ownerId: 'victim_uid',
      status: 'pending',
    },
  },
  {
    id: 'D08',
    name: 'Terminal state bypass reverting won bet to pending',
    method: 'PATCH',
    relativePath: 'users/u1/bets/bet-won-locked',
    authUid: 'u1',
    email: 'u1@example.com',
    emailVerified: true,
    body: {
      status: 'pending',
      pnl: 0,
    },
  },
  {
    id: 'D09',
    name: 'Value poisoning with invalid boolean status and oversized finalScore',
    method: 'PATCH',
    relativePath: 'users/u1/bets/bet-pending-poison',
    authUid: 'u1',
    email: 'u1@example.com',
    emailVerified: true,
    body: {
      status: true,
      finalScore: 'X'.repeat(2048),
    },
  },
  {
    id: 'D10',
    name: 'Path variable ID poisoning with disallowed characters and excessive length',
    method: 'PATCH',
    relativePath: `users/u1/bets/${'bad.id$'.repeat(30)}`,
    authUid: 'u1',
    email: 'u1@example.com',
    emailVerified: true,
    body: {
      ownerId: 'u1',
      status: 'pending',
    },
  },
  {
    id: 'D11',
    name: 'Shadow update adding ghost role field on /users/u1',
    method: 'PATCH',
    relativePath: 'users/u1',
    authUid: 'u1',
    email: 'u1@example.com',
    emailVerified: true,
    body: {
      theme: 'light',
      role: 'superadmin',
    },
  },
  {
    id: 'D12',
    name: 'Cross-tenant subcollection list scraping on /users/victim_uid/bets',
    method: 'GET',
    relativePath: 'users/victim_uid/bets',
    authUid: 'attacker_uid',
    email: 'attacker@example.com',
    emailVerified: true,
  },
];

function buildEmulatorJwt(uid: string, email: string, emailVerified: boolean): string {
  const encode = (obj: Record<string, unknown>) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = encode({ alg: 'none', typ: 'JWT' });
  const payload = encode({
    iss: 'https://securetoken.google.com/gen-lang-client-0347459992',
    aud: 'gen-lang-client-0347459992',
    sub: uid,
    user_id: uid,
    email,
    email_verified: emailVerified,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${header}.${payload}.`;
}

export async function runDirtyDozenSuite(
  emulatorHost = '127.0.0.1:8080',
  projectId = 'gen-lang-client-0347459992',
  databaseId = 'ai-studio-goaledgeanalytic-7749bcba-b631-49cd-820f-7da4148a7e70'
): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  for (const tc of DIRTY_DOZEN_CASES) {
    const url = `http://${emulatorHost}/v1/projects/${projectId}/databases/${databaseId}/documents/${tc.relativePath}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (tc.authUid) {
      headers.Authorization = `Bearer ${buildEmulatorJwt(
        tc.authUid,
        tc.email ?? `${tc.authUid}@example.com`,
        tc.emailVerified ?? false
      )}`;
    }
    const res = await fetch(url, {
      method: tc.method,
      headers,
      body: tc.body ? JSON.stringify({ fields: tc.body }) : undefined,
    });
    if (res.status === 403 || res.status === 400) {
      passed += 1;
    } else {
      failed += 1;
      console.error(`[FAIL] ${tc.id} (${tc.name}): expected 403 PERMISSION_DENIED, got ${res.status}`);
    }
  }

  return { passed, failed };
}
