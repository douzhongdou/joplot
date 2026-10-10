/**
 * 「这一操作只作用于当前切片，还是整个 Stack？」的询问文案。
 *
 * 命令目录里的滤镜、阈值、二值化、数学运算都要问同一个问题，所以文案必须与
 * 具体命令无关 —— 亮度/对比度面板自己那份措辞（"将当前亮度/对比度设置…"）说明不了滤镜。
 *
 * 之所以要有这份共享文案：顶栏左侧原先常驻一个「应用到整个 Stack（关闭时仅当前切片）」
 * 复选框，而亮度/对比度面板在应用时又弹一次同样的窗 —— 同一个问题问两遍，
 * 面板那条路径根本不读复选框。现在只保留弹窗，复选框已移除。
 */
export const SCOPE_PROMPT = {
  'zh-CN': {
    title: '应用到整个 Stack？',
    hint: '将当前设置应用到所有切片？',
    current: '仅当前切片',
    all: '整个 Stack',
    cancel: '取消',
  },
  en: {
    title: 'Apply to Entire Stack?',
    hint: 'Apply the current settings to all slices?',
    current: 'Current slice',
    all: 'Entire Stack',
    cancel: 'Cancel',
  },
  'ja-JP': {
    title: 'スタック全体に適用？',
    hint: '現在の設定をすべてのスライスに適用しますか？',
    current: '現在のスライス',
    all: 'スタック全体',
    cancel: 'キャンセル',
  },
} as const
