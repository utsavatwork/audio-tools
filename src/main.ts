import "./style.css";
import { Mp3Encoder } from '@breezystack/lamejs'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <h1>MP3 Playground</h1>
  <p class="sub">Trim audio in your browser. Your files never leave your device.</p>

  <label id="drop" class="drop">
    <input type="file" id="file" accept="audio/*,video/*" hidden />
    <span>Drop an audio or video file here, or <u>browse</u></span>
  </label>
  <p id="info"></p>

  <div id="editor" hidden>
    <canvas id="wave" width="900" height="160"
      style="touch-action:none;cursor:ew-resize"></canvas>
    <p id="sel"></p>
    <div class="row">
      <button id="play">Play selection</button>
      <button id="stop">Stop</button>
    </div>
    <div class="row">
      <select id="kbps">
        <option value="128">128 kbps</option>
        <option value="192" selected>192 kbps</option>
        <option value="320">320 kbps</option>
      </select>
      <button id="export-mp3">Download MP3</button>
      <button id="export-wav">Download WAV</button>
      <span id="status"></span>
    </div>
  </div>
`

const fileInput = document.querySelector<HTMLInputElement>('#file')!
const info = document.querySelector<HTMLParagraphElement>('#info')!
const sel = document.querySelector<HTMLParagraphElement>('#sel')!
const canvas = document.querySelector<HTMLCanvasElement>('#wave')!
const playBtn = document.querySelector<HTMLButtonElement>('#play')!
const stopBtn = document.querySelector<HTMLButtonElement>('#stop')!
const wavBtn = document.querySelector<HTMLButtonElement>('#export-wav')!
const mp3Btn = document.querySelector<HTMLButtonElement>('#export-mp3')!
const kbpsSel = document.querySelector<HTMLSelectElement>('#kbps')!
const status = document.querySelector<HTMLSpanElement>('#status')!
const drop = document.querySelector<HTMLLabelElement>('#drop')!
const editor = document.querySelector<HTMLDivElement>('#editor')!
const g = canvas.getContext('2d')!

const audioCtx = new AudioContext()
let audioBuffer: AudioBuffer | null = null
let peaks: { min: number; max: number }[] = []
let start = 0 // selection as fractions of the track (0..1)
let end = 1
let drag: 'start' | 'end' | 'new' | null = null
let anchor = 0
let source: AudioBufferSourceNode | null = null
let prevSel = { start: 0, end: 1 } // restored if a click makes no real selection
let encoding = false

const MAX_MB = 50
const MIN_SEL_SEC = 0.05 // anything shorter is treated as "no selection"

function hasSelection() {
  return !!audioBuffer && (end - start) * audioBuffer.duration >= MIN_SEL_SEC
}

function updateButtons() {
  const ok = hasSelection()
  playBtn.disabled = !ok
  wavBtn.disabled = !ok
  mp3Btn.disabled = !ok || encoding
}

async function loadFile(file: File) {
  if (file.size > MAX_MB * 1024 * 1024) {
    info.textContent = `File is too large (max ${MAX_MB} MB).`
    return
  }
  stop()
  info.textContent = 'Decoding...'
  try {
    audioBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer())
    info.textContent =
      `${file.name} · ${audioBuffer.duration.toFixed(1)}s · ` +
      `${audioBuffer.numberOfChannels}ch · ${audioBuffer.sampleRate} Hz`
    peaks = computePeaks(audioBuffer)
    start = 0
    end = 1
    status.textContent = ''
    editor.hidden = false
    render()
  } catch {
    info.textContent = "Couldn't read this file. Try an MP3, WAV, M4A, or MP4."
  }
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  if (f) loadFile(f)
})

drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over') })
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', e => {
  e.preventDefault()
  drop.classList.remove('over')
  const f = e.dataTransfer?.files?.[0]
  if (f) loadFile(f)
})

// Compute once: scanning millions of samples on every mouse move would lag
function computePeaks(buf: AudioBuffer) {
  const data = buf.getChannelData(0)
  const w = canvas.width
  const step = data.length / w // fractional, so the last column reaches the end
  const out: { min: number; max: number }[] = []
  for (let x = 0; x < w; x++) {
    const from = Math.floor(x * step)
    // at least one sample per column, never past the end (handles very short files)
    const to = Math.min(data.length, Math.max(from + 1, Math.floor((x + 1) * step)))
    let min = 1, max = -1
    for (let i = from; i < to; i++) {
      const v = data[i]
      if (v < min) min = v
      if (v > max) max = v
    }
    if (min > max) min = max = 0 // empty column (zero-length file)
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
  updateButtons()
}

function xToFraction(e: PointerEvent) {
  const r = canvas.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}

canvas.addEventListener('pointerdown', e => {
  if (!audioBuffer) return
  canvas.setPointerCapture(e.pointerId)
  prevSel = { start, end }
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

function endDrag() {
  // a plain click (or a tiny drag) shouldn't wipe out the current selection
  if (drag === 'new' && !hasSelection()) ({ start, end } = prevSel)
  drag = null
  render()
}
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)

playBtn.addEventListener('click', async () => {
  if (!audioBuffer || !hasSelection()) return
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

wavBtn.addEventListener('click', () => {
  if (!audioBuffer || !hasSelection()) return
  const blob = encodeWav(audioBuffer, start, end)
  download(blob, 'trimmed.wav')
})

function encodeWav(buf: AudioBuffer, startFrac: number, endFrac: number): Blob {
  const ch = buf.numberOfChannels
  const rate = buf.sampleRate
  const from = Math.floor(startFrac * buf.length)
  const to = Math.floor(endFrac * buf.length)
  const frames = to - from

  const bytesPerSample = 2 // 16-bit PCM
  const dataSize = frames * ch * bytesPerSample
  const view = new DataView(new ArrayBuffer(44 + dataSize))

  const str = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  // RIFF/WAVE header
  str(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)       // file size minus 8
  str(8, 'WAVE')
  str(12, 'fmt ')
  view.setUint32(16, 16, true)                 // fmt chunk size
  view.setUint16(20, 1, true)                  // format 1 = PCM
  view.setUint16(22, ch, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * ch * bytesPerSample, true) // byte rate
  view.setUint16(32, ch * bytesPerSample, true)        // block align
  view.setUint16(34, 16, true)                 // bits per sample
  str(36, 'data')
  view.setUint32(40, dataSize, true)

  // Samples: interleave channels (L R L R ...), float -1..1 to int16
  const channels = Array.from({ length: ch }, (_, c) => buf.getChannelData(c))
  let offset = 44
  for (let i = from; i < to; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([view], { type: 'audio/wav' })
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a) // Firefox ignores clicks on detached links
  a.click()
  a.remove()
  // revoking right away can cancel the download in Safari/Firefox
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

mp3Btn.addEventListener('click', async () => {
  if (!audioBuffer || !hasSelection() || encoding) return
  encoding = true
  updateButtons()
  try {
    const blob = await encodeMp3(
      audioBuffer, start, end, Number(kbpsSel.value),
      pct => { status.textContent = `Encoding ${pct}%` }
    )
    status.textContent = `Done (${(blob.size / 1024 / 1024).toFixed(2)} MB)`
    download(blob, 'trimmed.mp3')
  } catch {
    status.textContent = 'Encoding failed.'
  } finally {
    encoding = false
    updateButtons()
  }
})

function toInt16(f: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from)
  for (let i = from; i < to; i++) {
    const s = Math.max(-1, Math.min(1, f[i]))
    out[i - from] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

async function encodeMp3(
  buf: AudioBuffer, startFrac: number, endFrac: number,
  kbps: number, onProgress: (pct: number) => void
): Promise<Blob> {
  const from = Math.floor(startFrac * buf.length)
  const to = Math.floor(endFrac * buf.length)
  const ch = Math.min(2, buf.numberOfChannels)    // lamejs handles mono or stereo
  const encoder = new Mp3Encoder(ch, buf.sampleRate, kbps)

  const left = buf.getChannelData(0)
  const right = ch === 2 ? buf.getChannelData(1) : null

  const CHUNK = 1152 * 10                          // 1152 = samples per MP3 frame
  const parts: Uint8Array[] = []

  for (let i = from; i < to; i += CHUNK) {
    const j = Math.min(i + CHUNK, to)
    const l = toInt16(left, i, j)
    const out = right
      ? encoder.encodeBuffer(l, toInt16(right, i, j))
      : encoder.encodeBuffer(l)
    if (out.length) parts.push(out)

    onProgress(Math.round(((j - from) / (to - from)) * 100))
    await new Promise(r => setTimeout(r))          // yield so the UI can repaint
  }

  const tail = encoder.flush()
  if (tail.length) parts.push(tail)
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' })
}