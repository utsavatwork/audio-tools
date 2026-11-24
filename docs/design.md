# Design philosophy

**Humble, subtle, aggressively minimalist, quiet, casual.**

MP3 Playground should feel like a small, useful tool someone made with care, not a
product trying to get your attention. When in doubt, take something away.

## What the words mean here

- **Humble**: no hype, no "powerful", "ultimate" or "lightning-fast". Say plainly what
  a tool does, and stop.
- **Subtle**: nothing shouts. Hover, focus and selection states are small shifts in
  shade, not color explosions or animations.
- **Aggressively minimalist**: every element has to earn its place. If a label, line of
  help text, border or button can go, it goes. One way to do a thing, not three.
- **Quiet**: mostly monochrome. Grey for everything secondary. Color only where it
  carries meaning (the muted red for the part Remove cuts out, red for errors).
- **Casual**: friendly, short, everyday words. "Change file", "Thanks, noted",
  "Set to playhead". Not "Please select a file to proceed".

## In practice

**Color**
- Use the tokens at the top of `src/style.css` (`--fg`, `--muted`, `--line`,
  `--surface`, …), never hard-coded colors. Each has a light and a dark value.
- One filled button per screen at most, for the main action (Download). It uses the
  text color, not a brand color.
- No brand accent color. Purple, orange and other loud colors are out.

**Layout and type**
- System font, regular weight for text, 600 for headings. No decorative fonts.
- Hairline borders (`--line`) or none. Prefer space over boxes to group things.
- Secondary text is smaller and `--muted`, not a different color.
- Controls are 44px tall on touch screens and 36px with a mouse (`--ctl`).

**Components**
- Prefer a link-style button (`button.link`) over a bordered one for minor actions.
- Show controls only when they're useful: the fade length appears when the fade is on,
  "Set to playhead" when there is a playhead.
- Icons are small inline line icons (`.icon`, 24px grid, 2px stroke, round caps),
  next to a word or in place of one where the meaning is obvious (an arrow on a card).
  No icon fonts or icon libraries.

**Words**
- Short and plain. Sentence case. No exclamation marks.
- Don't explain what the interface already shows. Hints go in tooltips or
  `aria-label`s, not on the page.

**Motion**
- Only small transitions (about 0.15s) for state changes. Nothing bounces, slides in or
  loops.

## Before adding something, ask

1. Can this be left out?
2. Can an existing element do this job?
3. Does it look right in both light and dark mode, and on a phone?
