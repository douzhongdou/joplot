export type ScienceLanguage = 'zh-CN' | 'en' | 'ja-JP'

export interface ScienceCopy {
  workspace: string
  loadSample: string
  derived: string
  importData: string
  dropFiles: string
  dropFilesHint: string
  openFile: string
  orDivider: string
  importing: string
  restoring: string
  xColumn: string
  yColumn: string
  yColumns: string
  groupColumn: string
  groupNone: string
  removeDataset: string
  rowIndex: string
  exportCsv: string
  exportShort: string
  rawData: string
  viewData: string
  exportRawCsv: string
  loadingData: string
  emptyData: string
  runActions: string
  noNumeric: string
  storageError: string
  variables: string
  waveModeLine: string
  waveModeMarkers: string
  waveModeBoth: string
  empty: string
  analysis: string
  addStep: string
  insertBefore: string
  insertAfter: string
  run: string
  running: string
  cancel: string
  dirty: string
  ready: string
  lastRun: string
  runAll: string
  runToHere: string
  auto: string
  input: string
  secondInput: string
  remove: string
  stepMenu: string
  results: string
  noResult: string
  error: string
  operators: Record<string, string>
  categories: Record<string, string>
  labels: Record<string, string>
  kinds: Record<string, string>
  view: {
    /** 视图切换控件的分组无障碍标签。 */
    label: string
    plot: string
    table: string
  }
  plot: {
    timeDomain: string
    dataDomain: string
    frequencyDomain: string
    residual: string
    fit: string
    data: string
    peak: string
    magnitude: string
    magnitudeDb: string
    spectrumScale: string
    dbScale: string
    linearScale: string
    frequencyScale: string
    logFrequency: string
    linearFrequency: string
    dcHiddenOnLogFrequency: string
    phase: string
    phaseUnavailable: string
    /** 图表右下角高度拖拽手柄的无障碍标签。 */
    resizePlot: string
  }
  fit: {
    rSquared: string
    rmse: string
    iterations: string
    converged: string
    yes: string
    no: string
    params: string
    stopReason: string
    /** stopReason → 本地化标签（converged / maxIterations / stalled）。 */
    reasons: Record<string, string>
  }
  stats: Record<string, string>
}

const ZH_LABELS: Record<string, string> = {
  method: '方法',
  window: '窗口',
  order: '阶数',
  mode: '方式',
  windowFn: '窗函数',
  detrend: '去趋势',
  segments: 'Welch 段数',
  model: '模型',
  expr: '表达式 y(x, 参数)',
  initial: '初值（逗号分隔，可留空）',
  formula: '表达式 f(x, y, 参数)',
  exprHint: '可用 x、y、pi/e 与 sin、exp 等函数；其它字母自动成为参数',
  function: '函数',
  a: '系数 a',
  b: '系数 b',
  min: '下限',
  max: '上限',
  stat: '统计量',
  sigma: 'σ（标准差）',
  kind: '窗函数',
  savgol: 'Savitzky-Golay',
  moving: '移动平均',
  none: '不去趋势',
  mean: '去均值',
  linear: '去线性趋势',
  zscore: 'Z 标准化',
  minmax: 'Min-Max',
  peak: '峰值归一化',
  std: '标准差',
  rms: 'RMS',
  median: '中位数',
  abs: '绝对值',
  sqrt: '平方根',
  square: '平方',
  ln: '自然对数 ln',
  log10: '常用对数 log10',
  exp: '指数 exp',
  negate: '取负',
  reciprocal: '倒数',
  hann: 'Hann',
  hamming: 'Hamming',
  blackman: 'Blackman',
  flattop: 'Flat-top',
  rectangular: '矩形',
  'model.linear': '线性 a·x+b',
  'model.quadratic': '二次 a·x²+b·x+c',
  'model.cubic': '三次',
  'model.exponential': '指数 a·exp(b·x)+c',
  'model.power': '幂律 a·x^b+c',
  'model.log': '对数 a·ln(x)+b',
  'model.logistic': 'Logistic a/(1+exp(-b(x-c)))+d',
  'model.gaussian': '高斯',
  'model.lorentzian': 'Lorentzian',
  'model.damped': '阻尼振荡',
  'model.custom': '自定义',
}

const EN_LABELS: Record<string, string> = {
  method: 'Method',
  window: 'Window',
  order: 'Order',
  mode: 'Mode',
  windowFn: 'Window',
  detrend: 'Detrend',
  segments: 'Welch segments',
  model: 'Model',
  expr: 'Expression y(x, params)',
  initial: 'Initial (comma separated, optional)',
  formula: 'Expression f(x, y, params)',
  exprHint: 'Use x, y, pi/e and functions (sin, exp, ...); other letters become parameters',
  function: 'Function',
  a: 'Coefficient a',
  b: 'Coefficient b',
  min: 'Min',
  max: 'Max',
  stat: 'Statistic',
  sigma: 'σ (std)',
  kind: 'Window',
  savgol: 'Savitzky-Golay',
  moving: 'Moving average',
  none: 'None',
  mean: 'Remove mean',
  linear: 'Remove linear trend',
  zscore: 'Z-score',
  minmax: 'Min-Max',
  peak: 'Peak',
  std: 'Std',
  rms: 'RMS',
  median: 'Median',
  abs: 'Absolute',
  sqrt: 'Square root',
  square: 'Square',
  ln: 'Natural log',
  log10: 'Log10',
  exp: 'Exponential',
  negate: 'Negate',
  reciprocal: 'Reciprocal',
  hann: 'Hann',
  hamming: 'Hamming',
  blackman: 'Blackman',
  flattop: 'Flat-top',
  rectangular: 'Rectangular',
  'model.linear': 'Linear a·x+b',
  'model.quadratic': 'Quadratic a·x²+b·x+c',
  'model.cubic': 'Cubic',
  'model.exponential': 'Exponential a·exp(b·x)+c',
  'model.power': 'Power a·x^b+c',
  'model.log': 'Log a·ln(x)+b',
  'model.logistic': 'Logistic a/(1+exp(-b(x-c)))+d',
  'model.gaussian': 'Gaussian',
  'model.lorentzian': 'Lorentzian',
  'model.damped': 'Damped sine',
  'model.custom': 'Custom',
}

const ZH: ScienceCopy = {
  workspace: '工作区',
  loadSample: '示例信号',
  derived: '派生',
  importData: '导入数据',
  dropFiles: '将文件拖拽到这里',
  dropFilesHint: '或点击选择文件，支持 CSV / Excel，可多选',
  openFile: '打开文件',
  orDivider: '或',
  importing: '正在导入…',
  restoring: '正在恢复工作区…',
  xColumn: 'X 列',
  yColumn: 'Y 列',
  yColumns: 'Y 列（可多选）',
  groupColumn: '分组列（可选）',
  groupNone: '不分组',
  removeDataset: '移除数据集',
  rowIndex: '行号',
  exportCsv: '导出所选结果 CSV',
  noNumeric: '文件中至少需要一列可用的数值数据',
  storageError: '本地自动保存不可用，请先导出重要结果',
  variables: '变量',
  waveModeLine: '折线',
  waveModeMarkers: '散点',
  waveModeBoth: '线+点',
  empty: '还没有变量',
  analysis: '分析栈',
  addStep: '添加步骤',
  insertBefore: '前方添加步骤',
  insertAfter: '后方添加步骤',
  run: '运行',
  running: '运行中…',
  cancel: '取消',
  dirty: '待运行',
  runAll: '全部运行',
  runToHere: '运行到此处',
  auto: '自动运行',
  ready: '就绪',
  lastRun: '上次运行',
  runActions: '运行控制',
  exportShort: '导出 CSV',
  rawData: '查看原始数据',
  viewData: '查看所选数据',
  exportRawCsv: '导出完整 CSV',
  loadingData: '正在读取数据…',
  emptyData: '没有数据行',
  input: '输入',
  secondInput: '第二输入',
  remove: '删除',
  stepMenu: '步骤菜单',
  results: '结果',
  noResult: '选中一个结果变量查看详情',
  error: '错误',
  operators: {
    smooth: '平滑',
    gaussian: '高斯平滑',
    detrend: '去趋势',
    window: '加窗',
    movingStat: '滑动统计',
    differentiate: '微分',
    integrate: '积分',
    map: '一元映射',
    linear: '线性变换',
    normalize: '归一化',
    clip: '截断',
    expr: '函数表达式',
    fft: 'FFT 频谱',
    fit: '曲线拟合',
    stats: '描述统计',
  },
  categories: { signal: '信号', math: '数学', spectral: '频谱', fit: '拟合', stats: '统计' },
  labels: ZH_LABELS,
  kinds: { series: '序列', spectrum: '频谱', fit: '拟合', stats: '统计' },
  view: { label: '视图切换', plot: '图表', table: '表格' },
  plot: {
    timeDomain: '时域',
    dataDomain: '数据曲线',
    frequencyDomain: '频域',
    residual: '残差',
    fit: '拟合',
    data: '数据',
    peak: '峰值',
    magnitude: '幅度',
    magnitudeDb: '相对幅度 (dB)',
    spectrumScale: '频谱纵轴',
    dbScale: 'dB',
    linearScale: '线性',
    frequencyScale: '频率横轴',
    logFrequency: '对数频率',
    linearFrequency: '线性频率',
    dcHiddenOnLogFrequency: '对数频率轴从第一个非零频点开始；切换到线性频率可查看 0 Hz 直流分量。',
    phase: '相位 (rad)',
    phaseUnavailable: 'Welch 分段平均的是功率谱，没有唯一相位。将分段数设为 1 可查看 FFT 相位。',
    resizePlot: '拖动调整图表高度',
  },
  fit: { rSquared: 'R²', rmse: 'RMSE', iterations: '迭代', converged: '收敛', yes: '是', no: '否', params: '参数', stopReason: '停止原因', reasons: { converged: '步长收敛', maxIterations: '达到最大迭代', stalled: '无法继续下降' } },
  stats: {
    count: '样本数',
    mean: '均值',
    std: '标准差',
    min: '最小',
    max: '最大',
    median: '中位数',
    q1: 'Q1',
    q3: 'Q3',
    rms: 'RMS',
    skew: '偏度',
    kurtosis: '峰度(超)',
  },
}

const EN: ScienceCopy = {
  workspace: 'Workspace',
  loadSample: 'Sample',
  derived: 'Derived',
  importData: 'Import data',
  dropFiles: 'Drop files here',
  dropFilesHint: 'or click to browse — CSV / Excel, multiple allowed',
  openFile: 'Open file',
  orDivider: 'or',
  importing: 'Importing…',
  restoring: 'Restoring workspace…',
  xColumn: 'X column',
  yColumn: 'Y column',
  yColumns: 'Y columns (multiple)',
  groupColumn: 'Group by (optional)',
  groupNone: 'No grouping',
  removeDataset: 'Remove dataset',
  rowIndex: 'Row index',
  exportCsv: 'Export selected result CSV',
  noNumeric: 'The file needs at least one usable numeric column',
  storageError: 'Local autosave is unavailable. Export important results first.',
  variables: 'Variables',
  waveModeLine: 'Line',
  waveModeMarkers: 'Markers',
  waveModeBoth: 'Line+markers',
  empty: 'No variables yet',
  analysis: 'Analysis stack',
  addStep: 'Add step',
  insertBefore: 'Insert step before',
  insertAfter: 'Insert step after',
  run: 'Run',
  running: 'Running…',
  cancel: 'Cancel',
  dirty: 'Pending',
  runAll: 'Run all',
  runToHere: 'Run to here',
  auto: 'Auto run',
  ready: 'Ready',
  lastRun: 'Last run',
  runActions: 'Run controls',
  exportShort: 'Export CSV',
  rawData: 'View raw data',
  viewData: 'View selected data',
  exportRawCsv: 'Export full CSV',
  loadingData: 'Loading data…',
  emptyData: 'No data rows',
  input: 'Input',
  secondInput: 'Second input',
  remove: 'Remove',
  stepMenu: 'Step menu',
  results: 'Result',
  noResult: 'Select a result variable to inspect',
  error: 'Error',
  operators: {
    smooth: 'Smooth',
    gaussian: 'Gaussian smooth',
    detrend: 'Detrend',
    window: 'Apply window',
    movingStat: 'Moving statistic',
    differentiate: 'Differentiate',
    integrate: 'Integrate',
    map: 'Map function',
    linear: 'Linear transform',
    normalize: 'Normalize',
    clip: 'Clip',
    expr: 'Function expression',
    fft: 'FFT spectrum',
    fit: 'Curve fit',
    stats: 'Statistics',
  },
  categories: { signal: 'Signal', math: 'Math', spectral: 'Spectral', fit: 'Fit', stats: 'Stats' },
  labels: EN_LABELS,
  kinds: { series: 'Series', spectrum: 'Spectrum', fit: 'Fit', stats: 'Stats' },
  view: { label: 'View switch', plot: 'Plot', table: 'Table' },
  plot: {
    timeDomain: 'Time domain',
    dataDomain: 'Data plot',
    frequencyDomain: 'Frequency domain',
    residual: 'Residual',
    fit: 'Fit',
    data: 'Data',
    peak: 'Peak',
    magnitude: 'Magnitude',
    magnitudeDb: 'Relative magnitude (dB)',
    spectrumScale: 'Spectrum scale',
    dbScale: 'dB',
    linearScale: 'Linear',
    frequencyScale: 'Frequency scale',
    logFrequency: 'Log frequency',
    linearFrequency: 'Linear frequency',
    dcHiddenOnLogFrequency: 'The log frequency axis starts at the first nonzero bin. Switch to linear frequency to view DC at 0 Hz.',
    phase: 'Phase (rad)',
    phaseUnavailable: 'Welch averages power across segments, so there is no unique phase. Set segments to 1 to view FFT phase.',
    resizePlot: 'Drag to resize the plot height',
  },
  fit: { rSquared: 'R²', rmse: 'RMSE', iterations: 'Iterations', converged: 'Converged', yes: 'yes', no: 'no', params: 'Parameters', stopReason: 'Stop reason', reasons: { converged: 'Step converged', maxIterations: 'Max iterations', stalled: 'No further descent' } },
  stats: {
    count: 'Count',
    mean: 'Mean',
    std: 'Std',
    min: 'Min',
    max: 'Max',
    median: 'Median',
    q1: 'Q1',
    q3: 'Q3',
    rms: 'RMS',
    skew: 'Skew',
    kurtosis: 'Excess kurtosis',
  },
}

const JA: ScienceCopy = {
  ...EN,
  workspace: 'ワークスペース',
  loadSample: 'サンプル',
  derived: '派生',
  importData: 'データを読み込む',
  dropFiles: 'ここにファイルをドラッグ',
  dropFilesHint: 'またはクリックして選択（CSV / Excel、複数可）',
  openFile: 'ファイルを開く',
  orDivider: 'または',
  importing: '読み込み中…',
  restoring: 'ワークスペースを復元中…',
  xColumn: 'X 列',
  yColumn: 'Y 列',
  yColumns: 'Y 列（複数選択可）',
  groupColumn: 'グループ列（任意）',
  groupNone: 'グループ化しない',
  removeDataset: 'データセットを削除',
  rowIndex: '行番号',
  exportCsv: '選択結果を CSV で出力',
  noNumeric: '使用できる数値列が少なくとも 1 つ必要です',
  storageError: '自動保存できません。重要な結果は先に出力してください。',
  variables: '変数',
  waveModeLine: '折れ線',
  waveModeMarkers: 'マーカー',
  waveModeBoth: '線+点',
  empty: '変数がありません',
  analysis: '解析手順',
  addStep: '手順を追加',
  insertBefore: '前に手順を追加',
  insertAfter: '後に手順を追加',
  run: '実行',
  running: '実行中…',
  cancel: 'キャンセル',
  dirty: '未実行',
  runAll: 'すべて実行',
  runToHere: 'ここまで実行',
  auto: '自動実行',
  ready: '準備完了',
  lastRun: '前回',
  runActions: '実行操作',
  exportShort: 'CSV 出力',
  rawData: '元データを見る',
  viewData: '選択データを見る',
  exportRawCsv: '全件 CSV 出力',
  loadingData: 'データを読み込み中…',
  emptyData: 'データ行がありません',
  input: '入力',
  secondInput: '第 2 入力',
  remove: '削除',
  stepMenu: '手順メニュー',
  results: '結果',
  noResult: '結果の変数を選択してください',
  error: 'エラー',
  operators: {
    smooth: '平滑化', gaussian: 'ガウス平滑化', detrend: 'トレンド除去', window: '窓関数',
    movingStat: '移動統計', differentiate: '微分', integrate: '積分', map: '単項関数',
    linear: '線形変換', normalize: '正規化', clip: 'クリップ', expr: '数式',
    fft: 'FFT スペクトル', fit: '曲線フィット', stats: '記述統計',
  },
  categories: { signal: '信号', math: '数学', spectral: 'スペクトル', fit: 'フィット', stats: '統計' },
  labels: {
    ...EN_LABELS,
    method: '方法', window: '窓幅', order: '次数', mode: '方法', windowFn: '窓関数',
    detrend: 'トレンド除去', segments: 'Welch 分割数', model: 'モデル',
    expr: '式 y(x, パラメータ)', initial: '初期値（カンマ区切り、省略可）',
    formula: '式 f(x, y, パラメータ)',
    exprHint: 'x、y、pi/e と sin、exp などを使用できます。その他の変数はパラメータになります。',
    function: '関数', min: '最小', max: '最大', stat: '統計量', sigma: 'σ（標準偏差）',
    savgol: 'Savitzky-Golay', moving: '移動平均', none: 'なし', mean: '平均値を除去',
    zscore: 'Z スコア', std: '標準偏差', rms: 'RMS', median: '中央値',
  },
  kinds: { series: '系列', spectrum: 'スペクトル', fit: 'フィット', stats: '統計' },
  view: { label: '表示切替', plot: 'プロット', table: 'テーブル' },
  plot: { timeDomain: '時間領域', dataDomain: 'データ曲線', frequencyDomain: '周波数領域', residual: '残差', fit: 'フィット', data: 'データ', peak: 'ピーク', magnitude: '振幅', magnitudeDb: '相対振幅 (dB)', spectrumScale: 'スペクトル縦軸', dbScale: 'dB', linearScale: '線形', frequencyScale: '周波数軸', logFrequency: '対数周波数', linearFrequency: '線形周波数', dcHiddenOnLogFrequency: '対数周波数軸は最初の非ゼロ周波数から表示します。0 Hz の直流成分は線形周波数で確認できます。', phase: '位相 (rad)', phaseUnavailable: 'Welch 法はパワースペクトルを平均するため、一意の位相はありません。位相を表示するには分割数を 1 にしてください。', resizePlot: 'ドラッグしてグラフの高さを変更' },
  fit: { rSquared: 'R²', rmse: 'RMSE', iterations: '反復回数', converged: '収束', yes: 'はい', no: 'いいえ', params: 'パラメータ', stopReason: '停止理由', reasons: { converged: 'ステップ収束', maxIterations: '最大反復', stalled: '改善不能' } },
  stats: {
    count: '標本数', mean: '平均', std: '標準偏差', min: '最小', max: '最大', median: '中央値',
    q1: '第 1 四分位', q3: '第 3 四分位', rms: 'RMS', skew: '歪度', kurtosis: '超過尖度',
  },
}

export function resolveScienceLanguage(language: string | undefined): ScienceLanguage {
  if (language?.startsWith('zh')) return 'zh-CN'
  if (language?.startsWith('ja')) return 'ja-JP'
  return 'en'
}

export function createScienceCopy(language: ScienceLanguage): ScienceCopy {
  if (language === 'zh-CN') return ZH
  if (language === 'ja-JP') return JA
  return EN
}
