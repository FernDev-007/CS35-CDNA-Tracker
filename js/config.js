// Fill these in from Supabase > Project Settings > API (see README, step 3).
// The publishable/anon key is meant to be public; the database rules keep the data safe.
// Never put the "secret" or "service_role" key here.
export const SUPABASE_URL = 'https://tkzowdglpqeemwyrnwfk.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_-FZS8y1hu1A1g86UzZtGqQ_idFdbw4j';

// Shown at the top of the board.
export const SQUADRON_NAME = 'CS-35';

// Class years shown on the board, in this order.
export const CLASSES = [
  { year: 2030, color: '#B8232F' },   // red
  { year: 2029, color: '#A3ABB6' },   // silver
  { year: 2028, color: '#1F55B5' },   // blue
  { year: 2027, color: '#E5B31A' },   // yellow
];

export const CLASS_YEARS = CLASSES.map((c) => c.year);
export const classColor = (year) => CLASSES.find((c) => c.year === Number(year))?.color ?? '#172033';
