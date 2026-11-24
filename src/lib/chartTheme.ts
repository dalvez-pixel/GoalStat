import type React from 'react';

export interface AdaptiveChartTheme {
  gridStroke: string;
  axisTickFill: string;
  legendStyle: React.CSSProperties;
  tooltipContentStyle: React.CSSProperties;
  tooltipLabelStyle: React.CSSProperties;
  tooltipItemStyle: React.CSSProperties;
  cursorFill: string;
  referenceLineStroke: string;
  areaRealStroke: string;
  areaExpectedStroke: string;
  areaGradientTopOpacity: number;
}

export function getChartTheme(theme: 'dark' | 'light'): AdaptiveChartTheme {
  if (theme === 'light') {
    return {
      gridStroke: 'rgba(15, 23, 42, 0.09)',
      axisTickFill: '#475569',
      legendStyle: { fontSize: '12px', color: '#334155' },
      tooltipContentStyle: {
        backgroundColor: 'rgba(255, 255, 255, 0.88)',
        border: '1px solid rgba(15, 23, 42, 0.1)',
        borderRadius: '10px',
        color: '#0F172A',
        fontSize: '12px',
        backdropFilter: 'blur(14px)',
        boxShadow: '0 12px 28px -6px rgba(15, 23, 42, 0.14)',
      },
      tooltipLabelStyle: {
        color: '#0F172A',
        fontWeight: 600,
        marginBottom: '2px',
      },
      tooltipItemStyle: {
        color: '#334155',
      },
      cursorFill: 'rgba(15, 23, 42, 0.05)',
      referenceLineStroke: '#0F172A',
      areaRealStroke: '#ABF43F',
      areaExpectedStroke: '#3FF4E5',
      areaGradientTopOpacity: 0.45,
    };
  }

  return {
    gridStroke: 'rgba(148, 163, 184, 0.18)',
    axisTickFill: '#94A3B8',
    legendStyle: { fontSize: '12px', color: '#CBD5E1' },
    tooltipContentStyle: {
      backgroundColor: 'rgba(12, 12, 14, 0.92)',
      border: '1px solid rgba(255, 255, 255, 0.12)',
      borderRadius: '10px',
      color: '#F8FAFC',
      fontSize: '12px',
      backdropFilter: 'blur(14px)',
      boxShadow: '0 16px 32px -8px rgba(0, 0, 0, 0.72)',
    },
    tooltipLabelStyle: {
      color: '#F8FAFC',
      fontWeight: 600,
      marginBottom: '2px',
    },
    tooltipItemStyle: {
      color: '#E2E8F0',
    },
    cursorFill: 'rgba(255, 255, 255, 0.05)',
    referenceLineStroke: '#3FF4E5',
    areaRealStroke: '#ABF43F',
    areaExpectedStroke: '#3FF4E5',
    areaGradientTopOpacity: 0.32,
  };
}
