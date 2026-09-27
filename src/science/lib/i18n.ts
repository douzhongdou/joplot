export type ScienceLanguage = 'zh-CN' | 'en' | 'ja-JP'

export interface ScienceCopy {
  brand: string
  title: string
  subtitle: string
  workspace: string
  loadSample: string
  variables: string
  empty: string
  analysis: string
  addStep: string
  run: string
  running: string
  cancel: string
  dirty: string
  runAll: string
  runToHere: string
  auto: string
  input: string
  secondInput: string
  remove: string
  results: string
  noResult: string
  error: string
  operators: Record<string, string>
  categories: Record<string, string>
  labels: Record<string, string>
  kinds: Record<string, string>
  plot: {
    timeDomain: string
    frequencyDomain: string
    residual: string
    fit: string
    data: string
    peak: string
  }
  fit: {
    rSquared: string
    rmse: string
    iterations: string
    converged: string
    yes: string
    no: string
    params: string
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
  brand: 'joplot science',
  title: '科学处理工作台',
  subtitle: '导入或生成数据 · 组合分析步骤 · 实时出图',
  workspace: '工作区',
  loadSample: '重载示例信号',
  variables: '变量',
  empty: '还没有变量',
  analysis: '分析栈',
  addStep: '添加步骤',
  run: '运行',
  running: '运行中…',
  cancel: '取消',
  dirty: '待运行',
  runAll: '全部运行',
  runToHere: '运行到此处',
  auto: '自动',
  input: '输入',
  secondInput: '第二输入',
  remove: '删除',
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
  plot: {
    timeDomain: '时域',
    frequencyDomain: '频域',
    residual: '残差',
    fit: '拟合',
    data: '数据',
    peak: '峰值',
  },
  fit: { rSquared: 'R²', rmse: 'RMSE', iterations: '迭代', converged: '收敛', yes: '是', no: '否', params: '参数' },
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
  brand: 'joplot science',
  title: 'Scientific workspace',
  subtitle: 'Load or generate data · compose analysis steps · plot live',
  workspace: 'Workspace',
  loadSample: 'Reload sample',
  variables: 'Variables',
  empty: 'No variables yet',
  analysis: 'Analysis stack',
  addStep: 'Add step',
  run: 'Run',
  running: 'Running…',
  cancel: 'Cancel',
  dirty: 'Pending',
  runAll: 'Run all',
  runToHere: 'Run to here',
  auto: 'Auto',
  input: 'Input',
  secondInput: 'Second input',
  remove: 'Remove',
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
  plot: {
    timeDomain: 'Time domain',
    frequencyDomain: 'Frequency domain',
    residual: 'Residual',
    fit: 'Fit',
    data: 'Data',
    peak: 'Peak',
  },
  fit: { rSquared: 'R²', rmse: 'RMSE', iterations: 'Iterations', converged: 'Converged', yes: 'yes', no: 'no', params: 'Parameters' },
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

export function resolveScienceLanguage(routeLanguage: string | undefined): ScienceLanguage {
  if (routeLanguage === 'zh') return 'zh-CN'
  if (routeLanguage === 'ja') return 'ja-JP'
  return 'en'
}

export function createScienceCopy(language: ScienceLanguage): ScienceCopy {
  if (language === 'zh-CN') return ZH
  // ja 暂回退英文
  return EN
}
