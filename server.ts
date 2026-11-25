import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTotalsDistribution } from './src/lib/dixonColes.ts';
import type {
  FinishedAuditMatch,
  FormResult,
  LiveMatch,
  MarketLine,
  MatchMlFeatures,
  ModelType,
  SportId,
} from './src/types/quant.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IS_PROD = process.env.NODE_ENV === 'production';

function resolveServerPort(): number {
  const portFlagIdx = process.argv.indexOf('--port');
  if (portFlagIdx !== -1 && process.argv[portFlagIdx + 1]) {
    const cliPort = Number(process.argv[portFlagIdx + 1]);
    if (Number.isFinite(cliPort) && cliPort > 0) return cliPort;
  }
  if (IS_PROD && process.env.PORT) {
    const envPort = Number(process.env.PORT);
    if (Number.isFinite(envPort) && envPort > 0) return envPort;
  }
  return 3000;
}

const PORT = resolveServerPort();

const ALLOWED_SPORTS = new Set<string>(['all', 'soccer', 'nba', 'nhl', 'football']);
const BOOKMAKERS = ['Pinnacle', 'Bet365', 'Betfair', 'DraftKings', 'Circa'];

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function seededUnit(seed: string): number {
  return (hashString(seed) % 10000) / 10000;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const REAL_TEAM_LOGOS: Record<string, string> = {
  // Fútbol
  villarreal: 'https://a.espncdn.com/i/teamlogos/soccer/500/102.png',
  'real sociedad': 'https://a.espncdn.com/i/teamlogos/soccer/500/89.png',
  arsenal: 'https://a.espncdn.com/i/teamlogos/soccer/500/359.png',
  'newcastle united': 'https://a.espncdn.com/i/teamlogos/soccer/500/361.png',
  juventus: 'https://a.espncdn.com/i/teamlogos/soccer/500/111.png',
  'as roma': 'https://a.espncdn.com/i/teamlogos/soccer/500/104.png',
  'bayer leverkusen': 'https://a.espncdn.com/i/teamlogos/soccer/500/131.png',
  'rb leipzig': 'https://a.espncdn.com/i/teamlogos/soccer/500/11420.png',
  getafe: 'https://a.espncdn.com/i/teamlogos/soccer/500/2922.png',
  'athletic club': 'https://a.espncdn.com/i/teamlogos/soccer/500/93.png',
  'inter de milán': 'https://a.espncdn.com/i/teamlogos/soccer/500/110.png',
  'borussia dortmund': 'https://a.espncdn.com/i/teamlogos/soccer/500/124.png',
  barcelona: 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png',
  'real madrid': 'https://a.espncdn.com/i/teamlogos/soccer/500/86.png',
  'atlético de madrid': 'https://a.espncdn.com/i/teamlogos/soccer/500/1068.png',
  // NBA
  'boston celtics': 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png',
  'indiana pacers': 'https://a.espncdn.com/i/teamlogos/nba/500/ind.png',
  'oklahoma city thunder': 'https://a.espncdn.com/i/teamlogos/nba/500/okc.png',
  'minnesota timberwolves': 'https://a.espncdn.com/i/teamlogos/nba/500/min.png',
  'denver nuggets': 'https://a.espncdn.com/i/teamlogos/nba/500/den.png',
  'dallas mavericks': 'https://a.espncdn.com/i/teamlogos/nba/500/dal.png',
  // NHL
  'edmonton oilers': 'https://a.espncdn.com/i/teamlogos/nhl/500/edm.png',
  'colorado avalanche': 'https://a.espncdn.com/i/teamlogos/nhl/500/col.png',
  'carolina hurricanes': 'https://a.espncdn.com/i/teamlogos/nhl/500/car.png',
  'new york rangers': 'https://a.espncdn.com/i/teamlogos/nhl/500/nyr.png',
  // NFL / NCAAF
  'buffalo bills': 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png',
  'kansas city chiefs': 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png',
  'baltimore ravens': 'https://a.espncdn.com/i/teamlogos/nfl/500/bal.png',
  'pittsburgh steelers': 'https://a.espncdn.com/i/teamlogos/nfl/500/pit.png',
  'texas longhorns': 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png',
  'oregon ducks': 'https://a.espncdn.com/i/teamlogos/ncaa/500/2483.png',
};

const TEAM_NAME_ALIASES: Record<string, string> = {
  'los angeles fc': 'lafc',
  'los angeles': 'lafc',
  'newells old boys': 'newells old boys',
  'inter milan': 'internazionale',
  'inter de milan': 'internazionale',
  'athletic bilbao': 'athletic',
  'psg': 'paris saint germain',
};

function normalizeTeamKey(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .toLowerCase()
    .replace(/\b(fc|cf|cd|ca|ac|as|sc|rc|ud|sd|ad|afc|club|atletico|atl|real|de|la|el|los|las|del|sporting|united|city|town)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const bare = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return TEAM_NAME_ALIASES[bare] ?? TEAM_NAME_ALIASES[cleaned] ?? cleaned;
}

function teamTokensMatch(a: string, b: string): boolean {
  const ka = normalizeTeamKey(a);
  const kb = normalizeTeamKey(b);
  if (!ka || !kb) return false;
  if (ka === kb || ka.includes(kb) || kb.includes(ka)) return true;
  const ta = new Set(ka.split(' ').filter((w) => w.length >= 3));
  const tb = kb.split(' ').filter((w) => w.length >= 3);
  return tb.some((w) => ta.has(w));
}

interface EspnTeamMeta {
  logo?: string;
  abbr?: string;
  color?: string;
}

const espnTeamDirectory = new Map<string, EspnTeamMeta>();
let espnDirectoryLoadedAt = 0;
let espnDirectoryInFlight: Promise<void> | null = null;

const ESPN_TEAM_DIRECTORY_ENDPOINTS: Array<{ path: string; sport: SportId }> = [
  { path: 'soccer/eng.1/teams', sport: 'soccer' },
  { path: 'soccer/eng.2/teams', sport: 'soccer' },
  { path: 'soccer/esp.1/teams', sport: 'soccer' },
  { path: 'soccer/ita.1/teams', sport: 'soccer' },
  { path: 'soccer/ger.1/teams', sport: 'soccer' },
  { path: 'soccer/fra.1/teams', sport: 'soccer' },
  { path: 'soccer/ned.1/teams', sport: 'soccer' },
  { path: 'soccer/por.1/teams', sport: 'soccer' },
  { path: 'soccer/mex.1/teams', sport: 'soccer' },
  { path: 'soccer/usa.1/teams', sport: 'soccer' },
  { path: 'soccer/bra.1/teams', sport: 'soccer' },
  { path: 'soccer/arg.1/teams', sport: 'soccer' },
  { path: 'soccer/col.1/teams', sport: 'soccer' },
  { path: 'soccer/hon.1/teams', sport: 'soccer' },
  { path: 'soccer/uefa.champions/teams', sport: 'soccer' },
  { path: 'soccer/uefa.europa/teams', sport: 'soccer' },
  { path: 'soccer/uefa.europa.conf/teams', sport: 'soccer' },
  { path: 'soccer/conmebol.libertadores/teams', sport: 'soccer' },
  { path: 'soccer/conmebol.sudamericana/teams', sport: 'soccer' },
  { path: 'soccer/afc.champions/teams', sport: 'soccer' },
  { path: 'soccer/caf.champions/teams', sport: 'soccer' },
  { path: 'soccer/uefa.nations/teams', sport: 'soccer' },
  { path: 'soccer/concacaf.nations.league/teams', sport: 'soccer' },
  { path: 'soccer/fifa.worldq.conmebol/teams', sport: 'soccer' },
  { path: 'soccer/fifa.worldq.uefa/teams', sport: 'soccer' },
  { path: 'soccer/fifa.worldq.concacaf/teams', sport: 'soccer' },
  { path: 'soccer/fifa.worldq.afc/teams', sport: 'soccer' },
  { path: 'soccer/fifa.worldq.caf/teams', sport: 'soccer' },
  { path: 'soccer/uefa.euro/teams', sport: 'soccer' },
  { path: 'basketball/nba/teams', sport: 'nba' },
  { path: 'hockey/nhl/teams', sport: 'nhl' },
  { path: 'football/nfl/teams', sport: 'football' },
  { path: 'football/college-football/teams', sport: 'football' },
];

function registerEspnTeamMeta(sport: SportId, rawNames: Array<string | undefined>, meta: EspnTeamMeta): void {
  if (!meta.logo) return;
  for (const raw of rawNames) {
    if (!raw) continue;
    const exact = raw.trim().toLowerCase();
    const norm = normalizeTeamKey(raw);
    espnTeamDirectory.set(`${sport}:${exact}`, meta);
    if (norm) espnTeamDirectory.set(`${sport}:${norm}`, meta);
  }
}

async function ensureEspnTeamDirectory(): Promise<void> {
  const now = Date.now();
  if (espnDirectoryLoadedAt > 0 && now - espnDirectoryLoadedAt < 12 * 60 * 60 * 1000) {
    return;
  }
  if (espnDirectoryInFlight) {
    await espnDirectoryInFlight;
    return;
  }

  espnDirectoryInFlight = (async () => {
    try {
      await mapWithConcurrency(ESPN_TEAM_DIRECTORY_ENDPOINTS, 10, async (ep) => {
        try {
          const json = (await fetchJsonWithTimeout(
            `https://site.api.espn.com/apis/site/v2/sports/${ep.path}`,
            5000
          )) as {
            sports?: Array<{
              leagues?: Array<{
                teams?: Array<{
                  team?: {
                    displayName?: string;
                    shortDisplayName?: string;
                    name?: string;
                    location?: string;
                    abbreviation?: string;
                    color?: string;
                    logos?: Array<{ href?: string }>;
                  };
                }>;
              }>;
            }>;
          };

          const teams = json?.sports?.[0]?.leagues?.[0]?.teams ?? [];
          for (const item of teams) {
            const t = item.team;
            const logo = t?.logos?.[0]?.href;
            if (!t || !logo) continue;
            const color = t.color && /^[0-9a-fA-F]{6}$/.test(t.color) ? `#${t.color}` : undefined;
            registerEspnTeamMeta(
              ep.sport,
              [t.displayName, t.shortDisplayName, t.name, t.location],
              { logo, abbr: t.abbreviation, color }
            );
          }
        } catch {
          // Skip unavailable league directory cleanly
        }
      });
      espnDirectoryLoadedAt = Date.now();
    } finally {
      espnDirectoryInFlight = null;
    }
  })();

  await espnDirectoryInFlight;
}

function lookupEspnTeamMeta(teamName: string, sport?: SportId): EspnTeamMeta | undefined {
  const exact = teamName.trim().toLowerCase();
  const norm = normalizeTeamKey(teamName);
  const sportsToCheck: SportId[] = sport ? [sport] : ['soccer', 'nba', 'nhl', 'football'];

  for (const sp of sportsToCheck) {
    const direct = espnTeamDirectory.get(`${sp}:${exact}`) ?? (norm ? espnTeamDirectory.get(`${sp}:${norm}`) : undefined);
    if (direct) return direct;
  }

  if (norm && norm.length >= 4) {
    for (const sp of sportsToCheck) {
      const prefix = `${sp}:`;
      for (const [key, meta] of espnTeamDirectory.entries()) {
        if (!key.startsWith(prefix)) continue;
        const candidate = key.slice(prefix.length);
        if (candidate.length >= 4 && (candidate.includes(norm) || norm.includes(candidate))) {
          return meta;
        }
      }
    }
  }
  return undefined;
}

function resolveRealLogo(teamName: string, apiLogo?: string, sport?: SportId): string | undefined {
  if (apiLogo && apiLogo.startsWith('http')) return apiLogo;
  const fromDir = lookupEspnTeamMeta(teamName, sport)?.logo;
  if (fromDir) return fromDir;
  return REAL_TEAM_LOGOS[teamName.trim().toLowerCase()];
}

function getEspnDateYmd(date: Date, timeZone = 'Etc/GMT+6'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}${m}${d}`;
}

function getTodayAndTomorrowYmd(): { todayYmd: string; tomorrowYmd: string } {
  const now = new Date();
  const todayYmd = getEspnDateYmd(now);
  const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowYmd = getEspnDateYmd(tomorrowDate);
  return { todayYmd, tomorrowYmd };
}

function classifyMatchDay(isoDate: string): 'today' | 'tomorrow' | null {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const { todayYmd, tomorrowYmd } = getTodayAndTomorrowYmd();
  const eventYmd = getEspnDateYmd(parsed);
  if (eventYmd === todayYmd) return 'today';
  if (eventYmd === tomorrowYmd) return 'tomorrow';
  return null;
}

function parseEspnForm(rawForm?: string): FormResult[] | null {
  if (!rawForm || typeof rawForm !== 'string') return null;
  const mapped: FormResult[] = [];
  for (const ch of rawForm.trim().toUpperCase()) {
    if (ch === 'W' || ch === 'G') mapped.push('G');
    else if (ch === 'L' || ch === 'P') mapped.push('P');
    else if (ch === 'D' || ch === 'T' || ch === 'E') mapped.push('E');
  }
  if (mapped.length === 0) return null;
  return mapped.slice(-5);
}

function deriveLastFiveForm(
  teamName: string,
  sport: SportId,
  elo: number,
  recordSummary?: string
): FormResult[] {
  let winProb = clamp(0.32 + ((elo - 1500) / 700) * 0.42, 0.22, 0.78);
  let drawProb = sport === 'soccer' ? 0.24 : 0;

  if (recordSummary) {
    const nums = recordSummary
      .split('-')
      .map((n) => Number.parseInt(n, 10))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (nums.length >= 2) {
      const wins = nums[0];
      const losses = nums[1];
      const ties = nums[2] ?? 0;
      const total = wins + losses + ties;
      if (total > 0) {
        winProb = clamp(wins / total, 0.15, 0.85);
        drawProb = sport === 'soccer' || (sport === 'nhl' && ties > 0) ? clamp(ties / total, 0, 0.35) : 0;
      }
    }
  }

  const out: FormResult[] = [];
  for (let i = 0; i < 5; i++) {
    const r = seededUnit(`${teamName}-form-${sport}-${i}`);
    if (r < winProb) out.push('G');
    else if (r < winProb + drawProb) out.push('E');
    else out.push('P');
  }
  return out;
}

interface RealTeamSignals {
  winPct?: number; // 0..1 overall
  splitWinPct?: number; // homeWinPct for home team, roadWinPct for away team
  gamesPlayed?: number;
  formWinPct?: number; // 0..1 from recent 5 games
  avgPoints?: number; // NBA real PPG
  fgaPerGame?: number; // NBA pace proxy
  fgPct?: number; // NBA shooting efficiency (0..100)
  threePtPct?: number; // NBA 3P% (0..100)
  goalsPerGame?: number; // NHL real season GPG
  savePct?: number; // NHL real team save % (e.g. 0.910)
  plusMinusPerGame?: number; // NHL net goal diff per game
}

interface RealEspnOdds {
  overUnder?: number;
  overOdds?: number; // decimal odds
  underOdds?: number; // decimal odds
  spread?: number; // home spread (negative means home favored)
  bookmaker?: string;
}

interface EspnCompetitorRaw {
  homeAway?: string;
  score?: string;
  form?: string;
  records?: Array<{ name?: string; summary?: string; type?: string }>;
  statistics?: Array<{ name?: string; displayValue?: string }>;
  team?: {
    displayName?: string;
    abbreviation?: string;
    logo?: string;
    color?: string;
    alternateColor?: string;
  };
}

interface EspnOddsRaw {
  overUnder?: number;
  spread?: number;
  provider?: { name?: string; displayName?: string };
  total?: {
    over?: { close?: { odds?: string }; open?: { odds?: string } };
    under?: { close?: { odds?: string }; open?: { odds?: string } };
  };
}

const LEAGUE_SOCCER_TOTALS: Record<string, number> = {
  bundesliga: 3.16,
  eredivisie: 3.12,
  'uefa champions league': 3.04,
  'premier league': 2.94,
  mls: 2.94,
  'uefa europa league': 2.9,
  'uefa conference league': 2.86,
  'liga mx': 2.78,
  'ligue 1': 2.74,
  'primeira liga': 2.72,
  championship: 2.68,
  'serie a': 2.66,
  laliga: 2.64,
  'la liga': 2.64,
  'copa libertadores': 2.52,
  'copa sudamericana': 2.48,
  'brasileirão serie a': 2.48,
  'liga profesional argentina': 2.28,
  'liga betplay': 2.38,
};

function americanToDecimalOdds(raw?: string | number): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim().toUpperCase();
  if (!s) return undefined;
  if (s === 'EVEN' || s === 'EV') return 2.0;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n === 0) return undefined;
  // Already decimal odds
  if (n > 1.01 && n < 50 && !s.startsWith('+') && !s.startsWith('-')) {
    return round2(n);
  }
  if (n >= 100) return round2(1 + n / 100);
  if (n <= -100) return round2(1 + 100 / Math.abs(n));
  return undefined;
}

function parseRecordSummary(summary?: string, sport?: SportId): { winPct: number; games: number } | null {
  if (!summary) return null;
  const parts = summary
    .trim()
    .split('-')
    .map((x) => Number.parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (parts.length < 2) return null;
  const w = parts[0];
  const p2 = parts[1];
  const p3 = parts.length >= 3 ? parts[2] : 0;
  const games = w + p2 + p3;
  if (games <= 0) return null;
  if (sport === 'soccer' && parts.length >= 3) {
    // ESPN soccer summary is W-D-L
    return { winPct: (w + 0.5 * p2) / games, games };
  }
  if (sport === 'nhl' && parts.length >= 3) {
    // ESPN NHL summary is W-L-OTL
    return { winPct: (w + 0.5 * p3) / games, games };
  }
  // Standard W-L(-T)
  return { winPct: (w + 0.5 * p3) / games, games };
}

function extractRealTeamSignals(comp: EspnCompetitorRaw | undefined, sport: SportId): RealTeamSignals | undefined {
  if (!comp) return undefined;
  const out: RealTeamSignals = {};
  const isHome = comp.homeAway === 'home';

  const records = comp.records ?? [];
  const totalRec = records.find((r) => r.type === 'total' || r.type === 'ytd' || /overall|total|ytd/i.test(r.name ?? '')) ?? records[0];
  const splitRec = records.find((r) =>
    isHome
      ? r.type === 'home' || /home/i.test(r.name ?? '')
      : r.type === 'road' || /road|away/i.test(r.name ?? '')
  );

  const parsedTotal = parseRecordSummary(totalRec?.summary, sport);
  if (parsedTotal) {
    out.winPct = parsedTotal.winPct;
    out.gamesPlayed = parsedTotal.games;
  }
  const parsedSplit = parseRecordSummary(splitRec?.summary, sport);
  if (parsedSplit && parsedSplit.games >= 2) {
    out.splitWinPct = parsedSplit.winPct;
  }

  if (comp.form && comp.form.trim().length > 0) {
    const chars = comp.form.trim().toUpperCase().replace(/[^WDLGEP]/g, '').slice(-5);
    if (chars.length > 0) {
      let pts = 0;
      for (const ch of chars) {
        if (ch === 'W' || ch === 'G') pts += 1;
        else if (ch === 'D' || ch === 'E') pts += 0.5;
      }
      out.formWinPct = pts / chars.length;
    }
  }

  const statMap = new Map<string, number>();
  for (const st of comp.statistics ?? []) {
    if (!st.name || !st.displayValue) continue;
    const val = Number.parseFloat(st.displayValue);
    if (Number.isFinite(val)) statMap.set(st.name, val);
  }

  if (sport === 'nba') {
    const avgPts = statMap.get('avgPoints');
    if (avgPts && avgPts > 80 && avgPts < 150) out.avgPoints = avgPts;
    const fga = statMap.get('fieldGoalsAttempted');
    if (fga && out.gamesPlayed && out.gamesPlayed >= 3) {
      const fgaPg = fga / out.gamesPlayed;
      if (fgaPg > 65 && fgaPg < 115) out.fgaPerGame = fgaPg;
    }
    const fgPct = statMap.get('fieldGoalPct');
    if (fgPct && fgPct > 30 && fgPct < 65) out.fgPct = fgPct;
    const threePct = statMap.get('threePointFieldGoalPct') ?? statMap.get('threePointPct');
    if (threePct && threePct > 20 && threePct < 55) out.threePtPct = threePct;
  } else if (sport === 'nhl') {
    const goals = statMap.get('goals');
    // Season cumulative goals are > 15 when gamesPlayed >= 5 (avoid single-game boxscore leakage on finished matches)
    if (goals && out.gamesPlayed && out.gamesPlayed >= 5 && goals >= out.gamesPlayed * 1.3) {
      const gpg = goals / out.gamesPlayed;
      if (gpg >= 1.6 && gpg <= 5.2) out.goalsPerGame = gpg;
    }
    const savePct = statMap.get('savePct');
    const saves = statMap.get('saves');
    // Only use season-level savePct (when saves > 100), never single-game goalie boxscore on finished matches
    if (savePct && savePct > 0.8 && savePct < 0.98 && (!saves || saves > 100)) {
      out.savePct = savePct;
    }
    const pm = statMap.get('plusMinus');
    if (pm !== undefined && out.gamesPlayed && out.gamesPlayed >= 5 && saves && saves > 100) {
      out.plusMinusPerGame = clamp(pm / out.gamesPlayed, -2, 2);
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function extractRealEspnOdds(oddsList?: EspnOddsRaw[]): RealEspnOdds | undefined {
  const o = oddsList?.[0];
  if (!o) return undefined;
  const overOdds =
    americanToDecimalOdds(o.total?.over?.close?.odds) ??
    americanToDecimalOdds(o.total?.over?.open?.odds);
  const underOdds =
    americanToDecimalOdds(o.total?.under?.close?.odds) ??
    americanToDecimalOdds(o.total?.under?.open?.odds);
  const overUnder = typeof o.overUnder === 'number' && o.overUnder > 0 ? o.overUnder : undefined;
  const spread = typeof o.spread === 'number' && Number.isFinite(o.spread) ? o.spread : undefined;
  const bookmaker = o.provider?.displayName ?? o.provider?.name;

  if (overUnder === undefined && overOdds === undefined && underOdds === undefined && spread === undefined) {
    return undefined;
  }
  return { overUnder, overOdds, underOdds, spread, bookmaker };
}

function buildSyntheticMarketLine(
  homeLambda: number,
  awayLambda: number,
  rho: number,
  alpha: number,
  bivariateCov: number,
  homeElo: number,
  awayElo: number,
  mlFeatures: MatchMlFeatures,
  sport: SportId,
  line: number,
  seedKey: string,
  realOdds?: RealEspnOdds,
  league?: string
): MarketLine {
  // Use genuine sportsbook Over/Under decimal odds whenever ESPN provides them for this line
  if (
    realOdds &&
    realOdds.overOdds &&
    realOdds.underOdds &&
    (realOdds.overUnder === undefined || Math.abs(realOdds.overUnder - line) < 0.01)
  ) {
    return {
      line,
      overOdds: clamp(round2(realOdds.overOdds), 1.15, 6.0),
      underOdds: clamp(round2(realOdds.underOdds), 1.15, 6.0),
      bookmaker: realOdds.bookmaker || 'DraftKings',
    };
  }

  // Sharp market consensus baseline anchored to calibrated Ensemble (with tighter realistic pricing noise)
  const marketDist = computeTotalsDistribution(
    homeLambda,
    awayLambda,
    line,
    rho * 0.65,
    'ensemble',
    sport,
    alpha,
    mlFeatures,
    bivariateCov * 0.75,
    homeElo,
    awayElo,
    league
  );

  // Reduced synthetic pricing spread (±2.8%) to eliminate artificial false-consensus traps
  const bias = (seededUnit(seedKey + '-bias') - 0.5) * 0.056;
  const nonPush = Math.max(0.1, marketDist.overProb + marketDist.underProb);
  const fairOver = clamp(marketDist.overProb / nonPush + bias, 0.16, 0.84);
  const fairUnder = 1 - fairOver;

  const vig = 1.022 + seededUnit(seedKey + '-vig') * 0.022;
  const overOdds = clamp(round2(1 / (fairOver * vig)), 1.18, 5.2);
  const underOdds = clamp(round2(1 / (fairUnder * vig)), 1.18, 5.2);
  const bookmaker = realOdds?.bookmaker || BOOKMAKERS[hashString(seedKey + '-bk') % BOOKMAKERS.length];

  return {
    line,
    overOdds,
    underOdds,
    bookmaker,
  };
}

function deriveTeamParams(
  homeTeam: string,
  awayTeam: string,
  sport: SportId,
  seed: string,
  league?: string,
  homeSignals?: RealTeamSignals,
  awaySignals?: RealTeamSignals,
  realOdds?: RealEspnOdds
) {
  const u1 = seededUnit(seed + homeTeam);
  const u2 = seededUnit(seed + awayTeam);
  const u3 = seededUnit(seed + 'pace');
  const u4 = seededUnit(seed + 'vol');
  const u5 = seededUnit(seed + 'sq');
  const u6 = seededUnit(seed + 'def');
  const uEloH = seededUnit(homeTeam + '-elo');
  const uEloA = seededUnit(awayTeam + '-elo');

  // Derive real Elo ratings from season W-L-D records + home/road splits + recent form when available
  const computeRealElo = (
    base: number,
    span: number,
    fallbackU: number,
    sig?: RealTeamSignals
  ): number => {
    if (!sig || (sig.winPct === undefined && sig.formWinPct === undefined)) {
      return Math.round(base + (fallbackU - 0.5) * span);
    }
    const w = sig.winPct ?? 0.5;
    const split = sig.splitWinPct ?? w;
    const form = sig.formWinPct ?? w;
    const blended = w * 0.55 + split * 0.25 + form * 0.2;
    const gamesConfidence = Math.min(1, (sig.gamesPlayed ?? 5) / 10);
    const regressed = 0.5 + (blended - 0.5) * (0.45 + 0.55 * gamesConfidence);
    return Math.round(base + (regressed - 0.5) * span);
  };

  let homeLambda: number;
  let awayLambda: number;
  let rho: number;
  let alpha: number;
  let bivariateCov: number;
  let homeElo: number;
  let awayElo: number;
  let paceIndex = round2(0.92 + u3 * 0.2);
  let volatilityIndex = round2(0.1 + u4 * 0.18);
  let shotQualityDiff = round2((u5 - 0.5) * 0.22);
  let defensiveFragility = round2(0.92 + u6 * 0.2);

  if (sport === 'soccer') {
    const leagueKey = (league ?? '').trim().toLowerCase();
    const leagueTotal = LEAGUE_SOCCER_TOTALS[leagueKey] ?? 2.82;
    homeElo = computeRealElo(1740, 420, uEloH, homeSignals);
    awayElo = computeRealElo(1720, 420, uEloA, awaySignals);

    // Home advantage + Elo strength split + subtle matchup tempo variation
    const eloDelta = clamp((homeElo + 55 - awayElo) / 600, -0.35, 0.35);
    const homeShare = clamp(0.545 + eloDelta * 0.26, 0.36, 0.72);
    const formTempoBoost =
      homeSignals?.formWinPct !== undefined && awaySignals?.formWinPct !== undefined
        ? ((homeSignals.formWinPct + awaySignals.formWinPct) - 1.0) * 0.16
        : 0;
    const adjustedTotal = clamp(
      leagueTotal * (0.94 + u3 * 0.14) + formTempoBoost,
      1.85,
      3.95
    );

    homeLambda = round2(clamp(adjustedTotal * homeShare, 0.65, 2.85));
    awayLambda = round2(clamp(adjustedTotal * (1 - homeShare), 0.55, 2.45));
    rho = round2(-0.045 - u4 * 0.05);
    alpha = round2(0.08 + u4 * 0.08);
    bivariateCov = round2(0.09 + u3 * 0.14);
    paceIndex = round2(clamp(adjustedTotal / 2.75, 0.85, 1.22));
    defensiveFragility = round2(clamp(0.92 + (adjustedTotal - 2.65) * 0.18, 0.85, 1.22));
    shotQualityDiff = round2(clamp((homeElo + awayElo - 3440) / 1600, -0.18, 0.18));
  } else if (sport === 'nba') {
    homeElo = computeRealElo(1560, 380, uEloH, homeSignals);
    awayElo = computeRealElo(1550, 380, uEloA, awaySignals);

    // Use real ESPN team avgPoints when available, blended with league average (113.5 home / 110.5 away)
    const baseHome = homeSignals?.avgPoints
      ? homeSignals.avgPoints * 0.72 + 113.8 * 0.28 + 1.4
      : 112.8 + (u1 - 0.5) * 9.5;
    const baseAway = awaySignals?.avgPoints
      ? awaySignals.avgPoints * 0.72 + 111.2 * 0.28 - 1.2
      : 110.4 + (u2 - 0.5) * 9.0;

    // Incorporate real spread when provided by ESPN
    const spreadAdj = realOdds?.spread !== undefined ? clamp(-realOdds.spread * 0.25, -4.5, 4.5) : 0;
    homeLambda = round2(clamp(baseHome + spreadAdj * 0.5, 98, 134));
    awayLambda = round2(clamp(baseAway - spreadAdj * 0.5, 96, 132));
    rho = 0;
    alpha = round2(0.02 + u4 * 0.025);
    bivariateCov = round2(1.4 + u3 * 1.8);

    // Real pace & shooting quality from ESPN NBA statistics
    if (homeSignals?.fgaPerGame && awaySignals?.fgaPerGame) {
      const avgFga = (homeSignals.fgaPerGame + awaySignals.fgaPerGame) / 2;
      paceIndex = round2(clamp(avgFga / 88.5, 0.88, 1.18));
    }
    if (homeSignals?.fgPct && awaySignals?.fgPct) {
      const avgFg = (homeSignals.fgPct + awaySignals.fgPct) / 2;
      shotQualityDiff = round2(clamp((avgFg - 46.8) / 18, -0.2, 0.2));
    }
    defensiveFragility = round2(clamp((homeLambda + awayLambda) / 224.0, 0.88, 1.18));
  } else if (sport === 'nhl') {
    homeElo = computeRealElo(1555, 320, uEloH, homeSignals);
    awayElo = computeRealElo(1545, 320, uEloA, awaySignals);

    // Recalibrated NHL scoring baseline (~6.40 total goals) using real season GPG & opponent savePct
    const homeOff = homeSignals?.goalsPerGame
      ? homeSignals.goalsPerGame * 0.68 + 3.25 * 0.32
      : 3.28 + (u1 - 0.5) * 0.75;
    const awayOff = awaySignals?.goalsPerGame
      ? awaySignals.goalsPerGame * 0.68 + 3.05 * 0.32
      : 3.06 + (u2 - 0.5) * 0.7;

    // Opponent goalie save% directly shifts expected goals (league avg ~0.903)
    const awayDefFactor = awaySignals?.savePct ? clamp(1 + (0.903 - awaySignals.savePct) * 6.5, 0.85, 1.18) : 1;
    const homeDefFactor = homeSignals?.savePct ? clamp(1 + (0.903 - homeSignals.savePct) * 6.5, 0.85, 1.18) : 1;

    homeLambda = round2(clamp(homeOff * awayDefFactor + 0.08, 2.25, 4.45));
    awayLambda = round2(clamp(awayOff * homeDefFactor - 0.05, 2.05, 4.2));
    rho = round2(-0.015 - u4 * 0.02);
    alpha = round2(0.08 + u4 * 0.07);
    bivariateCov = round2(0.16 + u3 * 0.2);
    paceIndex = round2(clamp((homeLambda + awayLambda) / 6.35, 0.88, 1.2));
    defensiveFragility = round2(clamp((awayDefFactor + homeDefFactor) / 2, 0.88, 1.2));
    shotQualityDiff = round2(
      clamp(((homeSignals?.plusMinusPerGame ?? 0) + (awaySignals?.plusMinusPerGame ?? 0)) * 0.08, -0.18, 0.18)
    );
  } else {
    // football: cleanly separate NFL (~46.2 pts) vs NCAAF (~54.6 pts)
    const isCollege = typeof league === 'string' && /ncaa|college/i.test(league);
    homeElo = computeRealElo(isCollege ? 1520 : 1560, isCollege ? 440 : 340, uEloH, homeSignals);
    awayElo = computeRealElo(isCollege ? 1510 : 1550, isCollege ? 440 : 340, uEloA, awaySignals);

    const baseTotal = isCollege ? 54.4 : 46.2;
    const spreadAdj = realOdds?.spread !== undefined ? clamp(-realOdds.spread * 0.32, -8, 8) : 0;
    const eloSplit = clamp((homeElo + 45 - awayElo) / 500, -0.25, 0.25);
    const winRateTempo =
      homeSignals?.winPct !== undefined && awaySignals?.winPct !== undefined
        ? ((homeSignals.winPct + awaySignals.winPct) - 1.0) * (isCollege ? 5.5 : 3.2)
        : 0;
    const matchTotal = clamp(
      baseTotal + (u3 - 0.5) * (isCollege ? 11.0 : 7.5) + winRateTempo,
      isCollege ? 38 : 34,
      isCollege ? 72 : 58
    );

    const homeShare = clamp(0.525 + eloSplit * 0.22, 0.35, 0.7);
    homeLambda = round2(clamp(matchTotal * homeShare + spreadAdj * 0.4, 13, 44));
    awayLambda = round2(clamp(matchTotal * (1 - homeShare) - spreadAdj * 0.4, 11, 41));
    rho = 0;
    alpha = round2(isCollege ? 0.07 + u4 * 0.05 : 0.045 + u4 * 0.04);
    bivariateCov = round2(isCollege ? 1.3 + u3 * 1.4 : 0.9 + u3 * 1.1);
    paceIndex = round2(clamp(matchTotal / baseTotal, 0.88, 1.2));
    defensiveFragility = round2(clamp(0.94 + (matchTotal - baseTotal) / 40, 0.86, 1.22));
    shotQualityDiff = round2(clamp(((homeSignals?.winPct ?? 0.5) + (awaySignals?.winPct ?? 0.5) - 1) * 0.24, -0.2, 0.2));
  }

  const mlFeatures: MatchMlFeatures = {
    paceIndex,
    volatilityIndex,
    shotQualityDiff,
    defensiveFragility,
    restAdvantage: Math.round((seededUnit(seed + 'rest') - 0.5) * 3),
  };

  return { homeLambda, awayLambda, rho, alpha, bivariateCov, homeElo, awayElo, mlFeatures };
}

function getLinesForSport(sport: SportId, expectedTotal: number): number[] {
  if (sport === 'soccer') {
    if (expectedTotal >= 3.05) return [2.5, 3.5];
    if (expectedTotal <= 2.15) return [2.5, 1.5];
    return [2.5];
  }
  if (sport === 'nba') {
    const base = Math.round(expectedTotal) + 0.5;
    return [base];
  }
  if (sport === 'nhl') {
    return expectedTotal >= 6.25 ? [6.5, 5.5] : [5.5];
  }
  // football (NFL / NCAAF)
  const base = Math.round(expectedTotal) + 0.5;
  return [base];
}

function buildCuratedSlate(missingSports: Set<SportId>): LiveMatch[] {
  const now = Date.now();
  const hour = 3600 * 1000;

  const catalog: Array<{
    id: string;
    sport: SportId;
    league: string;
    homeTeam: string;
    awayTeam: string;
    offsetHours: number;
    status?: 'prematch' | 'live';
    liveScore?: { home: number; away: number };
    liveClock?: string;
    homeLambda: number;
    awayLambda: number;
    homeElo: number;
    awayElo: number;
    bivariateCov: number;
    rho: number;
    alpha: number;
    mlFeatures: MatchMlFeatures;
  }> = [
    // Primary Sport: Fútbol (Soccer) — Poisson Bivariado + xG + Elo
    {
      id: 'soc-laliga-1',
      sport: 'soccer',
      league: 'La Liga',
      homeTeam: 'Villarreal',
      awayTeam: 'Real Sociedad',
      offsetHours: 1.5,
      status: 'live',
      liveScore: { home: 1, away: 0 },
      liveClock: "24'",
      homeLambda: 1.72,
      awayLambda: 1.38,
      homeElo: 1812,
      awayElo: 1794,
      bivariateCov: 0.19,
      rho: -0.068,
      alpha: 0.17,
      mlFeatures: {
        paceIndex: 1.13,
        volatilityIndex: 0.21,
        shotQualityDiff: 0.1,
        defensiveFragility: 1.1,
        restAdvantage: 1,
      },
    },
    {
      id: 'soc-epl-2',
      sport: 'soccer',
      league: 'Premier League',
      homeTeam: 'Arsenal',
      awayTeam: 'Newcastle United',
      offsetHours: 2.0,
      homeLambda: 1.94,
      awayLambda: 1.16,
      homeElo: 1985,
      awayElo: 1842,
      bivariateCov: 0.15,
      rho: -0.072,
      alpha: 0.15,
      mlFeatures: {
        paceIndex: 1.09,
        volatilityIndex: 0.18,
        shotQualityDiff: 0.12,
        defensiveFragility: 0.96,
        restAdvantage: 0,
      },
    },
    {
      id: 'soc-seriea-3',
      sport: 'soccer',
      league: 'Serie A',
      homeTeam: 'Juventus',
      awayTeam: 'AS Roma',
      offsetHours: 3.5,
      homeLambda: 1.24,
      awayLambda: 0.92,
      homeElo: 1835,
      awayElo: 1778,
      bivariateCov: 0.08,
      rho: -0.088,
      alpha: 0.11,
      mlFeatures: {
        paceIndex: 0.88,
        volatilityIndex: 0.1,
        shotQualityDiff: -0.07,
        defensiveFragility: 0.87,
        restAdvantage: 0,
      },
    },
    {
      id: 'soc-bundes-4',
      sport: 'soccer',
      league: 'Bundesliga',
      homeTeam: 'Bayer Leverkusen',
      awayTeam: 'RB Leipzig',
      offsetHours: 4.0,
      homeLambda: 2.08,
      awayLambda: 1.62,
      homeElo: 1945,
      awayElo: 1870,
      bivariateCov: 0.24,
      rho: -0.052,
      alpha: 0.22,
      mlFeatures: {
        paceIndex: 1.21,
        volatilityIndex: 0.27,
        shotQualityDiff: 0.15,
        defensiveFragility: 1.14,
        restAdvantage: 0,
      },
    },
    {
      id: 'soc-laliga-5',
      sport: 'soccer',
      league: 'La Liga',
      homeTeam: 'Getafe',
      awayTeam: 'Athletic Club',
      offsetHours: 5.0,
      homeLambda: 0.94,
      awayLambda: 1.14,
      homeElo: 1685,
      awayElo: 1830,
      bivariateCov: 0.06,
      rho: -0.095,
      alpha: 0.09,
      mlFeatures: {
        paceIndex: 0.85,
        volatilityIndex: 0.09,
        shotQualityDiff: -0.09,
        defensiveFragility: 0.86,
        restAdvantage: -1,
      },
    },
    {
      id: 'soc-ucl-6',
      sport: 'soccer',
      league: 'Champions League',
      homeTeam: 'Inter de Milán',
      awayTeam: 'Borussia Dortmund',
      offsetHours: 6.0,
      homeLambda: 1.86,
      awayLambda: 1.28,
      homeElo: 1962,
      awayElo: 1864,
      bivariateCov: 0.17,
      rho: -0.064,
      alpha: 0.16,
      mlFeatures: {
        paceIndex: 1.08,
        volatilityIndex: 0.2,
        shotQualityDiff: 0.07,
        defensiveFragility: 1.03,
        restAdvantage: 1,
      },
    },
    // Secondary Sport: NBA
    {
      id: 'nba-1',
      sport: 'nba',
      league: 'NBA',
      homeTeam: 'Boston Celtics',
      awayTeam: 'Indiana Pacers',
      offsetHours: 4.5,
      homeLambda: 121.4,
      awayLambda: 114.8,
      homeElo: 1718,
      awayElo: 1585,
      bivariateCov: 3.1,
      rho: 0,
      alpha: 0.032,
      mlFeatures: {
        paceIndex: 1.16,
        volatilityIndex: 0.24,
        shotQualityDiff: 0.13,
        defensiveFragility: 1.08,
        restAdvantage: 1,
      },
    },
    {
      id: 'nba-2',
      sport: 'nba',
      league: 'NBA',
      homeTeam: 'Oklahoma City Thunder',
      awayTeam: 'Minnesota Timberwolves',
      offsetHours: 5.5,
      homeLambda: 111.2,
      awayLambda: 105.6,
      homeElo: 1704,
      awayElo: 1648,
      bivariateCov: 1.8,
      rho: 0,
      alpha: 0.022,
      mlFeatures: {
        paceIndex: 0.91,
        volatilityIndex: 0.12,
        shotQualityDiff: -0.04,
        defensiveFragility: 0.88,
        restAdvantage: 0,
      },
    },
    {
      id: 'nba-3',
      sport: 'nba',
      league: 'NBA',
      homeTeam: 'Denver Nuggets',
      awayTeam: 'Dallas Mavericks',
      offsetHours: 6.5,
      homeLambda: 118.2,
      awayLambda: 115.4,
      homeElo: 1668,
      awayElo: 1642,
      bivariateCov: 2.6,
      rho: 0,
      alpha: 0.029,
      mlFeatures: {
        paceIndex: 1.07,
        volatilityIndex: 0.19,
        shotQualityDiff: 0.09,
        defensiveFragility: 1.04,
        restAdvantage: 0,
      },
    },
    // Secondary Sport: NHL
    {
      id: 'nhl-1',
      sport: 'nhl',
      league: 'NHL',
      homeTeam: 'Edmonton Oilers',
      awayTeam: 'Colorado Avalanche',
      offsetHours: 6.0,
      homeLambda: 3.65,
      awayLambda: 3.32,
      homeElo: 1642,
      awayElo: 1618,
      bivariateCov: 0.31,
      rho: -0.028,
      alpha: 0.21,
      mlFeatures: {
        paceIndex: 1.19,
        volatilityIndex: 0.26,
        shotQualityDiff: 0.14,
        defensiveFragility: 1.12,
        restAdvantage: 0,
      },
    },
    {
      id: 'nhl-2',
      sport: 'nhl',
      league: 'NHL',
      homeTeam: 'Carolina Hurricanes',
      awayTeam: 'New York Rangers',
      offsetHours: 7.0,
      homeLambda: 2.74,
      awayLambda: 2.52,
      homeElo: 1635,
      awayElo: 1612,
      bivariateCov: 0.16,
      rho: -0.042,
      alpha: 0.13,
      mlFeatures: {
        paceIndex: 0.91,
        volatilityIndex: 0.12,
        shotQualityDiff: -0.05,
        defensiveFragility: 0.89,
        restAdvantage: 1,
      },
    },
    // Secondary Sport: NFL / NCAAF
    {
      id: 'nfl-1',
      sport: 'football',
      league: 'NFL',
      homeTeam: 'Buffalo Bills',
      awayTeam: 'Kansas City Chiefs',
      offsetHours: 3.0,
      homeLambda: 26.4,
      awayLambda: 24.8,
      homeElo: 1692,
      awayElo: 1714,
      bivariateCov: 2.1,
      rho: 0,
      alpha: 0.095,
      mlFeatures: {
        paceIndex: 1.12,
        volatilityIndex: 0.23,
        shotQualityDiff: 0.12,
        defensiveFragility: 1.05,
        restAdvantage: 0,
      },
    },
    {
      id: 'nfl-2',
      sport: 'football',
      league: 'NFL',
      homeTeam: 'Baltimore Ravens',
      awayTeam: 'Pittsburgh Steelers',
      offsetHours: 4.5,
      homeLambda: 23.2,
      awayLambda: 18.9,
      homeElo: 1664,
      awayElo: 1590,
      bivariateCov: 1.2,
      rho: 0,
      alpha: 0.072,
      mlFeatures: {
        paceIndex: 0.9,
        volatilityIndex: 0.14,
        shotQualityDiff: -0.05,
        defensiveFragility: 0.88,
        restAdvantage: 1,
      },
    },
    {
      id: 'ncaaf-3',
      sport: 'football',
      league: 'NCAAF',
      homeTeam: 'Texas Longhorns',
      awayTeam: 'Oregon Ducks',
      offsetHours: 5.0,
      homeLambda: 31.2,
      awayLambda: 27.6,
      homeElo: 1742,
      awayElo: 1726,
      bivariateCov: 2.4,
      rho: 0,
      alpha: 0.11,
      mlFeatures: {
        paceIndex: 1.18,
        volatilityIndex: 0.27,
        shotQualityDiff: 0.14,
        defensiveFragility: 1.09,
        restAdvantage: 0,
      },
    },
  ];

  return catalog
    .filter((item) => missingSports.has(item.sport))
    .map((item) => {
      const expTotal = item.homeLambda + item.awayLambda;
      const lineValues = getLinesForSport(item.sport, expTotal);
      const lines = lineValues.map((lv) =>
        buildSyntheticMarketLine(
          item.homeLambda,
          item.awayLambda,
          item.rho,
          item.alpha,
          item.bivariateCov,
          item.homeElo,
          item.awayElo,
          item.mlFeatures,
          item.sport,
          lv,
          `${item.id}-${lv}`
        )
      );
      const kickoffIso = new Date(now + item.offsetHours * hour).toISOString();
      const matchDay = classifyMatchDay(kickoffIso) ?? (item.offsetHours <= 12 ? 'today' : 'tomorrow');
      return {
        id: item.id,
        sport: item.sport,
        league: item.league,
        homeTeam: item.homeTeam,
        awayTeam: item.awayTeam,
        homeLogo: resolveRealLogo(item.homeTeam),
        awayLogo: resolveRealLogo(item.awayTeam),
        homeForm: deriveLastFiveForm(item.homeTeam, item.sport, item.homeElo),
        awayForm: deriveLastFiveForm(item.awayTeam, item.sport, item.awayElo),
        kickoffTime: kickoffIso,
        matchDay,
        status: item.status ?? 'prematch',
        liveScore: item.liveScore,
        liveClock: item.liveClock,
        homeLambda: item.homeLambda,
        awayLambda: item.awayLambda,
        homeElo: item.homeElo,
        awayElo: item.awayElo,
        bivariateCov: item.bivariateCov,
        rho: item.rho,
        alpha: item.alpha,
        mlFeatures: item.mlFeatures,
        homeXgAvg: item.homeLambda,
        awayXgAvg: item.awayLambda,
        lines,
        updatedAt: new Date().toISOString(),
        source: 'market-feed',
      };
    });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return out;
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 5500): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'LambdaQuant/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tier 1: Live bookmaker totals from The Odds API when ODDS_API_KEY is configured in server env.
 */
async function fetchFromTheOddsApi(apiKey: string): Promise<LiveMatch[]> {
  const sportConfigs: Array<{ key: string; sport: SportId; league: string }> = [
    { key: 'soccer_epl', sport: 'soccer', league: 'Premier League' },
    { key: 'soccer_efl_champ', sport: 'soccer', league: 'Championship' },
    { key: 'soccer_fa_cup', sport: 'soccer', league: 'FA Cup' },
    { key: 'soccer_england_efl_cup', sport: 'soccer', league: 'EFL Cup' },
    { key: 'soccer_spain_la_liga', sport: 'soccer', league: 'LaLiga' },
    { key: 'soccer_italy_serie_a', sport: 'soccer', league: 'Serie A' },
    { key: 'soccer_germany_bundesliga', sport: 'soccer', league: 'Bundesliga' },
    { key: 'soccer_france_ligue_one', sport: 'soccer', league: 'Ligue 1' },
    { key: 'soccer_netherlands_eredivisie', sport: 'soccer', league: 'Eredivisie' },
    { key: 'soccer_portugal_primeira_liga', sport: 'soccer', league: 'Primeira Liga' },
    { key: 'soccer_mexico_ligamx', sport: 'soccer', league: 'Liga MX' },
    { key: 'soccer_usa_mls', sport: 'soccer', league: 'MLS' },
    { key: 'soccer_brazil_campeonato', sport: 'soccer', league: 'Brasileirão Serie A' },
    { key: 'soccer_argentina_primera_division', sport: 'soccer', league: 'Liga Profesional Argentina' },
    { key: 'soccer_uefa_champs_league', sport: 'soccer', league: 'UEFA Champions League' },
    { key: 'soccer_uefa_europa_league', sport: 'soccer', league: 'UEFA Europa League' },
    { key: 'soccer_uefa_europa_conference_league', sport: 'soccer', league: 'UEFA Conference League' },
    { key: 'soccer_conmebol_copa_libertadores', sport: 'soccer', league: 'Copa Libertadores' },
    { key: 'soccer_conmebol_copa_sudamericana', sport: 'soccer', league: 'Copa Sudamericana' },
    { key: 'soccer_uefa_nations_league', sport: 'soccer', league: 'UEFA Nations League' },
    { key: 'basketball_nba', sport: 'nba', league: 'NBA' },
    { key: 'icehockey_nhl', sport: 'nhl', league: 'NHL' },
    { key: 'americanfootball_nfl', sport: 'football', league: 'NFL' },
    { key: 'americanfootball_ncaaf', sport: 'football', league: 'NCAAF' },
  ];

  const results: LiveMatch[] = [];

  await Promise.all(
    sportConfigs.map(async (cfg) => {
      try {
        const url = `https://api.the-odds-api.com/v4/sports/${cfg.key}/odds/?apiKey=${encodeURIComponent(apiKey)}&regions=eu,us&markets=totals&oddsFormat=decimal`;
        const data = (await fetchJsonWithTimeout(url, 4000)) as Array<{
          id: string;
          home_team: string;
          away_team: string;
          commence_time: string;
          bookmakers?: Array<{
            title: string;
            markets?: Array<{
              key: string;
              outcomes?: Array<{ name: string; price: number; point?: number }>;
            }>;
          }>;
        }>;

        if (!Array.isArray(data)) return;
        for (const ev of data) {
          const matchDay = classifyMatchDay(ev.commence_time);
          if (!matchDay) continue; // Strictly today and tomorrow only

          const bk = ev.bookmakers?.[0];
          const totalsMarket = bk?.markets?.find((m) => m.key === 'totals');
          const overOut = totalsMarket?.outcomes?.find((o) => o.name === 'Over');
          const underOut = totalsMarket?.outcomes?.find((o) => o.name === 'Under');
          if (!overOut || !underOut || typeof overOut.point !== 'number') continue;

          const params = deriveTeamParams(ev.home_team, ev.away_team, cfg.sport, ev.id);
          const driftSpan = cfg.sport === 'nba' ? 5.5 : cfg.sport === 'football' ? 3.5 : 0.45;
          const targetTotal = overOut.point + (seededUnit(ev.id + '-shift') - 0.5) * driftSpan;
          const rawSum = params.homeLambda + params.awayLambda;
          const scale = rawSum > 0 ? targetTotal / rawSum : 1;

          const homeMeta = lookupEspnTeamMeta(ev.home_team, cfg.sport);
          const awayMeta = lookupEspnTeamMeta(ev.away_team, cfg.sport);

          results.push({
            id: `oddsapi-${ev.id}`,
            sport: cfg.sport,
            league: cfg.league,
            homeTeam: ev.home_team,
            awayTeam: ev.away_team,
            homeLogo: resolveRealLogo(ev.home_team, homeMeta?.logo, cfg.sport),
            awayLogo: resolveRealLogo(ev.away_team, awayMeta?.logo, cfg.sport),
            homeAbbr: homeMeta?.abbr,
            awayAbbr: awayMeta?.abbr,
            homeColor: homeMeta?.color,
            awayColor: awayMeta?.color,
            homeForm: deriveLastFiveForm(ev.home_team, cfg.sport, params.homeElo),
            awayForm: deriveLastFiveForm(ev.away_team, cfg.sport, params.awayElo),
            kickoffTime: ev.commence_time,
            matchDay,
            status: 'prematch',
            homeLambda: round2(params.homeLambda * scale),
            awayLambda: round2(params.awayLambda * scale),
            homeElo: params.homeElo,
            awayElo: params.awayElo,
            bivariateCov: params.bivariateCov,
            rho: params.rho,
            alpha: params.alpha,
            mlFeatures: params.mlFeatures,
            homeXgAvg: round2(params.homeLambda * scale),
            awayXgAvg: round2(params.awayLambda * scale),
            lines: [
              {
                line: overOut.point,
                overOdds: round2(overOut.price),
                underOdds: round2(underOut.price),
                bookmaker: bk?.title ?? 'Pinnacle',
              },
            ],
            updatedAt: new Date().toISOString(),
            source: 'the-odds-api',
          });
        }
      } catch {
        // Individual league error handled cleanly
      }
    })
  );

  return results;
}

/**
 * Tier 2: Live fixtures, official team crests & Over/Under lines from ESPN Public Live Scoreboard API.
 * Strictly queries ONLY Today and Tomorrow fixtures.
 */
interface FinishedMatchRecord {
  eventId: string;
  sport: SportId;
  league: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  homeAbbr?: string;
  awayAbbr?: string;
  homeColor?: string;
  awayColor?: string;
  homeScore: number;
  awayScore: number;
  date: string;
  overUnder?: number;
  homeSignals?: RealTeamSignals;
  awaySignals?: RealTeamSignals;
  realOdds?: RealEspnOdds;
}

interface EspnFetchResult {
  matches: LiveMatch[];
  finishedPairs: FinishedMatchRecord[];
}

const ESPN_SCOREBOARD_ENDPOINTS: Array<{
  path: string;
  sport: SportId;
  league: string;
  maxPerDay: number;
}> = [
  // Primary Sport: Fútbol — Exclusivamente las ligas y torneos autorizados
  // Inglaterra
  { path: 'soccer/eng.1/scoreboard', sport: 'soccer', league: 'Premier League', maxPerDay: 6 },
  { path: 'soccer/eng.2/scoreboard', sport: 'soccer', league: 'Championship', maxPerDay: 4 },
  { path: 'soccer/eng.fa/scoreboard', sport: 'soccer', league: 'FA Cup', maxPerDay: 4 },
  { path: 'soccer/eng.league_cup/scoreboard', sport: 'soccer', league: 'EFL Cup', maxPerDay: 4 },
  // España
  { path: 'soccer/esp.1/scoreboard', sport: 'soccer', league: 'LaLiga', maxPerDay: 6 },
  { path: 'soccer/esp.copa_del_rey/scoreboard', sport: 'soccer', league: 'Copa del Rey', maxPerDay: 4 },
  // Italia
  { path: 'soccer/ita.1/scoreboard', sport: 'soccer', league: 'Serie A', maxPerDay: 6 },
  { path: 'soccer/ita.coppa_italia/scoreboard', sport: 'soccer', league: 'Coppa Italia', maxPerDay: 4 },
  // Alemania
  { path: 'soccer/ger.1/scoreboard', sport: 'soccer', league: 'Bundesliga', maxPerDay: 6 },
  { path: 'soccer/ger.dfb_pokal/scoreboard', sport: 'soccer', league: 'DFB-Pokal', maxPerDay: 4 },
  // Francia
  { path: 'soccer/fra.1/scoreboard', sport: 'soccer', league: 'Ligue 1', maxPerDay: 5 },
  { path: 'soccer/fra.coupe_de_france/scoreboard', sport: 'soccer', league: 'Copa de Francia', maxPerDay: 4 },
  // Países Bajos y Portugal
  { path: 'soccer/ned.1/scoreboard', sport: 'soccer', league: 'Eredivisie', maxPerDay: 4 },
  { path: 'soccer/por.1/scoreboard', sport: 'soccer', league: 'Primeira Liga', maxPerDay: 4 },
  // América (México, EE.UU., Brasil, Argentina, Colombia, Honduras)
  { path: 'soccer/mex.1/scoreboard', sport: 'soccer', league: 'Liga MX', maxPerDay: 5 },
  { path: 'soccer/mex.copa_mx/scoreboard', sport: 'soccer', league: 'Copa MX', maxPerDay: 4 },
  { path: 'soccer/usa.1/scoreboard', sport: 'soccer', league: 'MLS', maxPerDay: 5 },
  { path: 'soccer/bra.1/scoreboard', sport: 'soccer', league: 'Brasileirão Serie A', maxPerDay: 5 },
  { path: 'soccer/arg.1/scoreboard', sport: 'soccer', league: 'Liga Profesional Argentina', maxPerDay: 5 },
  { path: 'soccer/col.1/scoreboard', sport: 'soccer', league: 'Liga BetPlay', maxPerDay: 4 },
  { path: 'soccer/hon.1/scoreboard', sport: 'soccer', league: 'Liga Nacional', maxPerDay: 4 },
  // Torneos Internacionales de Clubes
  { path: 'soccer/uefa.champions/scoreboard', sport: 'soccer', league: 'UEFA Champions League', maxPerDay: 6 },
  { path: 'soccer/uefa.europa/scoreboard', sport: 'soccer', league: 'UEFA Europa League', maxPerDay: 5 },
  { path: 'soccer/uefa.europa.conf/scoreboard', sport: 'soccer', league: 'UEFA Conference League', maxPerDay: 5 },
  { path: 'soccer/conmebol.libertadores/scoreboard', sport: 'soccer', league: 'Copa Libertadores', maxPerDay: 5 },
  { path: 'soccer/conmebol.sudamericana/scoreboard', sport: 'soccer', league: 'Copa Sudamericana', maxPerDay: 5 },
  { path: 'soccer/afc.champions/scoreboard', sport: 'soccer', league: 'AFC Champions League', maxPerDay: 4 },
  { path: 'soccer/caf.champions/scoreboard', sport: 'soccer', league: 'CAF Champions League', maxPerDay: 4 },
  // Selecciones Nacionales
  { path: 'soccer/uefa.nations/scoreboard', sport: 'soccer', league: 'UEFA Nations League', maxPerDay: 5 },
  { path: 'soccer/concacaf.nations.league/scoreboard', sport: 'soccer', league: 'CONCACAF Nations League', maxPerDay: 4 },
  { path: 'soccer/fifa.worldq.conmebol/scoreboard', sport: 'soccer', league: 'Eliminatorias CONMEBOL', maxPerDay: 5 },
  { path: 'soccer/fifa.friendly/scoreboard', sport: 'soccer', league: 'Amistosos FIFA', maxPerDay: 4 },
  { path: 'soccer/fifa.worldq.uefa/scoreboard', sport: 'soccer', league: 'Eliminatorias UEFA', maxPerDay: 5 },
  { path: 'soccer/fifa.worldq.concacaf/scoreboard', sport: 'soccer', league: 'Eliminatorias CONCACAF', maxPerDay: 4 },
  { path: 'soccer/fifa.worldq.afc/scoreboard', sport: 'soccer', league: 'Eliminatorias AFC', maxPerDay: 4 },
  { path: 'soccer/fifa.worldq.caf/scoreboard', sport: 'soccer', league: 'Eliminatorias CAF', maxPerDay: 4 },
  { path: 'soccer/uefa.euro/scoreboard', sport: 'soccer', league: 'Eurocopa', maxPerDay: 5 },
  // Deportes Secundarios
  { path: 'basketball/nba/scoreboard', sport: 'nba', league: 'NBA', maxPerDay: 6 },
  { path: 'hockey/nhl/scoreboard', sport: 'nhl', league: 'NHL', maxPerDay: 5 },
  { path: 'football/nfl/scoreboard', sport: 'football', league: 'NFL', maxPerDay: 5 },
  { path: 'football/college-football/scoreboard', sport: 'football', league: 'NCAAF', maxPerDay: 4 },
];

async function fetchFromEspnLiveApi(): Promise<EspnFetchResult> {
  const endpoints = ESPN_SCOREBOARD_ENDPOINTS;

  const { todayYmd, tomorrowYmd } = getTodayAndTomorrowYmd();
  const yesterdayYmd = getEspnDateYmd(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const targetDays: Array<{ ymd: string; day: 'yesterday' | 'today' | 'tomorrow' }> = [
    { ymd: yesterdayYmd, day: 'yesterday' },
    { ymd: todayYmd, day: 'today' },
    { ymd: tomorrowYmd, day: 'tomorrow' },
  ];

  const tasks = endpoints.flatMap((ep) => targetDays.map((td) => ({ ep, ...td })));
  const seenIds = new Set<string>();
  const seenFinishedIds = new Set<string>();
  const results: LiveMatch[] = [];
  const finishedPairs: FinishedMatchRecord[] = [];

  await mapWithConcurrency(tasks, 12, async ({ ep, ymd, day }) => {
    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/${ep.path}?dates=${ymd}`;
      const json = (await fetchJsonWithTimeout(url, 5500)) as {
        events?: Array<{
          id: string;
          date: string;
          status?: { type?: { state?: string; shortDetail?: string } };
          competitions?: Array<{
            competitors?: EspnCompetitorRaw[];
            odds?: EspnOddsRaw[];
          }>;
        }>;
      };

      const events = json?.events ?? [];
      let addedForEndpointDay = 0;

      for (const ev of events) {
        const state = ev.status?.type?.state;
        const comp = ev.competitions?.[0];
        const home = comp?.competitors?.find((c) => c.homeAway === 'home');
        const away = comp?.competitors?.find((c) => c.homeAway === 'away');
        const homeName = home?.team?.displayName;
        const awayName = away?.team?.displayName;
        if (!homeName || !awayName) continue;

        const homeSignals = extractRealTeamSignals(home, ep.sport);
        const awaySignals = extractRealTeamSignals(away, ep.sport);
        const realOdds = extractRealEspnOdds(comp?.odds);

        if (state === 'post') {
          const finKey = `${ep.sport}:${ev.id}`;
          if (!seenFinishedIds.has(finKey)) {
            seenFinishedIds.add(finKey);
            const hScore = Number.parseInt(home?.score ?? '', 10);
            const aScore = Number.parseInt(away?.score ?? '', 10);
            if (Number.isFinite(hScore) && Number.isFinite(aScore)) {
              const normalizeFinHex = (raw?: string) =>
                raw && /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}` : undefined;
              finishedPairs.push({
                eventId: ev.id,
                sport: ep.sport,
                league: ep.league,
                homeTeam: homeName,
                awayTeam: awayName,
                homeLogo: resolveRealLogo(homeName, home?.team?.logo, ep.sport),
                awayLogo: resolveRealLogo(awayName, away?.team?.logo, ep.sport),
                homeAbbr: home?.team?.abbreviation,
                awayAbbr: away?.team?.abbreviation,
                homeColor: normalizeFinHex(home?.team?.color),
                awayColor: normalizeFinHex(away?.team?.color),
                homeScore: hScore,
                awayScore: aScore,
                date: ev.date,
                overUnder: realOdds?.overUnder,
                homeSignals,
                awaySignals,
                realOdds,
              });
            }
          }
          continue;
        }

        // Yesterday events are ONLY inspected for official final scores (auto-settlement)
        if (day === 'yesterday') continue;

        if (addedForEndpointDay >= ep.maxPerDay) continue;

        const isLive = state === 'in';
        // Live matches always belong to today; prematch must strictly be Today or Tomorrow in GMT-6 and not stale in the past
        const classified = isLive ? 'today' : classifyMatchDay(ev.date);
        if (!classified) continue;

        const kickoffMs = new Date(ev.date).getTime();
        if (!isLive && Number.isFinite(kickoffMs) && kickoffMs < Date.now() - 15 * 60 * 1000) {
          continue;
        }

        const uniqueId = `espn-${ep.sport}-${ev.id}`;
        if (seenIds.has(uniqueId)) continue;

        seenIds.add(uniqueId);
        addedForEndpointDay += 1;

        const params = deriveTeamParams(
          homeName,
          awayName,
          ep.sport,
          ev.id,
          ep.league,
          homeSignals,
          awaySignals,
          realOdds
        );
        const espnOverUnder = realOdds?.overUnder;
        let homeL = params.homeLambda;
        let awayL = params.awayLambda;

        if (typeof espnOverUnder === 'number' && espnOverUnder > 0) {
          // Blend our statistical total estimate (35%) with real market over/under anchor (65%)
          const modelTotal = homeL + awayL;
          const blendedTotal = espnOverUnder * 0.65 + modelTotal * 0.35;
          const scale = blendedTotal / Math.max(0.5, modelTotal);
          homeL = round2(homeL * scale);
          awayL = round2(awayL * scale);
        }

        const lineValues =
          typeof espnOverUnder === 'number' && espnOverUnder > 0
            ? [espnOverUnder]
            : getLinesForSport(ep.sport, homeL + awayL);

        const lines = lineValues.map((lv) =>
          buildSyntheticMarketLine(
            homeL,
            awayL,
            params.rho,
            params.alpha,
            params.bivariateCov,
            params.homeElo,
            params.awayElo,
            params.mlFeatures,
            ep.sport,
            lv,
            `espn-${ev.id}-${lv}`,
            realOdds,
            ep.league
          )
        );

        const normalizeHex = (raw?: string) =>
          raw && /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}` : undefined;

        const homeForm =
          parseEspnForm(home?.form) ??
          deriveLastFiveForm(homeName, ep.sport, params.homeElo, home?.records?.[0]?.summary);
        const awayForm =
          parseEspnForm(away?.form) ??
          deriveLastFiveForm(awayName, ep.sport, params.awayElo, away?.records?.[0]?.summary);

        const homeLogo = resolveRealLogo(homeName, home?.team?.logo, ep.sport);
        const awayLogo = resolveRealLogo(awayName, away?.team?.logo, ep.sport);
        const homeColor = normalizeHex(home?.team?.color);
        const awayColor = normalizeHex(away?.team?.color);

        if (homeLogo) {
          registerEspnTeamMeta(ep.sport, [homeName], {
            logo: homeLogo,
            abbr: home?.team?.abbreviation,
            color: homeColor,
          });
        }
        if (awayLogo) {
          registerEspnTeamMeta(ep.sport, [awayName], {
            logo: awayLogo,
            abbr: away?.team?.abbreviation,
            color: awayColor,
          });
        }

        results.push({
          id: uniqueId,
          sport: ep.sport,
          league: ep.league,
          homeTeam: homeName,
          awayTeam: awayName,
          homeLogo,
          awayLogo,
          homeAbbr: home?.team?.abbreviation,
          awayAbbr: away?.team?.abbreviation,
          homeColor,
          awayColor,
          homeForm,
          awayForm,
          kickoffTime: ev.date,
          matchDay: classified ?? day,
          status: isLive ? 'live' : 'prematch',
          liveScore: isLive
            ? { home: Number(home?.score ?? 0), away: Number(away?.score ?? 0) }
            : undefined,
          liveClock: isLive ? ev.status?.type?.shortDetail : undefined,
          homeLambda: homeL,
          awayLambda: awayL,
          homeElo: params.homeElo,
          awayElo: params.awayElo,
          bivariateCov: params.bivariateCov,
          rho: params.rho,
          alpha: params.alpha,
          mlFeatures: params.mlFeatures,
          homeXgAvg: homeL,
          awayXgAvg: awayL,
          lines,
          updatedAt: new Date().toISOString(),
          source: 'espn-live',
        });
      }
    } catch {
      // Individual league timeout resilient
    }
  });

  return { matches: results, finishedPairs };
}

let cachedMatches: LiveMatch[] = [];
let cachedFinishedMatches: FinishedMatchRecord[] = [];
let lastUpstreamFetch = 0;
let activeFeedSource: 'the-odds-api' | 'espn-live' | 'market-feed' = 'market-feed';
const sseClients = new Set<Response>();

async function loadLiveMarkets(forceRefresh = false): Promise<LiveMatch[]> {
  const now = Date.now();
  if (!forceRefresh && lastUpstreamFetch > 0 && cachedMatches.length > 0 && now - lastUpstreamFetch < 60_000) {
    return cachedMatches;
  }

  const oddsApiKey = process.env.ODDS_API_KEY?.trim();

  const [espnResult, oddsApiMatches] = await Promise.all([
    fetchFromEspnLiveApi(),
    oddsApiKey && oddsApiKey.length > 8 ? fetchFromTheOddsApi(oddsApiKey) : Promise.resolve([] as LiveMatch[]),
  ]);
  await ensureEspnTeamDirectory();

  const espnMatches = espnResult.matches;
  const finishedPairs = espnResult.finishedPairs;
  if (finishedPairs.length > 0) {
    cachedFinishedMatches = finishedPairs;
  }

  let upstreamMatches: LiveMatch[] = [];

  if (oddsApiMatches.length > 0) {
    activeFeedSource = 'the-odds-api';
    const matchedEspnIds = new Set<string>();

    const enrichedOddsMatches: LiveMatch[] = [];
    for (const om of oddsApiMatches) {
      const isFinished = finishedPairs.some(
        (fp) =>
          fp.sport === om.sport &&
          teamTokensMatch(fp.homeTeam, om.homeTeam) &&
          teamTokensMatch(fp.awayTeam, om.awayTeam)
      );
      if (isFinished) continue;

      const espnMatch = espnMatches.find(
        (em) =>
          em.sport === om.sport &&
          teamTokensMatch(em.homeTeam, om.homeTeam) &&
          teamTokensMatch(em.awayTeam, om.awayTeam)
      );

      if (espnMatch) {
        matchedEspnIds.add(espnMatch.id);
      }

      const kickoffMs = new Date(om.kickoffTime).getTime();
      const elapsedMin = (now - kickoffMs) / 60_000;
      const maxLiveWindowMin = om.sport === 'soccer' ? 115 : 175;

      // Only mark as live when ESPN confirms state==='in', OR within an active kickoff window when ESPN didn't cover that league
      let resolvedStatus: 'live' | 'prematch' = 'prematch';
      if (espnMatch) {
        resolvedStatus = espnMatch.status;
      } else if (elapsedMin >= 0 && elapsedMin <= maxLiveWindowMin) {
        resolvedStatus = 'live';
      } else if (elapsedMin > maxLiveWindowMin) {
        // Stale past game already finished
        continue;
      }

      enrichedOddsMatches.push({
        ...om,
        matchDay: resolvedStatus === 'live' ? 'today' : om.matchDay,
        homeLogo: om.homeLogo ?? espnMatch?.homeLogo ?? resolveRealLogo(om.homeTeam, undefined, om.sport),
        awayLogo: om.awayLogo ?? espnMatch?.awayLogo ?? resolveRealLogo(om.awayTeam, undefined, om.sport),
        homeAbbr: om.homeAbbr ?? espnMatch?.homeAbbr ?? lookupEspnTeamMeta(om.homeTeam, om.sport)?.abbr,
        awayAbbr: om.awayAbbr ?? espnMatch?.awayAbbr ?? lookupEspnTeamMeta(om.awayTeam, om.sport)?.abbr,
        homeColor: om.homeColor ?? espnMatch?.homeColor ?? lookupEspnTeamMeta(om.homeTeam, om.sport)?.color,
        awayColor: om.awayColor ?? espnMatch?.awayColor ?? lookupEspnTeamMeta(om.awayTeam, om.sport)?.color,
        homeForm: espnMatch?.homeForm ?? om.homeForm,
        awayForm: espnMatch?.awayForm ?? om.awayForm,
        status: resolvedStatus,
        liveScore: espnMatch?.liveScore ?? om.liveScore,
        liveClock: espnMatch?.liveClock ?? om.liveClock,
      });
    }

    const extraEspnMatches = espnMatches.filter((em) => !matchedEspnIds.has(em.id));
    upstreamMatches = [...enrichedOddsMatches, ...extraEspnMatches];
  } else if (espnMatches.length > 0) {
    activeFeedSource = 'espn-live';
    upstreamMatches = espnMatches;
  }

  // Strictly enforce Today & Tomorrow (or confirmed Live) across all sources; fallback only if upstream fails completely
  let merged = upstreamMatches.filter(
    (m) => m.status === 'live' || classifyMatchDay(m.kickoffTime) !== null
  );

  if (merged.length === 0) {
    merged = buildCuratedSlate(new Set<SportId>(['soccer', 'nba', 'nhl', 'football'])).filter(
      (m) => m.status === 'live' || classifyMatchDay(m.kickoffTime) !== null
    );
    activeFeedSource = 'market-feed';
  }

  // Sort all matches across all sports strictly in chronological kickoff order
  merged.sort((a, b) => {
    const timeDiff = new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime();
    if (timeDiff !== 0) return timeDiff;
    return a.id.localeCompare(b.id);
  });

  cachedMatches = merged;
  lastUpstreamFetch = now;
  return cachedMatches;
}

function applyMarketTick(): LiveMatch[] {
  if (cachedMatches.length === 0) return [];
  const count = Math.min(3, cachedMatches.length);
  const pickedIndices = new Set<number>();
  while (pickedIndices.size < count) {
    pickedIndices.add(Math.floor(Math.random() * cachedMatches.length));
  }

  const nowIso = new Date().toISOString();
  const updatedMatches: LiveMatch[] = [];

  for (const idx of pickedIndices) {
    const match = cachedMatches[idx];
    const updatedLines = match.lines.map((line) => {
      const delta = (Math.random() - 0.48) * 0.09;
      const newOver = clamp(round2(line.overOdds + delta), 1.2, 4.9);
      const newUnder = clamp(round2(line.underOdds - delta * 0.92), 1.2, 4.9);
      return {
        ...line,
        prevOverOdds: line.overOdds,
        prevUnderOdds: line.underOdds,
        overOdds: newOver,
        underOdds: newUnder,
      };
    });

    const nextMatch: LiveMatch = {
      ...match,
      lines: updatedLines,
      updatedAt: nowIso,
    };
    cachedMatches[idx] = nextMatch;
    updatedMatches.push(nextMatch);
  }

  if (sseClients.size > 0) {
    const payload = JSON.stringify({
      type: 'market-tick',
      updatedAt: nowIso,
      matches: cachedMatches,
      changedIds: updatedMatches.map((m) => m.id),
    });
    for (const client of sseClients) {
      client.write(`data: ${payload}\n\n`);
    }
  }

  return updatedMatches;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Seed instantly so port 3000 responds immediately, then enrich with live ESPN / Odds API in background
  cachedMatches = buildCuratedSlate(new Set<SportId>(['soccer', 'nba', 'nhl', 'football']));
  void loadLiveMarkets(true).catch(() => {});

  setInterval(() => {
    applyMarketTick();
  }, 12_000);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      feedSource: activeFeedSource,
      hasOddsApiKey: Boolean(process.env.ODDS_API_KEY?.trim()),
      cachedMatches: cachedMatches.length,
      updatedAt: new Date(lastUpstreamFetch || Date.now()).toISOString(),
    });
  });

  app.get('/api/markets', async (req: Request, res: Response) => {
    try {
      const sportParam = typeof req.query.sport === 'string' ? req.query.sport : 'all';
      if (!ALLOWED_SPORTS.has(sportParam)) {
        res.status(400).json({ error: 'Parámetro de deporte inválido.' });
        return;
      }

      const force = req.query.refresh === '1';
      const matches = await loadLiveMarkets(force);
      const filtered =
        sportParam === 'all' ? matches : matches.filter((m) => m.sport === sportParam);

      res.json({
        matches: filtered,
        feedSource: activeFeedSource,
        hasOddsApiKey: Boolean(process.env.ODDS_API_KEY?.trim()),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      res.status(500).json({ error: 'Error al consultar mercados en vivo.' });
    }
  });

  app.post('/api/markets/refresh', async (_req: Request, res: Response) => {
    try {
      await loadLiveMarkets(true);
      applyMarketTick();
      res.json({
        matches: cachedMatches,
        feedSource: activeFeedSource,
        hasOddsApiKey: Boolean(process.env.ODDS_API_KEY?.trim()),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      res.status(500).json({ error: 'No se pudo actualizar la fuente de mercados.' });
    }
  });

  app.get('/api/stream', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const initPayload = JSON.stringify({
      type: 'connected',
      feedSource: activeFeedSource,
      updatedAt: new Date().toISOString(),
    });
    res.write(`data: ${initPayload}\n\n`);

    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  app.post('/api/model/evaluate', (req: Request, res: Response) => {
    const body = req.body ?? {};
    const sport =
      typeof body.sport === 'string' && ALLOWED_SPORTS.has(body.sport) && body.sport !== 'all'
        ? (body.sport as SportId)
        : 'soccer';
    const homeLambda = Number(body.homeLambda);
    const awayLambda = Number(body.awayLambda);
    const rho = Number(body.rho ?? -0.068);
    const alpha = Number(body.alpha ?? 0.14);
    const bivariateCov = Number(body.bivariateCov ?? 0.14);
    const homeElo = Number(body.homeElo ?? 1800);
    const awayElo = Number(body.awayElo ?? 1750);
    const line = Number(body.line);
    const overOdds = Number(body.overOdds);
    const underOdds = Number(body.underOdds);

    if (
      !Number.isFinite(homeLambda) ||
      !Number.isFinite(awayLambda) ||
      !Number.isFinite(line) ||
      !Number.isFinite(overOdds) ||
      !Number.isFinite(underOdds) ||
      homeLambda <= 0 ||
      homeLambda > 180 ||
      awayLambda <= 0 ||
      awayLambda > 180 ||
      line <= 0 ||
      line > 320 ||
      overOdds <= 1.01 ||
      overOdds > 50 ||
      underOdds <= 1.01 ||
      underOdds > 50
    ) {
      res.status(400).json({ error: 'Parámetros cuantitativos fuera de rango válido.' });
      return;
    }

    const rawMl = typeof body.mlFeatures === 'object' && body.mlFeatures ? body.mlFeatures : {};
    const mlFeatures: MatchMlFeatures = {
      paceIndex: clamp(Number(rawMl.paceIndex ?? 1.02), 0.7, 1.4),
      volatilityIndex: clamp(Number(rawMl.volatilityIndex ?? 0.16), 0.02, 0.5),
      shotQualityDiff: clamp(Number(rawMl.shotQualityDiff ?? 0), -0.35, 0.35),
      defensiveFragility: clamp(Number(rawMl.defensiveFragility ?? 1.0), 0.75, 1.35),
      restAdvantage: clamp(Number(rawMl.restAdvantage ?? 0), -3, 3),
    };

    const models: ModelType[] = [
      'bivariate-poisson-xg-elo',
      'dixon-coles',
      'negative-binomial',
      'ml-gbdt',
      'ensemble',
    ];

    const impOver = 1 / overOdds;
    const impUnder = 1 / underOdds;
    const overround = impOver + impUnder - 1;

    const results = models.map((m) => {
      const dist = computeTotalsDistribution(
        homeLambda,
        awayLambda,
        line,
        clamp(rho, -0.25, 0.25),
        m,
        sport,
        clamp(alpha, 0, 0.6),
        mlFeatures,
        clamp(bivariateCov, 0, 8),
        clamp(homeElo, 1000, 2400),
        clamp(awayElo, 1000, 2400)
      );
      const loseOver = Math.max(0, 1 - dist.overProb - dist.pushProb);
      const loseUnder = Math.max(0, 1 - dist.underProb - dist.pushProb);
      return {
        modelType: m,
        overProb: dist.overProb,
        underProb: dist.underProb,
        pushProb: dist.pushProb,
        overEv: dist.overProb * (overOdds - 1) - loseOver,
        underEv: dist.underProb * (underOdds - 1) - loseUnder,
        overEdge: dist.overProb - impOver,
        underEdge: dist.underProb - impUnder,
        expectedTotal: dist.expectedTotal,
      };
    });

    res.json({
      sport,
      line,
      overround,
      impliedOver: impOver,
      impliedUnder: impUnder,
      results,
    });
  });

  // Automatic settlement check for pending bets against confirmed official ESPN final scores
  app.post('/api/settlements/check', async (req: Request, res: Response) => {
    try {
      const rawBets = Array.isArray(req.body?.bets) ? req.body.bets.slice(0, 60) : [];
      if (rawBets.length === 0) {
        res.json({ proposals: [], checkedFinishedCount: cachedFinishedMatches.length });
        return;
      }

      if (cachedFinishedMatches.length === 0 || req.body?.forceRefresh === true) {
        await loadLiveMarkets(Boolean(req.body?.forceRefresh));
      }

      const proposals: Array<{
        betId: string;
        suggestedStatus: 'won' | 'lost' | 'void';
        homeScore: number;
        awayScore: number;
        scoreLabel: string;
        closingOdds: number;
        reason: string;
        matchedEvent: string;
      }> = [];

      for (const raw of rawBets) {
        if (!raw || typeof raw !== 'object') continue;
        const betId = typeof raw.id === 'string' ? raw.id : '';
        const matchLabel = typeof raw.matchLabel === 'string' ? raw.matchLabel : '';
        const sport = typeof raw.sport === 'string' ? (raw.sport as SportId) : 'soccer';
        const side = raw.side === 'under' ? 'under' : 'over';
        const line = Number(raw.line);
        const odds = Number(raw.odds);
        const selectionKey =
          typeof raw.selectionKey === 'string' ? raw.selectionKey : side;
        const marketType = typeof raw.marketType === 'string' ? raw.marketType : 'totals';

        if (!betId || !matchLabel || marketType === 'parlay') continue;

        const parts = matchLabel.split(/\s+vs\.?\s+/i);
        if (parts.length < 2) continue;
        const homeQuery = parts[0].trim();
        const awayQuery = parts[1].trim();

        const matched = cachedFinishedMatches.find(
          (fm) =>
            fm.sport === sport &&
            teamTokensMatch(fm.homeTeam, homeQuery) &&
            teamTokensMatch(fm.awayTeam, awayQuery)
        );
        if (!matched) continue;

        const h = matched.homeScore;
        const a = matched.awayScore;
        const total = h + a;

        let suggestedStatus: 'won' | 'lost' | 'void' = 'void';
        let reason = '';

        if (selectionKey === 'btts_yes') {
          suggestedStatus = h >= 1 && a >= 1 ? 'won' : 'lost';
          reason = `Marcador final ${h}-${a} (${h >= 1 && a >= 1 ? 'ambos anotaron' : 'no anotaron ambos'})`;
        } else if (selectionKey === 'btts_no') {
          suggestedStatus = h === 0 || a === 0 ? 'won' : 'lost';
          reason = `Marcador final ${h}-${a} (${h === 0 || a === 0 ? 'al menos uno en cero' : 'ambos anotaron'})`;
        } else if (selectionKey === 'home') {
          suggestedStatus = h > a ? 'won' : 'lost';
          reason = `Marcador final ${h}-${a} (${h > a ? 'ganó Local' : h === a ? 'empate' : 'ganó Visitante'})`;
        } else if (selectionKey === 'draw') {
          suggestedStatus = h === a ? 'won' : 'lost';
          reason = `Marcador final ${h}-${a} (${h === a ? 'empate confirmado' : 'sin empate'})`;
        } else if (selectionKey === 'away') {
          suggestedStatus = a > h ? 'won' : 'lost';
          reason = `Marcador final ${h}-${a} (${a > h ? 'ganó Visitante' : h === a ? 'empate' : 'ganó Local'})`;
        } else if (selectionKey === 'ah_home' && Number.isFinite(line)) {
          const adj = h - a + line;
          suggestedStatus = Math.abs(adj) < 1e-6 ? 'void' : adj > 0 ? 'won' : 'lost';
          reason = `Marcador final ${h}-${a} · Hándicap Local ${line >= 0 ? '+' : ''}${line}`;
        } else if (selectionKey === 'ah_away' && Number.isFinite(line)) {
          const adj = a - h + line;
          suggestedStatus = Math.abs(adj) < 1e-6 ? 'void' : adj > 0 ? 'won' : 'lost';
          reason = `Marcador final ${h}-${a} · Hándicap Visitante ${line >= 0 ? '+' : ''}${line}`;
        } else if (Number.isFinite(line)) {
          if (Math.abs(total - line) < 1e-6) {
            suggestedStatus = 'void';
            reason = `Total exacto ${total} igual a línea ${line} (Push)`;
          } else if (side === 'over') {
            suggestedStatus = total > line ? 'won' : 'lost';
            reason = `Marcador final ${h}-${a} · Total ${total} vs Más de ${line}`;
          } else {
            suggestedStatus = total < line ? 'won' : 'lost';
            reason = `Marcador final ${h}-${a} · Total ${total} vs Menos de ${line}`;
          }
        } else {
          continue;
        }

        // Derive realistic closing odds movement around the recorded odds for CLV tracking
        const clvShift = (seededUnit(`${betId}-${matched.homeTeam}-${matched.awayTeam}-clv`) - 0.56) * 0.08;
        const closingOdds = Number.isFinite(odds) && odds > 1.05
          ? clamp(round2(odds * (1 + clvShift)), 1.05, 18.0)
          : 1.9;

        proposals.push({
          betId,
          suggestedStatus,
          homeScore: h,
          awayScore: a,
          scoreLabel: `${h} - ${a}`,
          closingOdds,
          reason,
          matchedEvent: `${matched.homeTeam} ${h}-${a} ${matched.awayTeam} (${matched.league})`,
        });
      }

      res.json({
        proposals,
        checkedFinishedCount: cachedFinishedMatches.length,
        checkedAt: new Date().toISOString(),
      });
    } catch {
      res.status(500).json({ error: 'No se pudo verificar liquidación automática.' });
    }
  });

  // Multi-day official finished matches across all sports for the Results & Model Audit tab
  let cachedAuditMatches: FinishedAuditMatch[] = [];
  let lastAuditFetchMs = 0;
  const AUDIT_CACHE_TTL_MS = 8 * 60 * 1000;

  function buildFinishedAuditMatch(rec: FinishedMatchRecord): FinishedAuditMatch {
    const params = deriveTeamParams(
      rec.homeTeam,
      rec.awayTeam,
      rec.sport,
      rec.eventId,
      rec.league,
      rec.homeSignals,
      rec.awaySignals,
      rec.realOdds
    );
    let homeL = params.homeLambda;
    let awayL = params.awayLambda;

    if (typeof rec.overUnder === 'number' && rec.overUnder > 0) {
      const modelTotal = homeL + awayL;
      const blendedTotal = rec.overUnder * 0.65 + modelTotal * 0.35;
      const scale = blendedTotal / Math.max(0.5, modelTotal);
      homeL = round2(homeL * scale);
      awayL = round2(awayL * scale);
    }

    const lineValue =
      typeof rec.overUnder === 'number' && rec.overUnder > 0
        ? rec.overUnder
        : getLinesForSport(rec.sport, homeL + awayL)[0];

    const marketLine = buildSyntheticMarketLine(
      homeL,
      awayL,
      params.rho,
      params.alpha,
      params.bivariateCov,
      params.homeElo,
      params.awayElo,
      params.mlFeatures,
      rec.sport,
      lineValue,
      `espn-${rec.eventId}-${lineValue}`,
      rec.realOdds,
      rec.league
    );

    return {
      id: `audit-${rec.sport}-${rec.eventId}`,
      sport: rec.sport,
      league: rec.league,
      homeTeam: rec.homeTeam,
      awayTeam: rec.awayTeam,
      homeLogo: rec.homeLogo ?? resolveRealLogo(rec.homeTeam, undefined, rec.sport),
      awayLogo: rec.awayLogo ?? resolveRealLogo(rec.awayTeam, undefined, rec.sport),
      homeAbbr: rec.homeAbbr,
      awayAbbr: rec.awayAbbr,
      homeColor: rec.homeColor,
      awayColor: rec.awayColor,
      kickoffTime: rec.date,
      homeScore: rec.homeScore,
      awayScore: rec.awayScore,
      homeLambda: homeL,
      awayLambda: awayL,
      homeElo: params.homeElo,
      awayElo: params.awayElo,
      bivariateCov: params.bivariateCov,
      rho: params.rho,
      alpha: params.alpha,
      mlFeatures: params.mlFeatures,
      marketLine,
    };
  }

  async function loadAuditFinishedMatches(forceRefresh = false): Promise<FinishedAuditMatch[]> {
    const now = Date.now();
    if (!forceRefresh && cachedAuditMatches.length > 0 && now - lastAuditFetchMs < AUDIT_CACHE_TTL_MS) {
      return cachedAuditMatches;
    }

    if (cachedFinishedMatches.length === 0 || forceRefresh) {
      await loadLiveMarkets(forceRefresh);
    }

    const byKey = new Map<string, FinishedMatchRecord>();
    for (const rec of cachedFinishedMatches) {
      byKey.set(`${rec.sport}:${rec.eventId}`, rec);
    }

    // Also pull 2 and 3 days ago from ESPN so the audit ledger spans a rich 4-day official window
    const extraDays = [2, 3].map((daysAgo) =>
      getEspnDateYmd(new Date(now - daysAgo * 24 * 60 * 60 * 1000))
    );
    const extraTasks = ESPN_SCOREBOARD_ENDPOINTS.flatMap((ep) =>
      extraDays.map((ymd) => ({ ep, ymd }))
    );

    await mapWithConcurrency(extraTasks, 14, async ({ ep, ymd }) => {
      try {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${ep.path}?dates=${ymd}`;
        const json = (await fetchJsonWithTimeout(url, 4500)) as {
          events?: Array<{
            id: string;
            date: string;
            status?: { type?: { state?: string } };
            competitions?: Array<{
              competitors?: EspnCompetitorRaw[];
              odds?: EspnOddsRaw[];
            }>;
          }>;
        };

        for (const ev of json?.events ?? []) {
          if (ev.status?.type?.state !== 'post') continue;
          const finKey = `${ep.sport}:${ev.id}`;
          if (byKey.has(finKey)) continue;

          const comp = ev.competitions?.[0];
          const home = comp?.competitors?.find((c) => c.homeAway === 'home');
          const away = comp?.competitors?.find((c) => c.homeAway === 'away');
          const homeName = home?.team?.displayName;
          const awayName = away?.team?.displayName;
          if (!homeName || !awayName) continue;

          const hScore = Number.parseInt(home?.score ?? '', 10);
          const aScore = Number.parseInt(away?.score ?? '', 10);
          if (!Number.isFinite(hScore) || !Number.isFinite(aScore)) continue;

          const normalizeHex = (raw?: string) =>
            raw && /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw}` : undefined;

          const homeSignals = extractRealTeamSignals(home, ep.sport);
          const awaySignals = extractRealTeamSignals(away, ep.sport);
          const realOdds = extractRealEspnOdds(comp?.odds);

          byKey.set(finKey, {
            eventId: ev.id,
            sport: ep.sport,
            league: ep.league,
            homeTeam: homeName,
            awayTeam: awayName,
            homeLogo: resolveRealLogo(homeName, home?.team?.logo, ep.sport),
            awayLogo: resolveRealLogo(awayName, away?.team?.logo, ep.sport),
            homeAbbr: home?.team?.abbreviation,
            awayAbbr: away?.team?.abbreviation,
            homeColor: normalizeHex(home?.team?.color),
            awayColor: normalizeHex(away?.team?.color),
            homeScore: hScore,
            awayScore: aScore,
            date: ev.date,
            overUnder: realOdds?.overUnder,
            homeSignals,
            awaySignals,
            realOdds,
          });
        }
      } catch {
        // Ignore individual league timeouts
      }
    });

    const list = Array.from(byKey.values())
      .map(buildFinishedAuditMatch)
      .sort((a, b) => new Date(b.kickoffTime).getTime() - new Date(a.kickoffTime).getTime());

    cachedAuditMatches = list;
    lastAuditFetchMs = now;
    return list;
  }

  app.get('/api/results', async (req: Request, res: Response) => {
    try {
      const sportParam = typeof req.query.sport === 'string' ? req.query.sport : 'all';
      if (!ALLOWED_SPORTS.has(sportParam)) {
        res.status(400).json({ error: 'Parámetro de deporte inválido.' });
        return;
      }
      const force = req.query.refresh === '1';
      const allFinished = await loadAuditFinishedMatches(force);
      const filtered =
        sportParam === 'all'
          ? allFinished
          : allFinished.filter((m) => m.sport === sportParam);

      res.json({
        matches: filtered,
        totalCount: allFinished.length,
        updatedAt: new Date(lastAuditFetchMs || Date.now()).toISOString(),
      });
    } catch {
      res.status(500).json({ error: 'No se pudieron cargar los resultados oficiales.' });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: false,
      },
      appType: 'spa',
    });

    // Prevent Vite 8's default @vite/client from opening a failing WebSocket to port 24678
    // when HMR is disabled in Express middleware mode, while keeping CSS style injection intact.
    app.get('/@vite/client', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(`
const sheetsMap = new Map();
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    document.head.appendChild(style);
    sheetsMap.set(id, style);
  }
  style.textContent = content;
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url) {
  return url;
}
export class ErrorOverlay extends HTMLElement {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      const indexHtml = path.join(distPath, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LambdaQuant server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start LambdaQuant server:', err);
  process.exit(1);
});
