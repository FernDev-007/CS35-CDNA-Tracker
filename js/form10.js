// Fills the AFCW Form 10 template for a CDNA.
// Works in the browser (pass window PDFLib) and in Node tests.

const F = 'topmostSubform[0].Page1[0].';
const FIELDS = {
  cadetName: F + 'TextField1[2]',   // 1. CADET NAME (Last, First, MI)
  classYear: F + 'TextField1[0]',   // 3. CLASS YEAR
  date:      F + 'DateField1[0]',   // 4. DATE
  narrative: F + 'TextField1[6]',   // Conduct narrative
  awarded:   F + 'DateField1[3]',   // VI-8. DATE AWARDED
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}
const pad = (n) => String(n).padStart(2, '0');

// 2026-10-12 -> "12 Oct"
export function ddMmm(iso) {
  const { m, d } = parts(iso);
  return `${pad(d)} ${MONTHS[m - 1]}`;
}

// 2026-10-12 -> "10/12/26"
export function mmddyy(iso) {
  const { y, m, d } = parts(iso);
  return `${pad(m)}/${pad(d)}/${pad(y % 100)}`;
}

// ["2026-10-12"] -> "12 Oct"; two days -> "09 Oct and 12 Oct"; three+ -> "12 Oct through 14 Oct"
export function dateSpan(dates) {
  const s = [...dates].sort();
  if (s.length === 1) return ddMmm(s[0]);
  if (s.length === 2) return `${ddMmm(s[0])} and ${ddMmm(s[1])}`;
  return `${ddMmm(s[0])} through ${ddMmm(s[s.length - 1])}`;
}

// "WOOD, AARON, M" (no middle name -> "CAPANNELLI, NICHOLAS")
export function formName({ lastName, firstName, middleName }) {
  const mi = (middleName || '').trim().charAt(0);
  return [lastName, firstName, mi].filter(Boolean).join(', ').toUpperCase();
}

export function narrative({ lastName, dates }) {
  return `\nCadet ${lastName}, based on performance, has earned a Closed Door No AMI on ${dateSpan(dates)}.`;
}

export function fileName({ lastName, dates }) {
  const s = [...dates].sort();
  const safe = lastName.replace(/[^A-Za-z0-9-]+/g, '');
  return `Form10_CDNA_${safe}_${s[0]}${s.length > 1 ? '_to_' + s[s.length - 1] : ''}.pdf`;
}

/**
 * info = { lastName, firstName, middleName, classYear, dates: ['YYYY-MM-DD', ...], issuedOn: 'YYYY-MM-DD' }
 * Returns the filled PDF as a Uint8Array. Fields stay editable so the rest of the form can be completed and signed.
 */
export async function buildForm10(PDFLib, templateBytes, info) {
  const doc = await PDFLib.PDFDocument.load(templateBytes);
  const form = doc.getForm();
  form.getTextField(FIELDS.cadetName).setText(formName(info));
  form.getTextField(FIELDS.classYear).setText(String(info.classYear));
  form.getTextField(FIELDS.date).setText(mmddyy(info.issuedOn));
  form.getTextField(FIELDS.narrative).setText(narrative(info));
  form.getTextField(FIELDS.awarded).setText(mmddyy(info.issuedOn));
  for (const name of Object.values(FIELDS)) form.getTextField(name).setFontSize(8);   // match the form's other text
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  form.updateFieldAppearances(font);
  return doc.save();
}
