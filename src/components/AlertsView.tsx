import { Bell, BellRing, CheckCheck, Volume2, VolumeX } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { formatTime24h } from '../lib/timezone.ts';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type { AlertItem, AlertSettings, SportId } from '../types/quant.ts';
import { TeamCrest } from './TeamCrest.tsx';

interface AlertsViewProps {
  alerts: AlertItem[];
  settings: AlertSettings;
  timeZone: string;
  onUpdateSettings: (next: AlertSettings) => void;
  onMarkAllRead: () => void;
  onMarkRead: (alertId: string) => void;
  onTestAlert: () => void;
  onInspectAlert: (alert: AlertItem) => void;
}

const SPORT_IDS: SportId[] = ['soccer', 'nba', 'nhl', 'football'];

export const AlertsView: React.FC<AlertsViewProps> = ({
  alerts,
  settings,
  timeZone,
  onUpdateSettings,
  onMarkAllRead,
  onMarkRead,
  onTestAlert,
  onInspectAlert,
}) => {
  const [readFilter, setReadFilter] = useState<'all' | 'unread'>('all');
  const [sportFilter, setSportFilter] = useState<SportId | 'all'>('all');

  const unreadCount = useMemo(() => alerts.filter((a) => !a.read).length, [alerts]);
  const topAlertEv = useMemo(
    () => (alerts.length > 0 ? Math.max(...alerts.map((a) => a.ev)) * 100 : 0),
    [alerts]
  );

  const visibleAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (readFilter === 'unread' && a.read) return false;
      if (sportFilter !== 'all' && a.sport !== sportFilter) return false;
      return true;
    });
  }, [alerts, readFilter, sportFilter]);

  const activeSportsCount = SPORT_IDS.filter((s) => settings.sports[s]).length;

  return (
    <div className="space-y-6 overflow-visible">
      {/* KPI Summary Strip — 4 Glassmorphism + Hover Scale Cards */}
      <section
        aria-label="Resumen de alertas"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 py-1 overflow-visible"
      >
        <div className="glass-card rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Alertas detectadas
          </p>
          <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {alerts.length}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Centralizadas solo en esta pestaña
          </p>
        </div>

        <div className="glass-card rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Pendientes de revisar
          </p>
          <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-[#ABF43F]">
            {unreadCount}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {unreadCount > 0 ? 'Sin ventanas emergentes' : 'Todas revisadas'}
          </p>
        </div>

        <div className="glass-card rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Mayor +EV alertado
          </p>
          <p className="mt-1.5 font-mono tabular-nums text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {alerts.length > 0 ? `+${topAlertEv.toFixed(2)}%` : '—'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Umbral activo: ≥ +{settings.minEvPercent.toFixed(1)}% EV
          </p>
        </div>

        <div className="glass-card rounded-xl border border-slate-200 bg-white p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Monitor en tiempo real
          </p>
          <p className="mt-1.5 text-lg font-semibold text-slate-900 dark:text-slate-50">
            {settings.pushEnabled ? 'Activo' : 'En pausa'}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {activeSportsCount}/4 deportes · Edge ≥ +{settings.minEdgePercent.toFixed(1)}%
          </p>
        </div>
      </section>

      {/* Main 2-Column Workspace: Alert Rules + Dedicated Alert Feed */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start overflow-visible">
        {/* Alert Rules Panel */}
        <section className="xl:col-span-4 glass-panel glass-panel-hover border border-slate-200 rounded-xl bg-white p-5 space-y-5">
          <div className="border-b border-slate-200 dark:border-white/[0.08] pb-3.5">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Reglas de Detección Automática
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Las oportunidades que superen estos umbrales se registran silenciosamente en esta pestaña (sin pop-ups).
            </p>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Escaneo automático de alertas
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Registra movimientos +EV en vivo
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings.pushEnabled}
              onClick={() =>
                onUpdateSettings({ ...settings, pushEnabled: !settings.pushEnabled })
              }
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                settings.pushEnabled
                  ? 'bg-[#ABF43F]'
                  : 'bg-slate-300 dark:bg-white/20'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-[#090909] transition-transform ${
                  settings.pushEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="space-y-4">
            <label className="block space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400">Mínimo Valor Esperado (+EV)</span>
                <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  +{settings.minEvPercent.toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={12}
                step={0.5}
                value={settings.minEvPercent}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, minEvPercent: Number(e.target.value) })
                }
                className="w-full accent-[#ABF43F]"
              />
            </label>

            <label className="block space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-600 dark:text-slate-400">Mínima Ventaja (Edge)</span>
                <span className="font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                  +{settings.minEdgePercent.toFixed(1)}%
                </span>
              </div>
              <input
                type="range"
                min={0.5}
                max={8}
                step={0.5}
                value={settings.minEdgePercent}
                onChange={(e) =>
                  onUpdateSettings({ ...settings, minEdgePercent: Number(e.target.value) })
                }
                className="w-full accent-[#3FF4E5]"
              />
            </label>
          </div>

          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Deportes monitoreados
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SPORT_IDS.map((sid) => {
                const active = settings.sports[sid];
                return (
                  <button
                    key={sid}
                    type="button"
                    onClick={() =>
                      onUpdateSettings({
                        ...settings,
                        sports: { ...settings.sports, [sid]: !active },
                      })
                    }
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 border-slate-900 text-white dark:bg-[#ABF43F] dark:border-[#ABF43F] dark:text-[#090909]'
                        : 'border-slate-200 dark:border-white/[0.1] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {SPORT_META[sid].shortName}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-white/[0.08] flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onTestAlert}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/[0.1] dark:bg-white/[0.04] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors whitespace-nowrap"
            >
              <BellRing className="h-3.5 w-3.5" />
              <span>Capturar alerta ahora</span>
            </button>

            <button
              type="button"
              onClick={() =>
                onUpdateSettings({ ...settings, soundEnabled: !settings.soundEnabled })
              }
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/[0.1] dark:bg-white/[0.04] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors whitespace-nowrap"
            >
              {settings.soundEnabled ? (
                <Volume2 className="h-3.5 w-3.5 text-slate-900 dark:text-[#ABF43F]" />
              ) : (
                <VolumeX className="h-3.5 w-3.5 text-slate-400" />
              )}
              <span>{settings.soundEnabled ? 'Sonido' : 'Silencio'}</span>
            </button>
          </div>
        </section>

        {/* Dedicated Alerts Feed */}
        <section className="xl:col-span-8 space-y-4 overflow-visible">
          {/* Feed Toolbar */}
          <div className="glass-panel border border-slate-200 rounded-xl bg-white px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex p-1 rounded-lg bg-slate-100 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setReadFilter('all')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    readFilter === 'all'
                      ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Todas ({alerts.length})
                </button>
                <button
                  type="button"
                  onClick={() => setReadFilter('unread')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    readFilter === 'unread'
                      ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Sin leer ({unreadCount})
                </button>
              </div>

              <select
                aria-label="Filtrar alertas por deporte"
                value={sportFilter}
                onChange={(e) => setSportFilter(e.target.value as SportId | 'all')}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#141418] text-slate-700 dark:text-slate-200"
              >
                <option value="all">Todos los deportes</option>
                <option value="soccer">Fútbol</option>
                <option value="nba">NBA</option>
                <option value="nhl">NHL</option>
                <option value="football">NFL / NCAAF</option>
              </select>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-900 dark:text-[#ABF43F] hover:underline whitespace-nowrap"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>Marcar todas como leídas</span>
              </button>
            )}
          </div>

          {/* Alerts Cards List */}
          {visibleAlerts.length === 0 ? (
            <div className="glass-panel border border-slate-200 rounded-xl bg-white py-14 px-6 text-center">
              <Bell className="h-6 w-6 mx-auto text-slate-400 mb-2.5" />
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                No hay alertas para mostrar con este filtro
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
                Cuando el escáner en vivo detecte un mercado con +EV superior a +
                {settings.minEvPercent.toFixed(1)}%, aparecerá listado aquí automáticamente.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-1 overflow-visible">
              {visibleAlerts.map((alert) => {
                const [fallbackHome, fallbackAway] = alert.matchLabel.split(' vs ');
                const homeName = alert.homeTeam ?? fallbackHome ?? alert.matchLabel;
                const awayName = alert.awayTeam ?? fallbackAway ?? '';
                const timeStr = formatTime24h(alert.timestamp, timeZone, true);

                return (
                  <article
                    key={alert.id}
                    className={`glass-card rounded-xl p-4 flex flex-col justify-between gap-3.5 ${
                      alert.read ? '' : 'glass-card-active'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="truncate">
                        {SPORT_META[alert.sport].shortName} · {alert.league} ·{' '}
                        {MODEL_META[alert.modelType].shortName}
                      </span>
                      <span className="font-mono tabular-nums whitespace-nowrap shrink-0">
                        {timeStr}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center -space-x-1.5 shrink-0">
                        <TeamCrest
                          teamName={homeName}
                          sport={alert.sport}
                          logoUrl={alert.homeLogo}
                          size="sm"
                        />
                        {awayName && (
                          <TeamCrest
                            teamName={awayName}
                            sport={alert.sport}
                            logoUrl={alert.awayLogo}
                            size="sm"
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50 truncate">
                          {alert.matchLabel}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {alert.marketLabel} · {alert.bookmaker}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-slate-200/80 dark:border-white/[0.08] font-mono tabular-nums text-xs">
                      <div>
                        <p className="text-[10px] font-sans text-slate-500 dark:text-slate-400">
                          Cuota
                        </p>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {alert.odds.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-sans text-slate-500 dark:text-slate-400">
                          Edge
                        </p>
                        <p className="font-semibold text-slate-900 dark:text-[#3FF4E5]">
                          +{(alert.edge * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-sans text-slate-500 dark:text-slate-400">
                          Valor EV
                        </p>
                        <p className="font-semibold text-slate-900 dark:text-[#ABF43F]">
                          +{(alert.ev * 100).toFixed(2)}%
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.06]">
                      {!alert.read ? (
                        <button
                          type="button"
                          onClick={() => onMarkRead(alert.id)}
                          className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
                        >
                          Marcar leída
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          Revisada
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          onMarkRead(alert.id);
                          onInspectAlert(alert);
                        }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 dark:bg-[#ABF43F] dark:text-[#090909] dark:hover:bg-[#bef863] transition-colors whitespace-nowrap"
                      >
                        Analizar partido
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
