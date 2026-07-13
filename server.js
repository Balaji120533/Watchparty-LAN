const os = require('os');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = 3000;

// Set at runtime via /api/video-path (also editable here as a default).
let videoFilePath = path.join(__dirname, 'media', 'video.mp4');

function getLanIp() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        candidates.push({ name, address: iface.address });
      }
    }
  }

  if (candidates.length === 0) return '127.0.0.1';

  // Windows Mobile Hotspot adapter — prefer it since guests are often on it.
  const hotspot = candidates.find((c) => /Local Area Connection\*/i.test(c.name));
  if (hotspot) return hotspot.address;

  return candidates[0].address;
}

const lanIp = getLanIp();
const listenUrl = `http://${lanIp}:${PORT}/listen`;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/listen', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'listen.html'));
});

app.get('/api/qr', async (req, res) => {
  try {
    const dataUrl = await QRCode.toDataURL(listenUrl);
    res.json({ url: listenUrl, qr: dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

app.get('/media/video', (req, res) => {
  fs.stat(videoFilePath, (statErr, stat) => {
    if (statErr) {
      res.status(404).send('Video file not found. Set the file path from the host page.');
      return;
    }

    const fileSize = stat.size;
    const range = req.headers.range;

    if (!range) {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(videoFilePath).pipe(res);
      return;
    }

    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= fileSize) {
      res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(videoFilePath, { start, end }).pipe(res);
  });
});

// ---- Sync mode: get/set the local video file path from the host UI ----
app.get('/api/video-path', (req, res) => {
  fs.stat(videoFilePath, (statErr) => {
    res.json({ path: videoFilePath, exists: !statErr });
  });
});

app.post('/api/video-path', (req, res) => {
  const newPath = typeof req.body.path === 'string' ? req.body.path.trim() : '';
  if (!newPath) {
    res.status(400).json({ error: 'Path is required.' });
    return;
  }

  fs.stat(newPath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      res.status(400).json({ error: 'File not found at that path.' });
      return;
    }
    videoFilePath = newPath;
    res.json({ path: videoFilePath, exists: true });
  });
});

const server = app.listen(PORT, () => {
  console.log('');
  console.log('Local Audio Broadcast server running');
  console.log(`  Host (open in Chrome/Edge): http://localhost:${PORT}`);
  console.log(`  Guest join URL:             ${listenUrl}`);
  console.log('');
});

// ---- WebSocket signaling relay ----
const wss = new WebSocketServer({ server });

let hostSocket = null;
const guests = new Map(); // id -> ws

let currentMode = 'broadcast'; // 'broadcast' | 'sync'
let syncSessionLive = false; // once true, guests load the video and control it independently

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastToGuests(msg) {
  for (const guestWs of guests.values()) {
    send(guestWs, msg);
  }
}

wss.on('connection', (ws) => {
  ws.role = null;
  ws.id = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case 'host-hello': {
        hostSocket = ws;
        ws.role = 'host';
    
        for (const id of guests.keys()) {
          send(hostSocket, { type: 'join', id });
        }
        break;
      }

      case 'join': {
        ws.role = 'guest';
        ws.id = msg.id;
        guests.set(msg.id, ws);
        send(hostSocket, { type: 'join', id: msg.id });
        // Bring the new guest up to speed on the active mode / session state.
        send(ws, { type: 'mode-change', mode: currentMode });
        if (currentMode === 'sync' && syncSessionLive) {
          send(ws, { type: 'session-start' });
        }
        break;
      }

      case 'mode-change': {
        // host -> all guests
        currentMode = msg.mode;
        broadcastToGuests({ type: 'mode-change', mode: currentMode });
        break;
      }

      case 'session-start': {
        // host -> all guests: video is available, guests load it and control it independently
        syncSessionLive = true;
        broadcastToGuests({ type: 'session-start' });
        break;
      }

      case 'session-end': {
        // host -> all guests: session over, guests stop/unload
        syncSessionLive = false;
        broadcastToGuests({ type: 'session-end' });
        break;
      }

      case 'offer': {
        // host -> guest
        const guestWs = guests.get(msg.to);
        send(guestWs, { type: 'offer', sdp: msg.sdp });
        break;
      }

      case 'answer': {
        // guest -> host
        send(hostSocket, { type: 'answer', from: ws.id, sdp: msg.sdp });
        break;
      }

      case 'ice': {
        if (msg.to === 'host') {
          send(hostSocket, { type: 'ice', from: ws.id, candidate: msg.candidate });
        } else {
          const guestWs = guests.get(msg.to);
          send(guestWs, { type: 'ice', candidate: msg.candidate });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.role === 'host') {
      hostSocket = null;
    } else if (ws.role === 'guest' && ws.id) {
      guests.delete(ws.id);
      send(hostSocket, { type: 'leave', id: ws.id });
    }
  });
});
