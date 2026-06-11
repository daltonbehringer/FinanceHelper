import { useMemo, useState } from 'react'
import useECharts from '../../hooks/useECharts'
import { CHART, areaGradient } from '../../lib/echartsTheme'
import { formatMoney, compactMoney, subtractMonths, formatDate } from '../../lib/utils'

const SERIES = [
  { key: 'net', label: 'Net worth', color: CHART.net },
  { key: 'assets', label: 'Assets', color: CHART.assets },
  { key: 'debts', label: 'Debts', color: CHART.debts },
]
const PRESETS = [
  { key: '1M', months: 1 },
  { key: '3M', months: 3 },
  { key: '1Y', months: 12 },
  { key: 'All', months: null },
]

export default function NetWorthChart({ series }) {
  const [active, setActive] = useState('net')
  const [range, setRange] = useState('All')

  const meta = SERIES.find(s => s.key === active)

  const option = useMemo(() => {
    if (!series.length) return null
    const data = series.map(p => [p.date, p[active]])
    const lastDate = series[series.length - 1].date
    const preset = PRESETS.find(p => p.key === range)
    const startValue = preset?.months
      ? subtractMonths(lastDate, preset.months)
      : series[0].date

    return {
      grid: { left: 8, right: 16, top: 16, bottom: 56, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: {
            backgroundColor: CHART.surfaceRaised,
            formatter: (p) => (p.axisDimension === 'y' ? compactMoney(p.value) : ''),
          },
        },
        formatter: (params) => {
          const p = params[0]
          return `<div style="font-size:11px;color:${CHART.textMuted};margin-bottom:2px">${formatDate(p.data[0])}</div>`
            + `<div style="font-weight:600">${meta.label}: ${formatMoney(p.data[1])}</div>`
        },
      },
      xAxis: {
        type: 'time',
        boundaryGap: false,
        axisLabel: { formatter: '{MMM} {d}' },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLabel: { formatter: (v) => compactMoney(v) },
      },
      dataZoom: [
        { type: 'inside', startValue, endValue: lastDate, zoomOnMouseWheel: false },
        { type: 'slider', startValue, endValue: lastDate, height: 22, bottom: 12 },
      ],
      series: [{
        name: meta.label,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: false,
        data,
        lineStyle: { width: 2.5, color: meta.color },
        itemStyle: { color: meta.color },
        areaStyle: { color: areaGradient(meta.color) },
      }],
    }
  }, [series, active, range, meta])

  const [ref] = useECharts(option)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="inline-flex rounded-lg bg-surface-sunken p-0.5 border border-border">
          {SERIES.map(s => (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                active === s.key ? 'bg-surface-raised text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full mr-1.5 align-middle"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg bg-surface-sunken p-0.5 border border-border">
          {PRESETS.map(p => (
            <button
              key={p.key}
              onClick={() => setRange(p.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                range === p.key ? 'bg-surface-raised text-text' : 'text-text-muted hover:text-text'
              }`}
            >
              {p.key}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="h-72 sm:h-80 w-full" />
    </div>
  )
}
