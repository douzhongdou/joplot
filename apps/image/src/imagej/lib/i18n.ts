/** 图像工作台文案：中 / 英 / 日三语，结构必须保持一致（tests/imagej.test.ts 校验）。 */

export type ImagejLanguage = 'zh-CN' | 'en' | 'ja-JP'

export interface ImagejCopy {
  title: string
  subtitle: string
  localNote: string
  openImage: string
  dropHint: string
  emptyTitle: string
  emptyDescription: string
  original: string
  result: string
  zoomIn: string
  zoomOut: string
  zoomLabel: string
  fit: string
  reset: string
  viewer: {
    tool: string
    pan: string
    roiSelect: string
    actualSize: string
    pixelHint: string
    panHint: string
    display: string
    color: string
    gray: string
  }
  steps: {
    heading: string
    source: string
    empty: string
    add: string
    remove: string
    insertBefore: string
    insertAfter: string
    channel: string
    pendingHint: string
    needsGray: string
    categories: Record<string, string>
    ops: Record<string, string>
    params: Record<string, string>
  }
  roi: {
    draw: string
    clear: string
    scopeImage: string
    scopeRoi: string
    needRoi: string
    hint: string
  }
  adjust: {
    grayscale: string
    grayscaleHint: string
    invert: string
    brightness: string
    contrast: string
    applyLevels: string
    threshold: string
    thresholdApply: string
    otsu: string
    otsuResult: string
  }
  debayer: {
    pattern: string
    algorithm: string
    apply: string
    patternAuto: string
  }
  filters: {
    heading: string
    mean: string
    median: string
    sharpen: string
    sobel: string
    gaussian: string
    sigma: string
    minimum: string
    maximum: string
  }
  binary: {
    heading: string
    erode: string
    dilate: string
    open: string
    close: string
    fillHoles: string
    analyze: string
    particles: string
    perimeter: string
    circularity: string
    centroid: string
    minArea: string
    exportCsv: string
  }
  geometry: {
    heading: string
    crop: string
    flipH: string
    flipV: string
    rotateCw: string
    rotateCcw: string
  }
  history: {
    undo: string
    redo: string
  }
  exportPng: string
  close: string
  tabs: { closeOthers: string; closeToRight: string; openFolder: string; mergePrevious: string; mergeNext: string; buildStack: string; rename: string; splitStack: string; reorderStack: string; autoDebayer: string }
  rename: { title: string; label: string; confirm: string; cancel: string }
  reorder: { title: string; hint: string; apply: string; cancel: string; up: string; down: string; drag: string }
  ejectPage: string
  stackBuilder: { title: string; hint: string; file: string; modified: string; size: string; pages: string; create: string; cancel: string; selectAll: string }
  stack: { page: string; exportCurrent: string; exportAll: string; geometryUnavailable: string; applyAll: string; preloading: string }
  tools: {
    hand: string; zoom: string; dropper: string; rectangle: string; oval: string
    line: string; arrow: string; polyline: string; polygon: string; freehand: string
    point: string; multipoint: string; angle: string
    variantsHint: string; finishHint: string; cancelHint: string
  }
  stats: {
    heading: string
    pixels: string
    area: string
    mean: string
    min: string
    max: string
    stdDev: string
    histogram: string
    thresholdMark: string
    pixel: string
    cumulative: string
    level: string
    frequency: string
  }
  views: {
    add: string
    measurement: string
    histogram: string
    profile: string
    particles: string
    empty: string
    profileNote: string
    zprofile: string
    stackMeasure: string
    stackStatistics: string
    zProfileNote: string
    xyProfile: string
    xyProfileNote: string
  }
  /** Image ▸ Stacks 的跨帧处理（Z 投影 / 整栈统计）。 */
  stackOps: {
    zProject: string
    plotXyProfile: string
    groupedZProject: string
    plotZProfile: string
    measureStack: string
    statistics: string
    method: string
    startSlice: string
    stopSlice: string
    groupSize: string
    groupHint: string
    run: string
    needsStack: string
    slice: string
    voxels: string
    median: string
    mode: string
    summary: string
    stale: string
    factors: string
    allTimeFrames: string
    montage: string
    montageToStack: string
    reslice: string
    outputSpacing: string
    startAt: string
    startTop: string
    startLeft: string
    startBottom: string
    startRight: string
    flipVertically: string
    rotate90: string
    orthogonalViews: string
    pointX: string
    pointY: string
    reverse: string
    reduce: string
    substack: string
    addSlice: string
    deleteSlice: string
    factor: string
    pages: string
    pagesHint: string
    insert: string
    combine: string
    concatenate: string
    sourceDocument: string
    pasteX: string
    pasteY: string
    vertical: string
    needSecondDocument: string
    animationStart: string
    animationStop: string
    animationOptions: string
    fps: string
    firstFrame: string
    lastFrame: string
    loopBackAndForth: string
    startAnimation: string
    setLabel: string
    removeSliceLabels: string
    labelValue: string
    labelSlices: string
    magicMontage: string
    sourceColumns: string
    sourceRows: string
    label: string
    labelFormat: string
    labelStart: string
    labelInterval: string
    labelText: string
    labelX: string
    labelY: string
    labelFontSize: string
    labelFormats: { number: string; zeroPadded: string; mmss: string; hhmmss: string; text: string; label: string }
    project3d: string
    projection3dMethod: string
    projection3dAxis: string
    initialAngle: string
    totalRotation: string
    angleIncrement: string
    opacity: string
    surfaceCueing: string
    interiorCueing: string
    methods3d: { nearest: string; brightest: string; mean: string }
    axes3d: { x: string; y: string; z: string }
    columns: string
    rows: string
    scale: string
    border: string
    increment: string
    auto: string
    methods: { average: string; max: string; min: string; sum: string; sd: string; median: string }
  }
  status: {
    ready: string
    loading: string
    applied: string
  }
  errors: {
    decode: string
    unsupported: string
    tooLarge: string
    noImage: string
    needsRoi: string
    generic: string
    analysisTooLarge: string
    filterTooLarge: string
  }
}

const zhCN: ImagejCopy = {
  title: '图像工作台',
  subtitle: '8 位灰度 · ImageJ 风格处理流程',
  localNote: '图片仅在浏览器本地解码与处理，不会上传到服务器。',
  openImage: '打开图片',
  dropHint: '也可以把图片拖到这里',
  emptyTitle: '还没有图片',
  emptyDescription: '上传 PNG / JPEG / WebP / FITS 等本地图片，即可开始阈值、滤波与测量。',
  original: '原图',
  result: '结果',
  zoomIn: '放大',
  zoomOut: '缩小',
  zoomLabel: '缩放',
  fit: '适应窗口',
  reset: '重置',
  viewer: {
    tool: '工具',
    pan: '平移',
    roiSelect: 'ROI',
    actualSize: '1:1',
    pixelHint: '始终按像素显示，不做插值',
    panHint: 'Ctrl/⌘ + 滚轮缩放；Stack 模式下滚轮翻页；按住空格或中键拖动平移；切到 ROI 工具后拖拽可画选区。',
    display: '显示',
    color: '彩色',
    gray: '灰度',
  },
  steps: {
    heading: '处理步骤',
    source: '源图像',
    empty: '还没有处理步骤',
    add: '添加步骤',
    remove: '删除步骤',
    insertBefore: '在此之前插入',
    insertAfter: '在此之后插入',
    channel: '通道',
    pendingHint: '步骤栈已就绪；执行与结果由计算引擎接入后生效。',
    needsGray: '此步骤需要灰度图，请先添加「转灰度」步骤。',
    categories: { format: '格式', adjust: '显示', threshold: '阈值', filter: '滤波', morphology: '形态学', geometry: '几何', analysis: '分析' },
    ops: {
      grayscale: '转灰度', debayer: '去马赛克（Debayer）', invert: '反相', levels: '亮度/对比度', threshold: '阈值', otsu: 'Otsu 自动阈值',
      mean3x3: '3×3 均值', median3x3: '3×3 中值', sharpen3x3: '锐化', sobel: 'Sobel 边缘', minimum3x3: '3×3 最小', maximum3x3: '3×3 最大',
      gaussian: '高斯模糊', erode: '腐蚀', dilate: '膨胀', open: '开运算', close: '闭运算', fillHoles: '填孔',
      crop: '裁剪', flipH: '水平翻转', flipV: '垂直翻转', rotateCW: '顺时针 90°', rotateCCW: '逆时针 90°',
      measure: '测量与直方图', particles: '粒子分析',
    },
    params: { brightness: '亮度', contrast: '对比度', level: '阈值', sigma: 'σ', minArea: '最小面积', x: 'X', y: 'Y', width: '宽', height: '高', pattern: '滤镜序列', algorithm: '算法' },
  },
  roi: {
    draw: '矩形 ROI',
    clear: '清除 ROI',
    scopeImage: '整图',
    scopeRoi: 'ROI',
    needRoi: '请先在结果图上拖出一个矩形 ROI。',
    hint: '在结果图上拖拽即可绘制矩形 ROI，拖动已有区域可整体移动。',
  },
  adjust: {
    grayscale: '灰度',
    grayscaleHint: '从原图重新生成灰度结果',
    invert: '反相',
    brightness: '亮度',
    contrast: '对比度',
    applyLevels: '应用亮度/对比度',
    threshold: '阈值',
    thresholdApply: '应用阈值',
    otsu: '自动 Otsu 阈值',
    otsuResult: 'Otsu 阈值',
  },
  debayer: {
    pattern: '滤镜序列',
    algorithm: '算法',
    apply: '执行 Debayer',
    patternAuto: '自动（来自 RAW 元数据）',
  },
  filters: {
    heading: '3×3 滤波',
    mean: '均值',
    median: '中值',
    sharpen: '锐化',
    sobel: 'Sobel 边缘',
    gaussian: '高斯模糊', sigma: 'σ', minimum: '最小值', maximum: '最大值',
  },
  binary: {
    heading: '二值形态学与粒子分析', erode: '腐蚀', dilate: '膨胀', open: '开运算', close: '闭运算',
    fillHoles: '填孔', analyze: '分析粒子', particles: '粒子结果', perimeter: '周长',
    circularity: '圆度', centroid: '质心',
    minArea: '最小面积', exportCsv: '导出 CSV',
  },
  geometry: {
    heading: '几何变换',
    crop: '按 ROI 裁剪',
    flipH: '水平翻转',
    flipV: '垂直翻转',
    rotateCw: '顺时针 90°',
    rotateCcw: '逆时针 90°',
  },
  history: {
    undo: '撤销',
    redo: '重做',
  },
  exportPng: '导出 PNG',
  close: '关闭',
  tabs: { closeOthers: '关闭其他', closeToRight: '关闭右侧标签', openFolder: '打开文件夹…', mergePrevious: '与左侧标签合并为 Stack', mergeNext: '与右侧标签合并为 Stack', buildStack: '创建 Stack…', rename: '重命名…', splitStack: '拆分 Stack', reorderStack: '调整顺序…', autoDebayer: '打开 RAW 时自动去马赛克' },
  rename: { title: '重命名', label: '名称', confirm: '确定', cancel: '取消' },
  reorder: { title: '调整 Stack 顺序', hint: '拖拽行调整页面顺序，应用后重建 Stack', apply: '应用', cancel: '取消', up: '上移', down: '下移', drag: '拖拽排序' },
  ejectPage: '移出当前切片',
  stackBuilder: { title: '创建 Stack', hint: '勾选要合成一个 Stack 的图像（至少 2 个）', file: '文件名', modified: '修改时间', size: '大小', pages: '页数', create: '创建 Stack', cancel: '取消', selectAll: '全选' },
  stack: { page: '切片', exportCurrent: '导出当前 TIFF', exportAll: '导出整个 TIFF 栈', geometryUnavailable: '多页栈暂不支持改变切片尺寸的操作', applyAll: '应用到整个 Stack（关闭时仅当前切片）', preloading: '正在载入 Stack' },
  tools: {
    hand: '平移', zoom: '放大镜', dropper: '取色器', rectangle: '矩形', oval: '椭圆',
    line: '直线', arrow: '箭头', polyline: '折线', polygon: '多边形', freehand: '手绘',
    point: '点', multipoint: '多点', angle: '角度',
    variantsHint: '双击图标切换子类型', finishHint: '双击或回车结束', cancelHint: 'Esc 取消',
  },
  stats: {
    heading: '测量与直方图',
    pixels: '像素数',
    area: '面积（像素）',
    mean: '均值',
    min: '最小值',
    max: '最大值',
    stdDev: '标准差',
    histogram: '直方图',
    thresholdMark: '阈值',
    pixel: '像素',
    cumulative: '累计',
    level: '灰度',
    frequency: '频率',
  },
  views: {
    add: '添加视图',
    measurement: '统计测量',
    histogram: '直方图',
    profile: '剖面图',
    particles: '粒子分析',
    empty: '还没有视图——点右上「添加视图」新建',
    profileNote: '沿 ROI（无选区时为图像）的水平中线采样',
    zprofile: 'Z 轴剖面',
    stackMeasure: '整栈测量',
    stackStatistics: '整栈统计',
    zProfileNote: '逐切片取均值（有选区时取选区内的）',
    xyProfile: '逐页剖面',
    xyProfileNote: '每页取同一条剖面，共用同一纵轴',
  },
  stackOps: {
    zProject: 'Z 投影…',
    plotXyProfile: '逐页剖面…',
    groupedZProject: '分组 Z 投影…',
    plotZProfile: 'Z 轴剖面图',
    measureStack: '整栈测量…',
    statistics: '统计',
    method: '投影方式',
    startSlice: '起始切片',
    stopSlice: '结束切片',
    groupSize: '组大小',
    groupHint: '组大小需整除页数',
    run: '执行',
    needsStack: '该命令需要多页 Stack',
    slice: '切片',
    voxels: '体素数',
    median: '中位数',
    mode: '众数',
    summary: '整栈汇总',
    stale: '结果已过期，请重新运行该命令',
    factors: '可整除的组大小',
    allTimeFrames: '全部时间帧',
    montage: '制作蒙太奇…',
    montageToStack: '蒙太奇转 Stack…',
    reslice: '重切…',
    outputSpacing: '输出间距',
    startAt: '起始位置',
    startTop: '上',
    startLeft: '左',
    startBottom: '下',
    startRight: '右',
    flipVertically: '垂直翻转',
    rotate90: '旋转 90°',
    orthogonalViews: '正交视图',
    pointX: '交叉点 X',
    pointY: '交叉点 Y',
    reverse: '反转顺序',
    reduce: '抽稀…',
    substack: '子栈…',
    addSlice: '插入空白切片',
    deleteSlice: '删除当前切片',
    factor: '步长',
    pages: '切片列表',
    pagesHint: '例如 1-3,5（从 1 开始计数）',
    insert: '插入图像…',
    combine: '合并拼接…',
    concatenate: '首尾拼接全部',
    sourceDocument: '来源文档',
    pasteX: '粘贴位置 X',
    pasteY: '粘贴位置 Y',
    vertical: '垂直拼接',
    needSecondDocument: '需要至少两个已打开的文档',
    animationStart: '开始动画',
    animationStop: '停止动画',
    animationOptions: '动画选项…',
    fps: '帧率 (fps)',
    firstFrame: '起始帧',
    lastFrame: '结束帧',
    loopBackAndForth: '来回循环',
    startAnimation: '立即开始',
    setLabel: '设置标签…',
    removeSliceLabels: '清除切片标签',
    labelValue: '标签文本',
    labelSlices: '标注切片',
    magicMontage: '蒙太奇工具…',
    sourceColumns: '源列数',
    sourceRows: '源行数',
    label: '标注切片…',
    labelFormat: '格式',
    labelStart: '起始值',
    labelInterval: '步长',
    labelText: '附加文本',
    labelX: 'X 位置',
    labelY: 'Y 位置',
    labelFontSize: '字号',
    labelFormats: { number: '数值', zeroPadded: '零填充', mmss: '分:秒', hhmmss: '时:分:秒', text: '文本', label: '切片标签' },
    project3d: '3D 投影…',
    projection3dMethod: '投影方式',
    projection3dAxis: '旋转轴',
    initialAngle: '初始角度',
    totalRotation: '总旋转角度',
    angleIncrement: '角度增量',
    opacity: '不透明度 (%)',
    surfaceCueing: '表面深度提示 (%)',
    interiorCueing: '内部深度提示 (%)',
    methods3d: { nearest: '最近点', brightest: '最亮点', mean: '均值' },
    axes3d: { x: 'X 轴', y: 'Y 轴', z: 'Z 轴' },
    columns: '列数',
    rows: '行数',
    scale: '缩放',
    border: '边框宽度',
    increment: '步长',
    auto: '自动',
    methods: { average: '均值', max: '最大值', min: '最小值', sum: '求和', sd: '标准差', median: '中位数' },
  },
  status: {
    ready: '就绪',
    loading: '读取中…',
    applied: '已应用',
  },
  errors: {
    decode: '图片解码失败，请换一张图片重试。',
    unsupported: '只支持浏览器可解码的图片格式。',
    tooLarge: '图片过大，已超出浏览器内存上限，请先缩小再导入。',
    noImage: '请先打开一张图片。',
    needsRoi: '该操作需要矩形 ROI。',
    generic: '操作失败。',
    analysisTooLarge: '粒子分析无法分配所需内存，请缩小处理范围。',
    filterTooLarge: '滤波无法分配所需内存，请缩小处理范围。',
  },
}

const en: ImagejCopy = {
  title: 'Image workspace',
  subtitle: '8-bit grayscale · ImageJ-style processing',
  localNote: 'Images are decoded and processed in your browser — nothing is uploaded.',
  openImage: 'Open image',
  dropHint: 'or drop an image here',
  emptyTitle: 'No image yet',
  emptyDescription: 'Load a local PNG / JPEG / WebP / FITS image to start thresholding, filtering and measuring.',
  original: 'Original',
  result: 'Result',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  zoomLabel: 'Zoom',
  fit: 'Fit window',
  reset: 'Reset',
  viewer: {
    tool: 'Tool',
    pan: 'Pan',
    roiSelect: 'ROI',
    actualSize: '1:1',
    pixelHint: 'Pixel-accurate — no interpolation',
    panHint: 'Ctrl/⌘ + wheel to zoom; wheel to page through a stack; hold Space or drag with the middle button to pan; switch to the ROI tool to draw a selection.',
    display: 'Display',
    color: 'Color',
    gray: 'Gray',
  },
  steps: {
    heading: 'Processing steps',
    source: 'Source image',
    empty: 'No processing steps yet',
    add: 'Add step',
    remove: 'Remove step',
    insertBefore: 'Insert before',
    insertAfter: 'Insert after',
    channel: 'Channel',
    pendingHint: 'The step stack is ready; execution and results appear once the compute engine is connected.',
    needsGray: 'This step needs a grayscale image — add a “Convert to grayscale” step first.',
    categories: { format: 'Format', adjust: 'Display', threshold: 'Threshold', filter: 'Filter', morphology: 'Morphology', geometry: 'Geometry', analysis: 'Analysis' },
    ops: {
      grayscale: 'Convert to grayscale', debayer: 'Debayer', invert: 'Invert', levels: 'Brightness/contrast', threshold: 'Threshold', otsu: 'Auto Otsu threshold',
      mean3x3: '3×3 mean', median3x3: '3×3 median', sharpen3x3: 'Sharpen', sobel: 'Sobel edges', minimum3x3: '3×3 minimum', maximum3x3: '3×3 maximum',
      gaussian: 'Gaussian blur', erode: 'Erode', dilate: 'Dilate', open: 'Open', close: 'Close', fillHoles: 'Fill holes',
      crop: 'Crop', flipH: 'Flip horizontal', flipV: 'Flip vertical', rotateCW: 'Rotate 90° CW', rotateCCW: 'Rotate 90° CCW',
      measure: 'Measurements & histogram', particles: 'Particle analysis',
    },
    params: { brightness: 'Brightness', contrast: 'Contrast', level: 'Level', sigma: 'σ', minArea: 'Minimum area', x: 'X', y: 'Y', width: 'Width', height: 'Height', pattern: 'CFA pattern', algorithm: 'Algorithm' },
  },
  roi: {
    draw: 'Rectangle ROI',
    clear: 'Clear ROI',
    scopeImage: 'Whole image',
    scopeRoi: 'ROI',
    needRoi: 'Draw a rectangle ROI on the result image first.',
    hint: 'Drag on the result image to draw a rectangle ROI; drag inside it to move.',
  },
  adjust: {
    grayscale: 'Grayscale',
    grayscaleHint: 'Rebuild the grayscale result from the original',
    invert: 'Invert',
    brightness: 'Brightness',
    contrast: 'Contrast',
    applyLevels: 'Apply brightness/contrast',
    threshold: 'Threshold',
    thresholdApply: 'Apply threshold',
    otsu: 'Auto Otsu threshold',
    otsuResult: 'Otsu level',
  },
  debayer: {
    pattern: 'CFA pattern',
    algorithm: 'Algorithm',
    apply: 'Run debayer',
    patternAuto: 'Auto (from RAW metadata)',
  },
  filters: {
    heading: '3×3 filters',
    mean: 'Mean',
    median: 'Median',
    sharpen: 'Sharpen',
    sobel: 'Sobel edges',
    gaussian: 'Gaussian blur', sigma: 'σ', minimum: 'Minimum', maximum: 'Maximum',
  },
  binary: {
    heading: 'Binary morphology & particles', erode: 'Erode', dilate: 'Dilate', open: 'Open', close: 'Close',
    fillHoles: 'Fill holes', analyze: 'Analyze particles', particles: 'Particle results', perimeter: 'Perimeter',
    circularity: 'Circularity', centroid: 'Centroid',
    minArea: 'Minimum area', exportCsv: 'Export CSV',
  },
  geometry: {
    heading: 'Geometry',
    crop: 'Crop to ROI',
    flipH: 'Flip horizontal',
    flipV: 'Flip vertical',
    rotateCw: 'Rotate 90° CW',
    rotateCcw: 'Rotate 90° CCW',
  },
  history: {
    undo: 'Undo',
    redo: 'Redo',
  },
  exportPng: 'Export PNG',
  close: 'Close',
  tabs: { closeOthers: 'Close others', closeToRight: 'Close tabs to the right', openFolder: 'Open folder…', mergePrevious: 'Merge with tab on the left into a stack', mergeNext: 'Merge with tab on the right into a stack', buildStack: 'Set up stack…', rename: 'Rename…', splitStack: 'Split stack', reorderStack: 'Reorder…', autoDebayer: 'Debayer RAW automatically on open' },
  rename: { title: 'Rename', label: 'Name', confirm: 'OK', cancel: 'Cancel' },
  reorder: { title: 'Reorder stack', hint: 'Drag rows to change page order; the stack is rebuilt on apply', apply: 'Apply', cancel: 'Cancel', up: 'Move up', down: 'Move down', drag: 'Drag to reorder' },
  ejectPage: 'Eject current slice',
  stackBuilder: { title: 'Set up stack', hint: 'Select the images to combine into one stack (at least 2)', file: 'File name', modified: 'Modified', size: 'Size', pages: 'Pages', create: 'Create stack', cancel: 'Cancel', selectAll: 'Select all' },
  stack: { page: 'Slice', exportCurrent: 'Export current TIFF', exportAll: 'Export TIFF stack', geometryUnavailable: 'Size-changing operations are unavailable for multi-page stacks', applyAll: 'Apply to the whole Stack (off: current slice only)', preloading: 'Loading Stack' },
  tools: {
    hand: 'Pan', zoom: 'Zoom', dropper: 'Color picker', rectangle: 'Rectangle', oval: 'Oval',
    line: 'Line', arrow: 'Arrow', polyline: 'Polyline', polygon: 'Polygon', freehand: 'Freehand',
    point: 'Point', multipoint: 'Multi-point', angle: 'Angle',
    variantsHint: 'Double-click the icon to switch variant', finishHint: 'Double-click or Enter to finish', cancelHint: 'Esc to cancel',
  },
  stats: {
    heading: 'Measurements & histogram',
    pixels: 'Pixels',
    area: 'Area (px)',
    mean: 'Mean',
    min: 'Min',
    max: 'Max',
    stdDev: 'StdDev',
    histogram: 'Histogram',
    thresholdMark: 'Threshold',
    pixel: 'Pixel',
    cumulative: 'Cumulative',
    level: 'Level',
    frequency: 'Frequency',
  },
  views: {
    add: 'Add view',
    measurement: 'Measurement',
    histogram: 'Histogram',
    profile: 'Plot profile',
    particles: 'Particle analysis',
    empty: 'No views yet — use “Add view” above',
    profileNote: 'Sampled along the horizontal midline of the ROI (or image)',
    zprofile: 'Z-axis profile',
    stackMeasure: 'Stack measurements',
    stackStatistics: 'Stack statistics',
    zProfileNote: 'Mean per slice (inside the ROI when one is set)',
    xyProfile: 'Stack profiles',
    xyProfileNote: 'Same profile per slice, shared vertical scale',
  },
  stackOps: {
    zProject: 'Z Project…',
    plotXyProfile: 'Plot XY Profile…',
    groupedZProject: 'Grouped Z Project…',
    plotZProfile: 'Plot Z-axis Profile',
    measureStack: 'Measure Stack…',
    statistics: 'Statistics',
    method: 'Projection type',
    startSlice: 'Start slice',
    stopSlice: 'Stop slice',
    groupSize: 'Group size',
    groupHint: 'Group size must divide the stack size',
    run: 'Run',
    needsStack: 'This command requires a multi-slice stack',
    slice: 'Slice',
    voxels: 'Voxels',
    median: 'Median',
    mode: 'Mode',
    summary: 'Stack summary',
    stale: 'Result is out of date — run the command again',
    factors: 'Valid group sizes',
    allTimeFrames: 'All time frames',
    montage: 'Make Montage…',
    montageToStack: 'Montage to Stack…',
    reslice: 'Reslice…',
    outputSpacing: 'Output spacing',
    startAt: 'Start at',
    startTop: 'Top',
    startLeft: 'Left',
    startBottom: 'Bottom',
    startRight: 'Right',
    flipVertically: 'Flip vertically',
    rotate90: 'Rotate 90 degrees',
    orthogonalViews: 'Orthogonal Views',
    pointX: 'Crosshair X',
    pointY: 'Crosshair Y',
    reverse: 'Reverse',
    reduce: 'Reduce…',
    substack: 'Make Substack…',
    addSlice: 'Add Slice',
    deleteSlice: 'Delete Slice',
    factor: 'Factor',
    pages: 'Slices',
    pagesHint: 'e.g. 1-3,5 (1-based)',
    insert: 'Insert…',
    combine: 'Combine…',
    concatenate: 'Concatenate all',
    sourceDocument: 'Source document',
    pasteX: 'X location',
    pasteY: 'Y location',
    vertical: 'Combine vertically',
    needSecondDocument: 'At least two open documents are required',
    animationStart: 'Start Animation',
    animationStop: 'Stop Animation',
    animationOptions: 'Animation Options…',
    fps: 'Speed (fps)',
    firstFrame: 'First frame',
    lastFrame: 'Last frame',
    loopBackAndForth: 'Loop back and forth',
    startAnimation: 'Start animation',
    setLabel: 'Set Label…',
    removeSliceLabels: 'Remove Slice Labels',
    labelValue: 'Label',
    labelSlices: 'Label slices',
    magicMontage: 'Magic Montage Tools…',
    sourceColumns: 'Source columns',
    sourceRows: 'Source rows',
    label: 'Label…',
    labelFormat: 'Format',
    labelStart: 'Starting value',
    labelInterval: 'Interval',
    labelText: 'Text',
    labelX: 'X location',
    labelY: 'Y location',
    labelFontSize: 'Font size',
    labelFormats: { number: 'Number', zeroPadded: 'Zero padded', mmss: 'mm:ss', hhmmss: 'hh:mm:ss', text: 'Text', label: 'Slice label' },
    project3d: '3D Project…',
    projection3dMethod: 'Projection method',
    projection3dAxis: 'Axis of rotation',
    initialAngle: 'Initial angle',
    totalRotation: 'Total rotation',
    angleIncrement: 'Rotation angle increment',
    opacity: 'Opacity (%)',
    surfaceCueing: 'Surface depth-cueing (%)',
    interiorCueing: 'Interior depth-cueing (%)',
    methods3d: { nearest: 'Nearest Point', brightest: 'Brightest Point', mean: 'Mean Value' },
    axes3d: { x: 'X-Axis', y: 'Y-Axis', z: 'Z-Axis' },
    columns: 'Columns',
    rows: 'Rows',
    scale: 'Scale factor',
    border: 'Border width',
    increment: 'Increment',
    auto: 'Auto',
    methods: { average: 'Average Intensity', max: 'Max Intensity', min: 'Min Intensity', sum: 'Sum Slices', sd: 'Standard Deviation', median: 'Median' },
  },
  status: {
    ready: 'Ready',
    loading: 'Loading…',
    applied: 'Applied',
  },
  errors: {
    decode: 'Could not decode this image. Try another file.',
    unsupported: 'Only browser-decodable image formats are supported.',
    tooLarge: 'The image is too large for available browser memory. Resize it first.',
    noImage: 'Open an image first.',
    needsRoi: 'This operation needs a rectangle ROI.',
    generic: 'Operation failed.',
    analysisTooLarge: 'Insufficient memory for particle analysis. Reduce the processing region.',
    filterTooLarge: 'Insufficient memory for filtering. Reduce the processing region.',
  },
}

const jaJP: ImagejCopy = {
  title: '画像ワークベンチ',
  subtitle: '8bit グレースケール · ImageJ 風の処理フロー',
  localNote: '画像はブラウザ内でのみ処理され、サーバーにはアップロードされません。',
  openImage: '画像を開く',
  dropHint: 'またはここにドロップ',
  emptyTitle: '画像がありません',
  emptyDescription: 'PNG / JPEG / WebP / FITS などのローカル画像を読み込んで、二値化・フィルタ・測定を始めましょう。',
  original: '元画像',
  result: '結果',
  zoomIn: '拡大',
  zoomOut: '縮小',
  zoomLabel: '拡大率',
  fit: 'ウィンドウに合わせる',
  reset: 'リセット',
  viewer: {
    tool: 'ツール',
    pan: '移動',
    roiSelect: 'ROI',
    actualSize: '1:1',
    pixelHint: '常に画素どおりに表示（補間なし）',
    panHint: 'Ctrl/⌘ + ホイールでズーム、スタックはホイールでページ送り、Space か中ボタンのドラッグで移動、ROI ツールで選択範囲を作成できます。',
    display: '表示',
    color: 'カラー',
    gray: 'グレー',
  },
  steps: {
    heading: '処理ステップ',
    source: '元画像',
    empty: '処理ステップがありません',
    add: 'ステップを追加',
    remove: 'ステップを削除',
    insertBefore: 'この前に挿入',
    insertAfter: 'この後に挿入',
    channel: 'チャンネル',
    pendingHint: 'ステップスタックは準備完了です。実行と結果は計算エンジンの接続後に有効になります。',
    needsGray: 'このステップにはグレースケール画像が必要です。先に「グレースケール変換」を追加してください。',
    categories: { format: '形式', adjust: '表示', threshold: 'しきい値', filter: 'フィルタ', morphology: '形態学', geometry: '幾何', analysis: '解析' },
    ops: {
      grayscale: 'グレースケール変換', debayer: 'デベイヤ', invert: '反転', levels: '明るさ/コントラスト', threshold: 'しきい値', otsu: 'Otsu 自動しきい値',
      mean3x3: '3×3 平均', median3x3: '3×3 中央値', sharpen3x3: 'シャープ', sobel: 'Sobel エッジ', minimum3x3: '3×3 最小', maximum3x3: '3×3 最大',
      gaussian: 'ガウスぼかし', erode: '収縮', dilate: '膨張', open: '開', close: '閉', fillHoles: '穴埋め',
      crop: '切り抜き', flipH: '水平反転', flipV: '垂直反転', rotateCW: '時計回り 90°', rotateCCW: '反時計回り 90°',
      measure: '測定とヒストグラム', particles: '粒子解析',
    },
    params: { brightness: '明るさ', contrast: 'コントラスト', level: 'しきい値', sigma: 'σ', minArea: '最小面積', x: 'X', y: 'Y', width: '幅', height: '高さ', pattern: 'CFA パターン', algorithm: 'アルゴリズム' },
  },
  roi: {
    draw: '矩形 ROI',
    clear: 'ROI をクリア',
    scopeImage: '全体',
    scopeRoi: 'ROI',
    needRoi: '先に結果画像上へ矩形 ROI をドラッグしてください。',
    hint: '結果画像をドラッグして矩形 ROI を作成できます。領域内をドラッグで移動します。',
  },
  adjust: {
    grayscale: 'グレースケール',
    grayscaleHint: '元画像からグレースケール結果を作り直す',
    invert: '反転',
    brightness: '明るさ',
    contrast: 'コントラスト',
    applyLevels: '明るさ/コントラストを適用',
    threshold: 'しきい値',
    thresholdApply: 'しきい値を適用',
    otsu: '自動 Otsu しきい値',
    otsuResult: 'Otsu しきい値',
  },
  debayer: {
    pattern: 'CFA パターン',
    algorithm: 'アルゴリズム',
    apply: 'デベイヤ実行',
    patternAuto: '自動（RAW メタデータ）',
  },
  filters: {
    heading: '3×3 フィルタ',
    mean: '平均',
    median: '中央値',
    sharpen: 'シャープ',
    sobel: 'Sobel エッジ',
    gaussian: 'ガウスぼかし', sigma: 'σ', minimum: '最小値', maximum: '最大値',
  },
  binary: {
    heading: '二値形態と粒子解析', erode: '収縮', dilate: '膨張', open: 'オープニング', close: 'クロージング',
    fillHoles: '穴を埋める', analyze: '粒子を解析', particles: '粒子結果', perimeter: '周囲長',
    circularity: '円形度', centroid: '重心',
    minArea: '最小面積', exportCsv: 'CSV を出力',
  },
  geometry: {
    heading: '幾何変換',
    crop: 'ROI で切り抜き',
    flipH: '左右反転',
    flipV: '上下反転',
    rotateCw: '90° 右回転',
    rotateCcw: '90° 左回転',
  },
  history: {
    undo: '元に戻す',
    redo: 'やり直す',
  },
  exportPng: 'PNG を書き出す',
  close: '閉じる',
  tabs: { closeOthers: '他を閉じる', closeToRight: '右側を閉じる', openFolder: 'フォルダーを開く…', mergePrevious: '左のタブとスタックに統合', mergeNext: '右のタブとスタックに統合', buildStack: 'スタックを作成…', rename: '名前を変更…', splitStack: 'スタックを分割', reorderStack: '順序を変更…', autoDebayer: 'RAW を開いたら自動でデベイヤ' },
  rename: { title: '名前を変更', label: '名前', confirm: 'OK', cancel: 'キャンセル' },
  reorder: { title: 'スタックの順序', hint: '行をドラッグしてページ順を変更し、適用すると再構築します', apply: '適用', cancel: 'キャンセル', up: '上へ', down: '下へ', drag: 'ドラッグで並べ替え' },
  ejectPage: '現在のスライスを出す',
  stackBuilder: { title: 'スタックを作成', hint: '1 つのスタックにまとめる画像を選択してください（2 つ以上）', file: 'ファイル名', modified: '更新日時', size: 'サイズ', pages: 'ページ数', create: 'スタックを作成', cancel: 'キャンセル', selectAll: 'すべて選択' },
  stack: { page: 'スライス', exportCurrent: '現在の TIFF を出力', exportAll: 'TIFF スタックを出力', geometryUnavailable: '複数ページのスタックではサイズを変える操作はできません', applyAll: 'スタック全体に適用（オフ：現在のスライス）', preloading: 'スタックを読み込み中' },
  tools: {
    hand: '移動', zoom: 'ズーム', dropper: 'スポイト', rectangle: '矩形', oval: '楕円',
    line: '直線', arrow: '矢印', polyline: '折れ線', polygon: '多角形', freehand: 'フリーハンド',
    point: '点', multipoint: '多点', angle: '角度',
    variantsHint: 'アイコンをダブルクリックで切り替え', finishHint: 'ダブルクリックまたは Enter で確定', cancelHint: 'Esc でキャンセル',
  },
  stats: {
    heading: '測定とヒストグラム',
    pixels: 'ピクセル数',
    area: '面積（px）',
    mean: '平均',
    min: '最小値',
    max: '最大値',
    stdDev: '標準偏差',
    histogram: 'ヒストグラム',
    thresholdMark: 'しきい値',
    pixel: 'ピクセル',
    cumulative: '累積',
    level: '階調',
    frequency: '頻度',
  },
  views: {
    add: 'ビューを追加',
    measurement: '測定',
    histogram: 'ヒストグラム',
    profile: 'プロファイル',
    particles: '粒子解析',
    empty: 'ビューがありません。右上の「ビューを追加」から追加してください',
    profileNote: 'ROI（なければ画像）の水平中心線に沿ってサンプリング',
    zprofile: 'Z 軸プロファイル',
    stackMeasure: 'スタック測定',
    stackStatistics: 'スタック統計',
    zProfileNote: 'スライスごとの平均（ROI がある場合は ROI 内）',
    xyProfile: 'スタックプロファイル',
    xyProfileNote: '各スライスで同じプロファイル、縦軸は共通',
  },
  stackOps: {
    zProject: 'Z 投影…',
    plotXyProfile: 'スタックプロファイル…',
    groupedZProject: 'グループ Z 投影…',
    plotZProfile: 'Z 軸プロファイル',
    measureStack: 'スタック測定…',
    statistics: '統計',
    method: '投影方法',
    startSlice: '開始スライス',
    stopSlice: '終了スライス',
    groupSize: 'グループサイズ',
    groupHint: 'グループサイズはページ数を割り切れる必要があります',
    run: '実行',
    needsStack: '複数ページのスタックが必要です',
    slice: 'スライス',
    voxels: 'ボクセル数',
    median: '中央値',
    mode: '最頻値',
    summary: 'スタック集計',
    stale: '結果が古くなっています。コマンドを再実行してください',
    factors: '割り切れるグループサイズ',
    allTimeFrames: 'すべてのタイムフレーム',
    montage: 'モンタージュ作成…',
    montageToStack: 'モンタージュからスタック…',
    reslice: 'リズライス…',
    outputSpacing: '出力間隔',
    startAt: '開始位置',
    startTop: '上',
    startLeft: '左',
    startBottom: '下',
    startRight: '右',
    flipVertically: '垂直反転',
    rotate90: '90 度回転',
    orthogonalViews: '直交ビュー',
    pointX: '交点 X',
    pointY: '交点 Y',
    reverse: '順序を反転',
    reduce: '間引き…',
    substack: 'サブスタック…',
    addSlice: '空白スライスを挿入',
    deleteSlice: '現在のスライスを削除',
    factor: '間隔',
    pages: 'スライス',
    pagesHint: '例：1-3,5（1 始まり）',
    insert: '画像を挿入…',
    combine: '結合…',
    concatenate: 'すべて連結',
    sourceDocument: '元のドキュメント',
    pasteX: '貼り付け位置 X',
    pasteY: '貼り付け位置 Y',
    vertical: '垂直に結合',
    needSecondDocument: '2 つ以上のドキュメントが必要です',
    animationStart: 'アニメーション開始',
    animationStop: 'アニメーション停止',
    animationOptions: 'アニメーション設定…',
    fps: '速度 (fps)',
    firstFrame: '開始フレーム',
    lastFrame: '終了フレーム',
    loopBackAndForth: '往復ループ',
    startAnimation: 'すぐに開始',
    setLabel: 'ラベル設定…',
    removeSliceLabels: 'スライスラベルを削除',
    labelValue: 'ラベル',
    labelSlices: 'スライスにラベル',
    magicMontage: 'モンタージュツール…',
    sourceColumns: '元の列数',
    sourceRows: '元の行数',
    label: 'ラベル付け…',
    labelFormat: '形式',
    labelStart: '開始値',
    labelInterval: '間隔',
    labelText: '追加テキスト',
    labelX: 'X 位置',
    labelY: 'Y 位置',
    labelFontSize: 'フォントサイズ',
    labelFormats: { number: '数値', zeroPadded: 'ゼロ埋め', mmss: '分:秒', hhmmss: '時:分:秒', text: 'テキスト', label: 'スライスラベル' },
    project3d: '3D 投影…',
    projection3dMethod: '投影方法',
    projection3dAxis: '回転軸',
    initialAngle: '初期角度',
    totalRotation: '総回転角度',
    angleIncrement: '角度の刻み',
    opacity: '不透明度 (%)',
    surfaceCueing: '表面深度キュー (%)',
    interiorCueing: '内部深度キュー (%)',
    methods3d: { nearest: '最近点', brightest: '最輝点', mean: '平均値' },
    axes3d: { x: 'X 軸', y: 'Y 軸', z: 'Z 軸' },
    columns: '列数',
    rows: '行数',
    scale: '倍率',
    border: '境界線の幅',
    increment: '増分',
    auto: '自動',
    methods: { average: '平均', max: '最大値', min: '最小値', sum: '合計', sd: '標準偏差', median: '中央値' },
  },
  status: {
    ready: '準備完了',
    loading: '読み込み中…',
    applied: '適用しました',
  },
  errors: {
    decode: '画像を読み込めませんでした。別の画像を試してください。',
    unsupported: 'ブラウザでデコードできる画像形式のみ対応しています。',
    tooLarge: '画像が大きすぎてメモリ上限を超えています。縮小してから読み込んでください。',
    noImage: '先に画像を開いてください。',
    needsRoi: 'この操作には矩形 ROI が必要です。',
    generic: '処理に失敗しました。',
    analysisTooLarge: '粒子解析に必要なメモリを確保できません。処理範囲を縮小してください。',
    filterTooLarge: 'フィルタに必要なメモリを確保できません。処理範囲を縮小してください。',
  },
}

const COPIES: Record<ImagejLanguage, ImagejCopy> = {
  'zh-CN': zhCN,
  en,
  'ja-JP': jaJP,
}

export function createImagejCopy(language: ImagejLanguage): ImagejCopy {
  return COPIES[language] ?? COPIES.en
}
