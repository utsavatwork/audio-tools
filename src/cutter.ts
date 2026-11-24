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
const clipLabel = document.querySelector<HTMLElement>('#clip-label')!
const modeInputs = document.querySelectorAll<HTMLInputElement>('input[name=mode]')
const fadeInBox = document.querySelector<HTMLInputElement>('#fade-in')!
const fadeOutBox = document.querySelector<HTMLInputElement>('#fade-out')!
const fadeInSec = document.querySelector<HTMLSelectElement>('#fade-in-sec')!
const fadeOutSec = document.querySelector<HTMLSelectElement>('#fade-out-sec')!
const timeMsg = document.querySelector<HTMLParagraphElement>('#time-msg')!
const canvas = document.querySelector<HTMLCanvasElement>('#wave')!
const playBtn = document.querySelector<HTMLButtonElement>('#play')!
const playLabel = document.querySelector<HTMLSpanElement>('#play-label')!
const headEl = document.querySelector<HTMLDivElement>('#head')!
const posText = document.querySelector<HTMLParagraphElement>('#pos')!
const setStartBtn = document.querySelector<HTMLButtonElement>('[data-set=start]')!
const setEndBtn = document.querySelector<HTMLButtonElement>('[data-set=end]')!
const downloadBtn = document.querySelector<HTMLButtonElement>('#download')!
const formatSel = document.querySelector<HTMLSelectElement>('#format')! // an MP3 bitrate, or "wav"
const status = document.querySelector<HTMLParagraphElement>('#status')!
const drop = document.querySelector<HTMLLabelElement>('#drop')!
const editor = document.querySelector<HTMLDivElement>('#editor')!
const g = canvas.getContext('2d')!

const audioCtx = new AudioContext()
let audioBuffer: AudioBuffer | null = null
let peaks: { min: number; max: number }[] = []
let start = 0 // selection as fractions of the track (0..1)
let end = 1
// keep: export the selection. remove: cut it out and export the rest, joined.
let mode: 'keep' | 'remove' = 'keep'
let drag: 'start' | 'end' | 'new' | 'head' | null = null
let anchor = 0
let downX = 0 // where the pointer went down, to tell a click from a drag
let resumeAfterScrub = false // playback paused while the playhead is dragged
// What's playing now: one or more back-to-back ranges of the file (in Remove mode,
// the removed part is skipped). `at` is the audio clock time each range starts,
// `floor` is where playback (re)started from.
type Seg = { from: number; to: number; at: number }
let playing: {
  sources: AudioBufferSourceNode[]
  segs: Seg[]
  floor: number
  fades: string // fadeKey() the gain was scheduled with
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
const JOIN_SEC = 0.01 // crossfade where the two parts meet in Remove mode, so there's no click
const EPS = 1e-6 // rounding slack: 10.1 - 10.05 is slightly under 0.05

function hasSelection() {
  return !!audioBuffer && (end - start) * audioBuffer.duration >= MIN_SEL_SEC - EPS
}

// Length of what will be exported, in seconds
function resultLength() {
  if (!audioBuffer) return 0
  const d = audioBuffer.duration
  if (mode === 'keep') return (end - start) * d
  const before = start * d
  const after = d - end * d
  return before + after - Math.min(JOIN_SEC, before, after)
}

// --- Fades ---

// Fade lengths in seconds (0 = off). Each is at most half of the result, so a short
// clip still fades all the way in and out.
function fadeLens() {
  const half = resultLength() / 2
  return {
    fin: fadeInBox.checked ? Math.min(Number(fadeInSec.value), half) : 0,
    fout: fadeOutBox.checked ? Math.min(Number(fadeOutSec.value), half) : 0,
  }
}

// Volume (0..1) at `r` seconds into the result
function fadeGain(r: number) {
  const L = resultLength()
  const { fin, fout } = fadeLens()
  let g = 1
  if (fin > 0 && r < fin) g = Math.max(0, r / fin)
  if (fout > 0 && r > L - fout) g = Math.min(g, Math.max(0, (L - r) / fout))
  return g
}

// Where a point of the file (in seconds) ends up in the result, or null if it isn't
// exported. Right at a cut, `side` says which side of it we mean.
function toResult(p: number, side: 'left' | 'right'): number | null {
  const d = audioBuffer!.duration
  const s = start * d
  const e = end * d
  if (mode === 'keep') {
    const inside = side === 'left' ? p > s + EPS && p <= e + EPS : p >= s - EPS && p < e - EPS
    return inside ? p - s : null
  }
  if (side === 'left' ? p <= s + EPS : p < s - EPS) return p
  if (side === 'left' ? p > e + EPS : p >= e - EPS) {
    return p - (e - s) - Math.min(JOIN_SEC, s, d - e) // the parts overlap by the crossfade
  }
  return null
}

// Volume at a point of the file while previewing: parts that aren't exported play as they are
function gainAt(p: number, side: 'left' | 'right') {
  const r = toResult(p, side)
  return r === null ? 1 : fadeGain(r)
}

// Changes whenever the fades would sound different, so playback can be rescheduled
function fadeKey() {
  const { fin, fout } = fadeLens()
  return fin || fout ? [mode, start, end, fin, fout].join() : ''
}

function updateButtons() {
  const ok = hasSelection() && !timeInvalid
  const exportOk = ok && resultLength() >= MIN_SEL_SEC - EPS // removing everything leaves nothing
  playBtn.disabled = !ok && !playing // it's the Stop button while playing
  playLabel.textContent = playing ? 'Stop' : 'Play'
  playBtn.classList.toggle('playing', !!playing) // swaps the play and stop icons
  downloadBtn.disabled = !exportOk || encoding
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

// Colors come from the page's theme (style.css), so light and dark mode both work
const css = (name: string) => getComputedStyle(canvas).getPropertyValue(name).trim()
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render())

function render() {
  const w = canvas.width, h = canvas.height
  g.clearRect(0, 0, w, h)
  const [off, on, cut, selBg, fg, danger] =
    ['--wave-off', '--wave-on', '--wave-cut', '--sel-bg', '--fg', '--danger'].map(css)
  const sx = Math.round(start * w), ex = Math.round(end * w)

  // a faint band behind the selection; red-tinted when it's the part that gets cut
  g.fillStyle = selBg
  g.fillRect(sx, 0, ex - sx, h)
  if (mode === 'remove') {
    g.save()
    g.globalAlpha = 0.08
    g.fillStyle = danger
    g.fillRect(sx, 0, ex - sx, h)
    g.restore()
  }

  // the waveform: strong where it's exported, faint where it isn't. Fades shrink
  // it, so you see the shape of what you'll get.
  const dur = audioBuffer?.duration ?? 0
  const { fin, fout } = audioBuffer ? fadeLens() : { fin: 0, fout: 0 }
  const fading = !!audioBuffer && !!(fin || fout)
  peaks.forEach((p, x) => {
    const inSel = x >= sx && x < ex
    const kept = mode === 'keep' ? inSel : !inSel
    const k = fading ? gainAt(((x + 0.5) / w) * dur, 'right') : 1
    const y1 = ((1 + p.min * k) / 2) * h
    const y2 = ((1 + p.max * k) / 2) * h
    g.fillStyle = kept ? on : inSel ? cut : off // Remove mode: the cut part in muted red
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1))
  })

  // handles: 2 CSS px wide, whatever the pixel density
  const hw = 2 * (window.devicePixelRatio || 1)
  g.fillStyle = fg
  g.fillRect(start * w - hw / 2, 0, hw, h)
  g.fillRect(end * w - hw / 2, 0, hw, h)

  if (audioBuffer) {
    const d = audioBuffer.duration
    // don't overwrite a box while someone is typing in it
    if (!typed.start) startInput.value = formatTime(start * d)
    if (!typed.end) endInput.value = formatTime(end * d)
    clipLabel.textContent = mode === 'keep' ? 'Clip length' : 'Result length'
    clipLength.textContent = formatTime(resultLength())
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
  return positionAt(audioCtx.currentTime - (audioCtx.outputLatency || 0), playing.floor)
}

// Position in the file without the headphone delay: what's being sent out right now
function rawPosition() {
  return playing ? positionAt(audioCtx.currentTime, 0) : 0
}

function positionAt(t: number, floor: number) {
  const segs = playing!.segs
  let i = segs.length - 1
  while (i > 0 && segs[i].at > t) i--
  const s = segs[i]
  const lo = i === 0 ? Math.max(s.from, floor) : s.from
  return Math.min(s.to, Math.max(lo, s.from + (t - s.at)))
}

// The ranges of the file to play from `from`. Inside the selection, playback stops
// at its end. Before it, Keep mode plays into the selection and stops at its end,
// while Remove mode skips the selection and carries on, like the exported result.
// After it, playback runs to the end of the file, so you can listen anywhere.
function plan(from: number): [number, number][] {
  const d = audioBuffer!.duration
  const s = start * d
  const e = end * d
  if (from >= e - EPS) return [[from, d]]
  if (from >= s - EPS || mode === 'keep') return [[from, e]]
  return e < d - EPS ? [[from, s], [e, d]] : [[from, s]]
}

function startSource(from: number, floor: number) {
  const ranges = plan(from)
  const sources: AudioBufferSourceNode[] = []
  const segs: Seg[] = []
  let at = audioCtx.currentTime
  ranges.forEach(([a, b], i) => {
    const source = audioCtx.createBufferSource()
    source.buffer = audioBuffer
    const gain = audioCtx.createGain() // plays the fades
    scheduleFades(gain.gain, a, b, at)
    source.connect(gain).connect(audioCtx.destination)
    source.start(at, a, b - a) // (when, offset, duration): ranges play back to back
    if (i === ranges.length - 1) {
      source.onended = () => {
        if (playing?.sources !== sources) return // stopped or replaced, not finished
        playing = null
        head = null
        render()
      }
    }
    sources.push(source)
    segs.push({ from: a, to: b, at })
    at += b - a
  })
  playing = { sources, segs, floor, fades: fadeKey() }
}

// Volume changes while the file plays from `a` to `b` seconds, starting at audio time
// `at`. The volume is a straight line between the points where a fade starts or ends,
// with a jump where Keep mode plays into the selection from before it.
function scheduleFades(param: AudioParam, a: number, b: number, at: number) {
  const d = audioBuffer!.duration
  const s = start * d
  const e = end * d
  const L = resultLength()
  const { fin, fout } = fadeLens()
  const pts = [a, b, s, e]
  for (const r of [fin, L - fout]) {
    // the file positions that end up `r` seconds into the result
    if (mode === 'keep') pts.push(s + r)
    else pts.push(r, r + (e - s) + Math.min(JOIN_SEC, s, d - e))
  }
  const inside = [...new Set(pts.filter(p => p >= a && p <= b))].sort((x, y) => x - y)
  inside.forEach((p, i) => {
    const t = at + (p - a)
    if (i === 0) return param.setValueAtTime(gainAt(p, 'right'), t)
    const left = gainAt(p, 'left')
    param.linearRampToValueAtTime(left, t)
    const right = gainAt(p, 'right')
    if (i < inside.length - 1 && Math.abs(right - left) > EPS) param.setValueAtTime(right, t)
  })
}

function stopSource() {
  const sources = playing?.sources ?? []
  playing = null // first, so onended knows this wasn't a natural end
  for (const s of sources) s.stop()
}

// Plays from the playhead. Without one (or with it at the very end of the selection
// or the file), it plays what you'd export: the selection in Keep mode, the whole
// result from the beginning in Remove mode.
function play() {
  if (!audioBuffer || !commitTyped() || !hasSelection()) return
  const d = audioBuffer.duration
  const atEnd = head !== null && (Math.abs(head - end * d) < 0.01 || head > d - MIN_SEL_SEC)
  const from = mode === 'keep' ? start * d : 0
  void playFrom(head === null || atEnd ? from : head)
  track('play-selection', { mode })
}

async function playFrom(from: number) {
  const id = ++playId
  await audioCtx.resume() // browsers keep audio suspended until a user gesture
  if (id !== playId || !audioBuffer) return
  stopSource()
  head = null
  startSource(from, from)
  render()
  requestAnimationFrame(tick)
}

// Move the playhead. While playing, playback jumps there and carries on.
function seek(t: number) {
  if (!audioBuffer) return
  t = Math.min(Math.max(0, t), audioBuffer.duration - MIN_SEL_SEC)
  if (playing) {
    stopSource()
    startSource(t, t)
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

// Call after the selection or mode changes: if what's left to play is different
// now, carry on from the same spot with the new plan.
function syncPlayback() {
  if (!audioBuffer || !playing) return
  const raw = rawPosition()
  const now = playing.segs.filter(s => s.to > raw + EPS).map(s => [s.from, s.to])
  const next = plan(raw)
  const same =
    now.length === next.length &&
    now.every(([a, b], i) => (i === 0 || Math.abs(a - next[i][0]) <= EPS) && Math.abs(b - next[i][1]) <= EPS)
  if (same && playing.fades === fadeKey()) return
  const { floor } = playing
  if (next[next.length - 1][1] - raw < 0.005) return stop() // nothing left to play
  stopSource()
  startSource(raw, floor)
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

for (const [box, sel] of [[fadeInBox, fadeInSec], [fadeOutBox, fadeOutSec]] as const) {
  box.addEventListener('change', () => {
    sel.hidden = !box.checked // the length only shows while the fade is on
    syncPlayback()
    render()
  })
  sel.addEventListener('change', () => {
    syncPlayback()
    render()
  })
}

const fadeLabel = () => {
  const { fin, fout } = fadeLens()
  return fin && fout ? 'both' : fin ? 'in' : fout ? 'out' : 'none'
}

modeInputs.forEach(input => {
  input.addEventListener('change', () => {
    if (!input.checked) return
    mode = input.value as 'keep' | 'remove'
    status.textContent = ''
    syncPlayback()
    render()
  })
})

// --- Export ---

// The exported audio as a list of pieces, each one an array of channels. Pieces
// mostly point into the original audio (subarray doesn't copy), so cutting a long
// song doesn't need a second copy of it in memory. Only the short crossfade where
// the two parts of a Remove meet is new data.
type Piece = Float32Array[]

function resultPieces(buf: AudioBuffer): Piece[] {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
  const part = (a: number, b: number): Piece => chans.map(d => d.subarray(a, b))
  const from = Math.floor(start * buf.length)
  const to = Math.floor(end * buf.length)
  if (mode === 'keep') return [part(from, to)]

  const n = buf.length
  const xf = Math.min(Math.round(JOIN_SEC * buf.sampleRate), from, n - to)
  const pieces: Piece[] = []
  if (from - xf > 0) pieces.push(part(0, from - xf))
  if (xf > 0) {
    // fade the end of the first part out while the start of the second fades in
    pieces.push(chans.map(d => {
      const out = new Float32Array(xf)
      for (let i = 0; i < xf; i++) {
        const k = (i + 0.5) / xf
        out[i] = d[from - xf + i] * (1 - k) + d[to + i] * k
      }
      return out
    }))
  }
  if (to + xf < n) pieces.push(part(to + xf, n))
  return pieces
}

const frameCount = (pieces: Piece[]) => pieces.reduce((n, p) => n + p[0].length, 0)

// Frames a..b of the result, still pointing into the pieces (no copy)
function slice(pieces: Piece[], a: number, b: number): Piece[] {
  const out: Piece[] = []
  let at = 0
  for (const p of pieces) {
    const len = p[0].length
    const from = Math.max(a, at), to = Math.min(b, at + len)
    if (from < to) out.push(p.map(c => c.subarray(from - at, to - at)))
    at += len
  }
  return out
}

// Frames a..b of the result as a new copy, with `gain(i)` applied to frame i
function faded(pieces: Piece[], a: number, b: number, gain: (i: number) => number): Piece {
  const parts = slice(pieces, a, b)
  return pieces[0].map((_, c) => {
    const out = new Float32Array(b - a)
    let i = 0
    for (const p of parts) for (const v of p[c]) out[i] = v * gain(i++)
    return out
  })
}

// Fade the start and end of the result. Only those few seconds are copied.
function withFades(pieces: Piece[], rate: number): Piece[] {
  const { fin, fout } = fadeLens()
  const n = frameCount(pieces)
  const nIn = Math.min(Math.round(fin * rate), n >> 1)
  const nOut = Math.min(Math.round(fout * rate), n >> 1)
  if (!nIn && !nOut) return pieces
  const out: Piece[] = []
  if (nIn) out.push(faded(pieces, 0, nIn, i => (i + 0.5) / nIn))
  out.push(...slice(pieces, nIn, n - nOut))
  if (nOut) out.push(faded(pieces, n - nOut, n, i => (nOut - i - 0.5) / nOut))
  return out
}

function exportName(ext: string) {
  return `${baseName}-${mode === 'keep' ? 'trimmed' : 'cut'}.${ext}`
}

downloadBtn.addEventListener('click', e => {
  if (formatSel.value === 'wav') exportWav()
  else void exportMp3(Number(formatSel.value))
  releaseFocus(e)
})

function exportWav() {
  if (!audioBuffer || !commitTyped() || !hasSelection()) return
  const rate = audioBuffer.sampleRate
  const blob = encodeWav(withFades(resultPieces(audioBuffer), rate), rate)
  download(blob, exportName('wav'))
  track('export-wav', { mode, fade: fadeLabel(), length: lengthBucket(resultLength()) })
}

function encodeWav(pieces: Piece[], rate: number): Blob {
  const ch = pieces[0].length
  const frames = frameCount(pieces)

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
  let offset = 44
  for (const channels of pieces) {
    const len = channels[0].length
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]))
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
        offset += 2
      }
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

async function exportMp3(kbps: number) {
  if (!audioBuffer || encoding || !commitTyped() || !hasSelection()) return
  encoding = true
  updateButtons()
  try {
    const blob = await encodeMp3(
      withFades(resultPieces(audioBuffer), audioBuffer.sampleRate),
      audioBuffer.sampleRate, kbps,
      pct => { status.textContent = `Encoding ${pct}%` }
    )
    status.textContent = `Done (${(blob.size / 1024 / 1024).toFixed(2)} MB)`
    download(blob, exportName('mp3'))
    track('export-mp3', {
      mode,
      fade: fadeLabel(),
      kbps: String(kbps),
      length: lengthBucket(resultLength()),
    })
  } catch {
    status.textContent = 'Encoding failed.'
    track('export-failed', { format: 'mp3' })
  } finally {
    encoding = false
    updateButtons()
  }
}

function toInt16(f: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from)
  for (let i = from; i < to; i++) {
    const s = Math.max(-1, Math.min(1, f[i]))
    out[i - from] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

async function encodeMp3(
  pieces: Piece[], rate: number,
  kbps: number, onProgress: (pct: number) => void
): Promise<Blob> {
  const ch = Math.min(2, pieces[0].length)        // lamejs handles mono or stereo
  const encoder = new Mp3Encoder(ch, rate, kbps)

  const CHUNK = 1152 * 10                          // 1152 = samples per MP3 frame
  const parts: Uint8Array[] = []
  const total = frameCount(pieces)
  let done = 0

  for (const piece of pieces) {
    const [left, right] = piece
    const len = left.length
    for (let i = 0; i < len; i += CHUNK) {
      const j = Math.min(i + CHUNK, len)
      const l = toInt16(left, i, j)
      const out = ch === 2
        ? encoder.encodeBuffer(l, toInt16(right, i, j))
        : encoder.encodeBuffer(l)
      if (out.length) parts.push(out)

      done += j - i
      onProgress(Math.round((done / total) * 100))
      await new Promise(r => setTimeout(r))        // yield so the UI can repaint
    }
  }

  const tail = encoder.flush()
  if (tail.length) parts.push(tail)
  return new Blob(parts as BlobPart[], { type: 'audio/mpeg' })
}