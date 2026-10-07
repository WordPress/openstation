import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
	}
	button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border: none;
		border-radius: var( --os-ui-btn-radius, 5px );

		background-color: var( --os-ui-btn-bg, transparent );
		background-image: var( --os-ui-btn-bg-image, none );
		background-repeat: var( --os-ui-btn-bg-image-repeat, no-repeat );
		background-size: var( --os-ui-btn-bg-image-size, auto );
		background-position: var( --os-ui-btn-bg-image-position, center );
		color: var( --os-ui-btn-color, currentColor );
		cursor: pointer;
		transition: background-color 0.15s ease, color 0.15s ease,
			transform 80ms ease;
	}

	button:active:not(:disabled) {
		transform: scale( 0.9 );
	}
	@media ( prefers-reduced-motion: reduce ) {
		button:active:not(:disabled) {
			transform: none;
		}
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button:hover:not(:disabled) {
		color: var( --os-ui-btn-color-hover, currentColor );
		background-color: var( --os-ui-btn-bg-hover, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
	}
	button:focus-visible {
		color: var( --os-ui-btn-color-hover, currentColor );
		background-color: var( --os-ui-btn-bg-hover, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
		outline: 2px solid var( --os-ui-btn-outline, currentColor );
		outline-offset: 1px;
	}
	:host( [ active ] ) button {
		color: var( --os-ui-btn-color-hover, currentColor );
		background-color: var( --os-ui-btn-bg-active, var( --os-ui-hover, rgba( 0, 0, 0, 0.08 ) ) );
	}
	:host( [ danger ] ) button:hover {
		color: var( --os-ui-fg-on-accent, #fff );
		background-color: var( --os-ui-btn-danger-hover, var( --os-ui-danger, #d63638 ) );
	}
	svg {
		display: block;
		pointer-events: none;
		flex-shrink: 0;
	}

	svg:empty {
		display: none;
	}

	.themed-icon {
		display: block;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		pointer-events: none;
		background-color: var( --os-ui-btn-icon-color, currentColor );
	}

	::slotted( span ) {
		line-height: 1;
	}
	::slotted( svg ) {
		display: block;
	}
`;
