export { en } from './en'
export { es } from './es'
export { fr } from './fr'
export { de } from './de'
export { zh } from './zh'
export { pt } from './pt'
export { ja } from './ja'
export type { Messages } from './types'

import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { de } from './de'
import { zh } from './zh'
import { pt } from './pt'
import { ja } from './ja'
import type { Messages } from './types'

export type Locale = 'en' | 'es' | 'fr' | 'de' | 'zh' | 'pt' | 'ja'

export const ALL_MESSAGES: Record<Locale, Messages> = { en, es, fr, de, zh, pt, ja }

export const LOCALES: { value: Locale; label: string; flag: string }[] = [
  { value: 'en', label: 'English', flag: '🇺🇸' },
  { value: 'es', label: 'Español', flag: '🇪🇸' },
  { value: 'fr', label: 'Français', flag: '🇫🇷' },
  { value: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'zh', label: '中文', flag: '🇨🇳' },
  { value: 'pt', label: 'Português', flag: '🇧🇷' },
  { value: 'ja', label: '日本語', flag: '🇯🇵' },
]
