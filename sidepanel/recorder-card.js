// The "Record clip" card: source, resolution and microphone pickers with a live mic level
// meter. Choices are remembered in prefs.recorder. Recording itself runs elsewhere (see
// sidepanel.js); this only collects the options.
import { createMenuSelect } from './menu.js';
import { icon } from '../lib/icons.js';
import { getPrefs, setPrefs } from '../lib/storage.js';
import { canRecordTab } from '../lib/platform.js';

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
const ALLOW = '__allow__'; // pseudo-item shown until the extension has mic permission

const DEFAULTS = { source: 'screen', resolution: '1080', mic: 'default' };

const $ = (id) => document.getElementById(id);

/**
 * @param {{ onGrantMic: () => void }} opts
 */
export async function createRecorderCard({ onGrantMic }) {
  const sourceIcon = $('rc-source-icon');
  const micIcon = $('rc-mic-icon');
  const meterFill = $('rc-meter-fill');

  const { recorder: saved = {} } = await getPrefs();
  const settings = { ...DEFAULTS, ...saved };
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

  function updateIcons() {
    sourceIcon.innerHTML = icon(SOURCES.find((s) => s.value === source.value)?.icon || 'monitor');
    micIcon.innerHTML = icon(settings.mic === NO_MIC ? 'micOff' : 'mic');
  }

  // ---- Microphone devices ----

  async function micPermission() {
    try {
      return (await navigator.permissions.query({ name: 'microphone' })).state;
    } catch {
      // No microphone permission query here: device labels only appear once access was granted.
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.some((d) => d.kind === 'audioinput' && d.label) ? 'granted' : 'prompt';
      } catch {
        return 'prompt';
      }
    }
  }

  async function refreshDevices() {
    let inputs = [];
    try {
      inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    } catch {
      // No media devices API — leave the list minimal.
    }
    // Without permission Chrome hides device names/ids, so offer the default plus a way to allow.
    const named = inputs.filter((d) => d.deviceId && d.label);
    const items = [{ value: NO_MIC, label: 'No microphone', icon: 'micOff' }];
    if (named.length) {
      named.forEach((d) => items.push({ value: d.deviceId, label: d.label }));
    } else {
      items.push({ value: 'default', label: 'Default microphone' });
      items.push({ value: ALLOW, label: 'Allow access to pick a microphone…' });
    }

    // Keep the saved device if it's still plugged in; otherwise fall back to the default.
    if (!items.some((i) => i.value === settings.mic && i.value !== ALLOW)) {
      settings.mic = items.find((i) => i.value === 'default')?.value || items[1]?.value || NO_MIC;
    }
    mic.setItems(items);
    mic.setValue(settings.mic);
    updateIcons();
  }

  navigator.mediaDevices?.addEventListener('devicechange', refreshDevices);
  // Granting access in the helper tab changes the permission; pick up the real device list.
  navigator.permissions
    ?.query({ name: 'microphone' })
    .then((status) => {
      status.onchange = () => {
        refreshDevices();
        restartMeter();
      };
    })
    .catch(() => {});
  // …and the helper tab also says so explicitly, for browsers where the permission status doesn't fire.
  chrome.storage.session?.onChanged.addListener((changes) => {
    if ('micGrantedAt' in changes) {
      refreshDevices();
      restartMeter();
    }
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
    if ((await micPermission()) !== 'granted') return; // a side panel / sidebar can't show the prompt
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

  window.addEventListener('pagehide', stopMeter);
  document.addEventListener('visibilitychange', () => (document.hidden ? stopMeter() : restartMeter()));

  await refreshDevices();

  return {
    /** Start/stop the mic meter as the card opens/closes. */
    setActive(on) {
      active = on;
      if (on) refreshDevices().then(restartMeter);
      else stopMeter();
    },
    /** Free the microphone before the recorder needs it. */
    releaseMic: stopMeter,
    options: () => ({
      source: settings.source,
      resolution: settings.resolution,
      micDeviceId: settings.mic === NO_MIC ? null : settings.mic,
    }),
  };
}
