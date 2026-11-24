import * as d3 from 'd3';
import { Activity, Layers, RotateCcw } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MODEL_META, SPORT_META } from '../types/quant.ts';
import type { BetRecord, ModelType, SportId } from '../types/quant.ts';

interface ModelOverlayD3ChartProps {
  theme: 'dark' | 'light';
  bets: BetRecord[];
  selectedSport: SportId | 'all';
}

type OverlayMetricMode = 'yield' | 'brier' | 'dual';

interface ModelTimePoint {
  date: Date;
  dateMs: number;
  pickIndex: number;
  yieldPct: number;
  brierScore: number;
  cumPnl: number;
  cumStaked: number;
  matchLabel: string;
  status: 'won' | 'lost';
}

interface ModelSeries {
  modelType: ModelType;
  name: string;
  shortName: string;
  color: string;
  points: ModelTimePoint[];
  latestYield: number;
  latestBrier: number;
  totalPicks: number;
}

interface HoverReadout {
  date: Date;
  xPos: number;
  containerWidth: number;
  items: Array<{
    modelType: ModelType;
    shortName: string;
    color: string;
    yieldPct: number;
    brierScore: number;
    pickIndex: number;
    matchLabel: string;
  }>;
}

const ALL_MODELS: ModelType[] = [
  'bivariate-poisson-xg-elo',
  'ensemble',
  'dixon-coles',
  'negative-binomial',
  'ml-gbdt',
];

const MODEL_STROKE_PALETTE: Record<ModelType, { dark: string; light: string }> = {
  'bivariate-poisson-xg-elo': { dark: '#ABF43F', light: '#15803D' },
  ensemble: { dark: '#3FF4E5', light: '#0E7490' },
  'dixon-coles': { dark: '#F59E0B', light: '#B45309' },
  'negative-binomial': { dark: '#C084FC', light: '#7E22CE' },
  'ml-gbdt': { dark: '#FF3B4B', light: '#DC2626' },
};

const QUICK_PRESETS: Array<{ id: string; label: string; models: ModelType[] }> = [
  {
    id: 'poisson-vs-ensemble',
    label: 'Poisson vs Ensemble',
    models: ['bivariate-poisson-xg-elo', 'ensemble'],
  },
  {
    id: 'poisson-vs-dc',
    label: 'Poisson vs Dixon-Coles',
    models: ['bivariate-poisson-xg-elo', 'dixon-coles'],
  },
  {
    id: 'ensemble-vs-ml',
    label: 'Ensemble vs ML GBDT',
    models: ['ensemble', 'ml-gbdt'],
  },
  {
    id: 'all-models',
    label: 'Todos (5)',
    models: ALL_MODELS,
  },
];

function formatShortDateEs(date: Date): string {
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
  });
}

function formatFullDateEs(date: Date): string {
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export const ModelOverlayD3Chart: React.FC<ModelOverlayD3ChartProps> = ({
  theme,
  bets,
  selectedSport,
}) => {
  const [metricMode, setMetricMode] = useState<OverlayMetricMode>('yield');
  const [selectedModels, setSelectedModels] = useState<ModelType[]>([
    'bivariate-poisson-xg-elo',
    'ensemble',
  ]);
  const [smoothCurve, setSmoothCurve] = useState<boolean>(true);
  const [hoverReadout, setHoverReadout] = useState<HoverReadout | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(820);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Measure chart container responsively
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateWidth = () => {
      const next = Math.max(300, Math.floor(el.getBoundingClientRect().width));
      setChartWidth(next);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Build chronological cumulative Yield & Brier Score time-series per model
  const allSeries = useMemo<ModelSeries[]>(() => {
    const scoped = bets
      .filter((b) => (b.status === 'won' || b.status === 'lost'))
      .filter((b) => (selectedSport === 'all' ? true : b.sport === selectedSport))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return ALL_MODELS.map((modelType) => {
      const modelBets = scoped.filter((b) => b.modelUsed === modelType);
      let cumPnl = 0;
      let cumStaked = 0;
      let cumBrierSum = 0;

      const points: ModelTimePoint[] = modelBets.map((b, idx) => {
        cumPnl += b.pnl;
        cumStaked += b.stake;
        const outcome = b.status === 'won' ? 1 : 0;
        cumBrierSum += Math.pow(b.modelProb - outcome, 2);
        const dateObj = new Date(b.date);

        return {
          date: dateObj,
          dateMs: dateObj.getTime(),
          pickIndex: idx + 1,
          yieldPct: cumStaked > 0 ? (cumPnl / cumStaked) * 100 : 0,
          brierScore: cumBrierSum / (idx + 1),
          cumPnl,
          cumStaked,
          matchLabel: b.matchLabel,
          status: b.status === 'won' ? 'won' : 'lost',
        };
      });

      const last = points[points.length - 1];
      return {
        modelType,
        name: MODEL_META[modelType].name,
        shortName: MODEL_META[modelType].shortName,
        color: MODEL_STROKE_PALETTE[modelType][theme],
        points,
        latestYield: last ? last.yieldPct : 0,
        latestBrier: last ? last.brierScore : 0,
        totalPicks: points.length,
      };
    });
  }, [bets, selectedSport, theme]);

  const activeSeries = useMemo(
    () => allSeries.filter((s) => selectedModels.includes(s.modelType) && s.points.length > 0),
    [allSeries, selectedModels]
  );

  const toggleModel = (model: ModelType) => {
    setSelectedModels((prev) => {
      if (prev.includes(model)) {
        if (prev.length === 1) return prev; // Keep at least 1 series active
        return prev.filter((m) => m !== model);
      }
      return [...prev, model];
    });
  };

  // Render D3 multi-model overlay line chart
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    if (activeSeries.length === 0) {
      setHoverReadout(null);
      return;
    }

    const height = 340;
    const isDual = metricMode === 'dual';
    const margin = {
      top: 22,
      right: isDual ? 60 : 24,
      bottom: 38,
      left: 56,
    };
    const innerWidth = Math.max(180, chartWidth - margin.left - margin.right);
    const innerHeight = height - margin.top - margin.bottom;

    const isDark = theme === 'dark';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(15, 23, 42, 0.09)';
    const axisColor = isDark ? '#94a3b8' : '#475569';
    const refLineColor = isDark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(15, 23, 42, 0.28)';
    const crosshairColor = isDark ? 'rgba(255, 255, 255, 0.32)' : 'rgba(15, 23, 42, 0.32)';

    const allPoints = activeSeries.flatMap((s) => s.points);
    const [minDate, maxDate] = d3.extent(allPoints, (d) => d.date) as [Date, Date];
    const paddedMinDate =
      minDate.getTime() === maxDate.getTime()
        ? new Date(minDate.getTime() - 24 * 60 * 60 * 1000)
        : minDate;
    const paddedMaxDate =
      minDate.getTime() === maxDate.getTime()
        ? new Date(maxDate.getTime() + 24 * 60 * 60 * 1000)
        : maxDate;

    const xScale = d3.scaleTime().domain([paddedMinDate, paddedMaxDate]).range([0, innerWidth]);

    // Yield domain (always includes 0% reference)
    const yieldValues = allPoints.map((d) => d.yieldPct);
    const rawYieldMin = Math.min(0, d3.min(yieldValues) ?? -5);
    const rawYieldMax = Math.max(5, d3.max(yieldValues) ?? 10);
    const yieldPad = Math.max(3, (rawYieldMax - rawYieldMin) * 0.14);
    const yYieldScale = d3
      .scaleLinear()
      .domain([rawYieldMin - yieldPad, rawYieldMax + yieldPad])
      .nice()
      .range([innerHeight, 0]);

    // Brier domain (always includes 0.250 baseline reference)
    const brierValues = allPoints.map((d) => d.brierScore);
    const rawBrierMin = Math.max(0, Math.min(0.12, d3.min(brierValues) ?? 0.15));
    const rawBrierMax = Math.min(0.6, Math.max(0.27, d3.max(brierValues) ?? 0.28));
    const brierPad = Math.max(0.02, (rawBrierMax - rawBrierMin) * 0.15);
    const yBrierScale = d3
      .scaleLinear()
      .domain([Math.max(0, rawBrierMin - brierPad), rawBrierMax + brierPad])
      .nice()
      .range([innerHeight, 0]);

    const leftScale = metricMode === 'brier' ? yBrierScale : yYieldScale;

    svg
      .attr('viewBox', `0 0 ${chartWidth} ${height}`)
      .attr('width', chartWidth)
      .attr('height', height);

    const defs = svg.append('defs');
    const clipId = `d3-overlay-clip-${Math.random().toString(36).slice(2, 8)}`;
    defs
      .append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('x', 0)
      .attr('y', -6)
      .attr('width', innerWidth)
      .attr('height', innerHeight + 12);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    // Horizontal grid lines
    g.append('g')
      .attr('class', 'd3-grid')
      .call(
        d3
          .axisLeft(leftScale)
          .ticks(5)
          .tickSize(-innerWidth)
          .tickFormat(() => '')
      )
      .call((sel) => sel.select('.domain').remove())
      .call((sel) =>
        sel
          .selectAll('line')
          .attr('stroke', gridColor)
          .attr('stroke-dasharray', '3 3')
      );

    // X Axis
    const tickCountX = Math.max(3, Math.min(7, Math.floor(innerWidth / 115)));
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(tickCountX)
          .tickFormat((d) => formatShortDateEs(d as Date))
          .tickSizeOuter(0)
      )
      .call((sel) => sel.select('.domain').attr('stroke', gridColor))
      .call((sel) => sel.selectAll('.tick line').attr('stroke', gridColor))
      .call((sel) =>
        sel
          .selectAll('.tick text')
          .attr('fill', axisColor)
          .style('font-size', '11px')
          .style('font-family', 'var(--font-mono)')
      );

    // Left Y Axis
    const leftAxis = d3
      .axisLeft(leftScale)
      .ticks(5)
      .tickFormat((d) =>
        metricMode === 'brier' ? Number(d).toFixed(3) : `${Number(d) >= 0 ? '+' : ''}${Number(d).toFixed(0)}%`
      )
      .tickSizeOuter(0);

    g.append('g')
      .call(leftAxis)
      .call((sel) => sel.select('.domain').remove())
      .call((sel) => sel.selectAll('.tick line').remove())
      .call((sel) =>
        sel
          .selectAll('.tick text')
          .attr('fill', axisColor)
          .style('font-size', '11px')
          .style('font-family', 'var(--font-mono)')
      );

    // Left Y Axis unit label
    g.append('text')
      .attr('x', -4)
      .attr('y', -10)
      .attr('text-anchor', 'start')
      .attr('fill', axisColor)
      .style('font-size', '10px')
      .style('font-weight', '600')
      .text(metricMode === 'brier' ? 'Brier Score (↓ mejor)' : 'Yield acumulado (%)');

    // Optional Right Y Axis for Dual Overlay mode
    if (isDual) {
      const rightAxis = d3
        .axisRight(yBrierScale)
        .ticks(5)
        .tickFormat((d) => Number(d).toFixed(3))
        .tickSizeOuter(0);

      g.append('g')
        .attr('transform', `translate(${innerWidth},0)`)
        .call(rightAxis)
        .call((sel) => sel.select('.domain').remove())
        .call((sel) => sel.selectAll('.tick line').remove())
        .call((sel) =>
          sel
            .selectAll('.tick text')
            .attr('fill', axisColor)
            .style('font-size', '11px')
            .style('font-family', 'var(--font-mono)')
        );

      g.append('text')
        .attr('x', innerWidth + 4)
        .attr('y', -10)
        .attr('text-anchor', 'end')
        .attr('fill', axisColor)
        .style('font-size', '10px')
        .style('font-weight', '600')
        .text('Brier Score (punteada)');
    }

    // Reference baseline (0% Yield or 0.250 Random Brier)
    if (metricMode === 'yield' || metricMode === 'dual') {
      const yZero = yYieldScale(0);
      if (yZero >= 0 && yZero <= innerHeight) {
        g.append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', yZero)
          .attr('y2', yZero)
          .attr('stroke', refLineColor)
          .attr('stroke-width', 1.2)
          .attr('stroke-dasharray', '4 4');

        g.append('text')
          .attr('x', innerWidth - 6)
          .attr('y', yZero - 5)
          .attr('text-anchor', 'end')
          .attr('fill', axisColor)
          .style('font-size', '10px')
          .style('font-family', 'var(--font-mono)')
          .text('Break-even 0%');
      }
    } else {
      const yRandom = yBrierScale(0.25);
      if (yRandom >= 0 && yRandom <= innerHeight) {
        g.append('line')
          .attr('x1', 0)
          .attr('x2', innerWidth)
          .attr('y1', yRandom)
          .attr('y2', yRandom)
          .attr('stroke', refLineColor)
          .attr('stroke-width', 1.2)
          .attr('stroke-dasharray', '4 4');

        g.append('text')
          .attr('x', innerWidth - 6)
          .attr('y', yRandom - 5)
          .attr('text-anchor', 'end')
          .attr('fill', axisColor)
          .style('font-size', '10px')
          .style('font-family', 'var(--font-mono)')
          .text('Azar 0.250');
      }
    }

    const curveFactory = smoothCurve ? d3.curveMonotoneX : d3.curveLinear;

    const yieldLineGen = d3
      .line<ModelTimePoint>()
      .x((d) => xScale(d.date))
      .y((d) => yYieldScale(d.yieldPct))
      .curve(curveFactory);

    const brierLineGen = d3
      .line<ModelTimePoint>()
      .x((d) => xScale(d.date))
      .y((d) => yBrierScale(d.brierScore))
      .curve(curveFactory);

    const plotLayer = g.append('g').attr('clip-path', `url(#${clipId})`);

    // Draw each selected model series
    for (const series of activeSeries) {
      if (metricMode === 'yield' || metricMode === 'dual') {
        // Soft area tint under the primary line only when 2 or fewer models in Yield mode
        if (metricMode === 'yield' && activeSeries.length <= 2) {
          const gradId = `d3-area-${series.modelType}`;
          const grad = defs
            .append('linearGradient')
            .attr('id', gradId)
            .attr('x1', '0')
            .attr('y1', '0')
            .attr('x2', '0')
            .attr('y2', '1');
          grad.append('stop').attr('offset', '0%').attr('stop-color', series.color).attr('stop-opacity', isDark ? 0.16 : 0.14);
          grad.append('stop').attr('offset', '100%').attr('stop-color', series.color).attr('stop-opacity', 0);

          const areaGen = d3
            .area<ModelTimePoint>()
            .x((d) => xScale(d.date))
            .y0(yYieldScale(0))
            .y1((d) => yYieldScale(d.yieldPct))
            .curve(curveFactory);

          plotLayer
            .append('path')
            .datum(series.points)
            .attr('fill', `url(#${gradId})`)
            .attr('d', areaGen);
        }

        plotLayer
          .append('path')
          .datum(series.points)
          .attr('fill', 'none')
          .attr('stroke', series.color)
          .attr('stroke-width', 2.4)
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round')
          .attr('d', yieldLineGen);

        // Endpoint dot for visual clarity
        const lastPt = series.points[series.points.length - 1];
        plotLayer
          .append('circle')
          .attr('cx', xScale(lastPt.date))
          .attr('cy', yYieldScale(lastPt.yieldPct))
          .attr('r', 4)
          .attr('fill', series.color)
          .attr('stroke', isDark ? '#090909' : '#ffffff')
          .attr('stroke-width', 1.5);
      }

      if (metricMode === 'brier' || metricMode === 'dual') {
        plotLayer
          .append('path')
          .datum(series.points)
          .attr('fill', 'none')
          .attr('stroke', series.color)
          .attr('stroke-width', isDual ? 1.8 : 2.4)
          .attr('stroke-dasharray', isDual ? '5 4' : 'none')
          .attr('stroke-opacity', isDual ? 0.85 : 1)
          .attr('stroke-linecap', 'round')
          .attr('stroke-linejoin', 'round')
          .attr('d', brierLineGen);

        const lastPt = series.points[series.points.length - 1];
        plotLayer
          .append('circle')
          .attr('cx', xScale(lastPt.date))
          .attr('cy', yBrierScale(lastPt.brierScore))
          .attr('r', isDual ? 3.2 : 4)
          .attr('fill', isDual ? (isDark ? '#090909' : '#ffffff') : series.color)
          .attr('stroke', series.color)
          .attr('stroke-width', isDual ? 1.8 : 1.5);
      }
    }

    // Interactive hover crosshair & synced point markers
    const focusGroup = g.append('g').style('display', 'none');

    const focusLine = focusGroup
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', crosshairColor)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3 3');

    const focusDots = focusGroup.append('g');
    const bisectDate = d3.bisector<ModelTimePoint, number>((d) => d.dateMs).left;

    const handlePointerMove = (event: MouseEvent | TouchEvent) => {
      const [mx] = d3.pointer(event);
      const clampedX = Math.max(0, Math.min(innerWidth, mx));
      const hoverDate = xScale.invert(clampedX);
      const hoverMs = hoverDate.getTime();

      focusGroup.style('display', null);
      focusLine.attr('x1', clampedX).attr('x2', clampedX);
      focusDots.selectAll('*').remove();

      const items: HoverReadout['items'] = [];

      for (const series of activeSeries) {
        const pts = series.points;
        const idx = bisectDate(pts, hoverMs, 1);
        const prev = pts[idx - 1];
        const next = pts[idx];
        let chosen = prev ?? next;
        if (prev && next) {
          chosen = hoverMs - prev.dateMs > next.dateMs - hoverMs ? next : prev;
        }
        if (!chosen) continue;

        const cx = xScale(chosen.date);
        if (metricMode === 'yield' || metricMode === 'dual') {
          focusDots
            .append('circle')
            .attr('cx', cx)
            .attr('cy', yYieldScale(chosen.yieldPct))
            .attr('r', 5)
            .attr('fill', series.color)
            .attr('stroke', isDark ? '#090909' : '#ffffff')
            .attr('stroke-width', 2);
        }
        if (metricMode === 'brier' || metricMode === 'dual') {
          focusDots
            .append('circle')
            .attr('cx', cx)
            .attr('cy', yBrierScale(chosen.brierScore))
            .attr('r', isDual ? 4 : 5)
            .attr('fill', isDual ? (isDark ? '#090909' : '#ffffff') : series.color)
            .attr('stroke', series.color)
            .attr('stroke-width', 2);
        }

        items.push({
          modelType: series.modelType,
          shortName: series.shortName,
          color: series.color,
          yieldPct: chosen.yieldPct,
          brierScore: chosen.brierScore,
          pickIndex: chosen.pickIndex,
          matchLabel: chosen.matchLabel,
        });
      }

      setHoverReadout({
        date: hoverDate,
        xPos: margin.left + clampedX,
        containerWidth: chartWidth,
        items,
      });
    };

    const handlePointerLeave = () => {
      focusGroup.style('display', 'none');
      setHoverReadout(null);
    };

    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('mousemove', handlePointerMove)
      .on('touchmove', handlePointerMove)
      .on('mouseleave', handlePointerLeave)
      .on('touchend', handlePointerLeave);
  }, [activeSeries, chartWidth, metricMode, smoothCurve, theme]);

  // Head-to-head delta when exactly 2 models are overlaid
  const headToHeadDelta = useMemo(() => {
    if (activeSeries.length !== 2) return null;
    const [a, b] = activeSeries;
    return {
      first: a,
      second: b,
      yieldDiff: a.latestYield - b.latestYield,
      brierDiff: a.latestBrier - b.latestBrier, // Negative means first model has better (lower) Brier Score
    };
  }, [activeSeries]);

  const tooltipLeftPct = hoverReadout
    ? hoverReadout.xPos > hoverReadout.containerWidth * 0.62
      ? Math.max(12, hoverReadout.xPos - 252)
      : Math.min(hoverReadout.containerWidth - 252, hoverReadout.xPos + 14)
    : 0;

  return (
    <section className="glass-panel glass-panel-hover border border-slate-200 rounded-xl bg-white p-5 space-y-5">
      {/* Header + Metric Mode Switch */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-slate-200 dark:border-white/[0.08]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-900 dark:text-[#ABF43F] shrink-0" />
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
              Superposición Temporal de Modelos (D3 · Yield &amp; Brier Score)
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Contrasta la evolución acumulada de rentabilidad (Yield %) y calibración probabilística (Brier Score, menor = mejor) en{' '}
            <span className="font-medium text-slate-700 dark:text-slate-200">
              {selectedSport === 'all' ? 'todos los deportes' : SPORT_META[selectedSport].name}
            </span>
            .
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Métrica del gráfico D3"
            className="flex items-center gap-1 p-1 rounded-lg bg-slate-100/80 dark:bg-white/[0.04] border border-slate-900/[0.08] dark:border-white/[0.08]"
          >
            {(
              [
                { id: 'yield', label: 'Yield (%)' },
                { id: 'brier', label: 'Brier Score' },
                { id: 'dual', label: 'Dual (Yield + Brier)' },
              ] as Array<{ id: OverlayMetricMode; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMetricMode(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  metricMode === opt.id
                    ? 'bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSmoothCurve((prev) => !prev)}
            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-white/[0.1] bg-white/70 dark:bg-white/[0.04] text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-colors whitespace-nowrap"
          >
            {smoothCurve ? 'Curva suave' : 'Línea exacta'}
          </button>
        </div>
      </div>

      {/* Model Overlay Selector + Quick Presets */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {allSeries.map((s) => {
            const isSelected = selectedModels.includes(s.modelType);
            const hasData = s.totalPicks > 0;
            return (
              <button
                key={s.modelType}
                type="button"
                onClick={() => toggleModel(s.modelType)}
                disabled={!hasData}
                aria-pressed={isSelected}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                  isSelected
                    ? 'border-slate-900/25 dark:border-white/25 bg-slate-900/[0.06] dark:bg-white/[0.09] text-slate-950 dark:text-slate-50'
                    : 'border-slate-200/80 dark:border-white/[0.08] bg-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor: s.color,
                    opacity: isSelected ? 1 : 0.35,
                  }}
                />
                <span>{s.shortName}</span>
                <span className="font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400">
                  ({s.totalPicks})
                </span>
              </button>
            );
          })}
        </div>

        {/* Quick Preset Comparison Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 mr-1">
            <Layers className="h-3 w-3" />
            <span>Comparar:</span>
          </span>
          {QUICK_PRESETS.map((preset) => {
            const isSame =
              preset.models.length === selectedModels.length &&
              preset.models.every((m) => selectedModels.includes(m));
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedModels(preset.models)}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                  isSame
                    ? 'bg-slate-900 text-white dark:bg-[#3FF4E5] dark:text-[#090909]'
                    : 'bg-slate-100/80 dark:bg-white/[0.05] text-slate-600 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* D3 Chart Canvas */}
      <div ref={containerRef} className="relative w-full min-h-[340px]">
        {activeSeries.length === 0 ? (
          <div className="h-[340px] flex flex-col items-center justify-center text-center px-6 rounded-xl border border-dashed border-slate-300 dark:border-white/15">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Sin picks liquidados suficientes para superponer estos modelos
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-md">
              Cambia el filtro de deporte a &ldquo;Vista global&rdquo; o selecciona otros modelos con historial liquidado.
            </p>
            <button
              type="button"
              onClick={() => setSelectedModels(ALL_MODELS)}
              className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-white dark:bg-[#ABF43F] dark:text-[#090909]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Mostrar todos los modelos</span>
            </button>
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              role="img"
              aria-label="Gráfico de líneas D3 superponiendo Yield y Brier Score de modelos predictivos a lo largo del tiempo"
              className="w-full h-[340px] overflow-visible select-none"
            />

            {/* Floating Interactive Glassmorphic Tooltip */}
            {hoverReadout && hoverReadout.items.length > 0 && (
              <div
                className="pointer-events-none absolute top-3 z-20 w-[240px] rounded-xl border border-slate-200 dark:border-white/15 bg-white/95 dark:bg-[#111316]/95 backdrop-blur-md p-3 shadow-xl space-y-2"
                style={{ left: `${tooltipLeftPct}px` }}
              >
                <div className="flex items-center justify-between border-b border-slate-200/80 dark:border-white/10 pb-1.5">
                  <span className="text-[11px] font-semibold text-slate-900 dark:text-slate-100">
                    {formatFullDateEs(hoverReadout.date)}
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                    {metricMode === 'dual'
                      ? 'Yield / Brier'
                      : metricMode === 'brier'
                        ? 'Brier acum.'
                        : 'Yield acum.'}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {hoverReadout.items.map((item) => (
                    <div key={item.modelType} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 truncate">
                          <span
                            className="h-2 w-2 rounded-full shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                          <span className="truncate">{item.shortName}</span>
                        </span>
                        <span className="font-mono tabular-nums text-[11px] font-semibold text-slate-900 dark:text-slate-50 whitespace-nowrap">
                          {metricMode === 'yield' &&
                            `${item.yieldPct >= 0 ? '+' : ''}${item.yieldPct.toFixed(2)}%`}
                          {metricMode === 'brier' && item.brierScore.toFixed(3)}
                          {metricMode === 'dual' &&
                            `${item.yieldPct >= 0 ? '+' : ''}${item.yieldPct.toFixed(1)}% · ${item.brierScore.toFixed(3)}`}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate pl-3.5">
                        Pick #{item.pickIndex} · {item.matchLabel}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Legend + Head-to-Head Summary Bar */}
      {activeSeries.length > 0 && (
        <div className="pt-3 border-t border-slate-200/80 dark:border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {activeSeries.map((s) => (
              <div key={s.modelType} className="inline-flex items-center gap-2">
                <span
                  className="inline-block w-4 h-0.5 rounded-full"
                  style={{ backgroundColor: s.color }}
                />
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {s.shortName}:
                </span>
                <span
                  className={`font-mono tabular-nums font-semibold ${
                    s.latestYield >= 0
                      ? 'text-slate-900 dark:text-[#ABF43F]'
                      : 'text-[#FF3B4B]'
                  }`}
                >
                  {s.latestYield >= 0 ? '+' : ''}
                  {s.latestYield.toFixed(2)}%
                </span>
                <span className="text-slate-400 dark:text-slate-600">·</span>
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                  Brier {s.latestBrier.toFixed(3)}
                </span>
              </div>
            ))}
          </div>

          {headToHeadDelta && (
            <div className="font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300 shrink-0">
              <span>Δ {headToHeadDelta.first.shortName} vs {headToHeadDelta.second.shortName}: </span>
              <span
                className={
                  headToHeadDelta.yieldDiff >= 0
                    ? 'font-semibold text-slate-900 dark:text-[#ABF43F]'
                    : 'font-semibold text-[#FF3B4B]'
                }
              >
                {headToHeadDelta.yieldDiff >= 0 ? '+' : ''}
                {headToHeadDelta.yieldDiff.toFixed(2)} pp Yield
              </span>
              <span className="mx-1.5 text-slate-400 dark:text-slate-600">·</span>
              <span
                className={
                  headToHeadDelta.brierDiff <= 0
                    ? 'font-semibold text-slate-900 dark:text-[#3FF4E5]'
                    : 'font-semibold text-[#FF3B4B]'
                }
              >
                {headToHeadDelta.brierDiff >= 0 ? '+' : ''}
                {headToHeadDelta.brierDiff.toFixed(3)} Brier
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
