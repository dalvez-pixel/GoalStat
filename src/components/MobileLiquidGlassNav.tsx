import React from 'react';
import type { SportId } from '../types/quant.ts';

interface MobileLiquidGlassNavProps {
  selectedSport: SportId | 'all';
  drawerOpen: boolean;
  onSelectSport: (sport: SportId) => void;
  onToggleDrawer: () => void;
}

const SoccerBallIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9.5" />
    <polygon points="12,7.2 16.2,10.2 14.6,15 9.4,15 7.8,10.2" />
    <path d="M12 2.5v4.7M21 9l-4.8 1.2M17.5 19.6L14.6 15M6.5 19.6L9.4 15M3 9l4.8 1.2" />
  </svg>
);

const BasketballIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="9.5" />
    <path d="M2.5 12h19" />
    <path d="M12 2.5v19" />
    <path d="M5.5 5.2c3.2 2.8 3.2 10.8 0 13.6" />
    <path d="M18.5 5.2c-3.2 2.8-3.2 10.8 0 13.6" />
  </svg>
);

const AmericanFootballIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M18.8 5.2C14.7 3.2 8.7 5 5.8 8.9 3.6 11.9 3.5 16.3 5.2 18.8c4.1 2 10.1.2 13-3.7 2.2-3 2.3-7.4.6-9.9Z" />
    <path d="M9.2 14.8l5.6-5.6" />
    <path d="M10.4 11.2l2.4 2.4" />
    <path d="M12.4 9.2l2.4 2.4" />
    <path d="M8.4 13.2l2.4 2.4" />
  </svg>
);

const HockeyIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M4.5 5l11 11.5c1 1 2.4 1.5 3.8 1.5h1.2v-2.8h-1.2c-.6 0-1.2-.2-1.7-.7L7.3 4" />
    <path d="M19.5 5l-11 11.5c-1 1-2.4 1.5-3.8 1.5H3.5v-2.8h1.2c.6 0 1.2-.2 1.7-.7L16.7 4" />
    <ellipse cx="12" cy="19.2" rx="2.6" ry="1.3" />
  </svg>
);

const HamburgerIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    className={className}
    aria-hidden="true"
  >
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="17" x2="20" y2="17" />
  </svg>
);

const SPORT_NAV_ITEMS: Array<{
  id: SportId;
  label: string;
  Icon: React.FC<{ className?: string }>;
}> = [
  { id: 'soccer', label: 'Fútbol', Icon: SoccerBallIcon },
  { id: 'nba', label: 'NBA', Icon: BasketballIcon },
  { id: 'football', label: 'NFL', Icon: AmericanFootballIcon },
  { id: 'nhl', label: 'NHL', Icon: HockeyIcon },
];

export const MobileLiquidGlassNav: React.FC<MobileLiquidGlassNavProps> = ({
  selectedSport,
  drawerOpen,
  onSelectSport,
  onToggleDrawer,
}) => {
  return (
    <nav
      aria-label="Navegación rápida de deportes en móvil"
      className="md:hidden liquid-glass-nav grid grid-cols-5 items-center px-1.5"
    >
      {SPORT_NAV_ITEMS.map(({ id, label, Icon }) => {
        const isActive = !drawerOpen && selectedSport === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelectSport(id)}
            aria-pressed={isActive}
            aria-label={`Filtrar por ${label}`}
            className={`liquid-glass-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F] ${
              isActive ? 'liquid-glass-item-active' : ''
            }`}
          >
            <Icon className="h-[20px] w-[20px] shrink-0" />
            <span className="whitespace-nowrap tracking-tight">{label}</span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={onToggleDrawer}
        aria-expanded={drawerOpen}
        aria-label="Abrir menú completo"
        className={`liquid-glass-item focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ABF43F] ${
          drawerOpen ? 'liquid-glass-item-active' : ''
        }`}
      >
        <HamburgerIcon className="h-[20px] w-[20px] shrink-0" />
        <span className="whitespace-nowrap tracking-tight">Más</span>
      </button>
    </nav>
  );
};
