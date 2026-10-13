import { $, esc, compsUrl } from '../util.js';
import { api } from '../data.js';
import { icon, toast } from '../ui.js';

export async function loadSources() {
  try {
    const sources = await api('/api/source-guides');
    $('#sourceGrid').innerHTML = sources.map((source) => `
      <a class="source-card" href="${esc(source.url)}" target="_blank" rel="noopener">
        <span class="source-logo" aria-hidden="true">${esc(source.name[0])}</span>
        <div>${source.kind ? `<span class="badge">${esc(source.kind)}</span>` : ''}<h3>${esc(source.name)}</h3><p>${esc(source.note)}</p></div>
        ${icon('external')}
      </a>`).join('');
  } catch (error) {
    $('#sourceGrid').innerHTML = `<div class="empty">${icon('alert')}<strong>Could not load sources</strong>${esc(error.message)}</div>`;
  }
}

export function initSources() {
  $('#compsForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const query = $('#compsQuery').value.trim();
    if (!query) {
      toast('Type what you are looking for first.', { type: 'error' });
      return;
    }
    const engine = event.submitter?.dataset.engine || 'ebay';
    window.open(compsUrl(engine, query), '_blank', 'noopener');
  });
}
