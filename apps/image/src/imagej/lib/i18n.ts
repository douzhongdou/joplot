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
  stack: { page: string; exportCurrent: string; exportAll: string; geometryUnavailable: string }
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
    panHint: '滚轮缩放；按住空格或中键拖动平移；切到 ROI 工具后拖拽可画选区。',
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
  stack: { page: '切片', exportCurrent: '导出当前 TIFF', exportAll: '导出整个 TIFF 栈', geometryUnavailable: '多页栈暂不支持改变切片尺寸的操作' },
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
    analysisTooLarge: '粒子分析最多支持 400 万像素，请先裁剪图像。',
    filterTooLarge: '高级滤波最多支持 400 万像素，请先裁剪图像。',
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
    panHint: 'Wheel to zoom; hold Space or drag with the middle button to pan; switch to the ROI tool to draw a selection.',
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
  stack: { page: 'Slice', exportCurrent: 'Export current TIFF', exportAll: 'Export TIFF stack', geometryUnavailable: 'Size-changing operations are unavailable for multi-page stacks' },
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
    analysisTooLarge: 'Particle analysis supports up to 4 million pixels. Crop the image first.',
    filterTooLarge: 'Advanced filters support up to 4 million pixels. Crop the image first.',
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
    panHint: 'ホイールでズーム、Space か中ボタンのドラッグで移動、ROI ツールで選択範囲を作成できます。',
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
  stack: { page: 'スライス', exportCurrent: '現在の TIFF を出力', exportAll: 'TIFF スタックを出力', geometryUnavailable: '複数ページのスタックではサイズを変える操作はできません' },
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
    analysisTooLarge: '粒子解析は 400 万ピクセルまで対応します。画像を切り抜いてください。',
    filterTooLarge: '高度なフィルタは 400 万ピクセルまで対応します。画像を切り抜いてください。',
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
