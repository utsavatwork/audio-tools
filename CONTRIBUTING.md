# Contributing

Thanks for your interest in MP3 Playground! Bug reports, ideas and pull requests are welcome.

## Running it locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # type-check and build to dist/
```

`npm run build` must pass (it runs the TypeScript compiler first) before a pull request can be merged.

## Ground rules

- **Audio never leaves the device.** All processing has to happen in the browser. Features
  that need to upload user files to a server won't be accepted.
- **Keep it light.** The app is plain TypeScript with no UI framework. Please discuss new
  dependencies in an issue first.
- **One page per tool.** Each tool lives on its own page (like `audio-cutter/index.html`,
  served at `/audio-cutter`) with its own script in `src/`. Add the page to `vite.config.ts`,
  `public/sitemap.xml` and the home page's tool list.
- **Test on mobile.** Many people use the site on phones, so check touch and narrow screens.

## Analytics

The live site uses cookie-free [Umami](https://umami.is) analytics. It only records
visits to `mp3playground.com`: the script still loads locally and in forks, but sends no data.

To record a new event, use `track()` from [src/analytics.ts](src/analytics.ts):

```ts
track('export-mp3', { kbps: '192', length: lengthBucket(seconds) })
```

Rules:

- **Never send file names, file contents or anything that could identify a user.** Use coarse
  values like the file type, and round lengths with `lengthBucket()`.
- If a change alters *what kind* of data is collected, update [privacy.html](privacy.html) in
  the same pull request.
- Add the event to the table below.

### Current events

| Event | Data |
|---|---|
| `file-loaded` | file type, length bucket (e.g. `1-5min`) |
| `file-unreadable` | file type |
| `file-too-large` | file type |
| `play-selection` | mode (`keep` or `remove`) |
| `export-mp3` | mode, fade (`none`, `in`, `out` or `both`), bitrate, length bucket of the result |
| `export-wav` | mode, fade, length bucket of the result |
| `export-failed` | format |
| `vote` | feature id from the Coming soon section (e.g. `vocal-remover`) |
