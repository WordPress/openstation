import { css } from '../../core';

export const styles = css`
	:host {
		display: grid;
		min-inline-size: 0;
		min-block-size: 0;
		grid-template-columns: var( --os-ui-grid-columns, 1fr );
		grid-template-rows: var( --os-ui-grid-rows, auto );
		gap: var( --os-ui-grid-gap, 8px );
		column-gap: var( --os-ui-grid-column-gap, var( --os-ui-grid-gap, 8px ) );
		row-gap: var( --os-ui-grid-row-gap, var( --os-ui-grid-gap, 8px ) );
	}
	:host( [ hidden ] ) {
		display: none;
	}

	::slotted( * ) { min-inline-size: 0; }
	::slotted( [ col-span='1' ] ) { grid-column: span min( 1, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='1' ] ) { grid-row: span 1; }
	::slotted( [ col-span='2' ] ) { grid-column: span min( 2, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='2' ] ) { grid-row: span 2; }
	::slotted( [ col-span='3' ] ) { grid-column: span min( 3, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='3' ] ) { grid-row: span 3; }
	::slotted( [ col-span='4' ] ) { grid-column: span min( 4, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='4' ] ) { grid-row: span 4; }
	::slotted( [ col-span='5' ] ) { grid-column: span min( 5, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='5' ] ) { grid-row: span 5; }
	::slotted( [ col-span='6' ] ) { grid-column: span min( 6, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='6' ] ) { grid-row: span 6; }
	::slotted( [ col-span='7' ] ) { grid-column: span min( 7, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='7' ] ) { grid-row: span 7; }
	::slotted( [ col-span='8' ] ) { grid-column: span min( 8, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='8' ] ) { grid-row: span 8; }
	::slotted( [ col-span='9' ] ) { grid-column: span min( 9, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='9' ] ) { grid-row: span 9; }
	::slotted( [ col-span='10' ] ) { grid-column: span min( 10, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='10' ] ) { grid-row: span 10; }
	::slotted( [ col-span='11' ] ) { grid-column: span min( 11, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='11' ] ) { grid-row: span 11; }
	::slotted( [ col-span='12' ] ) { grid-column: span min( 12, var( --_os-grid-tracks, 1 ) ); }
	::slotted( [ row-span='12' ] ) { grid-row: span 12; }
	:host( [ data-single-column ] ) { grid-template-rows: none; }
	:host( [ data-single-column ] ) ::slotted( [ row-span ] ) { grid-row: auto; }
`;
