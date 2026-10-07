export const OVERVIEW_TOP_BAR_RESERVE = 120;

export const OVERVIEW_TOP_BAR_HEADER_RESERVE = 56;

export function overviewTopBarReserve( bar: HTMLElement | null ): number {
	return (
		OVERVIEW_TOP_BAR_RESERVE +
		( bar?.querySelector( '.os-overview-top-bar__header' )
			? OVERVIEW_TOP_BAR_HEADER_RESERVE
			: 0 )
	);
}
