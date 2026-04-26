import type { SupportedLanguage } from '../i18n/config'

interface SeoFaqItem {
  question: string
  answer: string
}

interface SeoShellContent {
  eyebrow: string
  title: string
  description: string
  note: string
  featureHeading: string
  featureItems: string[]
  faqHeading: string
  faqItems: SeoFaqItem[]
  sampleHref: string
  sampleLabel: string
}

export const seoShellContentByLanguage: Record<SupportedLanguage, SeoShellContent> = {
  'zh-CN': {
    eyebrow: 'CSV 图表与数据分析工作台',
    title: '将 CSV 拖进来，立刻出图',
    description:
      'joplot 支持导入多个 CSV 或 Excel 文件，快速生成图表、筛选数据，并在同一工作区中对比多份数据集。',
    note: '启用 JavaScript 后会加载完整的交互式工作台。',
    featureHeading: '为什么团队会选择 joplot',
    featureItems: [
      '支持 CSV / Excel，多文件导入后可直接开始探索数据。',
      '在同一个工作区里筛选、对比并联动查看多份数据集。',
      '生成图表后可以继续复制图像、导出结果并沉淀分析结论。',
    ],
    faqHeading: '常见问题',
    faqItems: [
      {
        question: '可以一次比较多个 CSV 文件吗？',
        answer: '可以，joplot 支持同时导入多个数据文件，并在同一画布中对比不同数据集。',
      },
      {
        question: '除了 CSV 还能导入什么格式？',
        answer: '除了 CSV，也支持导入 Excel 文件，适合快速开始整理和可视化数据。',
      },
    ],
    sampleHref: '/samples/demo.csv',
    sampleLabel: '下载示例 CSV',
  },
  en: {
    eyebrow: 'CSV charting and data analysis workspace',
    title: 'Drop in a CSV and get a chart instantly',
    description:
      'joplot imports multiple CSV or Excel files, builds charts quickly, and helps teams compare datasets in one workspace.',
    note: 'The full interactive workspace loads when JavaScript is available.',
    featureHeading: 'Why teams use joplot',
    featureItems: [
      'Import CSV or Excel files and start exploring data without a setup step.',
      'Compare datasets in one workspace with shared filters and chart views.',
      'Copy chart images, export outputs, and keep analysis moving without extra tooling.',
    ],
    faqHeading: 'Frequently asked questions',
    faqItems: [
      {
        question: 'Can I compare multiple CSV files at once?',
        answer: 'Yes. joplot is built for importing multiple datasets and reviewing them side by side in one workspace.',
      },
      {
        question: 'Does joplot only support CSV uploads?',
        answer: 'No. You can import Excel files too, so teams can move from raw spreadsheets to charts faster.',
      },
    ],
    sampleHref: '/samples/demo.csv',
    sampleLabel: 'Download sample CSV',
  },
  'ja-JP': {
    eyebrow: 'CSV グラフとデータ分析ワークスペース',
    title: 'CSV をドロップすると、すぐにグラフ化',
    description:
      'joplot は複数の CSV / Excel ファイルを読み込み、グラフ作成、データの絞り込み、データセット比較を 1 つのワークスペースで進められます。',
    note: 'JavaScript が有効な環境では、完全なインタラクティブ UI が読み込まれます。',
    featureHeading: 'joplot が選ばれる理由',
    featureItems: [
      'CSV / Excel を読み込めば、すぐにデータ探索を始められます。',
      '共有フィルターとチャートビューで複数データセットを 1 画面で比較できます。',
      '作成したグラフは画像コピーや書き出しにもつなげやすく、分析の流れを止めません。',
    ],
    faqHeading: 'よくある質問',
    faqItems: [
      {
        question: '複数の CSV ファイルを同時に比較できますか？',
        answer: 'はい。joplot は複数データセットを 1 つのワークスペースで並べて比較できるように設計されています。',
      },
      {
        question: 'CSV 以外の形式も読み込めますか？',
        answer: 'はい。Excel ファイルにも対応しているため、表計算データからすぐに可視化へ進めます。',
      },
    ],
    sampleHref: '/samples/demo.csv',
    sampleLabel: 'サンプル CSV をダウンロード',
  },
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderSeoShell(language: SupportedLanguage): string {
  const content = seoShellContentByLanguage[language]
  const features = content.featureItems
    .map((item) => `          <li>${escapeHtml(item)}</li>`)
    .join('\n')
  const faqs = content.faqItems
    .map(
      (item) => `        <div class="seo-shell-faq-item">
          <h3>${escapeHtml(item.question)}</h3>
          <p>${escapeHtml(item.answer)}</p>
        </div>`,
    )
    .join('\n')

  return `<style id="seo-shell-styles">
      #seo-shell {
        margin: 0 auto;
        max-width: 1120px;
        padding: 48px 24px 56px;
        color: #111827;
        font-family: "Segoe UI", "PingFang SC", "Hiragino Sans", sans-serif;
      }
      #seo-shell .seo-shell-hero {
        display: grid;
        gap: 24px;
      }
      #seo-shell .seo-shell-eyebrow {
        margin: 0;
        color: #155eef;
        font-size: 0.82rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      #seo-shell h1 {
        margin: 0;
        font-size: clamp(2.4rem, 4vw, 4.25rem);
        line-height: 1.05;
      }
      #seo-shell p {
        margin: 0;
        max-width: 64ch;
        color: #4b5563;
        font-size: 1rem;
        line-height: 1.75;
      }
      #seo-shell .seo-shell-cta {
        display: inline-flex;
        width: fit-content;
        border-radius: 999px;
        background: #155eef;
        color: #ffffff;
        font-weight: 700;
        padding: 12px 18px;
        text-decoration: none;
      }
      #seo-shell .seo-shell-grid {
        display: grid;
        gap: 20px;
        margin-top: 40px;
      }
      #seo-shell .seo-shell-card {
        border: 1px solid #dbe2ea;
        border-radius: 24px;
        padding: 24px;
        background: #ffffff;
      }
      #seo-shell h2,
      #seo-shell h3 {
        margin: 0 0 12px;
        color: #111827;
      }
      #seo-shell ul {
        margin: 0;
        padding-left: 20px;
        color: #374151;
        line-height: 1.75;
      }
      #seo-shell .seo-shell-faq-item + .seo-shell-faq-item {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid #e5e7eb;
      }
      @media (min-width: 880px) {
        #seo-shell .seo-shell-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <main id="seo-shell" data-language="${escapeHtml(language)}">
      <section class="seo-shell-hero">
        <p class="seo-shell-eyebrow">${escapeHtml(content.eyebrow)}</p>
        <h1>${escapeHtml(content.title)}</h1>
        <p>${escapeHtml(content.description)}</p>
        <p>${escapeHtml(content.note)}</p>
        <a class="seo-shell-cta" href="${escapeHtml(content.sampleHref)}">${escapeHtml(content.sampleLabel)}</a>
      </section>
      <section class="seo-shell-grid" aria-label="joplot seo summary">
        <div class="seo-shell-card">
          <h2>${escapeHtml(content.featureHeading)}</h2>
          <ul>
${features}
          </ul>
        </div>
        <div class="seo-shell-card">
          <h2>${escapeHtml(content.faqHeading)}</h2>
${faqs}
        </div>
      </section>
    </main>`
}
