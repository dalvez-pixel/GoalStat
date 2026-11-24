import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SPORT_META } from '../types/quant.ts';
import type { BankrollConfig, BetRecord, SportId } from '../types/quant.ts';

export interface MonthlyReportOptions {
  monthKey: string; // 'YYYY-MM' or 'all'
  monthLabel: string;
  sportFilter: SportId | 'all';
  bets: BetRecord[];
  bankrollConfig: BankrollConfig;
  currentBankroll: number;
  notes?: string;
}

export function exportMonthlyPdfReport(options: MonthlyReportOptions): void {
  const { monthLabel, sportFilter, bets, bankrollConfig, currentBankroll, notes } = options;
  const currencySymbol = bankrollConfig.currency === 'USD' ? '$' : '€';

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const settled = bets.filter((b) => b.status === 'won' || b.status === 'lost');
  const won = settled.filter((b) => b.status === 'won');
  const totalStaked = settled.reduce((acc, b) => acc + b.stake, 0);
  const netPnl = settled.reduce((acc, b) => acc + b.pnl, 0);
  const yieldPct = totalStaked > 0 ? (netPnl / totalStaked) * 100 : 0;
  const winRate = settled.length > 0 ? (won.length / settled.length) * 100 : 0;
  const avgEv = bets.length > 0 ? (bets.reduce((acc, b) => acc + b.ev, 0) / bets.length) * 100 : 0;
  const avgClv =
    settled.length > 0
      ? (settled.reduce((acc, b) => acc + (b.odds / b.closingOdds - 1), 0) / settled.length) * 100
      : 0;

  // Header band
  doc.setFillColor(11, 17, 30);
  doc.rect(0, 0, 210, 34, 'F');

  doc.setTextColor(248, 250, 252);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('LambdaQuant', 14, 15);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(148, 163, 184);
  doc.text('Reporte Mensual de Rendimiento Cuantitativo · Totales de Goles', 14, 22);

  const sportTitle = sportFilter === 'all' ? 'Todos los deportes' : SPORT_META[sportFilter].name;
  doc.text(`Periodo: ${monthLabel}  |  Filtro: ${sportTitle}`, 14, 28);

  const issuedDate = new Date().toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  doc.setFontSize(9);
  doc.text(`Emitido: ${issuedDate}`, 196, 15, { align: 'right' });

  // Executive KPI Summary Grid
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('1. Resumen Ejecutivo', 14, 44);

  const kpis = [
    { label: 'Beneficio Neto', value: `${netPnl >= 0 ? '+' : ''}${currencySymbol}${netPnl.toFixed(2)}` },
    { label: 'Yield / ROI', value: `${yieldPct >= 0 ? '+' : ''}${yieldPct.toFixed(2)}%` },
    { label: 'Tasa de Acierto', value: `${winRate.toFixed(1)}% (${won.length}/${settled.length})` },
    { label: 'EV Promedio / CLV', value: `+${avgEv.toFixed(2)}% / ${avgClv >= 0 ? '+' : ''}${avgClv.toFixed(2)}%` },
    { label: 'Volumen Apostado', value: `${currencySymbol}${totalStaked.toFixed(2)}` },
    { label: 'Bankroll Actual', value: `${currencySymbol}${currentBankroll.toFixed(2)}` },
  ];

  let kpiX = 14;
  let kpiY = 48;
  const boxW = 58;
  const boxH = 16;

  kpis.forEach((kpi, idx) => {
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(kpiX, kpiY, boxW, boxH, 1.5, 1.5, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, kpiX + 3, kpiY + 5.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.value, kpiX + 3, kpiY + 12.2);

    if ((idx + 1) % 3 === 0) {
      kpiX = 14;
      kpiY += boxH + 3.5;
    } else {
      kpiX += boxW + 4;
    }
  });

  let currentY = kpiY + 6;

  // Optional executive note
  if (notes && notes.trim().length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Notas del Analista', 14, currentY);
    currentY += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    const wrapped = doc.splitTextToSize(notes.trim(), 182);
    doc.text(wrapped, 14, currentY);
    currentY += wrapped.length * 4.5 + 5;
  }

  // Sport breakdown table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('2. Desglose por Deporte', 14, currentY);
  currentY += 3;

  const sportIds: SportId[] = ['soccer', 'nba', 'nhl', 'football'];
  const sportRows = sportIds
    .map((sid) => {
      const sBets = settled.filter((b) => b.sport === sid);
      if (sBets.length === 0) return null;
      const sWon = sBets.filter((b) => b.status === 'won').length;
      const sStaked = sBets.reduce((a, b) => a + b.stake, 0);
      const sPnl = sBets.reduce((a, b) => a + b.pnl, 0);
      const sYield = sStaked > 0 ? (sPnl / sStaked) * 100 : 0;
      const sEv = (sBets.reduce((a, b) => a + b.ev, 0) / sBets.length) * 100;
      return [
        SPORT_META[sid].name,
        String(sBets.length),
        `${((sWon / sBets.length) * 100).toFixed(1)}%`,
        `${currencySymbol}${sStaked.toFixed(2)}`,
        `${sPnl >= 0 ? '+' : ''}${currencySymbol}${sPnl.toFixed(2)}`,
        `${sYield >= 0 ? '+' : ''}${sYield.toFixed(2)}%`,
        `+${sEv.toFixed(2)}%`,
      ];
    })
    .filter((r): r is string[] => r !== null);

  autoTable(doc, {
    startY: currentY + 1,
    head: [['Deporte', 'Picks', 'Acierto', 'Apostado', 'P&L Neto', 'Yield', 'EV Medio']],
    body: sportRows.length > 0 ? sportRows : [['Sin operaciones liquidadas', '-', '-', '-', '-', '-', '-']],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8.5, textColor: [30, 41, 59] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right', fontStyle: 'bold' },
      5: { halign: 'right' },
      6: { halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afterSportY = (doc as any).lastAutoTable?.finalY ?? currentY + 25;

  // Detailed ledger table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('3. Registro Detallado de Operaciones', 14, afterSportY + 10);

  const ledgerRows = bets.map((b) => {
    const d = new Date(b.date).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
    const sideLabel =
      b.marketLabel ?? (b.side === 'over' ? `Más ${b.line}` : `Menos ${b.line}`);
    const statusLabel =
      b.status === 'won'
        ? 'Ganada'
        : b.status === 'lost'
          ? 'Perdida'
          : b.status === 'void'
            ? 'Nula'
            : 'Pendiente';
    return [
      d,
      SPORT_META[b.sport].shortName,
      b.matchLabel,
      sideLabel,
      b.odds.toFixed(2),
      `${(b.modelProb * 100).toFixed(1)}%`,
      `+${(b.ev * 100).toFixed(1)}%`,
      `${currencySymbol}${b.stake.toFixed(2)}`,
      statusLabel,
      b.status === 'pending'
        ? '-'
        : `${b.pnl >= 0 ? '+' : ''}${currencySymbol}${b.pnl.toFixed(2)}`,
    ];
  });

  autoTable(doc, {
    startY: afterSportY + 14,
    head: [['Fecha', 'Deporte', 'Partido', 'Mercado', 'Cuota', 'P.Mod', '+EV', 'Stake', 'Estado', 'P&L']],
    body: ledgerRows.length > 0 ? ledgerRows : [['-', '-', 'Sin apuestas en este periodo', '-', '-', '-', '-', '-', '-', '-']],
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 7.5, textColor: [30, 41, 59] },
    columnStyles: {
      2: { cellWidth: 44 },
      4: { halign: 'right' },
      5: { halign: 'right' },
      6: { halign: 'right' },
      7: { halign: 'right' },
      9: { halign: 'right', fontStyle: 'bold' },
    },
    margin: { left: 14, right: 14 },
  });

  // Footer with page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `LambdaQuant · Gestión cuantitativa de bankroll (${bankrollConfig.strategy})`,
      14,
      290
    );
    doc.text(`Página ${i} de ${pageCount}`, 196, 290, { align: 'right' });
  }

  const safeSlug = options.monthKey.replace(/[^a-zA-Z0-9_-]/g, '');
  doc.save(`LambdaQuant_Reporte_${safeSlug}.pdf`);
}
