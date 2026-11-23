import React, { useId, useState } from 'react';
import type { SportId } from '../types/quant.ts';

interface TeamCrestProps {
  teamName: string;
  sport: SportId;
  logoUrl?: string;
  abbr?: string;
  primaryColor?: string;
  size?: 'sm' | 'md' | 'lg';
}

interface TeamIdentity {
  primary: string;
  secondary: string;
  text: string;
  abbr: string;
  pattern: 'stripes' | 'sash' | 'halves' | 'solid' | 'hoops';
}

const OFFICIAL_TEAM_LOGOS: Record<string, string> = {
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
  'real madrid': 'https://a.espncdn.com/i/teamlogos/soccer/500/86.png',
  'atlético de madrid': 'https://a.espncdn.com/i/teamlogos/soccer/500/1068.png',
  barcelona: 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png',
  'fc barcelona': 'https://a.espncdn.com/i/teamlogos/soccer/500/83.png',
  'boston celtics': 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png',
  'indiana pacers': 'https://a.espncdn.com/i/teamlogos/nba/500/ind.png',
  'oklahoma city thunder': 'https://a.espncdn.com/i/teamlogos/nba/500/okc.png',
  'minnesota timberwolves': 'https://a.espncdn.com/i/teamlogos/nba/500/min.png',
  'denver nuggets': 'https://a.espncdn.com/i/teamlogos/nba/500/den.png',
  'dallas mavericks': 'https://a.espncdn.com/i/teamlogos/nba/500/dal.png',
  'edmonton oilers': 'https://a.espncdn.com/i/teamlogos/nhl/500/edm.png',
  'colorado avalanche': 'https://a.espncdn.com/i/teamlogos/nhl/500/col.png',
  'carolina hurricanes': 'https://a.espncdn.com/i/teamlogos/nhl/500/car.png',
  'new york rangers': 'https://a.espncdn.com/i/teamlogos/nhl/500/nyr.png',
  'buffalo bills': 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png',
  'kansas city chiefs': 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png',
  'baltimore ravens': 'https://a.espncdn.com/i/teamlogos/nfl/500/bal.png',
  'pittsburgh steelers': 'https://a.espncdn.com/i/teamlogos/nfl/500/pit.png',
  'texas longhorns': 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png',
  'oregon ducks': 'https://a.espncdn.com/i/teamlogos/ncaa/500/2483.png',
};

const KNOWN_TEAMS: Record<string, TeamIdentity> = {
  // Fútbol — La Liga, Premier League, Serie A, Bundesliga, Champions League
  villarreal: { primary: '#FBE122', secondary: '#005187', text: '#0F172A', abbr: 'VIL', pattern: 'solid' },
  'real sociedad': { primary: '#0067B1', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'RSO', pattern: 'stripes' },
  arsenal: { primary: '#EF0107', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'ARS', pattern: 'halves' },
  'newcastle united': { primary: '#18181B', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'NEW', pattern: 'stripes' },
  juventus: { primary: '#111111', secondary: '#F8FAFC', text: '#FFFFFF', abbr: 'JUV', pattern: 'stripes' },
  'as roma': { primary: '#8E1F2F', secondary: '#F0BC42', text: '#F0BC42', abbr: 'ROM', pattern: 'solid' },
  'bayer leverkusen': { primary: '#E32221', secondary: '#111111', text: '#FFFFFF', abbr: 'B04', pattern: 'sash' },
  'rb leipzig': { primary: '#DD0741', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'RBL', pattern: 'sash' },
  getafe: { primary: '#005999', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'GET', pattern: 'solid' },
  'athletic club': { primary: '#EE2523', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'ATH', pattern: 'stripes' },
  'inter de milán': { primary: '#010E80', secondary: '#111111', text: '#FFFFFF', abbr: 'INT', pattern: 'stripes' },
  'borussia dortmund': { primary: '#FDE100', secondary: '#111111', text: '#111111', abbr: 'BVB', pattern: 'hoops' },
  'real madrid': { primary: '#F8FAFC', secondary: '#D4AF37', text: '#1E293B', abbr: 'RMA', pattern: 'sash' },
  'atlético de madrid': { primary: '#CB3524', secondary: '#1D3C85', text: '#FFFFFF', abbr: 'ATM', pattern: 'stripes' },
  barcelona: { primary: '#004D98', secondary: '#A50044', text: '#FFFFFF', abbr: 'FCB', pattern: 'stripes' },
  'fc barcelona': { primary: '#004D98', secondary: '#A50044', text: '#FFFFFF', abbr: 'FCB', pattern: 'stripes' },
  'real betis': { primary: '#00954C', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'BET', pattern: 'stripes' },
  sevilla: { primary: '#D40028', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'SEV', pattern: 'sash' },
  'manchester city': { primary: '#6CABDD', secondary: '#1C2C5B', text: '#FFFFFF', abbr: 'MCI', pattern: 'solid' },
  liverpool: { primary: '#C8102E', secondary: '#00B2A9', text: '#FFFFFF', abbr: 'LIV', pattern: 'solid' },
  chelsea: { primary: '#034694', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'CHE', pattern: 'solid' },
  'bayern munich': { primary: '#DC052D', secondary: '#0066B2', text: '#FFFFFF', abbr: 'BAY', pattern: 'halves' },
  psg: { primary: '#004170', secondary: '#DA291C', text: '#FFFFFF', abbr: 'PSG', pattern: 'stripes' },

  // NBA
  'boston celtics': { primary: '#007A33', secondary: '#BA9653', text: '#FFFFFF', abbr: 'BOS', pattern: 'solid' },
  'indiana pacers': { primary: '#002D62', secondary: '#FDBB30', text: '#FDBB30', abbr: 'IND', pattern: 'sash' },
  'oklahoma city thunder': { primary: '#007AC1', secondary: '#EF3B24', text: '#FFFFFF', abbr: 'OKC', pattern: 'sash' },
  'minnesota timberwolves': { primary: '#0C2340', secondary: '#78BE20', text: '#FFFFFF', abbr: 'MIN', pattern: 'hoops' },
  'denver nuggets': { primary: '#0E2240', secondary: '#FEC524', text: '#FEC524', abbr: 'DEN', pattern: 'halves' },
  'dallas mavericks': { primary: '#00538C', secondary: '#B8C4CA', text: '#FFFFFF', abbr: 'DAL', pattern: 'solid' },
  'los angeles lakers': { primary: '#552583', secondary: '#FDB927', text: '#FDB927', abbr: 'LAL', pattern: 'hoops' },
  'new york knicks': { primary: '#006BB6', secondary: '#F58426', text: '#FFFFFF', abbr: 'NYK', pattern: 'stripes' },

  // NHL
  'edmonton oilers': { primary: '#041E42', secondary: '#FF4C00', text: '#FFFFFF', abbr: 'EDM', pattern: 'hoops' },
  'colorado avalanche': { primary: '#6F263D', secondary: '#236192', text: '#FFFFFF', abbr: 'COL', pattern: 'sash' },
  'carolina hurricanes': { primary: '#CC0000', secondary: '#111111', text: '#FFFFFF', abbr: 'CAR', pattern: 'sash' },
  'new york rangers': { primary: '#0038A8', secondary: '#CE1126', text: '#FFFFFF', abbr: 'NYR', pattern: 'sash' },

  // NFL / NCAAF
  'buffalo bills': { primary: '#00338D', secondary: '#C60C30', text: '#FFFFFF', abbr: 'BUF', pattern: 'sash' },
  'kansas city chiefs': { primary: '#E31837', secondary: '#FFB81C', text: '#FFFFFF', abbr: 'KC', pattern: 'solid' },
  'baltimore ravens': { primary: '#241773', secondary: '#9E7C0C', text: '#FFFFFF', abbr: 'BAL', pattern: 'halves' },
  'pittsburgh steelers': { primary: '#101820', secondary: '#FFB612', text: '#FFB612', abbr: 'PIT', pattern: 'hoops' },
  'texas longhorns': { primary: '#BF5700', secondary: '#FFFFFF', text: '#FFFFFF', abbr: 'TEX', pattern: 'solid' },
  'oregon ducks': { primary: '#154733', secondary: '#FEE123', text: '#FEE123', abbr: 'ORE', pattern: 'halves' },
};

const FALLBACK_PALETTES: Array<[string, string, string]> = [
  ['#1E3A8A', '#38BDF8', '#FFFFFF'],
  ['#991B1B', '#FCA5A5', '#FFFFFF'],
  ['#065F46', '#34D399', '#FFFFFF'],
  ['#4C1D95', '#C4B5FD', '#FFFFFF'],
  ['#9A3412', '#FDBA74', '#FFFFFF'],
  ['#0F766E', '#5EEAD4', '#FFFFFF'],
  ['#1F2937', '#FBBF24', '#FFFFFF'],
  ['#831843', '#F9A8D4', '#FFFFFF'],
];

function hashName(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function buildAbbreviation(name: string): string {
  const cleaned = name
    .replace(/^(FC|CF|CD|AS|AC|RB|SC|RC|UD|SD|CA|AD|Real|Club|Atlético|Atletico)\s+/i, '')
    .trim();
  const parts = (cleaned || name).split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1].slice(0, 2)).toUpperCase();
  }
  return (parts[0] ?? name).slice(0, 3).toUpperCase();
}

function resolveIdentity(
  teamName: string,
  abbr?: string,
  primaryColor?: string
): TeamIdentity {
  const key = teamName.trim().toLowerCase();
  const known = KNOWN_TEAMS[key];
  if (known) {
    return {
      ...known,
      abbr: abbr ? abbr.slice(0, 3).toUpperCase() : known.abbr,
      primary: primaryColor || known.primary,
    };
  }

  const h = hashName(key);
  const [p, s, t] = FALLBACK_PALETTES[h % FALLBACK_PALETTES.length];
  const patterns: TeamIdentity['pattern'][] = ['stripes', 'sash', 'halves', 'hoops', 'solid'];

  return {
    primary: primaryColor || p,
    secondary: s,
    text: t,
    abbr: abbr ? abbr.slice(0, 3).toUpperCase() : buildAbbreviation(teamName),
    pattern: patterns[h % patterns.length],
  };
}

export const TeamCrest: React.FC<TeamCrestProps> = ({
  teamName,
  sport,
  logoUrl,
  abbr,
  primaryColor,
  size = 'md',
}) => {
  const [imgError, setImgError] = useState(false);
  const clipId = useId();

  const dimensions =
    size === 'sm'
      ? 'h-8 w-8'
      : size === 'lg'
        ? 'h-12 w-12'
        : 'h-10 w-10';

  const resolvedLogoUrl =
    logoUrl || OFFICIAL_TEAM_LOGOS[teamName.trim().toLowerCase()];

  if (resolvedLogoUrl && !imgError) {
    return (
      <div
        className={`${dimensions} shrink-0 flex items-center justify-center`}
        title={teamName}
      >
        <img
          src={resolvedLogoUrl}
          alt={`Escudo oficial de ${teamName}`}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgError(true)}
          className="h-full w-full object-contain drop-shadow-xs"
        />
      </div>
    );
  }

  const identity = resolveIdentity(teamName, abbr, primaryColor);

  // Sport-specific silhouette path for heraldic/athletic crests
  const shieldPath =
    sport === 'nba'
      ? 'M24 3 C35.6 3 45 12.4 45 24 C45 35.6 35.6 45 24 45 C12.4 45 3 35.6 3 24 C3 12.4 12.4 3 24 3 Z'
      : sport === 'nhl'
        ? 'M7 6 L41 6 L43 22 C43 34 33 41 24 45 C15 41 5 34 5 22 Z'
        : sport === 'football'
          ? 'M8 5 L40 5 L40 27 C40 36 31 42 24 45 C17 42 8 36 8 27 Z'
          : 'M9 5 L39 5 L39 24 C39 34.5 32 41 24 45 C16 41 9 34.5 9 24 Z';

  return (
    <div
      className={`${dimensions} shrink-0 flex items-center justify-center`}
      title={teamName}
      aria-label={`Escudo de ${teamName}`}
    >
      <svg viewBox="0 0 48 48" className="h-full w-full drop-shadow-xs" role="img" aria-label={teamName}>
        <defs>
          <clipPath id={clipId}>
            <path d={shieldPath} />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {/* Base field */}
          <rect x="0" y="0" width="48" height="48" fill={identity.primary} />

          {/* Club pattern */}
          {identity.pattern === 'stripes' && (
            <>
              <rect x="11" y="0" width="6" height="48" fill={identity.secondary} fillOpacity="0.88" />
              <rect x="21" y="0" width="6" height="48" fill={identity.secondary} fillOpacity="0.88" />
              <rect x="31" y="0" width="6" height="48" fill={identity.secondary} fillOpacity="0.88" />
            </>
          )}
          {identity.pattern === 'halves' && (
            <rect x="24" y="0" width="24" height="48" fill={identity.secondary} fillOpacity="0.88" />
          )}
          {identity.pattern === 'sash' && (
            <polygon points="-4,40 40,-4 52,8 8,52" fill={identity.secondary} fillOpacity="0.85" />
          )}
          {identity.pattern === 'hoops' && (
            <>
              <rect x="0" y="10" width="48" height="7" fill={identity.secondary} fillOpacity="0.85" />
              <rect x="0" y="29" width="48" height="7" fill={identity.secondary} fillOpacity="0.85" />
            </>
          )}

          {/* Subtle center dark ribbon behind monogram for guaranteed contrast */}
          <rect x="0" y="16" width="48" height="16" fill="rgba(9, 9, 11, 0.72)" />

          {/* Subtle gloss highlight */}
          <path d="M0 0 L48 0 L48 16 Q24 22 0 16 Z" fill="rgba(255,255,255,0.14)" />
        </g>

        {/* Outer metallic crest rim */}
        <path
          d={shieldPath}
          fill="none"
          stroke="rgba(255,255,255,0.65)"
          strokeWidth="2"
        />

        {/* Crisp monogram */}
        <text
          x="24"
          y="27.5"
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="11.5"
          fontWeight="700"
          fontFamily="var(--font-mono), monospace"
          letterSpacing="0.04em"
        >
          {identity.abbr}
        </text>
      </svg>
    </div>
  );
};
