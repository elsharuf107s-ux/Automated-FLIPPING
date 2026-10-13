import { $, $$, esc } from '../util.js';
import { state, api, saveAi, saveSettings } from '../data.js';
import { icon, toast, busy, confirmDialog } from '../ui.js';

const SOURCE_LABEL = { app: 'saved in app', env: 'from environment', default: 'default', draft: 'unsaved' };

function selectedProvider() {
  return $('#aiForm').elements.provider.value || state.ai?.provider || 'openai';
}

function showProviderFields() {
  const provider = selectedProvider();
  $$('.provider-fields').forEach((group) => group.classList.toggle('active', group.dataset.provider === provider));
}

function renderKeyStatus() {
  const ai = state.ai;
  const status = $('#keyStatus');
  if (!ai) return;
  if (!ai.openai.keySet) {
    status.innerHTML = `<span>${icon('info')} No key set — paste one above. Get a key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.</span>`;
    return;
  }
  const source = ai.sources.openaiApiKey;
  status.innerHTML = `<span>Current key <code>${esc(ai.openai.keyPreview)}</code> · ${esc(SOURCE_LABEL[source] || source)}</span>
    ${source === 'app' ? `<button class="link-btn" type="button" id="keyRemove">${icon('trash')}Remove saved key</button>` : ''}`;
}

export function renderAiStatus() {
  const ai = state.ai;
  if (!ai) return;
  const chip = $('#aiStatusChip');
  if (ai.provider === 'demo') {
    chip.className = 'status-chip';
    chip.innerHTML = 'Demo mode';
  } else if (ai.configured) {
    chip.className = 'status-chip ok';
    chip.innerHTML = `${icon('check')}Ready`;
  } else {
    chip.className = 'status-chip warn';
    chip.innerHTML = `${icon('alert')}Needs a key`;
  }
  // Sidebar card
  const names = { openai: 'OpenAI', ollama: 'Ollama', demo: 'Demo scorer' };
  $('#aiName').textContent = ai.provider === 'openai' && !ai.configured ? 'Add an API key' : `${names[ai.provider]} AI`;
  $('#aiModel').textContent = ai.provider === 'demo' ? 'offline scoring' : ai.model;
  $('#aiDot').className = `ai-dot ${ai.configured ? 'ok' : ai.provider === 'demo' ? 'warn' : 'bad'}`;
}

export function fillAiForm() {
  const ai = state.ai;
  if (!ai) return;
  const form = $('#aiForm');
  form.elements.provider.value = ai.provider;
  form.elements.openaiModel.value = ai.openai.model;
  form.elements.ollamaBaseUrl.value = ai.ollama.baseUrl;
  form.elements.ollamaModel.value = ai.ollama.model;
  form.elements.openaiApiKey.value = '';
  form.elements.openaiApiKey.placeholder = ai.openai.keySet ? `${ai.openai.keyPreview} — paste a new key to replace` : 'sk-…';
  showProviderFields();
  renderKeyStatus();
  renderAiStatus();
}

export function fillSettingsForm() {
  const form = $('#settingsForm');
  for (const [key, value] of Object.entries(state.settings)) {
    if (form.elements[key] && document.activeElement !== form.elements[key]) form.elements[key].value = value;
  }
}

// Only send values the user actually changed, so settings that come from
// environment variables keep following the environment.
function aiPatch() {
  const form = $('#aiForm');
  const ai = state.ai;
  const current = {
    provider: ai?.provider,
    openaiModel: ai?.openai.model,
    ollamaBaseUrl: ai?.ollama.baseUrl,
    ollamaModel: ai?.ollama.model
  };
  const values = {
    provider: selectedProvider(),
    openaiModel: form.elements.openaiModel.value.trim(),
    ollamaBaseUrl: form.elements.ollamaBaseUrl.value.trim(),
    ollamaModel: form.elements.ollamaModel.value.trim()
  };
  const patch = {};
  for (const [key, value] of Object.entries(values)) if (value !== current[key]) patch[key] = value;
  const key = form.elements.openaiApiKey.value.trim();
  if (key) patch.openaiApiKey = key; // blank means "keep the current key"
  return patch;
}

function showTestResult(result) {
  const box = $('#aiTestResult');
  box.hidden = false;
  box.className = `test-result ${result.ok ? 'ok' : 'bad'}`;
  box.innerHTML = `${icon(result.ok ? 'check' : 'alert')}<div>${esc(result.message)}${result.latencyMs ? `<small>${result.latencyMs} ms</small>` : ''}</div>`;
}

async function testAi() {
  const btn = $('#aiTest');
  busy(btn, true);
  try {
    showTestResult(await api('/api/ai-config/test', { body: aiPatch() }));
  } catch (error) {
    showTestResult({ ok: false, message: error.message });
  } finally {
    busy(btn, false);
  }
}

async function submitAi(event) {
  event.preventDefault();
  const form = $('#aiForm');
  if (!form.reportValidity()) return;
  const btn = $('#aiSave');
  busy(btn, true);
  try {
    const hadNewKey = Boolean(form.elements.openaiApiKey.value.trim());
    await saveAi(aiPatch());
    fillAiForm();
    $('#aiTestResult').hidden = true;
    toast(hadNewKey ? 'API key saved' : 'AI settings saved', { type: 'success' });
  } catch (error) {
    toast(error.message, { type: 'error' });
  } finally {
    busy(btn, false);
  }
}

async function removeKey() {
  const fallback = state.ai.sources.openaiApiKey === 'app' ? 'FlipLab will fall back to the OPENAI_API_KEY environment variable if one is set.' : '';
  const ok = await confirmDialog({ title: 'Remove saved API key?', body: `The key will be deleted from this server. ${fallback}`, confirmLabel: 'Remove key' });
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
  const aiForm = $('#aiForm');
  aiForm.addEventListener('submit', submitAi);
  aiForm.addEventListener('change', (event) => {
    if (event.target.name === 'provider') {
      showProviderFields();
      $('#aiTestResult').hidden = true;
    }
  });
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
    const data = Object.fromEntries(new FormData(event.target).entries());
    for (const key of Object.keys(data)) data[key] = Number(data[key]) || 0;
    const btn = event.submitter;
    busy(btn, true);
    try {
      await saveSettings(data);
      fillSettingsForm();
      toast('Economics saved', { type: 'success' });
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
