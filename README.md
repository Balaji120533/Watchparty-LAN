# WatchParty LAN
Broadcast Audio & Sync Video Over WiFi, No Internet Needed

Two ways to share what you're watching with friends over WiFi, no internet
needed:

1. **Broadcast Audio** — capture whatever audio your laptop is playing
   (Netflix, Prime, VLC, a local movie) and broadcast it over WiFi to
   everyone's phones, so each person listens on their own earbuds while
   watching your screen. Audio only, peer-to-peer WebRTC.
2. **Sync Local File** — the host points at a local video file; once the
   session is started, each guest streams that same file to their **own**
   phone and watches it **independently** — play, pause, seek, skip, all
   without affecting anyone else, including the host. Everyone's watching
   the same movie in parallel, on their own schedule.

## Requirements

- **Host laptop**: Windows, with **Google Chrome** or **Microsoft Edge**
  (Chromium-based). Firefox and Safari are not supported for hosting.
- **Guests**: any modern phone browser, including iPhone Safari — they only
  receive audio.
- Host and guests must be on the **same WiFi network**.

## Setup

```bash
npm install
npm start
```

The terminal will print something like:

```
Local Audio Broadcast server running
  Host (open in Chrome/Edge): http://localhost:3000
  Guest join URL:             http://192.168.1.42:3000/listen
```

### Windows Firewall (first time only, on each host machine)

Windows blocks incoming connections to Node.js by default, so guests won't
be able to load the page even though the server is running. **On the host
laptop**, open PowerShell **as Administrator** and run:

```powershell
New-NetFirewallRule -DisplayName "Local Audio Broadcast" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow -Profile Any
```

This only opens port 3000 (the port this app uses) — it doesn't weaken the
firewall otherwise. You only need to do this **once per laptop** that hosts
a session; it's not needed on guest devices.

## Running a Broadcast Audio session

1. Open **`http://localhost:3000`** in Chrome or Edge on the host laptop
   (must be `localhost`, not the LAN IP — screen capture requires it).
2. Keep **"Broadcast Audio"** selected (it's the default) and click **Start
   broadcast**.
3. Pick a screen or tab to share and tick **"Share audio"**. On Windows,
   sharing "Entire Screen" captures full system audio from any app.
4. A QR code and LAN URL appear on the host page — have friends scan it or
   type the URL on their phones, on the **same WiFi**.
5. Each guest taps **Listen** to start hearing the audio live.

## Running a Sync Local File session

Sync mode streams a **local video file** from the host to every guest's own
device. Once started, each guest plays, pauses, and seeks independently —
nobody's controls affect anyone else, including the host's. It's for local
files only; Netflix/Prime have no file to serve, so use Broadcast Audio mode
for those.

1. Open **`http://localhost:3000`** and click **"Sync Local File"**.
2. Type the full path to a video file on the host laptop (e.g.
   `D:\Movies\film.mp4`) and click **Set** — the page confirms if it's found.
3. Click **Start sync session**. This just makes the file available; nothing
   plays automatically yet.
4. Share the QR code / LAN URL with friends, same as broadcast mode.
5. Each guest taps **Watch** to load their own copy and controls it with the
   normal video controls (play, pause, seek, fullscreen). Guests joining
   after the session has started can watch right away too.
6. Click **End session** when you're done — every guest's video stops and
   unloads immediately with a "Session ended by host" message.

## Notes & known limitations

- **Hosting needs Chrome or Edge.** Guests can use any browser.
- **Windows vs Mac:** Windows can capture full system audio ("Entire
  Screen"); macOS Chrome only captures per-tab audio — a Chrome/macOS
  limit, not fixable here.
- **Netflix/DRM:** capturing a Netflix browser tab works; the desktop app
  may block it — use the Netflix website in a Chrome tab instead.
- **Latency:** ~100–200ms is expected on the WebRTC LAN path.
- **No internet used:** signaling and streaming stay on your LAN, no
  STUN/TURN.
- **Guest page won't load at all?** First check Windows Firewall on the
  host (see setup step above) — this is the most common cause on a new
  laptop. If firewall is fine, it's usually router AP/client isolation;
  fallback is to use the host's phone as a WiFi hotspot instead.
- **Sync mode is local files only** — no file to serve for Netflix/Prime,
  use Broadcast Audio for those.
- **Sync mode is independent per guest** — once started, everyone (host
  included) controls their own playback; drifting apart is expected.
- Switching modes on the host is safe at any time.
