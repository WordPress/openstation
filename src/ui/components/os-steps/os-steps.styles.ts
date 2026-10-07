import { css } from '../../core';

export const stepsStyles = css`
	:host {
		display: block;
		counter-reset: os-step;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.os-steps__list {
		display: flex;
		flex-direction: column;
		gap: var( --os-ui-steps-gap, 16px );
		margin: 0;
		padding: 0;
		list-style: none;
	}

	:host( [ horizontal ] ) {
		--os-ui-step-connector-width: 20px;

		--os-ui-step-title-color: var( --os-ui-fg-muted, #646970 );
		--os-ui-step-title-weight: 400;
	}
	:host( [ horizontal ] ) .os-steps__list {
		flex-direction: row;
		align-items: center;
		flex-wrap: wrap;
		gap: var( --os-ui-steps-gap, 10px );
	}
`;

export const stepStyles = css`
	:host {
		display: grid;
		grid-template-columns:
			var( --os-ui-step-chip-size, 28px ) 1fr
			var( --os-ui-step-connector-width, 0 );
		column-gap: var( --os-ui-step-gap, 12px );
		align-items: start;
		counter-increment: os-step;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	:host::before {
		content: counter( os-step );
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: var( --os-ui-step-chip-size, 28px );
		height: var( --os-ui-step-chip-size, 28px );

		box-sizing: border-box;
		border-radius: 50%;

		background: var(
			--os-ui-step-chip-bg,
			var( --wp-admin-theme-color, #2271b1 )
		);
		background-size: 200% 200%;
		background-position: 30% 40%;
		color: var( --os-ui-step-chip-fg, var( --os-ui-fg-on-accent, #fff ) );

		border: var( --os-ui-step-chip-border, 0 );
		font-family: var( --os-ui-step-chip-family, inherit );
		font-size: var( --os-ui-step-chip-font-size, 13px );
		font-weight: 600;
		line-height: 1;
		flex-shrink: 0;
	}

	:host( [ done ] )::before {
		content: '✓';
		background: var(
			--os-ui-step-chip-done-bg,
			var( --os-ui-fg-muted, #646970 )
		);
	}

	:host( [ current ] ) .os-step__title {
		color: var( --os-ui-fg, #1d2327 );
		font-weight: 600;
	}

	:host( [ interactive ] ) {
		cursor: pointer;
	}
	:host( [ interactive ] ) .os-step__title {
		transition: color 120ms ease;
	}
	:host( [ interactive ] )::before {
		transition: border-color 120ms ease;
	}
	:host( [ interactive ]:hover ) .os-step__title {
		color: var( --os-ui-step-title-hover-color, var( --os-ui-fg, #1d2327 ) );
	}
	:host( [ interactive ]:hover )::before {
		border-color: var( --os-ui-step-title-hover-color, var( --os-ui-fg, #1d2327 ) );
	}
	:host( [ interactive ]:focus-visible ) {
		outline: var( --os-ui-focus-ring, 2px solid #2271b1 );
		outline-offset: 2px;
		border-radius: var( --os-ui-radius, 4px );
	}

	:host::after {
		content: '';
		inline-size: var( --os-ui-step-connector-width, 0 );
		block-size: 1px;
		background: var( --os-ui-border, rgba( 0, 0, 0, 0.08 ) );
		align-self: center;
	}
	:host( :last-of-type )::after {
		content: none;
	}
	.os-step__body {
		min-width: 0;
	}

	:host( [ trail ] ) {
		align-items: center;
	}
	:host( [ trail ] ) .os-step__title {
		margin: 0;
	}
	.os-step__title {
		margin: 0 0 4px;
		font-family: var( --os-ui-step-title-family, inherit );
		font-size: var( --os-ui-step-title-size, 14px );
		font-weight: var( --os-ui-step-title-weight, 600 );
		color: var( --os-ui-step-title-color, var( --os-ui-fg, #1d2327 ) );
		text-transform: var( --os-ui-step-title-transform, none );
		letter-spacing: var( --os-ui-step-title-spacing, normal );
		line-height: 1.3;
	}
	.os-step__title:empty {
		display: none;
	}
	.os-step__body ::slotted( * ) {
		margin-block: 0;
	}
`;
