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
  tabs: { closeOthers: string; closeToRight: string; openFolder: string; mergePrevious: string; mergeNext: string }
  stack: { page: string; exportCurrent: string; exportAll: string; geometryUnavailable: string; applyAll: string }
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
  emptyDescription: '上传 PNG / JPEG / WebP 等本地图片，即可开始阈值、滤波与测量。',
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
      grayscale: '转灰度', invert: '反相', levels: '亮度/对比度', threshold: '阈值', otsu: 'Otsu 自动阈值',
      mean3x3: '3×3 均值', median3x3: '3×3 中值', sharpen3x3: '锐化', sobel: 'Sobel 边缘', minimum3x3: '3×3 最小', maximum3x3: '3×3 最大',
      gaussian: '高斯模糊', erode: '腐蚀', dilate: '膨胀', open: '开运算', close: '闭运算', fillHoles: '填孔',
      crop: '裁剪', flipH: '水平翻转', flipV: '垂直翻转', rotateCW: '顺时针 90°', rotateCCW: '逆时针 90°',
      measure: '测量与直方图', particles: '粒子分析',
    },
    params: { brightness: '亮度', contrast: '对比度', level: '阈值', sigma: 'σ', minArea: '最小面积', x: 'X', y: 'Y', width: '宽', height: '高' },
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
  tabs: { closeOthers: '关闭其他', closeToRight: '关闭右侧标签', openFolder: '打开文件夹…', mergePrevious: '与左侧标签合并为 Stack', mergeNext: '与右侧标签合并为 Stack' },
  stack: { page: '切片', exportCurrent: '导出当前 TIFF', exportAll: '导出整个 TIFF 栈', geometryUnavailable: '多页栈暂不支持改变切片尺寸的操作', applyAll: '应用到整个 Stack（关闭时仅当前切片）' },
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
  emptyDescription: 'Load a local PNG / JPEG / WebP image to start thresholding, filtering and measuring.',
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
      grayscale: 'Convert to grayscale', invert: 'Invert', levels: 'Brightness/contrast', threshold: 'Threshold', otsu: 'Auto Otsu threshold',
      mean3x3: '3×3 mean', median3x3: '3×3 median', sharpen3x3: 'Sharpen', sobel: 'Sobel edges', minimum3x3: '3×3 minimum', maximum3x3: '3×3 maximum',
      gaussian: 'Gaussian blur', erode: 'Erode', dilate: 'Dilate', open: 'Open', close: 'Close', fillHoles: 'Fill holes',
      crop: 'Crop', flipH: 'Flip horizontal', flipV: 'Flip vertical', rotateCW: 'Rotate 90° CW', rotateCCW: 'Rotate 90° CCW',
      measure: 'Measurements & histogram', particles: 'Particle analysis',
    },
    params: { brightness: 'Brightness', contrast: 'Contrast', level: 'Level', sigma: 'σ', minArea: 'Minimum area', x: 'X', y: 'Y', width: 'Width', height: 'Height' },
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
  tabs: { closeOthers: 'Close others', closeToRight: 'Close tabs to the right', openFolder: 'Open folder…', mergePrevious: 'Merge with tab on the left into a stack', mergeNext: 'Merge with tab on the right into a stack' },
  stack: { page: 'Slice', exportCurrent: 'Export current TIFF', exportAll: 'Export TIFF stack', geometryUnavailable: 'Size-changing operations are unavailable for multi-page stacks', applyAll: 'Apply to the whole Stack (off: current slice only)' },
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
  emptyDescription: 'PNG / JPEG / WebP などのローカル画像を読み込んで、二値化・フィルタ・測定を始めましょう。',
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
      grayscale: 'グレースケール変換', invert: '反転', levels: '明るさ/コントラスト', threshold: 'しきい値', otsu: 'Otsu 自動しきい値',
      mean3x3: '3×3 平均', median3x3: '3×3 中央値', sharpen3x3: 'シャープ', sobel: 'Sobel エッジ', minimum3x3: '3×3 最小', maximum3x3: '3×3 最大',
      gaussian: 'ガウスぼかし', erode: '収縮', dilate: '膨張', open: '開', close: '閉', fillHoles: '穴埋め',
      crop: '切り抜き', flipH: '水平反転', flipV: '垂直反転', rotateCW: '時計回り 90°', rotateCCW: '反時計回り 90°',
      measure: '測定とヒストグラム', particles: '粒子解析',
    },
    params: { brightness: '明るさ', contrast: 'コントラスト', level: 'しきい値', sigma: 'σ', minArea: '最小面積', x: 'X', y: 'Y', width: '幅', height: '高さ' },
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
  tabs: { closeOthers: '他を閉じる', closeToRight: '右側を閉じる', openFolder: 'フォルダーを開く…', mergePrevious: '左のタブとスタックに統合', mergeNext: '右のタブとスタックに統合' },
  stack: { page: 'スライス', exportCurrent: '現在の TIFF を出力', exportAll: 'TIFF スタックを出力', geometryUnavailable: '複数ページのスタックではサイズを変える操作はできません', applyAll: 'スタック全体に適用（オフ：現在のスライス）' },
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
