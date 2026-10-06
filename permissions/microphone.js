const button = document.getElementById('grant');
const status = document.getElementById('status');

function showStatus(message, kind) {
  status.textContent = message;
  status.className = `notice ${kind}`;
  status.hidden = false;
}

async function request() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    button.hidden = true;
    showStatus('Microphone allowed. You can close this tab and record again from the side panel.', 'success');
  } catch (err) {
    showStatus(
      `Microphone access was not granted (${err.name}). If you blocked it before, click the icon at the ` +
        'left of the address bar, set Microphone to "Allow", then try again.',
      'error',
    );
  }
}

button.addEventListener('click', request);
