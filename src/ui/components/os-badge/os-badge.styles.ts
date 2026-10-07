import { css } from '../../core';
import { holoTokens } from '../../holo';

export const styles = css`
	${ holoTokens }

	:host {
		display: inline-flex;
		align-items: center;
		gap: var( --os-ui-badge-gap, 6px );
		padding: var( --os-ui-badge-padding, 2px 8px );
		font: var( --os-ui-badge-font, 500 12px/1.4 var( --os-font, system-ui ) );
		color: var( --os-ui-badge-color, var( --os-ui-fg, #1d2327 ) );
		background: var( --os-ui-badge-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
		border: var( --os-ui-badge-border, 1px solid transparent );
		border-radius: var( --os-ui-badge-border-radius, 999px );
		white-space: nowrap;
		vertical-align: baseline;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.dot {
		width: var( --os-ui-badge-dot-size, 8px );
		height: var( --os-ui-badge-dot-size, 8px );
		border-radius: 50%;
		background: currentColor;
		flex: 0 0 auto;
	}

	:host( [ tone="success" ] ) {
		--os-ui-badge-color: var( --os-ui-badge-success, var( --os-ui-success-fg, #1a7f37 ) );
		--os-ui-badge-bg: var( --os-ui-badge-success-bg, rgba( 26, 127, 55, 0.12 ) );
	}
	:host( [ tone="warning" ] ) {
		--os-ui-badge-color: var( --os-ui-badge-warning, var( --os-ui-warning-fg, #9a6700 ) );
		--os-ui-badge-bg: var( --os-ui-badge-warning-bg, rgba( 154, 103, 0, 0.12 ) );
	}
	:host( [ tone="danger" ] ) {
		--os-ui-badge-color: var( --os-ui-badge-danger, var( --os-ui-danger, #cf222e ) );
		--os-ui-badge-bg: var( --os-ui-badge-danger-bg, rgba( 207, 34, 46, 0.12 ) );
	}
	:host( [ tone="info" ] ) {
		--os-ui-badge-color: var( --os-ui-badge-info, var( --os-ui-info-fg, #0969da ) );
		--os-ui-badge-bg: var( --os-ui-badge-info-bg, rgba( 9, 105, 218, 0.12 ) );
	}
	:host( [ tone="neutral" ] ) {
		--os-ui-badge-color: var( --os-ui-badge-neutral, var( --os-ui-fg-muted, #57606a ) );
		--os-ui-badge-bg: var( --os-ui-badge-neutral-bg, rgba( 87, 96, 106, 0.12 ) );
	}

	:host( [ tone="accent" ] ) {
		--os-ui-badge-color: var( --os-ui-badge-accent, var( --_holo-ink ) );
		background-color: transparent;
		background-image: var( --os-ui-badge-accent-bg, var( --_holo-fill ) );
		background-size: 220% 220%;
		background-position: 22% 28%;
		background-repeat: no-repeat;
		box-shadow: var( --_holo-glow );
		font-weight: 600;
	}

	:host( [ tone="accent" ] ) .dot {
		display: none;
	}

	:host( [ no-dot ] ) .dot {
		display: none;
	}
`;
