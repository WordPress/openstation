import { css } from '../../core';

export const styles = css`
	:host {
		display: grid;
		grid-template-rows: auto auto minmax( 0, 1fr ) auto;
		flex: 1 1 auto;
		min-inline-size: 0;
		min-block-size: 0;
		block-size: 100%;
		overflow: hidden;
	}
	:host( [ hidden ] ) { display: none; }
	.content { min-inline-size: 0; min-block-size: 0; overflow: auto; }
	:host( [ contained ] ) .content { display: flex; flex-direction: column; overflow: hidden; }
	::slotted( * ) { min-inline-size: 0; }
	:host( [ contained ] ) slot:not( [ name ] )::slotted( * ) {
		flex: 1 1 auto;
		min-block-size: 0;
	}
`;
