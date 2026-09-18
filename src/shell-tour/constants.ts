/**
 * Shell tour — the two names both bundles need.
 *
 * A leaf on purpose: `loader.ts` ships in `desktop.min.js` and must
 * not reach `index.ts`, which side-effect-imports `<os-coachmark>`
 * and `<os-key>` into whichever bundle imports it.
 */

/** Slug the tour records in the seen-intros registry. */
export const SHELL_TOUR_INTRO_SLUG = 'shell-tour';

/** Document event that starts (or restarts) the tour on demand. */
export const SHELL_TOUR_START_EVENT = 'os-shell-tour-start';
