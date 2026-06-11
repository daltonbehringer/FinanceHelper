import { useMemo, useState } from 'react'
import useECharts from '../../hooks/useECharts'
import { CHART, areaGradient } from '../../lib/echartsTheme'
import { formatMoney, compactMoney, subtractMonths, formatDate } from '../../lib/utils'
import Card, { CardBody } from '../ui/Card'
import Spinner from '../ui/Spinner'
import EmptyState from '../ui/EmptyState'

// Simpler than History's NetWorthChart: net-worth only, no dataZoom slider, no
// series toggle — History stays the deep-dive surface (handoff spec WS1).
const PRESETS = [
  { key: '3M', months: 3 },
  { key: '1Y', months: 12 },
  { key: 'All', months: null },
]

export default function NetWorthHero({ series, loading }) {
  const [range, setRange] = useState('3M')

  // Current net worth + this-month delta from the (ascending) series.
  const { current, delta } = useMemo(() => {
    if (!series.length) return { current: null, delta: null }
    const last = series[series.length - 1]
    const monthAgo = subtractMonths(last.date, 1)
    // Latest point at or before one month ago; fall back to the first point.
    let prior = series[0]
    for (const p of series) {
      if (p.date <= monthAgo) prior = p
      else break
    }
    return { current: last.net, delta: last.net - prior.net }
  }, [series])

  const option = useMemo(() => {
    if (!series.length) return null
    const preset = PRESETS.find(p => p.key === range)
    const lastDate = series[series.length - 1].date
    const startDate = preset?.months ? subtractMonths(lastDate, preset.months) : series[0].date
    const data = series
      .filter(p => p.date >= startDate)
      .map(p => [p.date, p.net])

    return {
      grid: { left: 4, right: 12, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'line',
          label: {
            backgroundColor: CHART.surfaceRaised,
            formatter: (p) => (p.axisDimension === 'y' ? compactMoney(p.value) : ''),
          },
        },
        formatter: (params) => {
          const p = params[0]
          return `<div style="font-size:11px;color:${CHART.textMuted};margin-bottom:2px">${formatDate(p.data[0])}</div>`
            + `<div style="font-weight:600">${formatMoney(p.data[1])}</div>`
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
      series: [{
        name: 'Net worth',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: false,
        data,
        lineStyle: { width: 2.5, color: CHART.net },
        itemStyle: { color: CHART.net },
        areaStyle: { color: areaGradient(CHART.net) },
      }],
    }
  }, [series, range])

  const [ref] = useECharts(option)
  const deltaUp = delta != null && delta >= 0

  return (
    <Card>
      <CardBody>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle mb-1">
              Net worth
            </p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-text tnum">
                {current == null ? '—' : formatMoney(current)}
              </span>
              {delta != null && delta !== 0 && (
                <span className={`text-sm font-semibold tnum ${deltaUp ? 'text-credit' : 'text-debit'}`}>
                  {deltaUp ? '▲' : '▼'} {formatMoney(Math.abs(delta))}
                  <span className="text-text-subtle font-normal"> this month</span>
                </span>
              )}
            </div>
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

        {loading ? (
          <div className="flex items-center justify-center h-52">
            <Spinner size="lg" className="text-accent" />
          </div>
        ) : series.length ? (
          <div ref={ref} className="h-52 w-full" />
        ) : (
          <EmptyState
            title="No history yet"
            description="Net worth appears once you record balances over time."
          />
        )}
      </CardBody>
    </Card>
  )
}
