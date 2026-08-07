import { css } from '../../core';

/**
 * Styles for the 12-column row.
 *
 * The grid-template pins the rail to 12 equal tracks so any child
 * with `col="N"` (1..12) takes a predictable N/12 slice of the row
 * width. Bootstrap ergonomics without the framework — `col="6"`
 * twice yields a 50/50 split, `col="4"` three times yields thirds,
 * and so on.
 *
 * `::slotted` lives in shadow CSS (hosted on the row element) so
 * the rules only apply to direct children of the row — a nested
 * `<os-row>` deeper in the subtree owns its own slotted rules
 * without collision. The slotted selectors work for ANY element
 * type (os-*, plain HTML, third-party custom elements) because
 * they key off the attribute alone.
 */

export const styles = css`
	:host {
		display: grid;
		grid-template-columns: repeat( 12, minmax( 0, 1fr ) );
		gap: var( --os-ui-row-gap, 12px );
		row-gap: var( --os-ui-row-row-gap, var( --os-ui-row-gap, 12px ) );
		column-gap: var( --os-ui-row-column-gap, var( --os-ui-row-gap, 12px ) );
		width: 100%;
		min-width: 0;
	}

	:host( [ hidden ] ) {
		display: none;
	}

	/*
	 * Explicit col spans. Each rule is tiny; keeping 12 of them
	 * is simpler than a more magical matching scheme (and the
	 * compiled stylesheet is still a few hundred bytes).
	 */
	::slotted( [ col='1' ] )  { grid-column: span 1; }
	::slotted( [ col='2' ] )  { grid-column: span 2; }
	::slotted( [ col='3' ] )  { grid-column: span 3; }
	::slotted( [ col='4' ] )  { grid-column: span 4; }
	::slotted( [ col='5' ] )  { grid-column: span 5; }
	::slotted( [ col='6' ] )  { grid-column: span 6; }
	::slotted( [ col='7' ] )  { grid-column: span 7; }
	::slotted( [ col='8' ] )  { grid-column: span 8; }
	::slotted( [ col='9' ] )  { grid-column: span 9; }
	::slotted( [ col='10' ] ) { grid-column: span 10; }
	::slotted( [ col='11' ] ) { grid-column: span 11; }
	::slotted( [ col='12' ] ) { grid-column: span 12; }

	/*
	 * Children without a col attribute default to spanning the
	 * full row — matches the intuition that dropping a single
	 * element into a row shouldn't shrink it to 1/12 of the
	 * width. Plugin authors who want auto-fit per-child sizing
	 * should reach for <os-grid> instead.
	 */
	::slotted( :not( [ col ] ) ) {
		grid-column: 1 / -1;
	}

	/*
	 * Tiny min-width guard — flex/grid children default to
	 * min-width: auto which lets overflowing content push the
	 * track wider than its assigned fraction. The minmax(0, 1fr)
	 * above already helps; this makes sure long option labels
	 * inside a os-select don't burst the row.
	 */
	::slotted( * ) {
		min-width: 0;
	}
`;
