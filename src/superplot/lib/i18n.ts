import type { DetrendMode, WindowKind } from '../types.ts'

export type SuperPlotLanguage = 'zh-CN' | 'en' | 'ja-JP'

export interface SuperPlotCopy {
  branding: string
  title: string
  subtitle: string
  back: string
  waveformTab: string
  spectrumTab: string
  timeDomain: string
  frequencyDomain: string
  dropTitle: string
  dropHint: string
  chooseFile: string
  replaceFile: string
  parsing: (percent: string, rows: string) => string
  parseFailed: string
  noDatasets: string
  rowsLabel: string
  sizeLabel: string
  rateLabel: string
  timeColumnLabel: string
  columnsLabel: string
  activeDataset: string
  waveform: {
    title: string
    xAxis: string
    series: string
    addSeries: string
    removeSeries: string
    downsample: string
    auto: string
    envelope: string
    lttb: string
    none: string
    targetPoints: string
    resetZoom: string
    exportPng: string
    statsTitle: string
    openSpectrum: string
  }
  stats: {
    samples: string
    min: string
    max: string
    mean: string
    rms: string
    peakToPeak: string
    std: string
  }
  spectrum: {
    title: string
    signal: string
    sampleRate: string
    auto: string
    advanced: string
    manual: string
    window: string
    detrend: string
    fftSize: string
    segments: string
    overlap: string
    normalize: string
    amplitude: string
    linear: string
    decibels: string
    logFrequency: string
    peakTable: string
    frequency: string
    magnitude: string
    relative: string
    noSignal: string
    summary: (fftSize: string, binWidth: string, segments: number) => string
    removed: (mean: string, slope: string) => string
  }
  windows: Record<WindowKind, string>
  detrends: Record<DetrendMode, string>
}

const zhCN: SuperPlotCopy = {
  branding: 'super-plot',
  title: 'super-plot 大数波形与频谱实验台',
  subtitle: '列式类型化数组 + 流式解析，百万行级别波形也能流畅缩放；内置独立 FFT 频谱面板。',
  back: '返回工作台',
  waveformTab: '波形',
  spectrumTab: '频谱',
  timeDomain: '时域',
  frequencyDomain: '频域',
  dropTitle: '把 CSV 拖到这里，或点击选择文件',
  dropHint: '支持百万行级别的数值 CSV，本地解析，不上传。',
  chooseFile: '选择文件',
  replaceFile: '追加文件',
  parsing: (percent, rows) => `解析中 ${percent} · ${rows} 行`,
  parseFailed: '解析失败，请确认文件是带表头的 CSV。',
  noDatasets: '还没有数据，先导入一个 CSV。',
  rowsLabel: '行数',
  sizeLabel: '大小',
  rateLabel: '采样率',
  timeColumnLabel: '时间列',
  columnsLabel: '数值列',
  activeDataset: '当前数据集',
  waveform: {
    title: '波形',
    xAxis: 'X 轴',
    series: '信号',
    addSeries: '添加信号',
    removeSeries: '移除',
    downsample: '抽稀',
    auto: '自动（极值包络）',
    envelope: '极值包络',
    lttb: 'LTTB',
    none: '不抽稀',
    targetPoints: '目标点数',
    resetZoom: '重置缩放',
    exportPng: '导出 PNG',
    statsTitle: '统计',
    openSpectrum: '同步到频谱',
  },
  stats: {
    samples: '样本数',
    min: '最小值',
    max: '最大值',
    mean: '均值',
    rms: 'RMS',
    peakToPeak: '峰峰值',
    std: '标准差',
  },
  spectrum: {
    title: '频谱（FFT）',
    signal: '信号列',
    sampleRate: '采样率 (Hz)',
    auto: '自动',
    advanced: '高级设置',
    manual: '手动',
    window: '窗函数',
    detrend: '去趋势',
    fftSize: 'FFT 长度',
    segments: 'Welch 段数',
    overlap: '重叠',
    normalize: '幅度归一化',
    amplitude: '幅度',
    linear: '线性',
    decibels: 'dB',
    logFrequency: '对数频率轴',
    peakTable: '峰值',
    frequency: '频率',
    magnitude: '幅度',
    relative: '相对',
    noSignal: '请选择一个数值信号列。',
    summary: (fftSize, binWidth, segments) => `FFT ${fftSize} · 频率分辨率 ${binWidth} · ${segments} 段平均`,
    removed: (mean, slope) => `已去除均值 ${mean}，线性趋势 ${slope}/样本`,
  },
  windows: {
    hann: 'Hann',
    hamming: 'Hamming',
    blackman: 'Blackman',
    flattop: 'Flat-top',
    rectangular: '矩形',
  },
  detrends: {
    none: '不去趋势',
    mean: '去均值',
    linear: '去线性趋势',
  },
}

const en: SuperPlotCopy = {
  branding: 'super-plot',
  title: 'super-plot large-data waveform & spectrum lab',
  subtitle: 'Columnar typed arrays plus streaming parse make million-row waveforms smooth; includes a standalone FFT spectrum panel.',
  back: 'Back to workbench',
  waveformTab: 'Waveform',
  spectrumTab: 'Spectrum',
  timeDomain: 'Time domain',
  frequencyDomain: 'Frequency domain',
  dropTitle: 'Drop a CSV here, or click to choose a file',
  dropHint: 'Handles million-row numeric CSVs. Parsed locally, never uploaded.',
  chooseFile: 'Choose file',
  replaceFile: 'Add file',
  parsing: (percent, rows) => `Parsing ${percent} · ${rows} rows`,
  parseFailed: 'Parse failed. Make sure the file is a CSV with a header row.',
  noDatasets: 'No data yet — import a CSV to begin.',
  rowsLabel: 'Rows',
  sizeLabel: 'Size',
  rateLabel: 'Sample rate',
  timeColumnLabel: 'Time column',
  columnsLabel: 'Numeric columns',
  activeDataset: 'Active dataset',
  waveform: {
    title: 'Waveform',
    xAxis: 'X axis',
    series: 'Signals',
    addSeries: 'Add signal',
    removeSeries: 'Remove',
    downsample: 'Downsample',
    auto: 'Auto (min/max envelope)',
    envelope: 'Min/max envelope',
    lttb: 'LTTB',
    none: 'None',
    targetPoints: 'Target points',
    resetZoom: 'Reset zoom',
    exportPng: 'Export PNG',
    statsTitle: 'Statistics',
    openSpectrum: 'Sync to spectrum',
  },
  stats: {
    samples: 'Samples',
    min: 'Min',
    max: 'Max',
    mean: 'Mean',
    rms: 'RMS',
    peakToPeak: 'Peak-to-peak',
    std: 'Std dev',
  },
  spectrum: {
    title: 'Spectrum (FFT)',
    signal: 'Signal column',
    sampleRate: 'Sample rate (Hz)',
    auto: 'Auto',
    advanced: 'Advanced settings',
    manual: 'Manual',
    window: 'Window',
    detrend: 'Detrend',
    fftSize: 'FFT size',
    segments: 'Welch segments',
    overlap: 'Overlap',
    normalize: 'Amplitude normalize',
    amplitude: 'Amplitude',
    linear: 'Linear',
    decibels: 'dB',
    logFrequency: 'Log frequency axis',
    peakTable: 'Peaks',
    frequency: 'Frequency',
    magnitude: 'Magnitude',
    relative: 'Relative',
    noSignal: 'Select a numeric signal column.',
    summary: (fftSize, binWidth, segments) => `FFT ${fftSize} · Δf ${binWidth} · ${segments} segment avg`,
    removed: (mean, slope) => `Removed mean ${mean}, linear trend ${slope}/sample`,
  },
  windows: {
    hann: 'Hann',
    hamming: 'Hamming',
    blackman: 'Blackman',
    flattop: 'Flat-top',
    rectangular: 'Rectangular',
  },
  detrends: {
    none: 'None',
    mean: 'Remove mean',
    linear: 'Remove linear trend',
  },
}

export function createSuperPlotCopy(language: SuperPlotLanguage): SuperPlotCopy {
  return language === 'zh-CN' ? zhCN : en
}

export function resolveSuperPlotLanguage(routeLanguage: string): SuperPlotLanguage {
  if (routeLanguage.startsWith('zh')) {
    return 'zh-CN'
  }
  if (routeLanguage.startsWith('ja')) {
    return 'ja-JP'
  }
  return 'en'
}
