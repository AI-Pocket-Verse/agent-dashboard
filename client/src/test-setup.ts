import '@testing-library/jest-dom'
import { useLocaleStore } from './lib/i18n'

// Tests assert against the Chinese source strings; jsdom reports en-US,
// so pin the locale to zh explicitly.
useLocaleStore.getState().setSetting('zh')
