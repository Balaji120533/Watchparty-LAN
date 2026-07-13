const startBtn = document.getElementById('startBtn');
const statusEl = document.getElementById('status');
const warningEl = document.getElementById('warning');
const qrBox = document.getElementById('qrBox');
const qrImg = document.getElementById('qrImg');
const joinUrlEl = document.getElementById('joinUrl');
const countEl = document.getElementById('count');

const modeBroadcastBtn = document.getElementById('modeBroadcastBtn');
const modeSyncBtn = document.getElementById('modeSyncBtn');
const broadcastPanel = document.getElementById('broadcastPanel');
const syncPanel = document.getElementById('syncPanel');
const syncVideo = document.getElementById('syncVideo');
const syncFilePathEl = document.getElementById('syncFilePath');
const syncStartBtn = document.getElementById('syncStartBtn');
const syncEndBtn = document.getElementById('syncEndBtn');
const syncPathForm = document.getElementById('syncPathForm');
const syncPathInput = document.getElementById('syncPathInput');
const syncPathSetBtn = document.getElementById('syncPathSetBtn');

let ws = null;
let wsReady = false;
const pendingWsMessages = []; // queued until the socket is actually open
const guestIds = new Set(); // all known guest ids, regardless of mode

// --- Browser guard (broadcast mode needs getDisplayMedia) ---
if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
  warningEl.style.display = 'block';
  startBtn.disabled = true;
}

// --- Fetch QR + join URL (shared by both modes) ---
async function loadQr() {
  try {
    const res = await fetch('/api/qr');
    const data = await res.json();
    qrImg.src = data.qr;
    joinUrlEl.textContent = data.url;
    qrBox.style.display = 'block';
  } catch (err) {
    console.error('Failed to load QR code', err);
  }
}
loadQr();

// --- Shared WebSocket signaling ---
function connectSignaling() {
  if (ws) return; // already connected
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    wsReady = true;
    ws.send(JSON.stringify({ type: 'host-hello' }));
    ws.send(JSON.stringify({ type: 'mode-change', mode: currentMode }));
    while (pendingWsMessages.length) {
      ws.send(JSON.stringify(pendingWsMessages.shift()));
    }
  });

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'join') {
      guestIds.add(msg.id);
      updateCount();
      if (currentMode === 'broadcast') {
        await addGuestPeer(msg.id);
      }
    } else if (msg.type === 'answer') {
      const pc = peers.get(msg.from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'ice') {
      const pc = peers.get(msg.from);
      if (pc && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch (err) {
          console.error('addIceCandidate failed', err);
        }
      }
    } else if (msg.type === 'leave') {
      guestIds.delete(msg.id);
      removeGuestPeer(msg.id);
      updateCount();
    }
  });

  ws.addEventListener('close', () => {
    wsReady = false;
    statusEl.textContent = 'Signaling disconnected.';
  });
}

function updateCount() {
  countEl.textContent = String(guestIds.size);
}

function sendWs(msg) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  } else {
    pendingWsMessages.push(msg);
  }
}

// =========================================================================
// Mode switch
// =========================================================================
let currentMode = 'broadcast'; // 'broadcast' | 'sync'

function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  modeBroadcastBtn.classList.toggle('active', mode === 'broadcast');
  modeSyncBtn.classList.toggle('active', mode === 'sync');
  broadcastPanel.style.display = mode === 'broadcast' ? 'block' : 'none';
  syncPanel.style.display = mode === 'sync' ? 'flex' : 'none';

  connectSignaling();
  sendWs({ type: 'mode-change', mode });
  statusEl.textContent = '';
}

modeBroadcastBtn.addEventListener('click', () => setMode('broadcast'));
modeSyncBtn.addEventListener('click', () => setMode('sync'));

// =========================================================================
// Broadcast Audio mode (existing — unchanged behavior)
// =========================================================================
let audioTrack = null;
const peers = new Map(); // guestId -> RTCPeerConnection
let broadcasting = false;

async function addGuestPeer(guestId) {
  if (peers.has(guestId)) return;

  const pc = new RTCPeerConnection({ iceServers: [] });
  peers.set(guestId, pc);

  if (audioTrack) {
    pc.addTrack(audioTrack);
  }

  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      sendWs({ type: 'ice', to: guestId, candidate: event.candidate });
    }
  });

  pc.addEventListener('connectionstatechange', () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      removeGuestPeer(guestId);
    }
  });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendWs({ type: 'offer', to: guestId, sdp: pc.localDescription });
}

function removeGuestPeer(guestId) {
  const pc = peers.get(guestId);
  if (pc) {
    pc.close();
    peers.delete(guestId);
  }
}

startBtn.addEventListener('click', async () => {
  if (broadcasting) return;

  try {
    statusEl.textContent = 'Choose a screen or tab and tick "Share audio"...';
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

    const tracks = stream.getAudioTracks();
    if (tracks.length === 0) {
      statusEl.textContent = 'No audio track captured — make sure to tick "Share audio".';
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    // Drop video, keep only audio
    stream.getVideoTracks().forEach((t) => t.stop());
    audioTrack = tracks[0];

    audioTrack.addEventListener('ended', () => {
      statusEl.textContent = 'Broadcast stopped (source ended).';
      broadcasting = false;
      startBtn.textContent = 'Start broadcast';
      startBtn.classList.remove('live');
    });

    // Add track to any peers already connected (shouldn't normally happen before start)
    for (const pc of peers.values()) {
      pc.addTrack(audioTrack);
    }

    broadcasting = true;
    startBtn.textContent = 'Broadcasting…';
    startBtn.classList.add('live');
    statusEl.textContent = 'Live. Share the QR code below with your friends.';

    connectSignaling();

    // Any guests who joined before broadcasting started still need peers.
    for (const guestId of guestIds) {
      await addGuestPeer(guestId);
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'Could not capture audio: ' + err.message;
  }
});

// =========================================================================
// Sync Local File mode (new)
// =========================================================================
let syncStarted = false;

function showVideoPathStatus(pathStr, exists) {
  syncFilePathEl.classList.remove('ok', 'error');
  if (exists) {
    syncFilePathEl.textContent = 'Streaming: ' + pathStr;
    syncFilePathEl.classList.add('ok');
  } else {
    syncFilePathEl.textContent = pathStr
      ? 'File not found: ' + pathStr
      : 'No video file set yet — enter a path below.';
    syncFilePathEl.classList.add('error');
  }
}

async function loadVideoPath() {
  try {
    const res = await fetch('/api/video-path');
    const data = await res.json();
    syncPathInput.value = data.path || '';
    showVideoPathStatus(data.path, data.exists);
    // cache-bust so the <video> element re-checks the (possibly new) file
    syncVideo.src = '/media/video?t=' + Date.now();
  } catch (err) {
    syncFilePathEl.textContent = 'Could not reach server to check video path.';
  }
}
loadVideoPath();

syncPathForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const newPath = syncPathInput.value.trim();
  if (!newPath) return;

  syncPathSetBtn.disabled = true;
  syncPathSetBtn.textContent = 'Setting…';

  try {
    const res = await fetch('/api/video-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: newPath }),
    });
    const data = await res.json();

    if (!res.ok) {
      showVideoPathStatus(newPath, false);
      statusEl.textContent = data.error || 'Could not set video path.';
    } else {
      showVideoPathStatus(data.path, data.exists);
      syncVideo.src = '/media/video?t=' + Date.now();
      statusEl.textContent = '';
    }
  } catch (err) {
    statusEl.textContent = 'Could not reach server to set video path.';
  } finally {
    syncPathSetBtn.disabled = false;
    syncPathSetBtn.textContent = 'Set';
  }
});

syncStartBtn.addEventListener('click', () => {
  if (syncStarted) return;
  syncStarted = true;
  syncStartBtn.textContent = 'Sync session live';
  syncStartBtn.disabled = true;
  syncEndBtn.disabled = false;
  statusEl.textContent = 'Sync session live. Guests can now watch and control playback independently.';

  connectSignaling();
  sendWs({ type: 'mode-change', mode: 'sync' });
  sendWs({ type: 'session-start' });
  // From here on, the host's own player is just a normal independent player —
  // play/pause/seek on this <video> only affects the host's own view.
});

syncEndBtn.addEventListener('click', () => {
  if (!syncStarted) return;
  syncStarted = false;
  syncStartBtn.textContent = 'Start sync session';
  syncStartBtn.disabled = false;
  syncEndBtn.disabled = true;
  statusEl.textContent = 'Sync session ended.';

  sendWs({ type: 'session-end' });
});
