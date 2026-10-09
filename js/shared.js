import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { buildForm10, fileName } from './form10.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_KEY.startsWith('YOUR-');
export const db = configured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Builds the Form 10 and saves it. Returns the blob URL so a link can offer it again.
let pdfLib = null;
let template = null;
export async function makeForm10(info) {
  pdfLib ??= await import('https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm');
  template ??= await fetch(new URL('../assets/form10-template.pdf', import.meta.url)).then((r) => {
    if (!r.ok) throw new Error('Could not load the Form 10 template.');
    return r.arrayBuffer();
  });
  const bytes = await buildForm10(pdfLib, template, info);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  return { url, name: fileName(info) };
}

export function saveFile(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

export function setupNotice(el) {
  el.innerHTML = `<div class="notice"><strong>Almost there.</strong> Add your Supabase project URL and key to
    <code>js/config.js</code> (README, step 3), then reload this page.</div>`;
}
