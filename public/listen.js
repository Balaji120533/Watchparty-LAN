const statusEl = document.getElementById('status');
const listenBtn = document.getElementById('listenBtn');
const audioEl = document.getElementById('audioEl');
const syncVideo = document.getElementById('syncVideo');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const debugLogEl = document.getElementById('debugLog');

function log(...args) {
  const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  console.log(line);
  if (debugLogEl) {
    debugLogEl.textContent += line + '\n';
    debugLogEl.scrollTop = debugLogEl.scrollHeight;
  }
}

window.addEventListener('error', (e) => log('window error:', e.message));

const myId = Math.random().toString(36).slice(2) + Date.now().toString(36);

let ws = null;
let currentMode = 'broadcast'; // 'broadcast' | 'sync'
let sessionLive = false;

function connectSignaling() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.addEventListener('open', () => {
    log('ws open');
    statusEl.textContent = 'Waiting for host…';
    ws.send(JSON.stringify({ type: 'join', id: myId }));
  });

  ws.addEventListener('message', async (event) => {
    const msg = JSON.parse(event.data);

    if (msg.type === 'mode-change') {
      applyMode(msg.mode);
    } else if (msg.type === 'session-start') {
      handleSessionStart();
    } else if (msg.type === 'session-end') {
      handleSessionEnd();
    } else if (msg.type === 'offer') {
      log('got offer');
      await ensurePeerConnection();
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
      log('sent answer');
    } else if (msg.type === 'ice') {
      if (pc && msg.candidate) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch (err) {
          console.error('addIceCandidate failed', err);
        }
      }
    }
  });

  ws.addEventListener('close', () => {
    statusEl.textContent = 'Disconnected from host.';
    statusEl.classList.remove('live');
  });

  ws.addEventListener('error', () => {
    statusEl.textContent = 'Connection error.';
  });
}

function applyMode(mode) {
  currentMode = mode;
  log('mode ->', mode);

  if (mode === 'broadcast') {
    syncVideo.style.display = 'none';
    fullscreenBtn.style.display = 'none';
    audioEl.style.display = 'block';
    listenBtn.textContent = 'Listen';
    ensurePeerConnection();
    if (!listenBtn.classList.contains('playing')) {
      statusEl.textContent = 'Waiting for host…';
      listenBtn.disabled = false;
    }
  } else {
    syncVideo.style.display = 'block';
    fullscreenBtn.style.display = 'inline-block';
    audioEl.style.display = 'none';
    listenBtn.textContent = 'Watch';
    if (!listenBtn.classList.contains('playing')) {
      statusEl.textContent = sessionLive
        ? 'Ready. Tap Watch to start the video.'
        : 'Waiting for host to start the session…';
      listenBtn.disabled = !sessionLive;
    }
  }
}

// =========================================================================
// Broadcast Audio mode (existing — unchanged behavior)
// =========================================================================
let pc = null;
let remoteStreamReady = false;

async function ensurePeerConnection() {
  if (pc) return pc;

  pc = new RTCPeerConnection({ iceServers: [] });

  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: 'ice', to: 'host', candidate: event.candidate }));
    }
  });

  pc.addEventListener('track', (event) => {
    const track = event.track;
    log('track event: kind=' + track.kind, 'muted=' + track.muted, 'enabled=' + track.enabled, 'readyState=' + track.readyState);
    const stream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([track]);
    log('stream audio tracks:', stream.getAudioTracks().length);
    audioEl.srcObject = stream;
    remoteStreamReady = true;
    listenBtn.disabled = false;
    if (currentMode === 'broadcast') {
      statusEl.textContent = 'Ready. Tap Listen to start audio.';
    }

    track.addEventListener('mute', () => log('track MUTED'));
    track.addEventListener('unmute', () => log('track UNMUTED'));
    track.addEventListener('ended', () => log('track ENDED'));
  });

  pc.addEventListener('connectionstatechange', () => {
    log('pc connectionState:', pc.connectionState);
    if (currentMode !== 'broadcast') return;
    if (pc.connectionState === 'connected') {
      statusEl.textContent = remoteStreamReady ? 'Ready. Tap Listen to start audio.' : 'Connecting audio…';
    } else if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      statusEl.textContent = 'Connection lost. Refresh to retry.';
      statusEl.classList.remove('live');
    }
  });

  pc.addEventListener('iceconnectionstatechange', () => {
    log('ice state:', pc.iceConnectionState);
  });

  return pc;
}

audioEl.addEventListener('loadedmetadata', () => log('audio loadedmetadata'));
audioEl.addEventListener('playing', () => log('audio element PLAYING event'));
audioEl.addEventListener('pause', () => log('audio element paused'));
audioEl.addEventListener('volumechange', () => log('audio volume:', audioEl.volume, 'muted:', audioEl.muted));
audioEl.addEventListener('error', () => log('audio element error:', audioEl.error && audioEl.error.message));

// =========================================================================
// Sync Local File mode (new)
// =========================================================================
// Once the host starts a session, each guest streams the same file and
// controls playback (play/pause/seek) entirely on their own — no mirroring
// between guests or back to the host.

function isFullscreen() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

fullscreenBtn.addEventListener('click', async () => {
  try {
    if (isFullscreen()) {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }

    if (syncVideo.requestFullscreen) {
      await syncVideo.requestFullscreen();
    } else if (syncVideo.webkitRequestFullscreen) {
      syncVideo.webkitRequestFullscreen();
    } else if (syncVideo.webkitEnterFullscreen) {
      // iOS Safari: only the <video> element itself supports native fullscreen
      syncVideo.webkitEnterFullscreen();
    } else {
      log('Fullscreen not supported on this browser');
    }
  } catch (err) {
    log('fullscreen error:', err.name, err.message);
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenBtn.textContent = isFullscreen() ? 'Exit fullscreen ⛶' : 'Fullscreen ⛶';
});
document.addEventListener('webkitfullscreenchange', () => {
  fullscreenBtn.textContent = isFullscreen() ? 'Exit fullscreen ⛶' : 'Fullscreen ⛶';
});

function handleSessionStart() {
  sessionLive = true;
  log('session-start');
  if (currentMode !== 'sync') return;

  if (!syncVideo.src) {
    syncVideo.src = '/media/video?t=' + Date.now();
  }
  if (!listenBtn.classList.contains('playing')) {
    statusEl.textContent = 'Ready. Tap Watch to start the video.';
    listenBtn.disabled = false;
  }
}

function handleSessionEnd() {
  sessionLive = false;
  log('session-end');

  syncVideo.pause();
  syncVideo.removeAttribute('src');
  syncVideo.load();

  listenBtn.classList.remove('playing');
  listenBtn.disabled = true;
  listenBtn.textContent = 'Watch';
  statusEl.textContent = 'Session ended by host.';
  statusEl.classList.remove('live');
}

listenBtn.addEventListener('click', async () => {
  if (currentMode === 'broadcast') {
    log('listen tapped. srcObject set:', !!audioEl.srcObject, 'muted:', audioEl.muted, 'volume:', audioEl.volume);
    try {
      await audioEl.play();
      log('play() resolved OK. paused=' + audioEl.paused, 'muted=' + audioEl.muted, 'volume=' + audioEl.volume);
      listenBtn.textContent = 'Listening…';
      listenBtn.classList.add('playing');
      listenBtn.disabled = true;
      statusEl.textContent = 'Live';
      statusEl.classList.add('live');
    } catch (err) {
      log('play() FAILED:', err.name, err.message);
      statusEl.textContent = 'Could not start playback: ' + err.message;
    }
  } else {
    if (!sessionLive) return;
    log('watch tapped');
    try {
      await syncVideo.play();
      listenBtn.textContent = 'Watching…';
      listenBtn.classList.add('playing');
      listenBtn.disabled = true;
      statusEl.textContent = 'Live';
      statusEl.classList.add('live');
    } catch (err) {
      log('watch play() FAILED:', err.name, err.message);
      statusEl.textContent = 'Could not start video: ' + err.message;
    }
  }
});

connectSignaling();
