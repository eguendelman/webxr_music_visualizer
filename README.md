# Pulse: WebXR music visualizer

A static, dependency-free WebGL/WebXR page. No npm, build step, CDN, upload, or microphone access. Choose a local audio file and play it to illuminate a space-filling volume of hanging LED strips. Head motion should update the view naturally; use the Quest system menu to exit VR.

## LED coordinate system

The initial viewer position is centered at `X=0, Z=0`, with the floor at `Y=0` and positive Y pointing upward. A vertical strip is placed at each point of a regular X/Z grid, except within the circular viewer-clearance radius. Every included strip runs from the floor to the configured ceiling height. LEDs are distributed uniformly along each strip, including both endpoints; their actual spacing is adjusted slightly when necessary so the top LED lands exactly at the ceiling.

Desktop controls independently set strip spacing, target LED spacing, LED position jitter, ceiling height, X/Z half-extents, viewer clearance, and apparent LED glow size. Strip spacing is the exact center-to-center distance between adjacent possible strip locations in both X and Z and defaults to `0.20 m`. The floor grid uses this same spacing, so each intersection corresponds to a possible strip location; intersections within the circular clearance remain empty. The shown full footprint is twice each half-extent. Strip spacing can be reduced to `0.10 m`; combining that with large extents and tight LED spacing can produce more than 600,000 LEDs, so configurations above 100,000 LEDs are marked **HEAVY** and may perform poorly on a standalone headset. The requested geometry is not silently reduced.

**LED jitter std dev** applies independent, normally distributed X/Y/Z offsets to rendered LED positions. Its fine-control range is `0–0.025 m` in `0.0005 m` increments, with a `0.005 m` default. The value is the standard deviation in meters, with outliers capped at three standard deviations and Y constrained between floor and ceiling. Logical grid positions still drive frequency and temporal sampling, so jitter changes appearance without distorting the visualization mapping. A geometry rebuild generates a new random field; moving only the jitter slider rescales the existing offsets. These controls remain in the page while VR is active, but HTML UI is not shown inside an immersive WebXR session.

The desktop renderer uses an inspection camera orbiting around the installation. Left-drag the empty canvas to orbit, use the mouse wheel to move closer or farther, and Shift-drag or right-drag to pan the orbit target. Dragging cannot begin over either UI panel. **Reset view** frames the complete grid again. This camera affects only the desktop preview; immersive VR continues to place the viewer at the origin.

The current effect is a radial, time-resolved spectrogram. It records 32 logarithmic frequency bands (roughly 40 Hz to 16 kHz) at 60 history frames per second. Height selects frequency, while horizontal radius selects age: the nearest strips show the newest spectrum and increasingly distant strips sample progressively older FFT frames. Transients therefore become expanding cylindrical shells instead of recoloring the whole volume simultaneously. The buffer retains up to 45 seconds; track changes and seeking clear it, while pausing adds silence behind the already-propagating history.

**Radial wave speed** controls how quickly history moves outward in meters per second and defaults to `4.0 m/s`. **History fade** controls how strongly older shells dim without changing their travel time. At the default speed, every additional meter from the clearance boundary adds 250 ms of intentional visual delay. The analyser itself typically contributes roughly 70-180 ms at the innermost strips because of the FFT window, smoothing, and render scheduling.

The compact **Light response** controls form an explicit signal chain. **Noise gate** rejects weak normalized FFT values, **Signal gain** amplifies what remains, **Contrast curve** suppresses weak responses when above `1`, **Onset boost** emphasizes sudden increases, and idle/peak brightness set the output range. The palette can use the original magenta/cyan gradient or a full frequency rainbow. **Animate when no track is loaded** enables the synthetic radial demo; it is off by default. **Debug: all LEDs full white** bypasses all response and color settings. LED glow now ranges up to `50 px` and defaults to `30 px`. The LED-grid geometry remains independent of this mapping, so future effects can reinterpret the same points.

## Audio playback

Choose an audio file on the device running the browser, press **Play track**, then **Enter VR**. MP3 or PCM WAV are good starting points; other formats depend on browser codec support. The native player provides seeking and volume after playback starts. In VR, a controller trigger (`select`) toggles play/pause. Exit VR to adjust the grid or choose another track. Hand tracking and in-scene controls are not implemented yet.

Files are read via local blob URLs and are never uploaded. A file chosen on this computer is not automatically available on the Quest: copy/download it to the headset and use its file picker. Reloading clears the selection. Cancelling the picker leaves the existing track selected. With no track selected, the LEDs remain at idle brightness unless the synthetic demo toggle is enabled; a selected but paused or ended track leaves existing history propagating outward while silence follows behind it.

A desktop file picker may select music from a mounted NAS share. The app does not directly browse SMB/NFS shares, and Quest file-picker access depends on the headset. A future NAS integration can load music from an HTTPS endpoint; cross-origin Web Audio analysis requires CORS permission from that endpoint. An HTTPS app generally cannot load HTTP tracks. Keep NAS access private or authenticated; no router port forwarding is needed for local playback.

## 1. Check connectivity over home Wi-Fi

Run in PowerShell:

```powershell
Set-Location 'C:\Users\eguendelman\dev\personal\webxr_music_visualizer'
python .\serve.py --host 0.0.0.0 --port 8000
```

Desktop: `http://localhost:8000`.

Quest Browser: `http://192.168.0.159:8000` (this computer's address when the project was created; it may change).

Both devices must be on the same LAN. If Windows asks about firewall access, allow Python on your **private home network only**. Do not forward ports on your router. Guest Wi-Fi/client isolation can block communication even when both devices have Internet access. Corporate VPNs can also interfere.

Find your current address with `ipconfig` and use the IPv4 address of the active Wi-Fi/Ethernet adapter. Stop the server with Ctrl+C.

Expected on the Quest over HTTP: the animated page loads and reports **HTTP / VR unavailable**. This proves connectivity, but it does NOT enable immersive VR. WebXR requires a secure context; LAN HTTP is not one. HTTP localhost is a special exception, but `localhost` on the headset ordinarily means the headset, not this PC.

## 2. Get into VR with trusted HTTPS

The quickest certificate-free route is a temporary HTTPS tunnel. It does not require you to install a certificate on the Quest, change browser security flags, or expose a router port. The app remains static and runs on this computer, but requests pass through an Internet tunnel rather than staying entirely on the LAN.

Install Cloudflare's tunnel client once:

```powershell
winget install --id Cloudflare.cloudflared --exact
```

Open a new terminal if the installed command is not on PATH yet. Start the Python server (use this instead of the LAN server above):

```powershell
Set-Location 'C:\Users\eguendelman\dev\personal\webxr_music_visualizer'
python .\serve.py --port 8000
```

In a second terminal:

```powershell
cloudflared tunnel --url http://localhost:8000
```

Open the printed `https://...trycloudflare.com` URL in **Meta Quest Browser**, then press **Enter VR** and accept any browser permission prompt. Expected diagnostics: **Secure context**, **Immersive VR supported**, **WebGL ready**.

Quick tunnels need Internet access, generally need no Cloudflare account, and provide a new URL when restarted. The URL is publicly reachable while the tunnel runs: treat it as public, not as authentication. This server only exposes the three app assets, not the setup guide, Python source, or certificate files. Stop both processes when finished. No tunnel has been installed or started automatically.

## 3. USB alternative (no HTTPS or Internet needed)

Android SDK platform-tools (`adb`) are already present on this computer. Enable Quest Developer Mode through the Meta developer setup, connect via USB, and accept the headset's USB debugging authorization prompt.

Start the Python server on localhost as in section 2, then:

```powershell
adb devices
adb reverse tcp:8000 tcp:8000
```

Open `http://localhost:8000` in Quest Browser. ADB forwards that port to the PC; the browser sees localhost, which qualifies as a secure context even over HTTP. This is useful for development but requires USB initially, so it is not the home-Wi-Fi-only route. With multiple ADB devices connected, select the Quest with `adb -s <serial> reverse tcp:8000 tcp:8000`.

Remove forwarding afterward:

```powershell
adb reverse --remove tcp:8000
```

## 4. Direct LAN HTTPS (when you have a trusted certificate)

The development server also supports HTTPS:

```powershell
Set-Location 'C:\Users\eguendelman\dev\personal\webxr_music_visualizer'
python .\serve.py --host 0.0.0.0 --port 8443 --cert 'C:\webxr-certs\cert.pem' --key 'C:\webxr-certs\key.pem'
```

Supply actual PEM certificate/key files. Visit `https://192.168.0.159:8443` only if the certificate covers that IP address and the Quest trusts its issuer. For a trusted domain certificate, use the matching hostname resolving to this computer's LAN address instead.

**A self-signed certificate or mkcert certificate trusted on Windows is not automatically trusted on the Quest.** Clicking through a certificate warning is not a dependable way to enable WebXR. For a strictly LAN-only, wireless workflow, you need a certificate trust setup on the headset or a real domain with a publicly trusted certificate and local DNS. Certificate issuance and headset trust provisioning are outside this initial smoke test; use the tunnel or USB method to establish that rendering works first. Do not globally disable certificate checks or expose the development server to the Internet via router port forwarding.

## Development

Edit the static app assets and reload the browser; the server disables caching. There is no build step, hot reload, or automated test suite. Keep iteration simple: edit, reload, and try it on the desktop or Quest. The page can later be deployed to any HTTPS static host.

Restart the Python server after changes to its asset allowlist (including the move of JavaScript and CSS into the static directory), then reload the page.
