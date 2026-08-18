import { useLocaleStore } from './i18n'

// Follows the in-app language switch (not just the system locale). App.tsx
// subscribes to the locale store, so switching language re-renders callers
// and this non-reactive read picks up the new locale.
export function formatDateTime(timestamp: number | string | Date) {
  const locale = useLocaleStore.getState().locale === 'zh' ? 'zh-CN' : 'en-US'
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}
