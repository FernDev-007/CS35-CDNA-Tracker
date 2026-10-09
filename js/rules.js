// The CDNA rules, checked in the browser so people get instant feedback.
// The database checks the exact same rules again (supabase/schema.sql, request_cdna),
// and the database always has the final say.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toDate = (iso) => new Date(iso + 'T12:00:00Z');
const weekday = (iso) => toDate(iso).getUTCDay(); // 0 = Sun, 6 = Sat
const isWeekend = (iso) => [0, 6].includes(weekday(iso));

export function addDays(iso, n) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "Tue 13 Oct"
export function fmt(iso) {
  const d = toDate(iso);
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// Friday -> Monday, otherwise the next day
export function nextWeekday(iso) {
  const w = weekday(iso);
  return addDays(iso, w === 5 ? 3 : w === 6 ? 2 : 1);
}

// Today's date in Mountain time, as YYYY-MM-DD
export function todayMountain() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date());
}

/**
 * Returns a list of reasons the request can't go through (empty list = OK).
 * Messages match the database word for word.
 */
export function checkRequest({ dates, today, balance, onProbation, bookedDays = [] }) {
  const errors = [];
  const picked = dates.filter(Boolean);
  if (picked.length === 0) return ['Pick at least one day.'];

  const unique = [...new Set(picked)].sort();
  if (unique.length !== picked.length) errors.push('The same day was picked more than once.');

  if (onProbation) errors.push("You can't use a CDNA while on probation.");

  const past = unique.filter((d) => d < today);
  if (past.length) errors.push(`CDNA days can't be in the past (${past.map(fmt).join(', ')}).`);

  const weekend = unique.filter(isWeekend);
  if (weekend.length) errors.push(`CDNAs can only be used on weekdays (${weekend.map(fmt).join(', ')} is a weekend).`);

  const weekdays = unique.filter((d) => !isWeekend(d));
  for (let i = 1; i < weekdays.length; i++) {
    if (weekdays[i] !== nextWeekday(weekdays[i - 1])) {
      errors.push(`Multi-day CDNAs must be back-to-back weekdays (there's a gap between ${fmt(weekdays[i - 1])} and ${fmt(weekdays[i])}).`);
      break;
    }
  }

  const overlap = unique.filter((d) => bookedDays.includes(d));
  if (overlap.length) errors.push(`You already have a CDNA on ${overlap.map(fmt).join(', ')}.`);

  if (balance === 0) errors.push("You don't have any CDNAs left.");
  else if (unique.length > balance) errors.push(`This request needs ${unique.length} CDNAs but you only have ${balance}.`);

  return errors;
}
