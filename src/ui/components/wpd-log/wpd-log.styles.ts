/**
 * `<wpd-log>` — virtualized streaming log container.
 *
 * Two-deep DOM: the host is the scroll viewport; a `.spacer` sized to
 * `entries × rowHeight` provides the scrollbar; the `.window` is
 * absolutely positioned inside the spacer and re-stamped on scroll
 * with the slice of rows currently visible. Rows themselves are
 * rendered into the window by the consumer's render callback.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
		position: relative;
		overflow-y: auto;
		overflow-x: hidden;
		font: var( --wpd-log-font, 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace );
		color: var( --wpd-log-fg, var( --desktop-mode-text, #1d2327 ) );
		background: var( --wpd-log-bg, transparent );
		border: var( --wpd-log-border, 1px solid rgba( 0, 0, 0, 0.06 ) );
		border-radius: var( --wpd-log-border-radius, 4px );
		min-height: var( --wpd-log-min-height, 120px );
		/* Forms a containing block for the absolutely-positioned
		 * window so spacer + window stay aligned with the host's
		 * scroll. */
		contain: strict;
	}
	:host( [ hidden ] ) {
		display: none;
	}

	.spacer {
		position: relative;
		width: 100%;
	}

	.window {
		position: absolute;
		left: 0;
		right: 0;
		top: 0;
	}

	.row {
		box-sizing: border-box;
		display: block;
		padding: var( --wpd-log-row-padding, 2px 8px );
		min-height: var( --wpd-log-row-height, 22px );
		border-bottom: var( --wpd-log-row-border, 1px solid rgba( 0, 0, 0, 0.04 ) );
		white-space: var( --wpd-log-row-white-space, pre );
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/*
	 * Auto-row-height mode — the virtualizer measures each rendered
	 * row, so we let content drive height. The fixed-height \`overflow:
	 * hidden\` would clip multi-line content the same way the default
	 * mode does — defeats the point. Plugins can still set their own
	 * \`overflow\` on the rendered row element.
	 */
	:host( [ auto-row-height ] ) .row {
		min-height: 0;
		overflow: visible;
		text-overflow: clip;
		white-space: var( --wpd-log-row-white-space, normal );
	}

	.empty {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		color: var( --desktop-mode-text-muted, #57606a );
		font-style: italic;
	}
`;
