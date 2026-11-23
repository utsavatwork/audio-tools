# MP3 Playground

**Free, private audio tools that run entirely in your browser.**
Live at **[mp3playground.com](https://mp3playground.com)**.

Nothing is uploaded: decoding, editing and encoding all happen on your device.
The home page lists the tools and the ones coming next. Each tool has its own page.

## Tools

### [Audio cutter](https://mp3playground.com/audio-cutter)

Drop in an audio or video file, select a part, and either keep just that part or cut it out
and keep the rest. Download the result as MP3 or WAV.


- **Trim audio**: drag on the waveform to select a range, or drag the handles to adjust it
- **Keep or remove**: export only the selection, or cut it out and join the rest
  (with a 10 ms crossfade so there's no click at the join)
- **Exact times**: type start and end times (`1:23.45` or `83.45`), or nudge them by 0.1 s
- **Preview** with a moving playhead (spacebar to play or stop): click the waveform to jump
  anywhere, drag the playhead to scrub, and set the start or end at the moment you hear it
- **Export to MP3** (128 / 192 / 320 kbps) or **WAV** (16-bit PCM)
- **Video files too**: extract and trim the audio from MP4 and other formats the browser can decode
- Works on desktop and mobile, with drag-and-drop and touch support
- Exports are named after the original file (`song.mp3` becomes `song-trimmed.mp3`)

### Coming soon

| Feature | Status |
|---|---|
| Vocal remover | **Next up** |
| Tempo & key change | Planned |
| Audio player | Planned |
| Fade in / fade out | Planned |
| Format converter | Planned |
| Merge audio | Planned |
| Ringtone maker | Planned |

Vote for the features you want on [mp3playground.com](https://mp3playground.com#coming-soon).

## Privacy

Your audio never leaves your device. There are no accounts, cookies or ad trackers.
The live site uses cookie-free [Umami](https://umami.is) analytics to count visits and
anonymous actions (like "an MP3 was exported"). It never receives your files or their names.
Details are on the [privacy page](https://mp3playground.com/privacy.html).

## Tech stack

- [Vite](https://vite.dev) + TypeScript, no UI framework
- [Web Audio API](https://developer.mozilla.org/docs/Web/API/Web_Audio_API) to decode and play audio
- [`@breezystack/lamejs`](https://www.npmjs.com/package/@breezystack/lamejs) for MP3 encoding; WAV encoding is hand-written
- Canvas for the waveform (sized for high-DPI screens)

## Getting started

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # type-check and build to dist/
npm run preview   # serve the production build locally
```

## Project structure

```
index.html          Home page: the list of tools plus the "Coming soon" section
audio-cutter/       The audio cutter page (served at /audio-cutter)
privacy.html        Privacy policy
404.html            Page shown for missing URLs
vite.config.ts      Multi-page build config (home, audio-cutter, privacy, 404)
public/             Static files copied as-is: favicon, robots.txt, sitemap.xml, og-image.png
src/
  home.ts           Home page script
  cutter.ts         Audio cutter: file loading, waveform, selection, playback, WAV/MP3 export
  time.ts           Formats and parses times like 1:23.45
  analytics.ts      Analytics wrapper and anonymous event helpers
  roadmap.ts        "I want this" voting on the Coming soon cards
  style.css         Styles for all pages (light and dark mode)
docs/
  deployment.md     How the live site is hosted and deployed (maintainers)
```

## Limits

- Files up to 50 MB (the whole file is decoded into memory)
- MP3 export is mono or stereo; files with more channels export their first two channels
- Supported input formats depend on what the browser can decode (MP3 and WAV are the safest)

## Contributing

Bug reports, ideas and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
