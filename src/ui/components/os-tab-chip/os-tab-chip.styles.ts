import { css } from '../../core';
import { holoTokens } from '../../holo';

export const styles = css`
	${ holoTokens }

	:host {
		display: inline-flex;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var( --os-ui-fg-muted, rgba( 0, 0, 0, 0.45 ) );
		cursor: pointer;
		transition: background-color 0.15s ease, color 0.15s ease,
			transform 0.12s ease;
	}
	/* Detach (lift + soft accent wash) */
	:host( [ variant='detach' ] ) button:hover {
		color: var( --wp-admin-theme-color, #2271b1 );
		background: var( --os-ui-accent-soft, rgba( 34, 113, 177, 0.12 ) );
		transform: translateY( -1px );
	}
	:host( [ variant='detach' ] ) button:focus-visible {
		outline: none;
		color: var( --os-ui-accent, #2271b1 );
		background: var( --os-ui-accent-soft, rgba( 34, 113, 177, 0.12 ) );
		box-shadow: var( --_holo-focus );
	}
	/* Close (red destructive wash) */
	:host( [ variant='close' ] ) button:hover {
		color: var( --os-ui-fg-on-accent, #fff );
		background: var( --os-ui-danger, #d63638 );
	}
	/*
	 * Close keeps a RED ring rather than the kit's Pulse one. The
	 * shared ring says "this has focus"; on the one control that
	 * destroys something, the ring should also say what it destroys.
	 */
	:host( [ variant='close' ] ) button:focus-visible {
		color: var( --os-ui-fg-on-accent, #fff );
		background: var( --os-ui-danger, #d63638 );
		outline: none;
		box-shadow: 0 0 0 2px rgba( 12, 11, 15, 0.9 ),
			0 0 0 4px var( --os-ui-danger, #d63638 ),
			0 0 12px 2px rgba( 214, 54, 56, 0.45 );
	}
	svg {
		display: block;
		pointer-events: none;
		width: 12px;
		height: 12px;
	}
	@media ( prefers-reduced-motion: reduce ) {
		button {
			transition-duration: 0.01ms;
		}
		:host( [ variant='detach' ] ) button:hover {
			transform: none;
		}
	}
`;
