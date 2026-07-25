/**
 * `<wpd-badge>` — colored-dot status pill.
 *
 * Five built-in tones map to common UI states; per-tone variables
 * pick up plugin theming where needed. The dot uses
 * `currentColor` so the dot tracks `--wpd-badge-color` automatically;
 * the surrounding pill background is independently themable.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-flex;
		align-items: center;
		gap: var( --wpd-badge-gap, 6px );
		padding: var( --wpd-badge-padding, 2px 8px );
		font: var( --wpd-badge-font, 500 12px/1.4 var( --desktop-mode-font, system-ui ) );
		color: var( --wpd-badge-color, var( --wpd-fg, #1d2327 ) );
		background: var( --wpd-badge-bg, var( --wpd-hover, rgba( 0, 0, 0, 0.06 ) ) );
		border: var( --wpd-badge-border, 1px solid transparent );
		border-radius: var( --wpd-badge-border-radius, 999px );
		white-space: nowrap;
		vertical-align: baseline;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.dot {
		width: var( --wpd-badge-dot-size, 8px );
		height: var( --wpd-badge-dot-size, 8px );
		border-radius: 50%;
		background: currentColor;
		flex: 0 0 auto;
	}

	/*
	 * Tone palette — opt-in via the \`tone\` attribute. The label
	 * inherits the parent text color so each tone's accent is carried
	 * by the dot only; this keeps badges legible against any
	 * background. Plugins can override any single tone via the
	 * variables below without redefining the rest.
	 */
	:host( [ tone="success" ] ) {
		--wpd-badge-color: var( --wpd-badge-success, var( --wpd-success-fg, #1a7f37 ) );
		--wpd-badge-bg: var( --wpd-badge-success-bg, rgba( 26, 127, 55, 0.12 ) );
	}
	:host( [ tone="warning" ] ) {
		--wpd-badge-color: var( --wpd-badge-warning, var( --wpd-warning-fg, #9a6700 ) );
		--wpd-badge-bg: var( --wpd-badge-warning-bg, rgba( 154, 103, 0, 0.12 ) );
	}
	:host( [ tone="danger" ] ) {
		--wpd-badge-color: var( --wpd-badge-danger, var( --wpd-danger, #cf222e ) );
		--wpd-badge-bg: var( --wpd-badge-danger-bg, rgba( 207, 34, 46, 0.12 ) );
	}
	:host( [ tone="info" ] ) {
		--wpd-badge-color: var( --wpd-badge-info, var( --wpd-info-fg, #0969da ) );
		--wpd-badge-bg: var( --wpd-badge-info-bg, rgba( 9, 105, 218, 0.12 ) );
	}
	:host( [ tone="neutral" ] ) {
		--wpd-badge-color: var( --wpd-badge-neutral, var( --wpd-fg-muted, #57606a ) );
		--wpd-badge-bg: var( --wpd-badge-neutral-bg, rgba( 87, 96, 106, 0.12 ) );
	}

	/*
	 * \`no-dot\` hides the leading marker entirely — useful when the
	 * label itself carries the meaning (counts, version pills) and
	 * the dot would just be visual noise.
	 */
	:host( [ no-dot ] ) .dot {
		display: none;
	}
`;
