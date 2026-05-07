export const DEFAULT_EVENT_TYPES = [
  { id: 'travel', name: 'Travel', alerts: [10080, 1440], permanent: false },
  { id: 'hangout', name: 'Hangout', alerts: [1440, 60], permanent: false },
  { id: 'subscription', name: 'Subscription', alerts: [10080], permanent: false },
  { id: 'other', name: 'Other', alerts: [60], permanent: true },
];

export function minutesToDisplay(minutes) {
  if (minutes % 10080 === 0) return { value: minutes / 10080, unit: 'weeks' };
  if (minutes % 1440 === 0) return { value: minutes / 1440, unit: 'days' };
  if (minutes % 60 === 0) return { value: minutes / 60, unit: 'hours' };
  return { value: minutes, unit: 'minutes' };
}

export function displayToMinutes(value, unit) {
  const mul = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };
  return Math.max(1, Math.round(Number(value))) * (mul[unit] ?? 1);
}

export function formatAlert(minutes) {
  const { value, unit } = minutesToDisplay(minutes);
  const label = value === 1 ? unit.replace(/s$/, '') : unit;
  return `${value} ${label} before`;
}
