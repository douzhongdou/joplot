// Shared chart hover-tooltip styling. Single source of truth so every Plotly
// chart (data workbench, function studio, science, super-plot) renders the same
// label. Plotly's own default is a hairlined box, which reads as "transparent"
// on a white plot: keep an opaque background, a visible border (the chart
// background is white, so `--border` alone disappears) and dark, legible text.
export const CHART_HOVERLABEL = {
  bgcolor: '#ffffff',
  bordercolor: '#d4d4d8',
  font: { color: '#111827', size: 12 },
}
