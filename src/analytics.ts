// Thin wrapper around Umami (loaded via a <script> tag in index.html).
// Never send file names or anything else that could identify the user or
// their content: only coarse, anonymous facts like file type and length.

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, string | number>) => void }
  }
}

export function track(event: string, data?: Record<string, string | number>) {
  try {
    window.umami?.track(event, data) // no-op if blocked or not loaded
  } catch {
    // analytics must never break the app
  }
}

// Round durations into buckets so exact lengths aren't recorded
export function lengthBucket(seconds: number) {
  if (seconds < 10) return '<10s'
  if (seconds < 60) return '10-60s'
  if (seconds < 300) return '1-5min'
  if (seconds < 1200) return '5-20min'
  return '20min+'
}
