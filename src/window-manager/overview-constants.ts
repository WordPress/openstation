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

/**
 * The extra reserve when the bar carries a header row above its tiles
 * — the site switcher on a network (`installOverviewHeader()`). A
 * constant rather than a measurement: the row is a kit component
 * whose shadow content may not have rendered on the frame the layout
 * runs, and a number that is right every time beats one that is
 * exact most of the time.
 */
export const OVERVIEW_TOP_BAR_HEADER_RESERVE = 56;

/**
 * The reserve for the bar as built: the base, plus the header row's
 * share when the bar has one.
 *
 * @param bar The mounted top bar, or null before / without one.
 */
export function overviewTopBarReserve( bar: HTMLElement | null ): number {
	return (
		OVERVIEW_TOP_BAR_RESERVE +
		( bar?.querySelector( '.os-overview-top-bar__header' )
			? OVERVIEW_TOP_BAR_HEADER_RESERVE
			: 0 )
	);
}
