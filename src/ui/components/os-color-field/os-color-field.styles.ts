import { css } from '../../core';
import { holoTokens } from '../../holo';

export const styles = css`
	${ holoTokens }

	:host {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
	}
	label {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	input[ type='color' ] {
		width: 28px;
		height: 28px;
		padding: 0;
		border: 1px solid var( --os-ui-border, #c3c4c7 );
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
		transition: border-color var( --_holo-t ) ease,
			box-shadow var( --_holo-t ) ease;
	}
	input[ type='color' ]:hover {
		border-color: var( --os-ui-border-strong, #8c8f94 );
	}

	input[ type='color' ]:focus-visible {
		outline: none;
		box-shadow: var( --_holo-focus );
	}

	:host( [ variant='block' ] ) {
		display: flex;
		width: 100%;
	}
	:host( [ variant='block' ] ) label {
		display: flex;
		flex: 1;
		align-items: center;
	}
	:host( [ variant='block' ] ) input[ type='color' ] {
		flex: 1;
		width: auto;
		height: 32px;
	}

	input[ type='color' ]::-webkit-color-swatch-wrapper {
		padding: 2px;
	}
	input[ type='color' ]::-webkit-color-swatch {
		border: none;
		border-radius: 2px;
	}
`;
