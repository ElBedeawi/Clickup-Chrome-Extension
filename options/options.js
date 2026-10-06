import { getToken, setToken, clearToken } from '../lib/storage.js';
import { getUser } from '../lib/clickup-api.js';

const form = document.getElementById('token-form');
const input = document.getElementById('token');
const toggle = document.getElementById('toggle');
const testBtn = document.getElementById('test');
const status = document.getElementById('status');
const saved = document.getElementById('saved');
const masked = document.getElementById('masked');
const revokeBtn = document.getElementById('revoke');

function showStatus(message, kind) {
  status.textContent = message;
  status.className = `notice ${kind}`;
  status.hidden = false;
}

function mask(token) {
  return token.length > 10 ? `${token.slice(0, 5)}…${token.slice(-4)}` : '••••';
}

async function renderSaved() {
  const token = await getToken();
  saved.hidden = !token;
  masked.textContent = token ? mask(token) : '';
}

async function testConnection() {
  testBtn.disabled = true;
  showStatus('Checking…', 'info');
  try {
    const user = await getUser();
    showStatus(`Connected as ${user.username || user.email}.`, 'success');
  } catch (err) {
    showStatus(err.message, 'error');
  } finally {
    testBtn.disabled = false;
  }
}

input.value = await getToken();
await renderSaved();

toggle.addEventListener('click', () => {
  const hidden = input.type === 'password';
  input.type = hidden ? 'text' : 'password';
  toggle.textContent = hidden ? 'Hide' : 'Show';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  await setToken(input.value);
  await renderSaved();
  if (!input.value.trim()) {
    showStatus('Token cleared.', 'info');
    return;
  }
  await testConnection();
});

testBtn.addEventListener('click', async () => {
  await setToken(input.value);
  await renderSaved();
  await testConnection();
});

revokeBtn.addEventListener('click', async () => {
  await clearToken();
  input.value = '';
  input.type = 'password';
  toggle.textContent = 'Show';
  await renderSaved();
  showStatus('Token revoked from this browser.', 'info');
});
