// The "Record clip" card: source, resolution, microphone and camera pickers, with a live mic
// level meter and a camera bubble preview. Choices are remembered in prefs.recorder. Recording
// itself runs elsewhere (see sidepanel.js); this only collects the options.
import { createMenuSelect } from './menu.js';
import { createBubbleStage } from './bubble-stage.js';
import { icon } from '../lib/icons.js';
import { getPrefs, setPrefs } from '../lib/storage.js';
import { canRecordTab, isSidebar } from '../lib/platform.js';

const SOURCES = [
  { value: 'screen', label: 'Entire screen', icon: 'monitor' },
  { value: 'window', label: 'Window', icon: 'window' },
  // Chrome only: Firefox's picker can't share a single tab.
  { value: 'tab', label: 'Current tab', icon: 'tab', hint: 'The picker opens on the tab list' },
];

const RESOLUTIONS = [
  { value: '720', label: '720p', badge: 'HD' },
  { value: '1080', label: '1080p', badge: 'Full HD' },
  { value: '1440', label: '1440p', badge: '2K' },
  { value: '2160', label: '2160p', badge: '4K' },
  { value: 'native', label: 'Native', badge: 'Auto' },
];

const NO_MIC = 'none';
const NO_CAMERA = 'none';
const ALLOW = '__allow__'; // pseudo-item shown until the extension has mic permission
const ALLOW_CAMERA = '__allow-camera__';

const DEFAULTS = { source: 'screen', resolution: '1080', mic: 'default', camera: NO_CAMERA, bubble: { x: 0, y: 1, size: 'md' } };

const $ = (id) => document.getElementById(id);

/**
 * @param {{ onGrantMic: () => void, onGrantCamera: () => void }} opts
 */
export async function createRecorderCard({ onGrantMic, onGrantCamera }) {
  const sourceIcon = $('rc-source-icon');
  const micIcon = $('rc-mic-icon');
  const cameraIcon = $('rc-camera-icon');
  const bubbleRow = $('rc-bubble-row');
  const meterFill = $('rc-meter-fill');

  const { recorder: saved = {} } = await getPrefs();
  const settings = { ...DEFAULTS, ...saved, bubble: { ...DEFAULTS.bubble, ...(saved.bubble || {}) } };
  const save = (patch) => {
    Object.assign(settings, patch);
    return setPrefs({ recorder: { ...settings } });
  };

  const sources = SOURCES.filter((s) => s.value !== 'tab' || canRecordTab());
  if (!sources.some((s) => s.value === settings.source)) settings.source = DEFAULTS.source;

  const source = createMenuSelect($('rc-source'), {
    items: sources,
    value: settings.source,
    label: 'What to record',
    onChange: (value) => {
      save({ source: value });
      updateIcons();
    },
  });

  createMenuSelect($('rc-resolution'), {
    items: RESOLUTIONS,
    value: settings.resolution,
    label: 'Resolution',
    onChange: (value) => save({ resolution: value }),
  });

  const mic = createMenuSelect($('rc-mic'), {
    items: [],
    value: settings.mic,
    label: 'Microphone',
    onChange: (value) => {
      if (value === ALLOW) {
        mic.setValue(settings.mic); // not a real choice
        onGrantMic();
        return;
      }
      save({ mic: value });
      updateIcons();
      restartMeter();
    },
  });

  const camera = createMenuSelect($('rc-camera'), {
    items: [],
    value: settings.camera,
    label: 'Camera bubble',
    onChange: (value) => {
      if (value === ALLOW_CAMERA) {
        camera.setValue(settings.camera); // not a real choice
        onGrantCamera();
        return;
      }
      save({ camera: value });
      updateIcons();
      restartPreview();
    },
  });

  const stage = createBubbleStage($('rc-bubble'), {
    value: settings.bubble,
    onChange: (bubble, { final }) => {
      if (final) save({ bubble });
    },
  });

  function updateIcons() {
    sourceIcon.innerHTML = icon(SOURCES.find((s) => s.value === source.value)?.icon || 'monitor');
    micIcon.innerHTML = icon(settings.mic === NO_MIC ? 'micOff' : 'mic');
    cameraIcon.innerHTML = icon(settings.camera === NO_CAMERA ? 'webcamOff' : 'webcam');
    bubbleRow.hidden = settings.camera === NO_CAMERA;
  }

  // ---- Devices ----

  /** 'granted' | 'prompt' | 'denied' for the microphone or the camera. */
  async function devicePermission(name, kind) {
    try {
      return (await navigator.permissions.query({ name })).state;
    } catch {
      // No permission query here: device labels only appear once access was granted.
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.some((d) => d.kind === kind && d.label) ? 'granted' : 'prompt';
      } catch {
        return 'prompt';
      }
    }
  }

  async function enumerate() {
    try {
      return await navigator.mediaDevices.enumerateDevices();
    } catch {
      return []; // No media devices API — leave the lists minimal.
    }
  }

  /**
   * Firefox lists no cameras at all (not even unnamed ones) until this document has used one:
   * a remembered grant from the helper tab isn't enough on its own. Opening the camera once,
   * silently, makes the named list appear. Only worth it when a grant is likely (no prompt can
   * show here), hence the timeout: an attempt that would need a prompt just hangs or rejects.
   */
  async function probeCamera() {
    let timer;
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ video: true }),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timeout')), 3000))),
      ]);
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  /** @param {{ probe?: boolean }} [opts] probe: open the camera once if no named camera is listed */
  async function refreshDevices({ probe = false } = {}) {
    let inputs = await enumerate();
    if (probe && !inputs.some((d) => d.kind === 'videoinput' && d.deviceId && d.label) && (await probeCamera())) {
      inputs = await enumerate();
    }

    // Without permission Chrome hides device names/ids, so offer the default plus a way to allow.
    const namedMics = inputs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.label);
    const micItems = [{ value: NO_MIC, label: 'No microphone', icon: 'micOff' }];
    if (namedMics.length) {
      namedMics.forEach((d) => micItems.push({ value: d.deviceId, label: d.label }));
    } else {
      micItems.push({ value: 'default', label: 'Default microphone' });
      micItems.push({ value: ALLOW, label: 'Allow access to pick a microphone…' });
    }
    // Keep the saved device if it's still plugged in; otherwise fall back to the default.
    if (!micItems.some((i) => i.value === settings.mic && i.value !== ALLOW)) {
      settings.mic = micItems.find((i) => i.value === 'default')?.value || micItems[1]?.value || NO_MIC;
    }
    mic.setItems(micItems);
    mic.setValue(settings.mic);

    // The camera is opt-in, so there is no "default camera": pick one by name or stay off.
    const cams = inputs.filter((d) => d.kind === 'videoinput');
    const namedCams = cams.filter((d) => d.deviceId && d.label);
    const camItems = [{ value: NO_CAMERA, label: 'No camera', icon: 'webcamOff' }];
    // Without permission the browser hides names/ids (Firefox lists nothing at all), so offer a way to allow.
    if (namedCams.length) namedCams.forEach((d) => camItems.push({ value: d.deviceId, label: d.label, icon: 'webcam' }));
    else camItems.push({ value: ALLOW_CAMERA, label: 'Allow access to pick a camera…' });
    if (!camItems.some((i) => i.value === settings.camera && i.value !== ALLOW_CAMERA)) settings.camera = NO_CAMERA;
    camera.setItems(camItems);
    camera.setValue(settings.camera);

    updateIcons();
  }

  navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
  // Granting access in the helper tab changes the permission; pick up the real device list.
  navigator.permissions
    ?.query({ name: 'microphone' })
    .then((status) => {
      status.onchange = () => {
        refreshDevices().then(restartMeter);
      };
    })
    .catch(() => {});
  navigator.permissions
    ?.query({ name: 'camera' })
    .then((status) => {
      status.onchange = () => {
        refreshDevices().then(restartPreview);
      };
    })
    .catch(() => {});
  // …and the helper tab also says so explicitly, for browsers where the permission status doesn't fire.
  chrome.storage.session?.onChanged.addListener((changes) => {
    if ('micGrantedAt' in changes) refreshDevices().then(restartMeter);
    if ('cameraGrantedAt' in changes) refreshDevices({ probe: true }).then(restartPreview);
  });

  // ---- Level meter (only while the card is open) ----

  let active = false;
  let meter = null; // { stream, ctx, raf }
  let level = 0;

  function stopMeter() {
    if (meter) {
      cancelAnimationFrame(meter.raf);
      meter.stream.getTracks().forEach((t) => t.stop());
      meter.ctx.close().catch(() => {});
      meter = null;
    }
    level = 0;
    meterFill.style.width = '0%';
  }

  async function restartMeter() {
    stopMeter();
    if (!active || settings.mic === NO_MIC) return;
    if ((await devicePermission('microphone', 'audioinput')) !== 'granted') return; // a side panel / sidebar can't show the prompt
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: settings.mic === 'default' ? true : { deviceId: { exact: settings.mic } },
      });
    } catch {
      return;
    }
    if (!active) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    const ctx = new AudioContext();
    ctx.resume().catch(() => {});
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    meter = { stream, ctx, raf: 0 };
    const tick = () => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += v * v;
      const rms = Math.sqrt(sum / samples.length);
      level = level * 0.75 + Math.min(1, rms * 5) * 0.25;
      meterFill.style.width = `${Math.round(level * 100)}%`;
      meter.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  // ---- Camera preview inside the bubble (only while the card is open) ----

  let preview = null; // MediaStream
  let previewToken = 0; // ignores a camera that opens after a newer restart/stop

  function stopPreview() {
    previewToken++;
    preview?.getTracks().forEach((t) => t.stop());
    preview = null;
    stage.attachPreview(null);
  }

  async function restartPreview() {
    stopPreview();
    if (!active || settings.camera === NO_CAMERA) return;
    if ((await devicePermission('camera', 'videoinput')) !== 'granted') return; // a side panel / sidebar can't show the prompt
    const token = previewToken;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: settings.camera }, width: { ideal: 320 }, height: { ideal: 240 } },
      });
    } catch {
      return;
    }
    if (token !== previewToken || !active) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    preview = stream;
    stage.attachPreview(stream);
  }

  function releaseDevices() {
    stopMeter();
    stopPreview();
  }

  window.addEventListener('pagehide', releaseDevices);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseDevices();
    else {
      restartMeter();
      restartPreview();
    }
  });

  await refreshDevices();

  return {
    /** Start/stop the mic meter and camera preview as the card opens/closes. */
    setActive(on) {
      active = on;
      if (on) {
        // Firefox sidebar: a camera was picked before, so the grant is remembered; wake the list up.
        const probe = isSidebar() && settings.camera !== NO_CAMERA;
        refreshDevices({ probe }).then(() => {
          restartMeter();
          restartPreview();
        });
      } else releaseDevices();
    },
    /** Free the microphone and camera before the recorder needs them. */
    releaseDevices,
    /** Remember a bubble moved from the recording strip and mirror it in the card. */
    setBubble(bubble) {
      stage.setValue(bubble);
      return save({ bubble: { ...settings.bubble, ...bubble } });
    },
    options: () => ({
      source: settings.source,
      resolution: settings.resolution,
      micDeviceId: settings.mic === NO_MIC ? null : settings.mic,
      cameraDeviceId: settings.camera === NO_CAMERA ? null : settings.camera,
      bubble: { ...settings.bubble },
    }),
  };
}
