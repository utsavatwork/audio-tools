import "./style.css";

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <h1>MP3 Playground</h1>
  <p>Trim audio right in your browser. Your files never leave your device.</p>
  <input type="file" id="file" accept="audio/*,video/*" />
  <p id="info"></p>
  <canvas id="wave" width="900" height="160"
    style="width:100%;max-width:900px;touch-action:none;cursor:ew-resize"></canvas>
  <p id="sel"></p>
  <button id="play" disabled>Play selection</button>
  <button id="stop" disabled>Stop</button>
`

const fileInput = document.querySelector<HTMLInputElement>('#file')!
const info = document.querySelector<HTMLParagraphElement>('#info')!
const sel = document.querySelector<HTMLParagraphElement>('#sel')!
const canvas = document.querySelector<HTMLCanvasElement>('#wave')!
const playBtn = document.querySelector<HTMLButtonElement>('#play')!
const stopBtn = document.querySelector<HTMLButtonElement>('#stop')!
const g = canvas.getContext('2d')!

const audioCtx = new AudioContext()
let audioBuffer: AudioBuffer | null = null
let peaks: { min: number; max: number }[] = []
let start = 0 // selection as fractions of the track (0..1)
let end = 1
let drag: 'start' | 'end' | 'new' | null = null
let anchor = 0
let source: AudioBufferSourceNode | null = null

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (!file) return
  info.textContent = 'Decoding...'
  try {
    audioBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer())
    info.textContent =
      `${file.name} · ${audioBuffer.duration.toFixed(1)}s · ` +
      `${audioBuffer.numberOfChannels}ch · ${audioBuffer.sampleRate} Hz`
    peaks = computePeaks(audioBuffer)
    start = 0
    end = 1
    playBtn.disabled = false
    stopBtn.disabled = false
    render()
  } catch {
    info.textContent = 'Could not decode this file.'
  }
})

// Compute once: scanning millions of samples on every mouse move would lag
function computePeaks(buf: AudioBuffer) {
  const data = buf.getChannelData(0)
  const w = canvas.width
  const step = Math.max(1, Math.floor(data.length / w))
  const out: { min: number; max: number }[] = []
  for (let x = 0; x < w; x++) {
    let min = 1, max = -1
    for (let i = 0; i < step; i++) {
      const v = data[x * step + i]
      if (v < min) min = v
      if (v > max) max = v
    }
    out.push({ min, max })
  }
  return out
}

function render() {
  const w = canvas.width, h = canvas.height
  g.clearRect(0, 0, w, h)

  g.fillStyle = '#646cff'
  peaks.forEach((p, x) => {
    const y1 = ((1 + p.min) / 2) * h
    const y2 = ((1 + p.max) / 2) * h
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1))
  })

  // dim everything outside the selection
  g.fillStyle = 'rgba(0,0,0,0.6)'
  g.fillRect(0, 0, start * w, h)
  g.fillRect(end * w, 0, w - end * w, h)

  // handles
  g.fillStyle = '#ffb454'
  g.fillRect(start * w - 1, 0, 3, h)
  g.fillRect(end * w - 1, 0, 3, h)

  if (audioBuffer) {
    const d = audioBuffer.duration
    sel.textContent =
      `Selection: ${(start * d).toFixed(2)}s to ${(end * d).toFixed(2)}s ` +
      `(${((end - start) * d).toFixed(2)}s)`
  }
}

function xToFraction(e: PointerEvent) {
  const r = canvas.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}

canvas.addEventListener('pointerdown', e => {
  if (!audioBuffer) return
  canvas.setPointerCapture(e.pointerId)
  const f = xToFraction(e)
  const grab = 12 / canvas.getBoundingClientRect().width // ~12px grab zone
  if (Math.abs(f - start) < grab) drag = 'start'
  else if (Math.abs(f - end) < grab) drag = 'end'
  else {
    drag = 'new'
    anchor = f
    start = end = f
  }
  render()
})

canvas.addEventListener('pointermove', e => {
  if (!drag) return
  const f = xToFraction(e)
  if (drag === 'start') start = Math.min(f, end)
  else if (drag === 'end') end = Math.max(f, start)
  else {
    start = Math.min(anchor, f)
    end = Math.max(anchor, f)
  }
  render()
})

canvas.addEventListener('pointerup', () => { drag = null })

playBtn.addEventListener('click', async () => {
  if (!audioBuffer) return
  stop()
  await audioCtx.resume() // browsers keep audio suspended until a user gesture
  source = audioCtx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(audioCtx.destination)
  const d = audioBuffer.duration
  source.start(0, start * d, (end - start) * d) // (when, offset, duration)
})

stopBtn.addEventListener('click', stop)

function stop() {
  source?.stop()
  source = null
}