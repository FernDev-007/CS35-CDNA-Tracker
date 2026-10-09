import { db, configured, $, $$, esc, makeForm10, saveFile, setupNotice } from './shared.js';
import { SQUADRON_NAME, CLASS_YEARS, classColor } from './config.js';
import { checkRequest, fmt, todayMountain } from './rules.js';

const board = $('#board');
const dialog = $('#request');
const body = $('#req-body');
const title = $('#req-title');
let people = [];

$('#subtitle').textContent = `Closed Door No AMI balances for ${SQUADRON_NAME}`;

// ---------------------------------------------------------------- Board

async function loadBoard() {
  if (!configured) return setupNotice(board);
  const { data, error } = await db.rpc('get_board');
  if (error) {
    board.innerHTML = `<div class="notice">The board couldn't load (${esc(error.message)}). Reload to try again.</div>`;
    return;
  }
  people = data;
  renderBoard();
  $('#updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function renderBoard() {
  const term = $('#search').value.trim().toLowerCase();
  const match = (p) => !term || `${p.first_name} ${p.last_name} ${p.last_name}, ${p.first_name}`.toLowerCase().includes(term);
  board.innerHTML = CLASS_YEARS.map((year) => {
    const all = people.filter((p) => p.class_year === year);
    const shown = all.filter(match);
    const total = all.reduce((n, p) => n + p.balance, 0);
    const rows = shown.length
      ? shown.map((p) => `
          <li class="person">
            <span class="name"><b>${esc(p.last_name)}</b>, ${esc(p.first_name)}</span>
            <span class="tag${p.balance === 0 ? ' zero' : ''}" aria-label="${p.balance} CDNAs">${p.balance}</span>
          </li>`).join('')
      : `<li class="empty">${all.length ? 'No names match.' : 'No one in this class yet.'}</li>`;
    return `
      <section class="class" aria-label="Class of ${year}" style="--class-color:${classColor(year)}">
        <div class="class-head">
          <h2>${year}</h2>
          <span class="meta">${all.length} cadets, ${total} CDNAs</span>
        </div>
        <ul class="people">${rows}</ul>
      </section>`;
  }).join('');
}

$('#search').addEventListener('input', renderBoard);

// ---------------------------------------------------------------- Request flow

let me = null;            // the person requesting (from cdna_lookup)
let email = '';
let mode = 'single';      // 'single' | 'multi'
let days = [''];          // picked dates, YYYY-MM-DD

$('#open-request').addEventListener('click', () => {
  if (!configured) return alert('The tracker isn\'t connected to its database yet. See README step 3.');
  me = null; mode = 'single'; days = [''];
  stepEmail();
  dialog.showModal();
});
dialog.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') || e.target === dialog) dialog.close();
});

function busy(btn, label) {
  btn.disabled = true;
  btn.dataset.label = btn.textContent;
  btn.textContent = label;
}
function unbusy(btn) {
  btn.disabled = false;
  btn.textContent = btn.dataset.label;
}

// Step 1: email
function stepEmail(error = '') {
  title.textContent = 'Request a CDNA';
  dialog.classList.remove('in-class');
  body.innerHTML = `
    <form id="f-email" novalidate>
      <label class="field">
        <span>Your email</span>
        <input class="input" id="email" type="email" autocomplete="email" required value="${esc(email)}"
               placeholder="c29first.last@afacademy.af.edu">
      </label>
      ${error ? `<p class="inline-error" role="alert">${esc(error)}</p>` : ''}
      <div class="actions">
        <button class="btn" type="button" data-close>Cancel</button>
        <button class="btn btn-primary" type="submit">Continue</button>
      </div>
    </form>`;
  const input = $('#email');
  input.focus();
  $('#f-email').addEventListener('submit', async (e) => {
    e.preventDefault();
    email = input.value.trim();
    if (!email) return stepEmail('Enter your email.');
    const btn = e.submitter;
    busy(btn, 'Checking…');
    const { data, error: err } = await db.rpc('cdna_lookup', { p_email: email });
    if (err) { unbusy(btn); return stepEmail(`Something went wrong checking your email (${err.message}). Try again.`); }
    if (!data.found) return stepEmail("That email isn't on the roster. Check the spelling, or ask an admin to add you.");
    me = data;
    dialog.style.setProperty('--class-color', classColor(me.class_year));
    dialog.classList.add('in-class');
    stepDays();
  });
}

// Step 2: pick days
function stepDays() {
  title.textContent = `${me.first_name} ${me.last_name}`;
  const today = me.today || todayMountain();
  const upcoming = me.booked_days || [];
  const dayRows = days.map((d, i) => `
    <div class="day-row">
      <input class="input" type="date" data-day="${i}" value="${esc(d)}" min="${today}"
             aria-label="${mode === 'single' ? 'Day' : `Day ${i + 1}`}">
      ${mode === 'multi' && days.length > 1 ? `<button class="x" type="button" data-remove="${i}" aria-label="Remove day ${i + 1}">&times;</button>` : ''}
    </div>`).join('');

  body.innerHTML = `
    <div class="balance-line">
      <span class="tag${me.balance === 0 ? ' zero' : ''}">${me.balance}</span>
      <span>CDNA${me.balance === 1 ? '' : 's'} available${me.on_probation ? ' <span class="pill warn">On probation</span>' : ''}</span>
    </div>
    <div class="seg" role="group" aria-label="Length">
      <button type="button" data-mode="single" aria-pressed="${mode === 'single'}">Single day</button>
      <button type="button" data-mode="multi" aria-pressed="${mode === 'multi'}">Multiple days</button>
    </div>
    <div id="days">${dayRows}</div>
    ${mode === 'multi' ? '<button class="btn-link" type="button" id="add-day">Add a day</button>' : ''}
    <p class="hint">${mode === 'multi'
      ? 'Weekdays in a row, one CDNA per day. Friday then Monday counts as in a row.'
      : 'Weekdays only.'}</p>
    ${upcoming.length ? `<p class="hint">You already have a CDNA on ${upcoming.map(fmt).join(', ')}.</p>` : ''}
    <div class="actions">
      <button class="btn" type="button" id="back">Back</button>
      <button class="btn btn-primary" type="button" id="review">Review</button>
    </div>`;

  $$('[data-day]', body).forEach((el) => el.addEventListener('change', () => { days[+el.dataset.day] = el.value; }));
  $$('[data-mode]', body).forEach((el) => el.addEventListener('click', () => {
    mode = el.dataset.mode;
    days = mode === 'single' ? [days[0] || ''] : (days.length > 1 ? days : [days[0] || '', '']);
    stepDays();
  }));
  $$('[data-remove]', body).forEach((el) => el.addEventListener('click', () => { days.splice(+el.dataset.remove, 1); stepDays(); }));
  $('#add-day')?.addEventListener('click', () => {
    const last = [...days].filter(Boolean).sort().pop();
    days.push(last ? nextSuggestion(last) : '');
    stepDays();
  });
  $('#back').addEventListener('click', () => stepEmail());
  $('#review').addEventListener('click', () => {
    days = $$('[data-day]', body).map((el) => el.value);
    const picked = days.filter(Boolean);
    const errors = checkRequest({
      dates: picked, today, balance: me.balance, onProbation: me.on_probation, bookedDays: upcoming,
    });
    if (errors.length) return stepFailed(errors);
    stepConfirm(picked.sort());
  });
  $('[data-day]', body)?.focus();
}

// Suggest the next weekday after the last picked day
function nextSuggestion(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}

// Step 3: confirm
function stepConfirm(picked) {
  const n = picked.length;
  title.textContent = 'Confirm your CDNA';
  body.innerHTML = `
    <p>Use <strong>${n} CDNA${n === 1 ? '' : 's'}</strong> for:</p>
    <ul class="summary">${picked.map((d) => `<li>${fmt(d)}</li>`).join('')}</ul>
    <p class="hint">You'll have ${me.balance - n} left. Your Form 10 downloads as soon as this goes through.</p>
    <div class="actions">
      <button class="btn" type="button" id="back">Change days</button>
      <button class="btn btn-primary" type="button" id="go">Use ${n} CDNA${n === 1 ? '' : 's'}</button>
    </div>`;
  $('#back').addEventListener('click', stepDays);
  $('#go').addEventListener('click', async (e) => {
    busy(e.target, 'Submitting…');
    $('#back').disabled = true;
    const { data, error } = await db.rpc('request_cdna', { p_email: email, p_dates: picked });
    if (error) return stepFailed([`The request couldn't be sent (${error.message}). Nothing was used. Try again.`]);
    if (!data.ok) {
      if (typeof data.balance === 'number') me.balance = data.balance;
      return stepFailed(data.errors);
    }
    loadBoard();
    stepDone(data);
  });
}

// Step 4a: it worked
async function stepDone(r) {
  title.textContent = 'CDNA approved';
  body.innerHTML = `
    <div class="result good" role="status">
      <h3>You're set for ${r.dates.map(fmt).join(', ')}</h3>
      <p style="margin:0">${r.used} CDNA${r.used === 1 ? '' : 's'} used. ${r.balance} left.</p>
    </div>
    <p id="form-status">Making your Form 10…</p>
    <div class="actions">
      <button class="btn btn-primary" type="button" data-close>Done</button>
    </div>`;
  const status = $('#form-status');
  try {
    const { url, name } = await makeForm10({
      lastName: r.last_name, firstName: r.first_name, middleName: r.middle_name,
      classYear: r.class_year, dates: r.dates, issuedOn: r.issued_on,
    });
    saveFile(url, name);
    status.innerHTML = `Your Form 10 downloaded. Didn't get it?
      <a href="${url}" download="${esc(name)}">Download Form 10</a> or
      <a href="${url}" target="_blank" rel="noopener">open it in a new tab</a>.`;
  } catch (err) {
    status.innerHTML = `<span class="inline-error">Your CDNA went through, but the Form 10 couldn't be made (${esc(err.message)}).
      Ask an admin to download it for you from the history log.</span>`;
  }
}

// Step 4b: it didn't
function stepFailed(errors) {
  title.textContent = 'Request a CDNA';
  body.innerHTML = `
    <div class="result bad" role="alert">
      <h3>You can't use this CDNA</h3>
      <ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
    </div>
    <p class="hint">Nothing was used.</p>
    <div class="actions">
      <button class="btn" type="button" data-close>Close</button>
      <button class="btn btn-primary" type="button" id="back">Change days</button>
    </div>`;
  $('#back').addEventListener('click', stepDays);
}

loadBoard();
// Keep the board fresh when someone leaves the tab open in Teams.
document.addEventListener('visibilitychange', () => { if (!document.hidden && configured) loadBoard(); });
