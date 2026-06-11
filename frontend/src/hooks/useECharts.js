import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import { ensureChartTheme } from '../lib/echartsTheme'

/**
 * Owns an ECharts instance bound to a DOM node: init with the shared dark theme,
 * resize via ResizeObserver, re-apply options on change, dispose on unmount.
 *
 * Returns [containerRef, chartRef]. Attach containerRef to a sized <div>; reach
 * the live instance through chartRef.current when you need imperative access.
 */
export default function useECharts(option) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const theme = ensureChartTheme()
    const chart = echarts.init(el, theme, { renderer: 'canvas' })
    chartRef.current = chart

    const ro = new ResizeObserver(() => chart.resize())
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    if (chartRef.current && option) {
      chartRef.current.setOption(option, { notMerge: true })
    }
  }, [option])

  return [containerRef, chartRef]
}
