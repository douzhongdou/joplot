import { Languages } from 'lucide-react'
import appIcon from '../icon.svg'
import { SelectMenu } from './SelectMenu'
import { SUPPORTED_LANGUAGES, useI18n, type SupportedLanguage } from '../i18n'

export function AppNavbar() {
  const { language, setLanguage, t } = useI18n()

  const languageOptions = SUPPORTED_LANGUAGES.map((option) => ({
    value: option,
    label: t(`language.options.${option}`),
  }))

  return (
    <header className="flex h-[var(--navbar-height)] items-center justify-between gap-4 border-b border-base-300 bg-base-100 px-5">
      <div className="flex min-w-0 items-center gap-3">
        <div className="size-9 overflow-hidden rounded-xl">
          <img src={appIcon} alt="" className="block size-full object-contain" />
        </div>

        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-base-content">joplot</h1>
        </div>
      </div>

      <div className="min-w-0">
        <SelectMenu<SupportedLanguage>
          value={language}
          options={languageOptions}
          onChange={setLanguage}
          placeholder={t('language.label')}
          triggerAriaLabel={t('language.label')}
          align="right"
          buttonClassName="h-9 w-9 justify-center rounded-xl border-0 bg-transparent px-0 shadow-none hover:bg-transparent focus-visible:ring-0"
          menuClassName="min-w-[9rem]"
          renderTrigger={(_, open) => (
            <Languages
              size={17}
              strokeWidth={2.1}
              className={`shrink-0 transition ${open ? 'text-primary' : 'text-base-content/72'}`}
              aria-hidden="true"
            />
          )}
        />
      </div>
    </header>
  )
}
