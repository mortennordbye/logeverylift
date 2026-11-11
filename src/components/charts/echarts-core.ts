// ECharts with only the parts the Garmin charts use. Imported dynamically by
// EChart.tsx, so it is its own chunk and never in a page's first load.
import { BarChart, CustomChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  AriaComponent,
  AxisPointerComponent,
  CalendarComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  HeatmapChart,
  CustomChart,
  GridComponent,
  TooltipComponent,
  AxisPointerComponent,
  LegendComponent,
  MarkLineComponent,
  MarkAreaComponent,
  VisualMapComponent,
  CalendarComponent,
  AriaComponent,
  CanvasRenderer,
]);

export { echarts };
