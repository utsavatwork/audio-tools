import { track } from './analytics'

// "I want this" votes on the Coming soon cards. Each vote is a Umami event
// (`vote` with the feature id), so demand shows up under Events in Umami.
// The browser remembers which features this visitor already voted for, so a
// returning visitor sees "Thanks" instead of voting again.

const KEY = 'roadmap-votes'

function loadVotes(): string[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]')
  } catch {
    return [] // storage blocked (private mode etc.) - voting still works
  }
}

function saveVotes(votes: string[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(votes))
  } catch {
    // ignore: only means the "already voted" state isn't remembered
  }
}

function markVoted(btn: HTMLButtonElement) {
  btn.disabled = true
  btn.classList.add('voted')
  btn.textContent = '✓ Thanks, noted!'
}

export function initRoadmap() {
  const votes = loadVotes()
  document.querySelectorAll<HTMLButtonElement>('button.vote').forEach(btn => {
    const feature = btn.dataset.feature!
    if (votes.includes(feature)) markVoted(btn)
    btn.addEventListener('click', () => {
      if (votes.includes(feature)) return
      track('vote', { feature })
      votes.push(feature)
      saveVotes(votes)
      markVoted(btn)
    })
  })
}
