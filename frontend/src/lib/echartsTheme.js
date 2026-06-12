import echarts from './echarts'

/* Chart palette — mirrors the `--color-chart-*` / surface tokens in index.css so
   charts and UI share exact colors. Keep these hexes in sync with @theme. */
export const CHART = {
  net: '#4f8cff',
  assets: '#3fb950',
  debts: '#f85149',
  accent2: '#a371f7',
  grid: '#1f2630',
  axis: '#6e7b8a',
  surface: '#161b22',
  surfaceRaised: '#1d242e',
  border: '#283039',
  text: '#e6edf3',
  textMuted: '#9aa7b4',
}

export const THEME_NAME = 'claudeFinance'

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

let registered = false

/** Register the dark ECharts theme once; returns the theme name for echarts.init. */
export function ensureChartTheme() {
  if (registered) return THEME_NAME

  const axisCommon = {
    axisLine: { lineStyle: { color: CHART.border } },
    axisTick: { show: false },
    axisLabel: { color: CHART.axis, fontFamily: FONT, fontSize: 11 },
    splitLine: { lineStyle: { color: CHART.grid, type: 'dashed' } },
  }

  echarts.registerTheme(THEME_NAME, {
    color: [CHART.net, CHART.assets, CHART.debts, CHART.accent2],
    backgroundColor: 'transparent',
    textStyle: { color: CHART.textMuted, fontFamily: FONT },
    title: { textStyle: { color: CHART.text, fontFamily: FONT } },
    legend: {
      textStyle: { color: CHART.textMuted, fontFamily: FONT },
      inactiveColor: CHART.border,
    },
    grid: { borderColor: CHART.border },
    categoryAxis: axisCommon,
    valueAxis: axisCommon,
    timeAxis: axisCommon,
    tooltip: {
      backgroundColor: CHART.surfaceRaised,
      borderColor: CHART.border,
      borderWidth: 1,
      textStyle: { color: CHART.text, fontFamily: FONT, fontSize: 12 },
      extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,0.45);',
    },
    dataZoom: [{
      borderColor: CHART.border,
      fillerColor: 'rgba(79,140,255,0.12)',
      handleStyle: { color: CHART.surfaceRaised, borderColor: CHART.axis },
      moveHandleStyle: { color: CHART.border },
      textStyle: { color: CHART.axis },
      dataBackground: {
        lineStyle: { color: CHART.border },
        areaStyle: { color: CHART.grid },
      },
      selectedDataBackground: {
        lineStyle: { color: CHART.net },
        areaStyle: { color: 'rgba(79,140,255,0.15)' },
      },
    }],
  })

  registered = true
  return THEME_NAME
}

/** A vertical gradient fill for area series (top -> transparent). Returned as a
 *  plain gradient object so the tree-shaken core needs no `echarts.graphic`. */
export function areaGradient(hex, topOpacity = 0.35) {
  return {
    type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
    colorStops: [
      { offset: 0, color: hexToRgba(hex, topOpacity) },
      { offset: 1, color: hexToRgba(hex, 0) },
    ],
  }
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
