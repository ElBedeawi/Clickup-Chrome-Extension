// Side-panel glue for "Save to Clips": a workspace token from the shared web-app session
// (webapp-session.js, minted in an app.clickup.com tab), then the upload straight from the panel.
// See lib/clickup-clips.js.

import { uploadClip } from '../lib/clickup-clips.js';
import { getSession } from './webapp-session.js';

/**
 * Uploads a file as a workspace Clip, to the workspace the signed-in ClickUp tab is viewing.
 * @param {File} file
 * @param {(fraction:number|null)=>void} [onProgress]  null while the token is minted, then 0–1
 * @returns {Promise<{ id:string, url:string, openUrl:string, workspaceId:string }>}
 */
export async function uploadAsClip(file, onProgress) {
  onProgress?.(null);
  const { token, workspaceId, base } = await getSession();
  onProgress?.(0);
  const result = await uploadClip({ base, token, workspaceId, file, onProgress });
  return { ...result, workspaceId };
}
