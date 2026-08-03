import { css } from '../../core';

export const styles = css`
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
		color: var( --wpd-fg-muted, rgba( 0, 0, 0, 0.45 ) );
		cursor: pointer;
		transition: background-color 0.15s ease, color 0.15s ease,
			transform 0.12s ease;
	}
	/* Detach (lift + soft accent wash) */
	:host( [ variant='detach' ] ) button:hover {
		color: var( --wp-admin-theme-color, #2271b1 );
		background: var( --wpd-accent-soft, rgba( 34, 113, 177, 0.12 ) );
		transform: translateY( -1px );
	}
	:host( [ variant='detach' ] ) button:focus-visible {
		outline: 2px solid var( --wp-admin-theme-color, #2271b1 );
		outline-offset: 1px;
	}
	/* Close (red destructive wash) */
	:host( [ variant='close' ] ) button:hover {
		color: var( --wpd-fg-on-accent, #fff );
		background: var( --wpd-danger, #d63638 );
	}
	:host( [ variant='close' ] ) button:focus-visible {
		color: var( --wpd-fg-on-accent, #fff );
		background: var( --wpd-danger, #d63638 );
		outline: 2px solid var( --wpd-danger-hover, rgba( 214, 54, 56, 0.6 ) );
		outline-offset: 1px;
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
