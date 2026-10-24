// Rummy10 as a SideQuest/Altspace Creator SDK snippet.
//
//   <bs-snippet name="rummy10" title="Rummy10" script="https://rummy10.firer.at/snippet.js"
//     position="0 0 3" ...></bs-snippet>
//
// The snippet runtime loads this file once per page, however many boards are placed. For each
// <bs-snippet name="rummy10"> it adds a copy of rummy10.js with the element's settings copied onto
// the script tag, so every placement is its own game, configured as with a plain script tag
// (see README.md).
//
// - position / rotation are Unity world values, as for every snippet.
// - The game's sync id is "room" if set, otherwise the instance id Unity's BSSnippet component
//   gives each placement. Placements with the same room share one game.
// - Empty settings are left off, so the game's own default applies.
(() => {
  const SNIPPET_NAME = 'rummy10';
  const GAME_SCRIPT = 'rummy10.js';
  const LOG = 'Rummy10 (snippet)';
  // Attributes that describe the snippet itself rather than the game.
  const NOT_SETTINGS = new Set(['name', 'title', 'description', 'script', 'asset', 'single', 'instance', 'room']);

  const thisScript = document.currentScript;
  const started = new WeakSet();

  const start = (el) => {
    if (started.has(el)) return;
    started.add(el);
    const base = el.getAttribute('script') || (thisScript && thisScript.src) || 'https://rummy10.firer.at/snippet.js';
    const script = document.createElement('script');
    for (const { name, value } of Array.from(el.attributes)) {
      if (!NOT_SETTINGS.has(name) && value.trim() !== '') script.setAttribute(name, value.trim());
    }
    const room = (el.getAttribute('room') || el.getAttribute('instance') || '').trim();
    if (room) script.setAttribute('instance', room);
    script.addEventListener('error', () => console.error(`${LOG}: failed to load ${script.src}`));
    script.src = new URL(GAME_SCRIPT, new URL(base, location.href)).href;
    document.body.appendChild(script);
  };

  const scan = () => document.querySelectorAll(`bs-snippet[name="${SNIPPET_NAME}"]`).forEach(start);

  const run = () => {
    scan();
    // Placements added later, e.g. with document.createElement('bs-snippet').
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
