import { useMemo } from 'react'
import useECharts from '../../hooks/useECharts'
import { CHART, areaGradient } from '../../lib/echartsTheme'
import { formatMoney, compactMoney, formatDate } from '../../lib/utils'

/** Stacked-area assets-vs-debts composition over time. */
export default function CompositionChart({ series }) {
  const option = useMemo(() => {
    if (!series.length) return null
    const dates = series.map(p => p.date)
    return {
      grid: { left: 8, right: 16, top: 16, bottom: 28, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        formatter: (params) => {
          const date = params[0]?.axisValue
          const rows = params.map(p =>
            `<div style="display:flex;justify-content:space-between;gap:12px">
               <span>${p.marker}${p.seriesName}</span>
               <span style="font-weight:600">${formatMoney(p.data)}</span>
             </div>`).join('')
          return `<div style="font-size:11px;color:${CHART.textMuted};margin-bottom:4px">${formatDate(date)}</div>${rows}`
        },
      },
      legend: { data: ['Assets', 'Debts'], bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: dates,
        axisLabel: { formatter: (v) => formatDate(v).replace(/, \d{4}$/, '') },
      },
      yAxis: { type: 'value', axisLabel: { formatter: (v) => compactMoney(v) } },
      series: [
        {
          name: 'Assets', type: 'line', stack: 'total', smooth: true, showSymbol: false,
          data: series.map(p => p.assets),
          lineStyle: { width: 1.5, color: CHART.assets },
          itemStyle: { color: CHART.assets },
          areaStyle: { color: areaGradient(CHART.assets, 0.45) },
        },
        {
          name: 'Debts', type: 'line', stack: 'total', smooth: true, showSymbol: false,
          data: series.map(p => p.debts),
          lineStyle: { width: 1.5, color: CHART.debts },
          itemStyle: { color: CHART.debts },
          areaStyle: { color: areaGradient(CHART.debts, 0.45) },
        },
      ],
    }
  }, [series])

  const [ref] = useECharts(option)
  return <div ref={ref} className="h-60 w-full" />
}
