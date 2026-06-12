// Tree-shaken ECharts: register only the chart/components/renderer the History
// and Dashboard surfaces use, instead of pulling the full `echarts` bundle.
//
// Used: LineChart (net-worth + composition, incl. stacked area), grid, tooltip
// + axis pointer (crosshair), dataZoom (History hero slider/inside), legend
// (composition), canvas renderer. Area gradients use plain gradient objects
// (see lib/echartsTheme.js), so `echarts.graphic` is not needed.
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  LegendComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  DataZoomComponent,
  LegendComponent,
  CanvasRenderer,
])

export default echarts
