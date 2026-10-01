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

/**
 * How the last run ended, alongside {@link SHELL_TOUR_INTRO_SLUG}.
 *
 * `shell-tour` only says "do not start it on boot again", and Skip,
 * Escape and Done all mean that. The relaunch icon needs the part
 * they disagree on: a tour someone bailed out of is unfinished, one
 * they walked to the end is not. Both slugs live in the same seen-
 * intros registry, so "Reset what's-new dialogs" clears them too.
 */
export const SHELL_TOUR_SKIPPED_SLUG = 'shell-tour-skipped';
export const SHELL_TOUR_DONE_SLUG = 'shell-tour-done';

/**
 * The desktop icon that relaunches an unfinished tour. Registered by
 * the server (`includes/first-run/shell-tour.php`); a click is caught
 * on `HOOKS.DESKTOP_ICON_CLICKED` by the loader.
 */
export const SHELL_TOUR_ICON_ID = 'openstation-shell-tour';
