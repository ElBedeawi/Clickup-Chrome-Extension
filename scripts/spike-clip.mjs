#!/usr/bin/env node
// Spike: can the extension reach ClickUp's private web-app API ("frontdoor") with a personal API token?
// Research only — nothing here ships. See ROADMAP.md / CHANGELOG.md for the Clips feature it informs.
//
//   CLICKUP_TOKEN=pk_... node scripts/spike-clip.mjs <workspaceId> [<attachmentId>] [--upload <file.webm>]
//
// 1. GET https://api.clickup.com/shard/v1/handshake/<ws>   (public, no auth) → frontdoor base URL
// 2. GET <frontdoor>/v1/attachments?attachment_ids[]=<id>    with the personal token, three header styles
// 3. --upload: POST <frontdoor>/v1/attachment with type=7, parent=<ws>, permanent=true, clip=true
//    (creates a Clip in the workspace's Clips Hub if the token is accepted)

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

// Anything not given on the command line / env is asked for interactively (Enter keeps the default).
const DEFAULT_WORKSPACE = '37401264';
const DEFAULT_ATTACHMENT = 'cb22ae38-44d9-4141-a409-b72e2198c682.webm';

let [workspaceId, ...rest] = process.argv.slice(2);
let token = process.env.CLICKUP_TOKEN || '';
const uploadIdx = rest.indexOf('--upload');
const uploadFile = uploadIdx !== -1 ? rest[uploadIdx + 1] : null;
let attachmentId = rest.find((a) => !a.startsWith('--') && a !== uploadFile) || '';

if (!token || !workspaceId) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (!token) token = (await rl.question('ClickUp personal API token (pk_...): ')).trim();
  if (!workspaceId) workspaceId = (await rl.question(`Workspace ID [${DEFAULT_WORKSPACE}]: `)).trim() || DEFAULT_WORKSPACE;
  if (!attachmentId) attachmentId = (await rl.question(`Known Clip attachment id [${DEFAULT_ATTACHMENT}]: `)).trim() || DEFAULT_ATTACHMENT;
  rl.close();
}
if (!workspaceId || !token) {
  console.error('usage: CLICKUP_TOKEN=pk_... node scripts/spike-clip.mjs <workspaceId> [<attachmentId>] [--upload <file.webm>]');
  process.exit(2);
}

const show = (label, res, body) => {
  console.log(`\n== ${label}\nHTTP ${res.status}  x-ratelimit-remaining=${res.headers.get('x-ratelimit-remaining') ?? '-'}`);
  console.log(String(body).slice(0, 600));
};

async function call(label, url, init = {}) {
  try {
    const res = await fetch(url, init);
    const body = await res.text();
    show(label, res, body);
    return { res, body };
  } catch (err) {
    console.log(`\n== ${label}\nnetwork error: ${err.message}`);
    return { res: null, body: '' };
  }
}

// 1. Shard handshake (public)
const hs = await call('handshake (api.clickup.com, no auth)', `https://api.clickup.com/shard/v1/handshake/${workspaceId}`);
let base = '';
try {
  base = JSON.parse(hs.body).appEnvironment.apiUrlBase;
} catch {
  console.error('handshake did not return appEnvironment.apiUrlBase; stopping');
  process.exit(1);
}
console.log(`\nfrontdoor base: ${base}`);

// Sanity: the public API accepts the token
await call('public API GET /api/v2/user', 'https://api.clickup.com/api/v2/user', { headers: { Authorization: token } });

// 2. Private API read with the personal token
const q = attachmentId ? `?attachment_ids%5B%5D=${encodeURIComponent(attachmentId)}&includeNonPermanent=true` : '';
const common = { 'X-Workspace-ID': workspaceId, 'X-CSRF': '1', Accept: 'application/json' };
const readUrl = attachmentId ? `${base}/v1/attachments${q}` : `${base}/data/v3/workspaces/${workspaceId}/clips/recent`;
const tries = [
  ['token as-is', { ...common, Authorization: token }],
  ['Bearer token', { ...common, Authorization: `Bearer ${token}` }],
  ['no auth (control)', { ...common }],
];
let accepted = null;
for (const [label, headers] of tries) {
  const { res } = await call(`private GET ${readUrl.replace(base, '<frontdoor>')} — ${label}`, readUrl, { headers });
  if (res?.ok && !accepted) accepted = headers;
}

if (!accepted) {
  console.log('\nRESULT: the personal token is NOT accepted by the private API (and cookies alone are rejected too: JWT_008).');
  process.exit(0);
}
console.log(`\nRESULT: private API accepted the personal token (${accepted.Authorization.startsWith('Bearer') ? 'Bearer' : 'as-is'}).`);

// 3. Optional upload
if (uploadFile) {
  const file = new File([fs.readFileSync(uploadFile)], path.basename(uploadFile), { type: 'application/octet-stream' });
  const form = new FormData();
  form.append('attachment', file, file.name);
  form.append('type', '7');
  form.append('parent', workspaceId);
  form.append('permanent', 'true');
  form.append('clip', 'true');
  const { body } = await call('private POST /v1/attachment (clip=true, workspace parent)', `${base}/v1/attachment`, {
    method: 'POST',
    headers: accepted,
    body: form,
  });
  try {
    const a = JSON.parse(body);
    console.log(`\nuploaded: id=${a.id} source=${a.source} (8 = Clip) → check https://app.clickup.com/${workspaceId}/hubs/clips`);
    await call('transcription status', `${base}/ai/v1/workspaces/${workspaceId}/transcriptions/attachment/${a.id}`, { headers: accepted });
  } catch {
    /* printed above */
  }
}
