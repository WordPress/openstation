import { css } from '../../core';

const CHEVRON_W = '10px';

export const styles = css`
	:host {
		display: inline-flex;
		max-width: 100%;
		align-items: center;
		min-width: 0;
		font-family: var( --os-ui-font, system-ui, sans-serif );

		font-size: 12px;
		line-height: 1;
		font-weight: 500;
	}

	.os-crumb-chain {
		display: inline-flex;
		flex-wrap: nowrap;
		align-items: stretch;
		max-width: 100%;
		min-width: 0;
		min-height: 22px;

		border-radius: 999px;
		overflow: hidden;
		filter: drop-shadow( 0 1px 1px rgba( 0, 0, 0, 0.06 ) );
	}

	.os-crumb {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-height: 22px;
		padding: 2px 12px;
		background: var( --os-ui-crumb-bg, var( --os-ui-surface, #c3c4c7 ) );
		color: var( --os-ui-crumb-fg, var( --os-ui-fg, #1d2327 ) );
		text-align: center;
		min-width: 0;
		max-width: 100%;
		flex-shrink: 1;
		font-size: 12px;
		font-weight: 500;
		letter-spacing: 0.01em;
		white-space: nowrap;

		cursor: grab;
		transition: filter 0.15s ease, transform 0.15s ease, background-color 0.12s ease;
	}
	.os-crumb:active {
		cursor: grabbing;
	}
	.os-crumb:hover {
		filter: brightness( 1.06 );
	}

	.os-crumb__remove {
		cursor: pointer;
	}

	.os-crumb--first {
		padding-inline-end: 22px;
		clip-path: polygon(
			0 0,
			calc( 100% - ${ CHEVRON_W } ) 0,
			100% 50%,
			calc( 100% - ${ CHEVRON_W } ) 100%,
			0 100%
		);
	}
	.os-crumb--middle {
		padding-inline: 22px;
		margin-inline-start: calc( -1 * ${ CHEVRON_W } );
		clip-path: polygon(
			${ CHEVRON_W } 0,
			calc( 100% - ${ CHEVRON_W } ) 0,
			100% 50%,
			calc( 100% - ${ CHEVRON_W } ) 100%,
			${ CHEVRON_W } 100%,
			0 50%
		);
	}
	.os-crumb--last {
		padding-inline-start: 22px;
		padding-inline-end: 14px;
		margin-inline-start: calc( -1 * ${ CHEVRON_W } );
		clip-path: polygon(
			${ CHEVRON_W } 0,
			100% 0,
			100% 100%,
			${ CHEVRON_W } 100%,
			0 50%
		);
	}

	.os-crumb--solo {
		padding: 2px 12px;
		border-radius: 999px;
	}

	.os-crumb__label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;

		line-height: 1.4;
	}

	.os-crumb__remove {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		color: inherit;
		cursor: pointer;
		opacity: 0.65;
		transition: opacity 0.12s ease, background-color 0.12s ease, transform 0.12s ease;
	}
	.os-crumb__remove:hover,
	.os-crumb__remove:focus-visible {
		opacity: 1;
		background: var( --os-ui-scrim, rgba( 0, 0, 0, 0.22 ) );
		outline: none;
		transform: scale( 1.1 );
	}

	.os-crumb__remove svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.os-crumb-chain:hover {
		filter: drop-shadow( 0 2px 3px rgba( 0, 0, 0, 0.12 ) );
	}

	:host( [ disabled ] ) .os-crumb-chain {
		opacity: 0.55;
		pointer-events: none;
	}
`;
