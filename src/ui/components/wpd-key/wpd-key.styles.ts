import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		user-select: none;
	}
	:host( [ fill-cell ] ),
	:host {
		/* Keys default to filling their cell; the calculator use
		 * case is the common one. Callers who want an inline key
		 * tile can override with display:inline-flex and width:auto
		 * on the host. */
		display: flex;
		width: 100%;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	button {
		width: 100%;
		min-height: var( --wpd-key-min-height, 48px );
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: var( --wpd-key-padding, 8px 12px );
		font: inherit;
		font-size: var( --wpd-key-font-size, 16px );
		font-weight: 500;
		cursor: pointer;
		border-radius: var( --wpd-key-border-radius, 8px );
		background: var( --wpd-key-bg, rgba( 0, 0, 0, 0.06 ) );
		color: var( --wpd-key-fg, var( --desktop-mode-text, #1d2327 ) );
		border: var( --wpd-key-border, 1px solid transparent );
		transition:
			transform 0.08s ease,
			background-color 0.12s ease,
			box-shadow 0.12s ease;
	}
	button:hover:not( :disabled ) {
		background: var( --wpd-key-bg-hover, rgba( 0, 0, 0, 0.1 ) );
	}
	:host( [ variant='primary' ] ) button {
		background: var( --wpd-key-bg, var( --wp-admin-theme-color, #2271b1 ) );
		color: var( --wpd-key-fg, #fff );
	}
	:host( [ variant='primary' ] ) button:hover:not( :disabled ) {
		filter: brightness( 1.06 );
	}
	:host( [ variant='secondary' ] ) button {
		background: var( --wpd-key-bg, rgba( 0, 0, 0, 0.04 ) );
	}
	:host( [ variant='ghost' ] ) button {
		background: transparent;
		border: var( --wpd-key-border, 1px solid var( --desktop-mode-border, #c3c4c7 ) );
	}
	:host( [ variant='danger' ] ) button {
		background: transparent;
		color: #d63638;
		border: 1px solid currentColor;
	}
	/* Pressed — both click-flash and keyboard-hold resolve here. The
	 * visual is deliberately tactile: inset shadow + subtle scale-down
	 * so the key reads as "squeezed" rather than "disappeared." */
	:host( .wpd-key--pressed ) button,
	button:active:not( :disabled ) {
		transform: scale( 0.96 );
		box-shadow: inset 0 1px 2px rgba( 0, 0, 0, 0.22 );
		background: var( --wpd-key-bg-pressed, rgba( 0, 0, 0, 0.14 ) );
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
`;
