import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import {
  BarChart,
  CustomChart,
  HeatmapChart,
  LineChart,
  SankeyChart,
  ScatterChart,
  TreemapChart,
} from 'echarts/charts';
import {
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

// Register only the chart types and components actually used (tree-shaken bundle)
echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  SankeyChart,
  TreemapChart,
  HeatmapChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  VisualMapComponent,
  CalendarComponent,
  MarkLineComponent,
  CanvasRenderer,
]);

export type { EChartsCoreOption };

export interface ChartThemeColors {
  isLight: boolean;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  gridLine: string;
  tooltipBg: string;
  tooltipBorder: string;
  bgSurface: string;
  bgElevated: string;
  borderSubtle: string;
}

export function readChartThemeColors(): ChartThemeColors {
  if (typeof window === 'undefined') {
    return {
      isLight: false,
      textPrimary: '#f4f4f6',
      textSecondary: '#a1a1aa',
      textMuted: '#71717a',
      gridLine: 'rgba(255, 255, 255, 0.06)',
      tooltipBg: '#16161b',
      tooltipBorder: 'rgba(255, 255, 255, 0.12)',
      bgSurface: '#111115',
      bgElevated: '#18181f',
      borderSubtle: 'rgba(255, 255, 255, 0.08)',
    };
  }
  const isLight = document.documentElement.classList.contains('light');
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;

  return {
    isLight,
    textPrimary: get('--text-primary', isLight ? '#09090b' : '#f4f4f6'),
    textSecondary: get('--text-secondary', isLight ? '#52525b' : '#a1a1aa'),
    textMuted: get('--text-muted', isLight ? '#71717a' : '#71717a'),
    gridLine: get('--chart-grid', isLight ? 'rgba(9, 9, 11, 0.07)' : 'rgba(255, 255, 255, 0.06)'),
    tooltipBg: get('--chart-tooltip-bg', isLight ? '#ffffff' : '#16161b'),
    tooltipBorder: get('--chart-tooltip-border', isLight ? 'rgba(9, 9, 11, 0.12)' : 'rgba(255, 255, 255, 0.12)'),
    bgSurface: get('--bg-surface', isLight ? '#ffffff' : '#111115'),
    bgElevated: get('--bg-elevated', isLight ? '#f4f4f5' : '#18181f'),
    borderSubtle: get('--border-subtle', isLight ? 'rgba(9, 9, 11, 0.08)' : 'rgba(255, 255, 255, 0.08)'),
  };
}

/**
 * React hook that stays in sync whenever the user toggles Dark / Light mode.
 */
export function useChartTheme(): ChartThemeColors {
  const [colors, setColors] = useState<ChartThemeColors>(() => readChartThemeColors());

  useEffect(() => {
    const update = () => setColors(readChartThemeColors());
    update();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'class') {
          update();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return colors;
}

export interface EChartProps {
  option: EChartsCoreOption;
  className?: string;
  style?: React.CSSProperties;
  notMerge?: boolean;
  onClick?: (params: unknown) => void;
}

/**
 * Responsive Apache ECharts wrapper with ResizeObserver and automatic cleanup.
 */
export function EChart({
  option,
  className = '',
  style,
  notMerge = false,
  onClick,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const hasRenderedRef = useRef(false);
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    instanceRef.current = chart;
    hasRenderedRef.current = false;

    const handleClick = (params: unknown) => {
      onClickRef.current?.(params);
    };
    chart.on('click', handleClick);

    const resizeObserver = new ResizeObserver(() => {
      chart.resize();
    });
    resizeObserver.observe(el);

    return () => {
      chart.off('click', handleClick);
      resizeObserver.disconnect();
      chart.dispose();
      instanceRef.current = null;
      hasRenderedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const chart = instanceRef.current;
    if (!chart) return;

    if (!hasRenderedRef.current) {
      // First render: animate cleanly into view
      chart.setOption(option, { notMerge: true, lazyUpdate: true });
      hasRenderedRef.current = true;
    } else if (notMerge) {
      chart.setOption(
        { ...option, animation: false },
        { notMerge: true, lazyUpdate: true },
      );
    } else {
      // Subsequent updates: replace series in place without resetting bars to 0 or losing dataZoom
      chart.setOption(
        { ...option, animationDuration: 0, animationDurationUpdate: 180 },
        { notMerge: false, replaceMerge: ['series'], lazyUpdate: true },
      );
    }
  }, [option, notMerge]);

  return <div ref={containerRef} className={className} style={{ width: '100%', height: '100%', ...style }} />;
}
