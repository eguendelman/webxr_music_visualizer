'use strict';

const canvas = document.querySelector('#scene');
const enterVrButton = document.querySelector('#enter-vr');
const message = document.querySelector('#message');
const secureStatus = document.querySelector('#secure-status');
const xrStatus = document.querySelector('#xr-status');
const glStatus = document.querySelector('#gl-status');
const gridCount = document.querySelector('#grid-count');
const ledSizeInput = document.querySelector('#led-size');
const ledPerturbationInput = document.querySelector('#led-perturbation');
const radialSpeedInput = document.querySelector('#radial-speed');
const radialSpeedDisplay = document.querySelector('#radial-speed-value');
const historyFadeInput = document.querySelector('#history-fade');
const historyFadeDisplay = document.querySelector('#history-fade-value');
const colorSchemeInput = document.querySelector('#color-scheme');
const noiseFloorInput = document.querySelector('#noise-floor');
const responseGainInput = document.querySelector('#response-gain');
const responseCurveInput = document.querySelector('#response-curve');
const onsetBoostInput = document.querySelector('#onset-boost');
const idleBrightnessInput = document.querySelector('#idle-brightness');
const peakBrightnessInput = document.querySelector('#peak-brightness');
const demoSignalInput = document.querySelector('#demo-signal');
const debugAllWhiteInput = document.querySelector('#debug-all-white');
const resetCameraButton = document.querySelector('#reset-camera');
document.querySelector('#origin').textContent = location.origin;
secureStatus.textContent = window.isSecureContext ? 'Secure context' : 'HTTP / VR unavailable';

const controls = {
  stripSpacing: document.querySelector('#strip-spacing'),
  ledSpacing: document.querySelector('#led-spacing'),
  ceilingHeight: document.querySelector('#ceiling-height'),
  xExtent: document.querySelector('#x-extent'),
  zExtent: document.querySelector('#z-extent'),
  clearanceRadius: document.querySelector('#clearance-radius'),
};
const controlDisplays = {
  stripSpacing: document.querySelector('#strip-spacing-value'),
  ledSpacing: document.querySelector('#led-spacing-value'),
  ceilingHeight: document.querySelector('#ceiling-height-value'),
  xExtent: document.querySelector('#x-extent-value'),
  zExtent: document.querySelector('#z-extent-value'),
  clearanceRadius: document.querySelector('#clearance-radius-value'),
};
const ledSizeDisplay = document.querySelector('#led-size-value');
const ledPerturbationDisplay = document.querySelector('#led-perturbation-value');
const responseDisplays = {
  noiseFloor: document.querySelector('#noise-floor-value'),
  responseGain: document.querySelector('#response-gain-value'),
  responseCurve: document.querySelector('#response-curve-value'),
  onsetBoost: document.querySelector('#onset-boost-value'),
  idleBrightness: document.querySelector('#idle-brightness-value'),
  peakBrightness: document.querySelector('#peak-brightness-value'),
};

let gl;
let boxProgram;
let pointProgram;
let lineProgram;
let boxBuffer;
let ledPositionBuffer;
let ledColorBuffer;
let strandBuffer;
let floorGridBuffer;
let ledBasePositions = new Float32Array();
let ledRenderPositions = new Float32Array();
let ledPerturbations = new Float32Array();
let ledColors = new Float32Array();
let strandCount = 0;
let floorGridVertexCount = 0;
let pointCount = 0;
let ledColorsAreDebugWhite = false;
let currentGrid = null;
let rebuildFrame = null;
let session = null;
let referenceSpace;
let desktopFrame;
let starting = false;
let supported = false;
const desktopView = {
  yaw: Math.PI * 0.25,
  pitch: 0.28,
  distance: 10,
  target: [0, 1.3, 0],
  pointerId: null,
  dragMode: null,
  lastX: 0,
  lastY: 0,
};

function resetDesktopView() {
  desktopView.yaw = Math.PI * 0.25;
  desktopView.pitch = 0.28;
  desktopView.distance = currentGrid ? Math.max(currentGrid.xExtent, currentGrid.zExtent) * 2.5 : 10;
  desktopView.target = [0, currentGrid ? currentGrid.ceilingHeight * 0.5 : 1.3, 0];
}

function finishDesktopDrag(event) {
  if (event.pointerId !== desktopView.pointerId) return;
  desktopView.pointerId = null;
  desktopView.dragMode = null;
  canvas.classList.remove('is-dragging');
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}

canvas.addEventListener('pointerdown', (event) => {
  if (session || desktopView.pointerId !== null) return;
  if (event.pointerType === 'mouse' && ![0, 1, 2].includes(event.button)) return;
  desktopView.pointerId = event.pointerId;
  desktopView.dragMode = event.shiftKey || event.button === 1 || event.button === 2 ? 'pan' : 'orbit';
  desktopView.lastX = event.clientX;
  desktopView.lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('is-dragging');
  event.preventDefault();
});
canvas.addEventListener('pointermove', (event) => {
  if (event.pointerId !== desktopView.pointerId) return;
  const dx = event.clientX - desktopView.lastX;
  const dy = event.clientY - desktopView.lastY;
  desktopView.lastX = event.clientX;
  desktopView.lastY = event.clientY;
  if (desktopView.dragMode === 'orbit') {
    desktopView.yaw -= dx * 0.005;
    desktopView.pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, desktopView.pitch + dy * 0.004));
  } else {
    const scale = desktopView.distance * 0.0015;
    const right = [Math.cos(desktopView.yaw), 0, -Math.sin(desktopView.yaw)];
    const up = [
      -Math.sin(desktopView.yaw) * Math.sin(desktopView.pitch),
      Math.cos(desktopView.pitch),
      -Math.cos(desktopView.yaw) * Math.sin(desktopView.pitch),
    ];
    for (let i = 0; i < 3; i++) {
      desktopView.target[i] -= right[i] * dx * scale;
      desktopView.target[i] += up[i] * dy * scale;
    }
  }
  event.preventDefault();
});
canvas.addEventListener('pointerup', finishDesktopDrag);
canvas.addEventListener('pointercancel', finishDesktopDrag);
canvas.addEventListener('lostpointercapture', (event) => {
  if (event.pointerId !== desktopView.pointerId) return;
  desktopView.pointerId = null;
  desktopView.dragMode = null;
  canvas.classList.remove('is-dragging');
});
canvas.addEventListener('wheel', (event) => {
  if (session) return;
  const maximum = currentGrid ? Math.max(currentGrid.xExtent, currentGrid.zExtent, currentGrid.ceilingHeight) * 8 : 40;
  desktopView.distance = Math.max(0.3, Math.min(maximum, desktopView.distance * Math.exp(event.deltaY * 0.001)));
  event.preventDefault();
}, { passive: false });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
resetCameraButton.addEventListener('click', resetDesktopView);

const audioFile = document.querySelector('#audio-file');
const audio = document.querySelector('#audio-player');
const playButton = document.querySelector('#play-audio');
const audioMessage = document.querySelector('#audio-message');
const audioStatus = document.querySelector('#audio-status');
const trackName = document.querySelector('#track-name');
const bandLevels = new Float32Array(32);
const SPECTRUM_HISTORY_RATE = 60;
const SPECTRUM_HISTORY_CAPACITY = SPECTRUM_HISTORY_RATE * 45;
const spectrumHistory = new Float32Array(SPECTRUM_HISTORY_CAPACITY * bandLevels.length);
let spectrumHistoryWriteIndex = -1;
let spectrumHistoryFrames = 0;
let lastSpectrumHistoryTime = null;
let audioContext;
let analyser;
let frequencyData;
let frequencyBands;
let objectUrl = null;
let audioRevision = 0;
let playPending = false;

function compileProgram(vertexSource, fragmentSource) {
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader));
    }
    return shader;
  }
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  return program;
}

// Column-major matrices, matching WebGL and WebXR.
function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] = a[row] * b[col * 4]
        + a[4 + row] * b[col * 4 + 1]
        + a[8 + row] * b[col * 4 + 2]
        + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function model(x, y, z, sx, sy, sz) {
  return new Float32Array([
    sx, 0, 0, 0,
    0, sy, 0, 0,
    0, 0, sz, 0,
    x, y, z, 1,
  ]);
}

function perspective(aspect) {
  const f = 1 / Math.tan(Math.PI / 6);
  const near = 0.1;
  const far = 100;
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) / (near - far), -1,
    0, 0, 2 * far * near / (near - far), 0,
  ]);
}

function lookAt(eye, target) {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let length = Math.hypot(zx, zy, zz);
  zx /= length; zy /= length; zz /= length;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  length = Math.hypot(xx, xz);
  xx /= length; xz /= length;
  const yx = zy * xz;
  const yy = zz * xx - zx * xz;
  const yz = -zy * xx;
  return new Float32Array([
    xx, yx, zx, 0,
    xy, yy, zy, 0,
    xz, yz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1,
  ]);
}

function initRenderer() {
  gl = canvas.getContext('webgl', { antialias: true, alpha: false, xrCompatible: true });
  if (!gl) throw new Error('WebGL is unavailable in this browser.');

  boxProgram = compileProgram(`
    attribute vec3 position;
    uniform mat4 mvp;
    varying float shade;
    void main() {
      shade = 0.68 + position.y * 0.25;
      gl_Position = mvp * vec4(position, 1.0);
    }
  `, `
    precision mediump float;
    uniform vec3 color;
    varying float shade;
    void main() { gl_FragColor = vec4(color * shade, 1.0); }
  `);
  boxProgram.position = gl.getAttribLocation(boxProgram, 'position');
  boxProgram.mvp = gl.getUniformLocation(boxProgram, 'mvp');
  boxProgram.color = gl.getUniformLocation(boxProgram, 'color');

  lineProgram = compileProgram(`
    attribute vec3 position;
    uniform mat4 vp;
    void main() { gl_Position = vp * vec4(position, 1.0); }
  `, `
    precision mediump float;
    uniform vec4 color;
    void main() { gl_FragColor = color; }
  `);
  lineProgram.position = gl.getAttribLocation(lineProgram, 'position');
  lineProgram.vp = gl.getUniformLocation(lineProgram, 'vp');
  lineProgram.color = gl.getUniformLocation(lineProgram, 'color');

  pointProgram = compileProgram(`
    attribute vec3 position;
    attribute vec3 color;
    uniform mat4 vp;
    uniform float pointScale;
    varying vec3 ledColor;
    void main() {
      gl_Position = vp * vec4(position, 1.0);
      gl_PointSize = clamp(pointScale / max(0.35, gl_Position.w), 1.0, 64.0);
      ledColor = color;
    }
  `, `
    precision mediump float;
    uniform float opacity;
    varying vec3 ledColor;
    void main() {
      float radius = length(gl_PointCoord - vec2(0.5));
      float alpha = (1.0 - smoothstep(0.08, 0.5, radius)) * opacity;
      gl_FragColor = vec4(ledColor, alpha);
    }
  `);
  pointProgram.position = gl.getAttribLocation(pointProgram, 'position');
  pointProgram.color = gl.getAttribLocation(pointProgram, 'color');
  pointProgram.vp = gl.getUniformLocation(pointProgram, 'vp');
  pointProgram.pointScale = gl.getUniformLocation(pointProgram, 'pointScale');
  pointProgram.opacity = gl.getUniformLocation(pointProgram, 'opacity');

  const vertices = [];
  const corners = [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  ];
  for (const face of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 4, 7, 3], [1, 5, 6, 2], [3, 2, 6, 7], [0, 1, 5, 4]]) {
    for (const index of [face[0], face[1], face[2], face[0], face[2], face[3]]) {
      vertices.push(...corners[index]);
    }
  }
  boxBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  ledPositionBuffer = gl.createBuffer();
  ledColorBuffer = gl.createBuffer();
  strandBuffer = gl.createBuffer();
  floorGridBuffer = gl.createBuffer();
  gl.enable(gl.DEPTH_TEST);
  gl.clearColor(0.012, 0.018, 0.026, 1);
  rebuildGrid();
  glStatus.textContent = 'WebGL ready';
}

function gridParameters() {
  return Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, Number(input.value)]));
}

function refreshControlLabels() {
  for (const [name, display] of Object.entries(controlDisplays)) {
    display.textContent = `${Number(controls[name].value).toFixed(controls[name].step < 0.1 ? 2 : 1)} m`;
  }
  ledSizeDisplay.textContent = `${ledSizeInput.value} px`;
  ledPerturbationDisplay.textContent = `${Number(ledPerturbationInput.value).toFixed(4)} m`;
  radialSpeedDisplay.textContent = `${Number(radialSpeedInput.value).toFixed(2)} m/s`;
  historyFadeDisplay.textContent = `${Number(historyFadeInput.value).toFixed(1)} s`;
  responseDisplays.noiseFloor.textContent = Number(noiseFloorInput.value).toFixed(2);
  responseDisplays.responseGain.textContent = `${Number(responseGainInput.value).toFixed(2)}x`;
  responseDisplays.responseCurve.textContent = Number(responseCurveInput.value).toFixed(2);
  responseDisplays.onsetBoost.textContent = `${Number(onsetBoostInput.value).toFixed(1)}x`;
  responseDisplays.idleBrightness.textContent = Number(idleBrightnessInput.value).toFixed(3);
  responseDisplays.peakBrightness.textContent = Number(peakBrightnessInput.value).toFixed(2);
}

let spareNormalRandom = null;

function normalRandom() {
  if (spareNormalRandom !== null) {
    const value = spareNormalRandom;
    spareNormalRandom = null;
    return value;
  }
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const magnitude = Math.sqrt(-2 * Math.log(u));
  const angle = 2 * Math.PI * v;
  spareNormalRandom = magnitude * Math.sin(angle);
  return magnitude * Math.cos(angle);
}

function updatePerturbedLedPositions() {
  if (!gl || !currentGrid || ledBasePositions.length === 0) return;
  const deviation = Number(ledPerturbationInput.value);
  for (let i = 0; i < ledBasePositions.length; i += 3) {
    ledRenderPositions[i] = ledBasePositions[i] + ledPerturbations[i] * deviation;
    ledRenderPositions[i + 1] = Math.max(0, Math.min(
      currentGrid.ceilingHeight,
      ledBasePositions[i + 1] + ledPerturbations[i + 1] * deviation,
    ));
    ledRenderPositions[i + 2] = ledBasePositions[i + 2] + ledPerturbations[i + 2] * deviation;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, ledPositionBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, ledRenderPositions);
}

function rebuildGrid() {
  if (!gl) return;
  const parameters = gridParameters();
  const positions = [];
  const strands = [];
  const floorLines = [];
  const isInitialGrid = currentGrid === null;
  const xSteps = Math.floor(parameters.xExtent / parameters.stripSpacing);
  const zSteps = Math.floor(parameters.zExtent / parameters.stripSpacing);
  const ledsPerStrip = Math.max(2, Math.round(parameters.ceilingHeight / parameters.ledSpacing) + 1);
  const actualLedSpacing = parameters.ceilingHeight / (ledsPerStrip - 1);
  const xLimit = xSteps * parameters.stripSpacing;
  const zLimit = zSteps * parameters.stripSpacing;
  for (let xi = -xSteps; xi <= xSteps; xi++) {
    const x = xi * parameters.stripSpacing;
    floorLines.push(x, 0.004, -zLimit, x, 0.004, zLimit);
  }
  for (let zi = -zSteps; zi <= zSteps; zi++) {
    const z = zi * parameters.stripSpacing;
    floorLines.push(-xLimit, 0.004, z, xLimit, 0.004, z);
  }
  let strips = 0;
  for (let xi = -xSteps; xi <= xSteps; xi++) {
    const x = xi * parameters.stripSpacing;
    for (let zi = -zSteps; zi <= zSteps; zi++) {
      const z = zi * parameters.stripSpacing;
      if (Math.hypot(x, z) < parameters.clearanceRadius) continue;
      strips++;
      strands.push(x, 0, z, x, parameters.ceilingHeight, z);
      for (let yi = 0; yi < ledsPerStrip; yi++) {
        positions.push(x, yi * actualLedSpacing, z);
      }
    }
  }
  ledBasePositions = new Float32Array(positions);
  ledRenderPositions = new Float32Array(positions.length);
  ledPerturbations = new Float32Array(positions.length);
  for (let i = 0; i < ledPerturbations.length; i++) {
    ledPerturbations[i] = Math.max(-3, Math.min(3, normalRandom()));
  }
  ledColors = new Float32Array(positions.length);
  ledColorsAreDebugWhite = false;
  pointCount = positions.length / 3;
  strandCount = strips;
  currentGrid = parameters;
  gl.bindBuffer(gl.ARRAY_BUFFER, ledPositionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, ledRenderPositions.byteLength, gl.DYNAMIC_DRAW);
  updatePerturbedLedPositions();
  gl.bindBuffer(gl.ARRAY_BUFFER, ledColorBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, ledColors.byteLength, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, strandBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(strands), gl.STATIC_DRAW);
  floorGridVertexCount = floorLines.length / 3;
  gl.bindBuffer(gl.ARRAY_BUFFER, floorGridBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(floorLines), gl.STATIC_DRAW);
  const isHeavy = pointCount > 100000;
  gridCount.textContent = `${strips.toLocaleString()} strips / ${pointCount.toLocaleString()} LEDs${isHeavy ? ' / HEAVY' : ''}`;
  gridCount.classList.toggle('is-heavy', isHeavy);
  gridCount.title = isHeavy ? 'This density may render slowly, especially on a standalone headset.' : '';
  if (isInitialGrid) resetDesktopView();
}

function scheduleGridRebuild() {
  refreshControlLabels();
  if (rebuildFrame !== null) cancelAnimationFrame(rebuildFrame);
  rebuildFrame = requestAnimationFrame(() => {
    rebuildFrame = null;
    rebuildGrid();
  });
}

for (const input of document.querySelectorAll('[data-grid-param]')) {
  input.addEventListener('input', scheduleGridRebuild);
}
for (const input of [
  ledSizeInput,
  ledPerturbationInput,
  radialSpeedInput,
  historyFadeInput,
  noiseFloorInput,
  responseGainInput,
  responseCurveInput,
  onsetBoostInput,
  idleBrightnessInput,
  peakBrightnessInput,
]) {
  input.addEventListener('input', refreshControlLabels);
}
ledPerturbationInput.addEventListener('input', updatePerturbedLedPositions);
demoSignalInput.addEventListener('change', updatePlaybackUI);
refreshControlLabels();

function makeFrequencyBands(sampleRate, fftSize, count) {
  const binHz = sampleRate / fftSize;
  const maxHz = Math.min(16000, sampleRate / 2);
  const minHz = Math.min(40, maxHz / 2);
  return Array.from({ length: count }, (_, i) => {
    const start = Math.max(1, Math.floor(minHz * (maxHz / minHz) ** (i / count) / binHz));
    const end = Math.min(fftSize / 2, Math.max(start + 1,
      Math.ceil(minHz * (maxHz / minHz) ** ((i + 1) / count) / binHz)));
    return [start, end];
  });
}

function readFrequencyBands(data, bands, output) {
  for (let i = 0; i < bands.length; i++) {
    const [start, end] = bands[i];
    let energy = 0;
    for (let bin = start; bin < end; bin++) energy += (data[bin] / 255) ** 2;
    output[i] = Math.sqrt(energy / (end - start));
  }
}

function initAudio() {
  if (audioContext) return;
  if (!window.AudioContext) throw new Error('Web Audio analysis is unavailable in this browser.');
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  analyser.minDecibels = -85;
  analyser.maxDecibels = -20;
  const source = audioContext.createMediaElementSource(audio);
  source.connect(analyser);
  analyser.connect(audioContext.destination);
  frequencyData = new Uint8Array(analyser.frequencyBinCount);
  frequencyBands = makeFrequencyBands(audioContext.sampleRate, analyser.fftSize, bandLevels.length);
}

function updateSpectrum() {
  if (!analyser || !objectUrl || audio.paused || audio.ended || audio.error || audioContext.state !== 'running') {
    bandLevels.fill(0);
    return;
  }
  analyser.getByteFrequencyData(frequencyData);
  readFrequencyBands(frequencyData, frequencyBands, bandLevels);
}

function clearSpectrumHistory() {
  spectrumHistoryWriteIndex = -1;
  spectrumHistoryFrames = 0;
  lastSpectrumHistoryTime = null;
}

function pushSpectrumHistoryFrame() {
  spectrumHistoryWriteIndex = (spectrumHistoryWriteIndex + 1) % SPECTRUM_HISTORY_CAPACITY;
  spectrumHistory.set(bandLevels, spectrumHistoryWriteIndex * bandLevels.length);
  spectrumHistoryFrames = Math.min(SPECTRUM_HISTORY_CAPACITY, spectrumHistoryFrames + 1);
}

function recordSpectrumHistory(seconds) {
  if (lastSpectrumHistoryTime === null || seconds - lastSpectrumHistoryTime > 0.5) {
    clearSpectrumHistory();
    pushSpectrumHistoryFrame();
    lastSpectrumHistoryTime = seconds;
    return;
  }
  const framesToAdd = Math.floor((seconds - lastSpectrumHistoryTime) * SPECTRUM_HISTORY_RATE);
  for (let i = 0; i < framesToAdd; i++) pushSpectrumHistoryFrame();
  if (framesToAdd > 0) lastSpectrumHistoryTime += framesToAdd / SPECTRUM_HISTORY_RATE;
}

function historicalBandLevel(delaySeconds, band) {
  if (spectrumHistoryFrames === 0) return 0;
  const framesAgo = Math.max(0, delaySeconds * SPECTRUM_HISTORY_RATE);
  if (framesAgo > spectrumHistoryFrames - 1) return 0;
  const newerOffset = Math.floor(framesAgo);
  const blend = framesAgo - newerOffset;
  const olderOffset = Math.min(spectrumHistoryFrames - 1, newerOffset + 1);
  const newerFrame = (spectrumHistoryWriteIndex - newerOffset + SPECTRUM_HISTORY_CAPACITY) % SPECTRUM_HISTORY_CAPACITY;
  const olderFrame = (spectrumHistoryWriteIndex - olderOffset + SPECTRUM_HISTORY_CAPACITY) % SPECTRUM_HISTORY_CAPACITY;
  const newer = spectrumHistory[newerFrame * bandLevels.length + band];
  const older = spectrumHistory[olderFrame * bandLevels.length + band];
  return newer + (older - newer) * blend;
}

function hsvToRgb(hue, saturation, value) {
  const sector = Math.floor(hue * 6);
  const fraction = hue * 6 - sector;
  const p = value * (1 - saturation);
  const q = value * (1 - fraction * saturation);
  const t = value * (1 - (1 - fraction) * saturation);
  switch (sector % 6) {
    case 0: return [value, t, p];
    case 1: return [q, value, p];
    case 2: return [p, value, t];
    case 3: return [p, q, value];
    case 4: return [t, p, value];
    default: return [value, p, q];
  }
}

const rainbowPalette = new Float32Array(bandLevels.length * 3);
for (let band = 0; band < bandLevels.length; band++) {
  const color = hsvToRgb((band / (bandLevels.length - 1)) * 0.86, 0.92, 1);
  rainbowPalette.set(color, band * 3);
}

function gatedLevel(level, noiseFloor) {
  return Math.max(0, (level - noiseFloor) / (1 - noiseFloor));
}

function updateLedColors(seconds) {
  if (debugAllWhiteInput.checked) {
    if (!ledColorsAreDebugWhite) {
      ledColors.fill(1);
      gl.bindBuffer(gl.ARRAY_BUFFER, ledColorBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, ledColors);
      ledColorsAreDebugWhite = true;
    }
    return;
  }
  ledColorsAreDebugWhite = false;
  const usingAudio = Boolean(objectUrl);
  const usingDemo = !usingAudio && demoSignalInput.checked;
  const useRainbow = colorSchemeInput.value === 'rainbow';
  const ceiling = currentGrid.ceilingHeight;
  const propagationSpeed = Number(radialSpeedInput.value);
  const fadeSeconds = Number(historyFadeInput.value);
  const noiseFloor = Number(noiseFloorInput.value);
  const gain = Number(responseGainInput.value);
  const responseCurve = Number(responseCurveInput.value);
  const onsetBoost = Number(onsetBoostInput.value);
  const idleBrightness = Number(idleBrightnessInput.value);
  const peakBrightness = Number(peakBrightnessInput.value);
  for (let i = 0; i < pointCount; i++) {
    const offset = i * 3;
    const x = ledBasePositions[offset];
    const y = ledBasePositions[offset + 1];
    const z = ledBasePositions[offset + 2];
    const radius = Math.hypot(x, z);
    const yRatio = y / ceiling;
    const band = Math.min(31, Math.floor(yRatio * 32));
    let signal = 0;
    if (usingAudio) {
      const delay = Math.max(0, radius - currentGrid.clearanceRadius) / propagationSpeed;
      const level = gatedLevel(historicalBandLevel(delay, band), noiseFloor);
      const previousLevel = gatedLevel(historicalBandLevel(delay + 0.08, band), noiseFloor);
      const onset = Math.max(0, level - previousLevel);
      const historyFade = Math.exp(-delay / fadeSeconds);
      const angularTexture = 0.9 + 0.1 * Math.sin(Math.atan2(z, x) * 5 + y * 1.4);
      signal = (level * gain + onset * onsetBoost) * historyFade * angularTexture;
    } else if (usingDemo) {
      const radialPhase = radius * 4.4 - seconds * 2.4 - y * 2.1;
      const demoLevel = Math.max(0, Math.sin(radialPhase)) ** 10;
      signal = gatedLevel(demoLevel, noiseFloor) * gain;
    }
    const shapedSignal = Math.pow(Math.min(1, Math.max(0, signal)), responseCurve);
    const intensity = idleBrightness + shapedSignal * peakBrightness;
    let red;
    let green;
    let blue;
    if (useRainbow) {
      const paletteOffset = band * 3;
      red = rainbowPalette[paletteOffset];
      green = rainbowPalette[paletteOffset + 1];
      blue = rainbowPalette[paletteOffset + 2];
    } else {
      red = 0.38 + (1 - yRatio) * 0.68;
      green = 0.07 + yRatio * 0.57;
      blue = 0.55 + yRatio * 0.45;
    }
    ledColors[offset] = intensity * red;
    ledColors[offset + 1] = intensity * green;
    ledColors[offset + 2] = intensity * blue;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, ledColorBuffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, ledColors);
}

function updatePlaybackUI() {
  playButton.disabled = !objectUrl || playPending || Boolean(audio.error);
  playButton.textContent = playPending ? 'Starting playback...' : audio.paused ? 'Play track' : 'Pause track';
  if (!objectUrl) {
    audioStatus.textContent = demoSignalInput.checked ? 'Demo signal' : 'No track / idle';
    return;
  }
  if (audio.error) return;
  audioStatus.textContent = audio.ended ? 'Track ended' : audio.paused ? 'Paused / ready' : 'Playing';
}

audioFile.addEventListener('change', () => {
  const file = audioFile.files[0];
  if (!file) return;
  audioRevision++;
  playPending = false;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  audio.hidden = true;
  bandLevels.fill(0);
  clearSpectrumHistory();
  trackName.textContent = file.name;
  audioMessage.textContent = 'Press Play track, then enter VR. MP3 or WAV are good starting points.';
  updatePlaybackUI();
});

async function toggleAudio() {
  if (!objectUrl || playPending || audio.error) return;
  if (!audio.paused) {
    audio.pause();
    return;
  }
  const revision = audioRevision;
  playPending = true;
  updatePlaybackUI();
  try {
    initAudio();
    await Promise.all([audioContext.resume(), audio.play()]);
    if (revision !== audioRevision) return;
    audio.hidden = false;
    audioMessage.textContent = 'Music is driving the LED field. In VR, controller trigger toggles play/pause.';
  } catch (error) {
    if (revision !== audioRevision) return;
    audio.pause();
    audioMessage.textContent = `Could not start audio: ${error.message}. Try again or choose another file.`;
  } finally {
    if (revision === audioRevision) {
      playPending = false;
      updatePlaybackUI();
    }
  }
}

playButton.addEventListener('click', toggleAudio);
for (const event of ['play', 'pause', 'ended']) audio.addEventListener(event, updatePlaybackUI);
audio.addEventListener('seeking', clearSpectrumHistory);
audio.addEventListener('play', () => {
  if (audioContext) audioContext.resume().catch((error) => {
    audioMessage.textContent = `Audio analysis could not resume: ${error.message}. Pause and press Play track again.`;
  });
});
audio.addEventListener('error', () => {
  if (!audio.error || !objectUrl) return;
  audioStatus.textContent = 'Unsupported / unreadable';
  audioMessage.textContent = 'This file could not be played. Try MP3 or PCM WAV.';
  updatePlaybackUI();
});
window.addEventListener('beforeunload', () => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

function drawBox(vp, transform, color) {
  gl.useProgram(boxProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, boxBuffer);
  gl.enableVertexAttribArray(boxProgram.position);
  gl.vertexAttribPointer(boxProgram.position, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(boxProgram.mvp, false, multiply(vp, transform));
  gl.uniform3fv(boxProgram.color, color);
  gl.drawArrays(gl.TRIANGLES, 0, 36);
}

function drawEnvironment(vp) {
  const width = currentGrid.xExtent * 2 + 0.5;
  const depth = currentGrid.zExtent * 2 + 0.5;
  drawBox(vp, model(0, -0.055, 0, width, 0.1, depth), [0.018, 0.03, 0.04]);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(lineProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, floorGridBuffer);
  gl.enableVertexAttribArray(lineProgram.position);
  gl.vertexAttribPointer(lineProgram.position, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(lineProgram.vp, false, vp);
  gl.uniform4f(lineProgram.color, 0.23, 0.66, 0.58, 0.46);
  gl.drawArrays(gl.LINES, 0, floorGridVertexCount);
  gl.disable(gl.BLEND);
}

function drawLedVolume(vp) {
  gl.enable(gl.BLEND);
  gl.depthMask(false);

  gl.useProgram(lineProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, strandBuffer);
  gl.enableVertexAttribArray(lineProgram.position);
  gl.vertexAttribPointer(lineProgram.position, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(lineProgram.vp, false, vp);
  gl.uniform4f(lineProgram.color, 0.2, 0.11, 0.24, 0.2);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.LINES, 0, strandCount * 2);

  gl.useProgram(pointProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, ledPositionBuffer);
  gl.enableVertexAttribArray(pointProgram.position);
  gl.vertexAttribPointer(pointProgram.position, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, ledColorBuffer);
  gl.enableVertexAttribArray(pointProgram.color);
  gl.vertexAttribPointer(pointProgram.color, 3, gl.FLOAT, false, 0, 0);
  gl.uniformMatrix4fv(pointProgram.vp, false, vp);
  const pointSize = Number(ledSizeInput.value);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.uniform1f(pointProgram.pointScale, pointSize * 2.35);
  gl.uniform1f(pointProgram.opacity, 0.16);
  gl.drawArrays(gl.POINTS, 0, pointCount);
  gl.uniform1f(pointProgram.pointScale, pointSize);
  gl.uniform1f(pointProgram.opacity, 0.9);
  gl.drawArrays(gl.POINTS, 0, pointCount);

  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

function prepareFrame(time) {
  const seconds = time / 1000;
  updateSpectrum();
  recordSpectrumHistory(seconds);
  updateLedColors(seconds);
}

function renderDesktop(time) {
  if (session) return;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  prepareFrame(time);
  const horizontal = Math.cos(desktopView.pitch) * desktopView.distance;
  const eye = [
    desktopView.target[0] + Math.sin(desktopView.yaw) * horizontal,
    desktopView.target[1] + Math.sin(desktopView.pitch) * desktopView.distance,
    desktopView.target[2] + Math.cos(desktopView.yaw) * horizontal,
  ];
  const vp = multiply(perspective(width / height), lookAt(eye, desktopView.target));
  drawEnvironment(vp);
  drawLedVolume(vp);
  desktopFrame = requestAnimationFrame(renderDesktop);
}

function renderXR(time, frame) {
  const current = frame.session;
  current.requestAnimationFrame(renderXR);
  const pose = frame.getViewerPose(referenceSpace);
  if (!pose) return;
  const layer = current.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  prepareFrame(time);
  for (const view of pose.views) {
    const viewport = layer.getViewport(view);
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    const vp = multiply(view.projectionMatrix, view.transform.inverse.matrix);
    drawEnvironment(vp);
    drawLedVolume(vp);
  }
}

enterVrButton.addEventListener('click', async () => {
  if (starting || session || !supported) return;
  starting = true;
  enterVrButton.disabled = true;
  message.textContent = 'Starting immersive VR...';
  try {
    session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    cancelAnimationFrame(desktopFrame);
    session.addEventListener('select', toggleAudio);
    session.addEventListener('end', () => {
      session = null;
      enterVrButton.disabled = !supported;
      enterVrButton.textContent = 'Enter VR';
      message.textContent = 'VR session ended. Adjust the LED volume or enter again.';
      desktopFrame = requestAnimationFrame(renderDesktop);
    }, { once: true });
    await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    try {
      referenceSpace = await session.requestReferenceSpace('local-floor');
    } catch {
      const local = await session.requestReferenceSpace('local');
      referenceSpace = local.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: -1.6, z: 0 }));
    }
    session.requestAnimationFrame(renderXR);
    enterVrButton.textContent = 'VR session active';
    message.textContent = 'You are inside the LED grid. Use the Quest system menu to exit.';
  } catch (error) {
    if (session) {
      try { await session.end(); } catch { /* The device may already have ended the session. */ }
    }
    enterVrButton.disabled = !supported;
    message.textContent = `Could not enter VR: ${error.message}`;
  } finally {
    starting = false;
  }
});

async function init() {
  try {
    initRenderer();
    desktopFrame = requestAnimationFrame(renderDesktop);
    if (!window.isSecureContext) {
      xrStatus.textContent = 'Needs HTTPS or localhost';
      enterVrButton.textContent = 'Secure connection required';
      message.textContent = 'The page is reachable. Immersive VR needs trusted HTTPS, or localhost via USB forwarding.';
      return;
    }
    if (!navigator.xr) {
      xrStatus.textContent = 'API unavailable';
      enterVrButton.textContent = 'WebXR unavailable';
      message.textContent = 'Desktop preview is ready. Open this URL in Meta Quest Browser for WebXR.';
      return;
    }
    supported = await navigator.xr.isSessionSupported('immersive-vr');
    xrStatus.textContent = supported ? 'Immersive VR supported' : 'No VR device detected';
    enterVrButton.disabled = !supported;
    enterVrButton.textContent = supported ? 'Enter VR' : 'Open on your Quest';
    message.textContent = supported ? 'Ready. Configure the grid, start a track, and enter VR.' : 'Desktop preview is running. Open this URL in Meta Quest Browser to enter VR.';
  } catch (error) {
    glStatus.textContent = 'Renderer unavailable';
    xrStatus.textContent = 'Check failed';
    enterVrButton.disabled = true;
    enterVrButton.textContent = 'Unable to initialize';
    message.textContent = error.message;
  }
}

init();
