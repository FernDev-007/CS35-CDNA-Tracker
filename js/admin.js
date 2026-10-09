import { db, configured, $, $$, esc, makeForm10, saveFile, setupNotice } from './shared.js';
import { CLASS_YEARS } from './config.js';
import { fmt } from './rules.js';

const app = $('#app');
let people = [];
let log = [];
let tab = 'award';
let editingId = null;

// ---------------------------------------------------------------- Helpers

function toast(msg, bad = false) {
  $$('.toast').forEach((old) => old.remove());
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.setAttribute('role', bad ? 'alert' : 'status');
  t.textContent = msg;
  document.body.append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3500);
}

// Small in-page dialog (Teams blocks window.prompt). Resolves to the typed text, '' if no input, or null if cancelled.
function ask({ title, message = '', label = '', required = false, okText = 'OK', input = true }) {
  const dlg = $('#ask');
  $('#ask-title').textContent = title;
  $('#ask-msg').textContent = message;
  $('#ask-msg').hidden = !message;
  $('#ask-field').hidden = !input;
  $('#ask-label').textContent = label;
  const field = $('#ask-input');
  field.value = '';
  field.required = input && required;
  $('#ask-ok').textContent = okText;
  dlg.showModal();
  if (input) field.focus();
  return new Promise((resolve) => {
    const done = (v) => { cleanup(); dlg.close(); resolve(v); };
    const onSubmit = (e) => { e.preventDefault(); if (field.required && !field.value.trim()) return field.reportValidity(); done(input ? field.value.trim() : ''); };
    const onCancel = (e) => { if (e.target.closest('[data-cancel]')) done(null); };
    const onEsc = (e) => { e.preventDefault(); done(null); };
    const cleanup = () => { $('#ask-form').removeEventListener('submit', onSubmit); dlg.removeEventListener('click', onCancel); dlg.removeEventListener('cancel', onEsc); };
    $('#ask-form').addEventListener('submit', onSubmit);
    dlg.addEventListener('click', onCancel);
    dlg.addEventListener('cancel', onEsc);
  });
}

const fullName = (p) => `${p.last_name}, ${p.first_name}${p.middle_name ? ' ' + p.middle_name : ''}`;
const mountainDate = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date(ts));
const when = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const nice = (msg) => String(msg || 'Something went wrong.').replace(/^.*?ERROR:\s*/, '');

// ---------------------------------------------------------------- Sign in

async function start() {
  if (!configured) return setupNotice(app);
  const { data: { session } } = await db.auth.getSession();
  if (!session) return renderLogin();
  const { data: isAdmin } = await db.rpc('am_i_admin');
  if (!isAdmin) {
    await db.auth.signOut();
    return renderLogin(`${session.user.email} isn't an admin. Ask an existing admin to add your email to the admins table.`);
  }
  $('#who').textContent = `Signed in as ${session.user.email}`;
  $('#signout').hidden = false;
  await Promise.all([loadPeople(), loadLog()]);
  render();
}

function renderLogin(error = '') {
  $('#signout').hidden = true;
  app.innerHTML = `
    <form class="panel login" id="login">
      <h2>Admin sign in</h2>
      <label class="field"><span>Email</span><input class="input" id="l-email" type="email" autocomplete="username" required></label>
      <label class="field"><span>Password</span><input class="input" id="l-pass" type="password" autocomplete="current-password" required></label>
      ${error ? `<p class="inline-error" role="alert">${esc(error)}</p>` : ''}
      <div class="actions"><button class="btn btn-primary" type="submit">Sign in</button></div>
    </form>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    e.submitter.disabled = true;
    const { error: err } = await db.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pass').value });
    if (err) return renderLogin(err.message === 'Invalid login credentials' ? 'Wrong email or password.' : err.message);
    start();
  });
}

$('#signout').addEventListener('click', async () => { await db.auth.signOut(); location.reload(); });

// ---------------------------------------------------------------- Data

async function loadPeople() {
  const { data, error } = await db.from('people').select('*').order('class_year').order('last_name').order('first_name');
  if (error) throw error;
  people = data;
}

async function loadLog() {
  const rows = [];
  for (let from = 0; ; from += 1000) {   // Supabase returns at most 1000 rows per call
    const { data, error } = await db.from('cdna_log')
      .select('*, people(last_name, first_name, middle_name, class_year)')
      .order('created_at', { ascending: false }).order('id', { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  log = rows;
}

async function refresh() {
  await Promise.all([loadPeople(), loadLog()]);
  render();
}

// ---------------------------------------------------------------- Layout

function render() {
  const tabs = [['award', 'Award CDNAs'], ['people', 'Roster'], ['history', 'History']];
  app.innerHTML = `
    <div class="tabs" role="tablist">
      ${tabs.map(([k, label]) => `<button role="tab" type="button" data-tab="${k}" aria-selected="${tab === k}">${label}</button>`).join('')}
    </div>
    <div id="panel"></div>`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  ({ award: renderAward, people: renderPeople, history: renderHistory })[tab]();
}

// ---------------------------------------------------------------- Award

function renderAward() {
  const active = people.filter((p) => p.active);
  $('#panel').innerHTML = `
    <form class="panel" id="award">
      <h2>Award or remove CDNAs</h2>
      <div class="row">
        <label class="field"><span>Action</span>
          <select class="input" id="a-dir"><option value="1">Award</option><option value="-1">Remove</option></select></label>
        <label class="field"><span>How many</span>
          <input class="input" id="a-n" type="number" min="1" max="20" value="1" style="width:90px" required></label>
        <label class="field grow"><span>Reason (required)</span>
          <input class="input" id="a-reason" required placeholder="e.g. Top room in SAMI, 6 Oct"></label>
      </div>
      <div class="row" style="margin-top:14px">
        <input class="search" id="a-filter" type="search" placeholder="Filter names" aria-label="Filter names">
        <button class="btn-link" type="button" id="a-clear">Clear selection</button>
      </div>
      <div class="picker">
        ${CLASS_YEARS.map((y) => {
          const list = active.filter((p) => p.class_year === y);
          return `<fieldset data-year="${y}">
            <legend>${y} <button class="btn-link" type="button" data-all="${y}">Select all</button></legend>
            <div class="opts">${list.map((p) => `
              <label data-name="${esc(fullName(p).toLowerCase())}">
                <input type="checkbox" value="${p.id}"> ${esc(p.last_name)}, ${esc(p.first_name)}
                <span class="bal">${p.balance}</span>
              </label>`).join('') || '<span class="muted">No one</span>'}</div>
          </fieldset>`;
        }).join('')}
      </div>
      <div class="actions"><button class="btn btn-primary" type="submit" id="a-go">Award</button></div>
    </form>`;

  const update = () => {
    const n = $$('#award input[type=checkbox]:checked').length;
    const k = +$('#a-n').value || 0;
    const verb = $('#a-dir').value === '1' ? 'Award' : 'Remove';
    $('#a-go').textContent = n ? `${verb} ${k} CDNA${k === 1 ? '' : 's'} ${verb === 'Award' ? 'to' : 'from'} ${n} ${n === 1 ? 'person' : 'people'}` : verb;
  };
  $('#award').addEventListener('change', update);
  $('#a-n').addEventListener('input', update);
  $('#a-filter').addEventListener('input', (e) => {
    const t = e.target.value.trim().toLowerCase();
    $$('#award .opts label').forEach((l) => { l.hidden = t && !l.dataset.name.includes(t); });
  });
  $('#a-clear').addEventListener('click', () => { $$('#award input[type=checkbox]').forEach((c) => (c.checked = false)); update(); });
  $$('[data-all]').forEach((b) => b.addEventListener('click', () => {
    const boxes = $$(`fieldset[data-year="${b.dataset.all}"] label:not([hidden]) input`);
    const on = boxes.some((c) => !c.checked);
    boxes.forEach((c) => (c.checked = on));
    update();
  }));
  $('#award').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ids = $$('#award input[type=checkbox]:checked').map((c) => c.value);
    if (!ids.length) return toast('Pick at least one person.', true);
    const amount = (+$('#a-n').value) * (+$('#a-dir').value);
    const btn = $('#a-go');
    btn.disabled = true;
    const { data, error } = await db.rpc('admin_award', { p_person_ids: ids, p_amount: amount, p_reason: $('#a-reason').value });
    btn.disabled = false;
    if (error) return toast(nice(error.message), true);
    toast(`${amount > 0 ? 'Awarded' : 'Removed'} ${Math.abs(amount)} CDNA${Math.abs(amount) === 1 ? '' : 's'} for ${data} ${data === 1 ? 'person' : 'people'}.`);
    await refresh();
  });
  update();
}

// ---------------------------------------------------------------- Roster

function renderPeople() {
  const showRemoved = $('#p-removed')?.checked ?? false;
  const edit = people.find((p) => p.id === editingId);
  const list = people.filter((p) => showRemoved || p.active);
  $('#panel').innerHTML = `
    <form class="panel" id="person">
      <h2>${edit ? `Edit ${esc(edit.first_name)} ${esc(edit.last_name)}` : 'Add a person'}</h2>
      <div class="row">
        <label class="field grow"><span>Last name</span><input class="input" id="p-last" required value="${esc(edit?.last_name)}"></label>
        <label class="field grow"><span>First name</span><input class="input" id="p-first" required value="${esc(edit?.first_name)}"></label>
        <label class="field grow"><span>Middle name</span><input class="input" id="p-mid" value="${esc(edit?.middle_name)}"></label>
      </div>
      <div class="row" style="margin-top:12px">
        <label class="field grow"><span>Email</span><input class="input" id="p-email" type="email" required value="${esc(edit?.email)}"></label>
        <label class="field"><span>Class year</span><input class="input" id="p-year" type="number" min="2000" max="2100" required style="width:110px" value="${edit?.class_year ?? ''}"></label>
      </div>
      <div class="actions">
        ${edit ? '<button class="btn" type="button" id="p-cancel">Cancel</button>' : ''}
        <button class="btn btn-primary" type="submit">${edit ? 'Save changes' : 'Add person'}</button>
      </div>
    </form>

    <div class="panel">
      <h2>Import roster</h2>
      <p class="hint">A CSV with one person per row: <code>"Last, First Middle",email,class year</code> (the same layout as the original roster).
        New emails are added with 0 CDNAs. Emails already on the roster get their name and class year updated. Balances never change.</p>
      <div class="row"><input type="file" id="p-file" accept=".csv,text/csv"><button class="btn" type="button" id="p-import" disabled>Import</button></div>
      <p class="hint" id="p-preview"></p>
    </div>

    <div class="panel">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
        <h2 style="margin:0">Roster (${people.filter((p) => p.active).length})</h2>
        <div class="row" style="align-items:center">
          <input class="search" id="p-filter" type="search" placeholder="Filter names or emails" aria-label="Filter">
          <label><input type="checkbox" id="p-removed" ${showRemoved ? 'checked' : ''}> Show removed</label>
        </div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Class</th><th class="num">CDNAs</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.map((p) => `
          <tr data-row="${esc((fullName(p) + ' ' + p.email).toLowerCase())}">
            <td>${esc(fullName(p))}</td>
            <td>${esc(p.email)}</td>
            <td>${p.class_year}</td>
            <td class="num">${p.balance}</td>
            <td>${!p.active ? '<span class="pill">Removed</span>' : p.on_probation ? '<span class="pill warn">On probation</span>' : ''}</td>
            <td style="white-space:nowrap">
              ${p.active ? `
                <button class="btn-link" type="button" data-prob="${p.id}">${p.on_probation ? 'End probation' : 'Probation'}</button> ·
                <button class="btn-link" type="button" data-edit="${p.id}">Edit</button> ·
                <button class="btn-link btn-danger" type="button" data-remove="${p.id}">Remove</button>`
              : `<button class="btn-link" type="button" data-restore="${p.id}">Restore</button>`}
            </td>
          </tr>`).join('')}</tbody>
      </table></div>
    </div>`;

  const byId = (id) => people.find((p) => p.id === id);

  $('#person').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { error } = await db.rpc('admin_save_person', {
      p_id: editingId, p_last: $('#p-last').value, p_first: $('#p-first').value, p_middle: $('#p-mid').value,
      p_email: $('#p-email').value, p_class_year: +$('#p-year').value,
    });
    if (error) return toast(/people_email_key|duplicate/.test(error.message) ? 'That email is already on the roster.' : nice(error.message), true);
    toast(editingId ? 'Changes saved.' : 'Person added.');
    editingId = null;
    await refresh();
  });
  $('#p-cancel')?.addEventListener('click', () => { editingId = null; renderPeople(); });
  $('#p-removed').addEventListener('change', renderPeople);
  $('#p-filter').addEventListener('input', (e) => {
    const t = e.target.value.trim().toLowerCase();
    $$('tr[data-row]').forEach((r) => { r.hidden = t && !r.dataset.row.includes(t); });
  });

  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => {
    editingId = b.dataset.edit; renderPeople(); window.scrollTo({ top: 0 }); $('#p-last').focus();
  }));
  $$('[data-prob]').forEach((b) => b.addEventListener('click', async () => {
    const p = byId(b.dataset.prob);
    const on = !p.on_probation;
    const reason = await ask({
      title: on ? `Put ${p.first_name} ${p.last_name} on probation?` : `End probation for ${p.first_name} ${p.last_name}?`,
      message: on ? "They won't be able to use CDNAs until probation ends. Their balance stays the same." : 'They can use CDNAs again.',
      label: 'Note for the history log (optional)', okText: on ? 'Put on probation' : 'End probation',
    });
    if (reason === null) return;
    const { error } = await db.rpc('admin_set_probation', { p_person_id: p.id, p_on: on, p_reason: reason });
    if (error) return toast(nice(error.message), true);
    toast(on ? 'On probation.' : 'Probation ended.');
    await refresh();
  }));
  $$('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const p = byId(b.dataset.remove);
    const ok = await ask({
      title: `Remove ${p.first_name} ${p.last_name}?`, input: false, okText: 'Remove',
      message: `They'll disappear from the board and can't request CDNAs. Their ${p.balance} CDNA(s) and history are kept, and you can restore them later.`,
    });
    if (ok === null) return;
    const { error } = await db.rpc('admin_set_active', { p_id: p.id, p_active: false });
    if (error) return toast(nice(error.message), true);
    toast('Removed from the roster.');
    await refresh();
  }));
  $$('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
    const { error } = await db.rpc('admin_set_active', { p_id: b.dataset.restore, p_active: true });
    if (error) return toast(nice(error.message), true);
    toast('Restored.');
    await refresh();
  }));

  // CSV import
  let parsed = [];
  $('#p-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const { rows, problems } = parseRoster(await file.text());
    parsed = rows;
    const known = new Set(people.map((p) => p.email));
    const adds = rows.filter((r) => !known.has(r.email)).length;
    $('#p-preview').innerHTML = `Found ${rows.length} people: ${adds} new, ${rows.length - adds} already on the roster.`
      + (problems.length ? `<br><span class="inline-error">Skipped ${problems.length} line(s): ${problems.map(esc).join('; ')}</span>` : '');
    $('#p-import').disabled = rows.length === 0;
  });
  $('#p-import').addEventListener('click', async () => {
    $('#p-import').disabled = true;
    const { data, error } = await db.rpc('admin_import_roster', { p_rows: parsed });
    if (error) { $('#p-import').disabled = false; return toast(nice(error.message), true); }
    toast(`Import done: ${data.added} added, ${data.updated} updated.`);
    await refresh();
  });
}

// Reads `"Last, First Middle",email,year` rows. Handles quotes, a header row, and Windows line endings.
function parseRoster(text) {
  const rows = [];
  const problems = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const cells = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    const [name, emailRaw, yearRaw] = cells.map((c) => c.trim());
    if (i === 0 && !/\d{4}/.test(yearRaw || '')) return; // header row
    const email = (emailRaw || '').toLowerCase();
    const year = parseInt(yearRaw, 10);
    const [last, rest = ''] = (name || '').split(/,(.*)/s).map((s) => (s || '').trim());
    const [first, ...middle] = rest.split(/\s+/).filter(Boolean);
    if (!last || !first) return problems.push(`line ${i + 1}: name should be "Last, First"`);
    if (!/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(email)) return problems.push(`line ${i + 1}: bad email "${emailRaw}"`);
    if (!(year >= 2000 && year <= 2100)) return problems.push(`line ${i + 1}: bad class year "${yearRaw}"`);
    rows.push({ last_name: last, first_name: first, middle_name: middle.join(' '), email, class_year: year });
  });
  return { rows, problems };
}

// ---------------------------------------------------------------- History

const KIND_LABEL = {
  award: 'Earned', use: 'Used', refund: 'Refunded', remove: 'Removed',
  probation_on: 'Probation started', probation_off: 'Probation ended',
};

const filters = { name: '', year: '', kind: '', from: '', to: '' };

function filteredLog() {
  const t = filters.name.trim().toLowerCase();
  return log.filter((l) => {
    const p = l.people;
    if (t && !fullName(p).toLowerCase().includes(t)) return false;
    if (filters.year && String(p.class_year) !== filters.year) return false;
    if (filters.kind && l.kind !== filters.kind) return false;
    const d = mountainDate(l.created_at);
    if (filters.from && d < filters.from) return false;
    if (filters.to && d > filters.to) return false;
    return true;
  });
}

function detail(l) {
  const days = l.dates?.length ? l.dates.map(fmt).join(', ') : '';
  if (l.kind === 'use') return days;
  if (l.kind === 'refund') return `${days}${l.reason ? '. ' + l.reason : ''}`;
  return l.reason || '';
}

function renderHistory() {
  const refunded = new Set(log.filter((l) => l.reverses).map((l) => l.reverses));
  const rows = filteredLog();
  $('#panel').innerHTML = `
    <div class="panel">
      <div class="row">
        <label class="field grow"><span>Name</span><input class="input" id="h-name" type="search" value="${esc(filters.name)}"></label>
        <label class="field"><span>Class</span><select class="input" id="h-year"><option value="">All</option>
          ${CLASS_YEARS.map((y) => `<option ${filters.year === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
        <label class="field"><span>Type</span><select class="input" id="h-kind"><option value="">All</option>
          ${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}" ${filters.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>From</span><input class="input" id="h-from" type="date" value="${filters.from}"></label>
        <label class="field"><span>To</span><input class="input" id="h-to" type="date" value="${filters.to}"></label>
        <button class="btn" type="button" id="h-csv">Export CSV</button>
      </div>
      <p class="hint" style="margin:12px 0 4px">${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>When</th><th>Cadet</th><th>Class</th><th>What</th><th class="num">Change</th><th>Details</th><th>By</th><th class="num">Balance</th><th></th></tr></thead>
        <tbody>${rows.map((l) => `
          <tr>
            <td style="white-space:nowrap">${esc(when(l.created_at))}</td>
            <td>${esc(l.people.last_name)}, ${esc(l.people.first_name)}</td>
            <td>${l.people.class_year}</td>
            <td>${KIND_LABEL[l.kind]}${l.kind === 'use' && refunded.has(l.id) ? ' <span class="pill">Refunded</span>' : ''}</td>
            <td class="num ${l.amount > 0 ? 'plus' : l.amount < 0 ? 'minus' : ''}">${l.amount > 0 ? '+' : ''}${l.amount || ''}</td>
            <td>${esc(detail(l))}</td>
            <td class="muted">${l.actor === 'self' ? 'Self' : esc(l.actor)}</td>
            <td class="num">${l.balance_after}</td>
            <td style="white-space:nowrap">${l.kind === 'use' ? `
              <button class="btn-link" type="button" data-form="${l.id}">Form 10</button>
              ${refunded.has(l.id) ? '' : ` · <button class="btn-link btn-danger" type="button" data-refund="${l.id}">Refund</button>`}` : ''}
            </td>
          </tr>`).join('') || '<tr><td colspan="9" class="muted">No entries match.</td></tr>'}</tbody>
      </table></div>
    </div>`;

  const bind = (id, key) => $(id).addEventListener(id === '#h-name' ? 'input' : 'change', (e) => {
    filters[key] = e.target.value;
    const pos = id === '#h-name' ? e.target.selectionStart : null;
    renderHistory();
    if (pos !== null) { const el = $('#h-name'); el.focus(); el.setSelectionRange(pos, pos); }
  });
  bind('#h-name', 'name'); bind('#h-year', 'year'); bind('#h-kind', 'kind'); bind('#h-from', 'from'); bind('#h-to', 'to');

  $('#h-csv').addEventListener('click', () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['When', 'Last name', 'First name', 'Class', 'What', 'Change', 'Details', 'By', 'Balance after'].map(cell).join(',')];
    for (const l of rows) {
      lines.push([when(l.created_at), l.people.last_name, l.people.first_name, l.people.class_year, KIND_LABEL[l.kind],
        l.amount, detail(l), l.actor === 'self' ? 'Self' : l.actor, l.balance_after].map(cell).join(','));
    }
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    saveFile(url, `cdna-history-${mountainDate(new Date())}.csv`);
  });

  $$('[data-form]').forEach((b) => b.addEventListener('click', async () => {
    const l = log.find((x) => String(x.id) === b.dataset.form);
    try {
      const { url, name } = await makeForm10({
        lastName: l.people.last_name, firstName: l.people.first_name, middleName: l.people.middle_name,
        classYear: l.people.class_year, dates: l.dates, issuedOn: mountainDate(l.created_at),
      });
      saveFile(url, name);
    } catch (err) { toast(err.message, true); }
  }));
  $$('[data-refund]').forEach((b) => b.addEventListener('click', async () => {
    const l = log.find((x) => String(x.id) === b.dataset.refund);
    const reason = await ask({
      title: `Refund ${l.people.first_name} ${l.people.last_name}?`,
      message: `Gives back ${-l.amount} CDNA${l.amount === -1 ? '' : 's'} and frees ${l.dates.map(fmt).join(', ')}.`,
      label: 'Reason (required)', required: true, okText: 'Refund',
    });
    if (reason === null) return;
    const { error } = await db.rpc('admin_refund', { p_log_id: l.id, p_reason: reason });
    if (error) return toast(nice(error.message), true);
    toast('Refunded.');
    await refresh();
  }));
}

start().catch((err) => { app.innerHTML = `<div class="notice">Couldn't load the admin page (${esc(err.message)}). Reload to try again.</div>`; });
