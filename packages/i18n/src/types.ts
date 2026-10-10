export type TranslationParams = Record<string, string | number | undefined>

export type TranslationValue = string | ((params: any) => string)

export interface TranslationDictionary {
  [key: string]: TranslationDictionary | TranslationValue
}
