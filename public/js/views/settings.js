import { $, esc } from '../util.js';
import { state, api, saveAi, saveSettings } from '../data.js';
import { icon, toast, busy, confirmDialog } from '../ui.js';

const SOURCE_LABEL = { app: 'saved in app', env: 'from environment', default: 'default', draft: 'unsaved' };

function renderKeyStatus() {
  const ai = state.ai;
  const status = $('#keyStatus');
  if (!ai || !status) return;
  if (!ai.openai?.keySet) {
    status.innerHTML = `<span>${icon('info')} Add your OpenAI API key to use Hunt and build Depop packs.</span>`;
    return;
  }
  const source = ai.sources?.openaiApiKey;
  status.innerHTML = `<span>Current key <code>${esc(ai.openai.keyPreview)}</code> · ${esc(SOURCE_LABEL[source] || source || '')}</span>
    ${source === 'app' ? `<button class="link-btn" type="button" id="keyRemove">${icon('trash')}Remove saved key</button>` : ''}`;
}

export function renderAiStatus() {
  const ai = state.ai;
  if (!ai) return;
  const chip = $('#aiStatusChip');
  if (chip) {
    chip.className = `status-chip ${ai.configured ? 'ok' : 'warn'}`;
    chip.innerHTML = ai.configured ? `${icon('check')}Ready` : `${icon('alert')}Needs a key`;
  }
  const name = $('#aiName');
  const model = $('#aiModel');
  const dot = $('#aiDot');
  if (name) name.textContent = ai.configured ? 'OpenAI ready' : 'Add OpenAI key';
  if (model) model.textContent = ai.openai?.model || ai.model || 'OpenAI';
  if (dot) dot.className = `ai-dot ${ai.configured ? 'ok' : 'bad'}`;
}

function showResult(result) {
  const box = $('#aiTestResult');
  box.hidden = false;
  box.className = `test-result ${result.ok ? 'ok' : 'bad'}`;
  box.innerHTML = `${icon(result.ok ? 'check' : 'alert')}<div>${esc(result.message)}${result.latencyMs ? `<small>${result.latencyMs} ms</small>` : ''}</div>`;
}

export function fillAiForm() {
  const ai = state.ai;
  if (!ai) return;
  const form = $('#aiForm');
  form.elements.openaiModel.value = ai.openai?.model || ai.model || 'gpt-6-luna';
  form.elements.openaiApiKey.value = '';
  form.elements.openaiApiKey.placeholder = ai.openai?.keySet ? `${ai.openai.keyPreview} — paste a new key to replace` : 'sk-…';
  renderKeyStatus();
  renderAiStatus();
}

export function fillSettingsForm() {
  const form = $('#settingsForm');
  for (const [key, value] of Object.entries(state.settings || {})) {
    if (form.elements[key] && document.activeElement !== form.elements[key]) form.elements[key].value = value;
  }
}

function aiPatch() {
  const form = $('#aiForm');
  const patch = {};
  const model = form.elements.openaiModel.value.trim();
  if (model && model !== state.ai?.openai?.model) patch.openaiModel = model;
  const key = form.elements.openaiApiKey.value.trim();
  if (key) patch.openaiApiKey = key;
  return patch;
}

async function testAi() {
  const btn = $('#aiTest');
  busy(btn, true);
  try {
    showResult(await api('/api/ai-config/test', { body: aiPatch() }));
  } catch (error) {
    showResult({ ok: false, message: error.message });
  } finally {
    busy(btn, false);
  }
}

async function submitAi(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const btn = $('#aiSave');
  busy(btn, true);
  try {
    const hadNewKey = Boolean(event.currentTarget.elements.openaiApiKey.value.trim());
    const patch = aiPatch();
    if (Object.keys(patch).length) await saveAi(patch);
    fillAiForm();
    $('#aiTestResult').hidden = true;
    toast(hadNewKey ? 'OpenAI key saved' : 'AI settings saved', { type: 'success' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    busy(btn, false);
  }
}

async function removeKey() {
  const fallback = state.ai?.sources?.openaiApiKey === 'app'
    ? 'FlipLab will fall back to the OPENAI_API_KEY environment variable if one is set.'
    : '';
  const ok = await confirmDialog({
    title: 'Remove saved API key?',
    body: `The saved key will be deleted from this server. ${fallback}`,
    confirmLabel: 'Remove key'
  });
  if (!ok) return;
  try {
    await saveAi({ openaiApiKey: '' });
    fillAiForm();
    toast('Saved key removed', { type: 'success' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  }
}

export function initSettings({ onThemeChange, currentTheme }) {
  $('#aiForm').addEventListener('submit', submitAi);
  $('#aiTest').addEventListener('click', testAi);
  $('#keyStatus').addEventListener('click', (event) => {
    if (event.target.closest('#keyRemove')) removeKey();
  });
  $('#keyReveal').addEventListener('click', () => {
    const field = $('#openaiKey');
    const show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    $('#keyReveal').innerHTML = icon(show ? 'eye-off' : 'eye');
    $('#keyReveal').setAttribute('aria-label', show ? 'Hide key' : 'Show key');
  });

  $('#settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    for (const key of Object.keys(data)) data[key] = Number(data[key]) || 0;
    const btn = event.submitter;
    busy(btn, true);
    try {
      await saveSettings(data);
      fillSettingsForm();
      toast('Depop economics saved', { type: 'success' });
    } catch (error) {
      toast(error.message, { type: 'error' });
    } finally {
      busy(btn, false);
    }
  });

  const themeChoice = $('#themeChoice');
  const radio = themeChoice.querySelector(`input[value="${currentTheme}"]`);
  if (radio) radio.checked = true;
  themeChoice.addEventListener('change', (event) => onThemeChange(event.target.value));
}

export function syncThemeChoice(theme) {
  const radio = $(`#themeChoice input[value="${theme}"]`);
  if (radio) radio.checked = true;
}
