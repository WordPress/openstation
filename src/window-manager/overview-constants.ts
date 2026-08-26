/**
 * OpenStation — Overview layout constants.
 *
 * Pulled into a dedicated module so `desktops.ts` and `overview.ts`
 * can both import it without forming an import cycle through either
 * side's function exports.
 */

/**
 * Vertical space reserved at the top of the desktop area for the
 * overview top bar. Used by `enterOverview` and the close-desktop
 * relayout path to push the thumbnail grid downward so tiles aren't
 * covered by the bar.
 */
export const OVERVIEW_TOP_BAR_RESERVE = 120;
