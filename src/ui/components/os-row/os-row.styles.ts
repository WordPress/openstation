import { css } from '../../core';

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

	::slotted( :not( [ col ] ) ) {
		grid-column: 1 / -1;
	}

	::slotted( * ) {
		min-width: 0;
	}
`;
