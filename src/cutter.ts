import { Mp3Encoder } from '@breezystack/lamejs'
import { track, lengthBucket } from './analytics'
import { formatTime, parseTime } from './time'

const app = document.querySelector<HTMLElement>('#app')!

const fileInput = document.querySelector<HTMLInputElement>('#file')!
const info = document.querySelector<HTMLParagraphElement>('#info')!
const fileName = document.querySelector<HTMLElement>('#file-name')!
const fileMeta = document.querySelector<HTMLSpanElement>('#file-meta')!
const changeBtn = document.querySelector<HTMLButtonElement>('#change-file')!
const times = document.querySelector<HTMLDivElement>('.times')!
const startInput = document.querySelector<HTMLInputElement>('#start-time')!
const endInput = document.querySelector<HTMLInputElement>('#end-time')!
const clipLength = document.querySelector<HTMLElement>('#clip-length')!
const timeMsg = document.querySelector<HTMLParagraphElement>('#time-msg')!
const canvas = document.querySelector<HTMLCanvasElement>('#wave')!
const playBtn = document.querySelector<HTMLButtonElement>('#play')!
const headEl = document.querySelector<HTMLDivElement>('#head')!
const posText = document.querySelector<HTMLParagraphElement>('#pos')!
const setStartBtn = document.querySelector<HTMLButtonElement>('[data-set=start]')!
const setEndBtn = document.querySelector<HTMLButtonElement>('[data-set=end]')!
const wavBtn = document.querySelector<HTMLButtonElement>('#export-wav')!
const mp3Btn = document.querySelector<HTMLButtonElement>('#export-mp3')!
const kbpsSel = document.querySelector<HTMLSelectElement>('#kbps')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const drop = document.querySelector<HTMLLabelElement>('#drop')!
const editor = document.querySelector<HTMLDivElement>('#editor')!
const g = canvas.getContext('2d')!

const audioCtx = new AudioContext()
let audioBuffer: AudioBuffer | null = null
let peaks: { min: number; max: number }[] = []
let start = 0 // selection as fractions of the track (0..1)
let end = 1
let drag: 'start' | 'end' | 'new' | 'head' | null = null
let anchor = 0
let downX = 0 // where the pointer went down, to tell a click from a drag
let resumeAfterScrub = false // playback paused while the playhead is dragged
// What's playing now. `from`/`to` are seconds in the file, `at` is the audio clock
// time when `from` started, `floor` is where playback (re)started from.
let playing: {
  source: AudioBufferSourceNode
  from: number
  to: number
  at: number
  floor: number
} | null = null
let playId = 0 // cancels a Play that's still waiting for the audio to wake up
let head: number | null = null // playhead while not playing, in seconds
let prevSel = { start: 0, end: 1 } // restored if a click makes no real selection
let encoding = false
const typed = { start: false, end: false } // boxes with typing not applied yet
let timeInvalid = false // a typed time couldn't be applied
let baseName = 'audio' // from the loaded file, used for export file names

// "My Song (live).final.mp3" -> "My Song (live).final"; strips characters
// that aren't allowed in file names on Windows/macOS.
function toBaseName(fileName: string) {
  const noExt = fileName.replace(/\.[^.]+$/, '')
  const clean = noExt.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim()
  return clean.slice(0, 100) || 'audio'
}

const MAX_MB = 50
const MIN_SEL_SEC = 0.05 // anything shorter is treated as "no selection"
const EPS = 1e-6 // rounding slack: 10.1 - 10.05 is slightly under 0.05

function hasSelection() {
  return !!audioBuffer && (end - start) * audioBuffer.duration >= MIN_SEL_SEC - EPS
}

function updateButtons() {
  const ok = hasSelection() && !timeInvalid
  playBtn.disabled = !ok && !playing // it's the Stop button while playing
  playBtn.textContent = playing ? 'Stop' : 'Play'
  wavBtn.disabled = !ok
  mp3Btn.disabled = !ok || encoding
}

async function loadFile(file: File) {
  if (file.size > MAX_MB * 1024 * 1024) {
    info.textContent = `File is too large (max ${MAX_MB} MB).`
    track('file-too-large', { type: file.type || 'unknown' })
    return
  }
  stop()
  info.textContent = 'Decoding...'
  try {
    audioBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer())
    info.textContent = ''
    fileName.textContent = file.name
    fileName.title = file.name // long names are cut off with an ellipsis
    fileMeta.textContent =
      `${formatTime(audioBuffer.duration)} · ` +
      `${audioBuffer.numberOfChannels}ch · ${audioBuffer.sampleRate} Hz`
    baseName = toBaseName(file.name)
    start = 0
    end = 1
    discardTyped()
    head = null
    times.classList.toggle('hours', audioBuffer.duration >= 3600)
    status.textContent = ''
    drop.hidden = true // the file bar's "Change file" takes over from here
    editor.hidden = false
    sizeCanvas() // the canvas has no size while the editor is hidden
    peaks = computePeaks(audioBuffer)
    render()
    track('file-loaded', {
      type: file.type || 'unknown',
      length: lengthBucket(audioBuffer.duration),
    })
  } catch {
    info.textContent = "Couldn't read this file. Try an MP3, WAV, M4A, or MP4."
    track('file-unreadable', { type: file.type || 'unknown' })
  }
}

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0]
  if (f) loadFile(f)
  fileInput.value = '' // so picking the same file again still fires "change"
})

changeBtn.addEventListener('click', () => fileInput.click())

// Files can be dropped anywhere on the page, so this keeps working once the
// drop box is hidden (and a missed drop doesn't navigate away from the page).
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')

window.addEventListener('dragover', e => {
  if (!hasFiles(e)) return
  e.preventDefault()
  app.classList.add('dragging')
})
window.addEventListener('dragleave', e => {
  if (!e.relatedTarget) app.classList.remove('dragging') // left the window
})
window.addEventListener('drop', e => {
  if (!hasFiles(e)) return
  e.preventDefault()
  app.classList.remove('dragging')
  const f = e.dataTransfer?.files?.[0]
  if (f) loadFile(f)
})

// Match the canvas's pixel buffer to its on-screen size × devicePixelRatio,
// so the waveform is sharp on Retina/phone screens and fits any width.
// Returns true if the size changed (peaks must then be recomputed).
function sizeCanvas() {
  const r = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  const w = Math.round(r.width * dpr)
  const h = Math.round(r.height * dpr)
  if (!w || !h || (w === canvas.width && h === canvas.height)) return false
  canvas.width = w
  canvas.height = h
  return true
}

new ResizeObserver(() => {
  if (sizeCanvas() && audioBuffer) {
    peaks = computePeaks(audioBuffer)
    render()
  }
}).observe(canvas)

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

  // handles: 3 CSS px wide, whatever the pixel density
  const hw = 3 * (window.devicePixelRatio || 1)
  g.fillStyle = '#ffb454'
  g.fillRect(start * w - hw / 2, 0, hw, h)
  g.fillRect(end * w - hw / 2, 0, hw, h)

  if (audioBuffer) {
    const d = audioBuffer.duration
    // don't overwrite a box while someone is typing in it
    if (!typed.start) startInput.value = formatTime(start * d)
    if (!typed.end) endInput.value = formatTime(end * d)
    clipLength.textContent = formatTime((end - start) * d)
  }
  updateHead()
  updateButtons()
}

// --- Start/End boxes ---

type Edge = 'start' | 'end'
const boxes: Record<Edge, HTMLInputElement> = { start: startInput, end: endInput }

function clearTimeError() {
  timeInvalid = false
  timeMsg.textContent = ''
  timeMsg.classList.remove('error')
  startInput.removeAttribute('aria-invalid')
  endInput.removeAttribute('aria-invalid')
}

function discardTyped() {
  typed.start = typed.end = false
  clearTimeError()
}

function timeError(edge: Edge, message: string) {
  timeInvalid = true // Play and Download stay off, so nobody exports the wrong part
  timeMsg.textContent = message
  timeMsg.classList.add('error')
  boxes[edge].setAttribute('aria-invalid', 'true')
  updateButtons()
  return false
}

// Applies whatever was typed. Both boxes are checked together, so a start past
// the current end is fine once the end is moved too. Returns false if invalid.
function commitTyped(): boolean {
  if (!audioBuffer || (!typed.start && !typed.end)) return true
  clearTimeError()
  const d = audioBuffer.duration
  let s = start * d
  let e = end * d
  let note = ''
  for (const edge of ['start', 'end'] as const) {
    if (!typed[edge]) continue
    const t = parseTime(boxes[edge].value)
    if (t === null) return timeError(edge, 'Enter a time like 1:23.45 or 83.45 (seconds).')
    if (edge === 'start') s = t
    else {
      e = Math.min(t, d)
      if (t > d + 0.01) note = `This file ends at ${formatTime(d)}, so End was set there.`
    }
  }
  if (e - s < MIN_SEL_SEC - EPS) {
    return typed.start
      ? timeError('start', `Start must be before End (${formatTime(e)}).`)
      : timeError('end', `End must be after Start (${formatTime(s)}).`)
  }
  start = s / d
  end = e / d
  discardTyped()
  timeMsg.textContent = note
  syncPlayback()
  render()
  return true
}

function nudge(edge: Edge, by: number) {
  if (!audioBuffer) return
  if (!commitTyped()) discardTyped()
  timeMsg.textContent = ''
  const d = audioBuffer.duration
  if (edge === 'start') {
    start = Math.max(0, Math.min(start * d + by, end * d - MIN_SEL_SEC)) / d
  } else {
    end = Math.min(d, Math.max(end * d + by, start * d + MIN_SEL_SEC)) / d
  }
  syncPlayback()
  render()
}

for (const edge of ['start', 'end'] as const) {
  const box = boxes[edge]
  box.addEventListener('input', () => {
    typed[edge] = true
    clearTimeError()
    updateButtons()
  })
  box.addEventListener('blur', commitTyped)
  box.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      if (commitTyped()) box.select()
    } else if (e.key === 'Escape') {
      discardTyped()
      render()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      nudge(edge, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1))
    }
  })
}

document.querySelectorAll<HTMLButtonElement>('button[data-edge]').forEach(b => {
  b.addEventListener('click', e => {
    nudge(b.dataset.edge as Edge, Number(b.dataset.step))
    releaseFocus(e)
  })
})

// --- Dragging on the waveform ---

function xToFraction(e: PointerEvent) {
  const r = canvas.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}

canvas.addEventListener('pointerdown', e => {
  if (!audioBuffer) return
  if (!commitTyped()) discardTyped() // dragging replaces a bad entry
  timeMsg.textContent = ''
  canvas.setPointerCapture(e.pointerId)
  prevSel = { start, end }
  const f = xToFraction(e)
  downX = e.clientX
  drag = grabbed(f, e.pointerType)
  if (drag === 'head') {
    // pause while scrubbing; playback picks up from wherever the playhead is dropped
    resumeAfterScrub = !!playing
    stop()
    head = f * audioBuffer.duration
  } else if (!drag) {
    drag = 'new'
    anchor = f
    start = end = f
  }
  render()
})

// Which handle (or the playhead) is under the pointer. Handles win when they overlap.
function grabbed(f: number, pointerType: string): 'start' | 'end' | 'head' | null {
  if (!audioBuffer) return null
  const grabPx = pointerType === 'touch' ? 24 : 12 // fingers need a bigger target
  const grab = grabPx / canvas.getBoundingClientRect().width
  const pos = position()
  if (Math.abs(f - start) < grab) return 'start'
  if (Math.abs(f - end) < grab) return 'end'
  if (pos !== null && Math.abs(f - pos / audioBuffer.duration) < grab) return 'head'
  return null
}

canvas.addEventListener('pointermove', e => {
  if (!drag) {
    // show what a press here would do: resize/scrub near a line, select elsewhere
    if (e.pointerType === 'mouse') {
      canvas.style.cursor = grabbed(xToFraction(e), 'mouse') ? 'ew-resize' : 'crosshair'
    }
    return
  }
  const f = xToFraction(e)
  if (drag === 'head') head = f * audioBuffer!.duration
  else if (drag === 'start') start = Math.min(f, end)
  else if (drag === 'end') end = Math.max(f, start)
  else {
    start = Math.min(anchor, f)
    end = Math.max(anchor, f)
  }
  render()
})

function endDrag(e: PointerEvent) {
  const was = drag
  drag = null
  if (was === 'head') {
    if (resumeAfterScrub && head !== null) void playFrom(head)
  } else if (was === 'new') {
    const clickPx = e.pointerType === 'touch' ? 8 : 4
    const isClick = e.type === 'pointerup' && Math.abs(e.clientX - downX) < clickPx
    // a click moves the playhead and keeps the selection; so does a drag too short to use
    if (isClick || !hasSelection()) ({ start, end } = prevSel)
    if (isClick && audioBuffer) seek(anchor * audioBuffer.duration)
  }
  syncPlayback()
  render()
}
canvas.addEventListener('pointerup', endDrag)
canvas.addEventListener('pointercancel', endDrag)

// --- Playback ---

// Where we are in the file, in seconds, or null if there's no playhead. Uses what
// you hear right now: Bluetooth headphones can lag a fraction of a second behind.
function position(): number | null {
  if (!playing) return head
  const heard = rawPosition(playing) - (audioCtx.outputLatency || 0)
  return Math.min(playing.to, Math.max(playing.floor, heard))
}

function rawPosition(p: { from: number; at: number }) {
  return p.from + (audioCtx.currentTime - p.at)
}

function startSource(from: number, to: number, floor: number) {
  const source = audioCtx.createBufferSource()
  source.buffer = audioBuffer
  source.connect(audioCtx.destination)
  source.onended = () => {
    if (playing?.source !== source) return // stopped or replaced, not finished
    playing = null
    head = null
    render()
  }
  source.start(0, from, to - from) // (when, offset, duration)
  playing = { source, from, to, at: audioCtx.currentTime, floor }
}

function stopSource() {
  const source = playing?.source
  playing = null // first, so onended knows this wasn't a natural end
  source?.stop()
}

// Playback stops at the end of the selection, unless it starts past it: then it
// plays to the end of the file, so you can listen anywhere in the track.
function stopPoint(from: number) {
  const d = audioBuffer!.duration
  return from < end * d - EPS ? end * d : d
}

// Plays from the playhead, or from the start of the selection if there's no
// playhead (or it sits at the very end of the selection or the file).
function play() {
  if (!audioBuffer || !commitTyped() || !hasSelection()) return
  const d = audioBuffer.duration
  const atEnd = head !== null && (Math.abs(head - end * d) < 0.01 || head > d - MIN_SEL_SEC)
  void playFrom(head === null || atEnd ? start * d : head)
  track('play-selection')
}

async function playFrom(from: number) {
  const id = ++playId
  await audioCtx.resume() // browsers keep audio suspended until a user gesture
  if (id !== playId || !audioBuffer) return
  stopSource()
  head = null
  startSource(from, stopPoint(from), from)
  render()
  requestAnimationFrame(tick)
}

// Move the playhead. While playing, playback jumps there and carries on.
function seek(t: number) {
  if (!audioBuffer) return
  t = Math.min(Math.max(0, t), audioBuffer.duration - MIN_SEL_SEC)
  if (playing) {
    stopSource()
    startSource(t, stopPoint(t), t)
  } else {
    head = t
  }
  render()
}

// The playhead stays where you stopped, so you can still "Set start/end here".
function stop() {
  playId++
  if (!playing) return
  head = position()
  stopSource()
  render()
}

function tick() {
  if (!playing) return
  updateHead()
  requestAnimationFrame(tick)
}

// Call after the selection changes: playback then stops at the new end instead.
function syncPlayback() {
  if (!audioBuffer || !playing) return
  const raw = rawPosition(playing)
  const to = stopPoint(raw)
  if (Math.abs(playing.to - to) <= EPS) return
  if (raw >= to) return stop()
  const { floor } = playing
  stopSource()
  startSource(raw, to, floor) // carry on from here to the new stop point
}

function updateHead() {
  const pos = position()
  headEl.hidden = pos === null
  posText.textContent =
    pos === null ? '' : `${playing ? 'Playing' : 'Playhead at'} ${formatTime(pos)}`
  if (!audioBuffer || pos === null) {
    setStartBtn.disabled = setEndBtn.disabled = true
    return
  }
  const d = audioBuffer.duration
  headEl.style.left = `${(pos / d) * 100}%`
  // a start at the end (or the reverse) would leave nothing to play
  setStartBtn.disabled = end * d - pos < MIN_SEL_SEC
  setEndBtn.disabled = pos - start * d < MIN_SEL_SEC
}

function setHere(edge: Edge) {
  const pos = position()
  if (!audioBuffer || pos === null) return
  discardTyped() // the playhead replaces anything half-typed
  if (edge === 'start') {
    start = pos / audioBuffer.duration
    if (playing) playing.floor = pos // keeps playing, now from the new start
  } else {
    stop() // the clip now ends right here
    head = pos
    end = pos / audioBuffer.duration
  }
  render()
}

// After a mouse click or tap, let go of the button so the spacebar plays the clip
// instead of pressing it again. Keyboard users (detail 0) keep their place.
function releaseFocus(e: MouseEvent) {
  if (e.detail) (e.currentTarget as HTMLElement).blur()
}

const togglePlay = () => (playing ? stop() : play())

playBtn.addEventListener('click', e => {
  togglePlay()
  releaseFocus(e)
})
for (const b of [setStartBtn, setEndBtn]) {
  b.addEventListener('click', e => {
    setHere(b.dataset.set as Edge)
    releaseFocus(e)
  })
}

window.addEventListener('keydown', e => {
  if (e.key !== ' ' || editor.hidden || e.ctrlKey || e.metaKey || e.altKey) return
  // leave the spacebar alone in fields and on focused buttons and links
  if ((e.target as Element).closest?.('input, select, textarea, button, a')) return
  e.preventDefault() // don't scroll the page
  if (!e.repeat) togglePlay()
})

wavBtn.addEventListener('click', () => {
  if (!audioBuffer || !commitTyped() || !hasSelection()) return
  const blob = encodeWav(audioBuffer, start, end)
  download(blob, `${baseName}-trimmed.wav`)
  track('export-wav', { length: lengthBucket((end - start) * audioBuffer.duration) })
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
  if (!audioBuffer || encoding || !commitTyped() || !hasSelection()) return
  encoding = true
  updateButtons()
  try {
    const blob = await encodeMp3(
      audioBuffer, start, end, Number(kbpsSel.value),
      pct => { status.textContent = `Encoding ${pct}%` }
    )
    status.textContent = `Done (${(blob.size / 1024 / 1024).toFixed(2)} MB)`
    download(blob, `${baseName}-trimmed.mp3`)
    track('export-mp3', {
      kbps: kbpsSel.value,
      length: lengthBucket((end - start) * audioBuffer.duration),
    })
  } catch {
    status.textContent = 'Encoding failed.'
    track('export-failed', { format: 'mp3' })
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