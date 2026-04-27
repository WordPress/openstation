/**
 * `<wpd-code>` — inline code badge. Visually close to `<wpd-key>` but
 * renders via a semantic `<code>` element, with no global keypress
 * listeners — safe for URLs, slugs, flag names, or anything else that
 * would otherwise steal keystrokes if stamped out as `<wpd-key>`.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: inline;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	code {
		font-family: var(
			--wpd-code-font-family,
			ui-monospace,
			SFMono-Regular,
			Menlo,
			Consolas,
			"Liberation Mono",
			monospace
		);
		font-size: var( --wpd-code-font-size, 0.92em );
		padding: var( --wpd-code-padding, 0.1em 0.4em );
		border-radius: var( --wpd-code-border-radius, 4px );
		background: var( --wpd-code-bg, rgba( 0, 0, 0, 0.06 ) );
		color: var( --wpd-code-fg, var( --wp-desktop-text, #1d2327 ) );
		border: var( --wpd-code-border, 1px solid rgba( 0, 0, 0, 0.08 ) );
		white-space: var( --wpd-code-white-space, nowrap );
		overflow-wrap: anywhere;
	}
	/*
	 * Block variant — set \`block\` on the host to render a pre-style
	 * multi-line box. Good for copy-paste snippets in onboarding /
	 * tooltip surfaces where a full syntax highlighter would be
	 * overkill.
	 */
	:host( [ block ] ) {
		display: block;
	}
	:host( [ block ] ) code {
		display: block;
		padding: var( --wpd-code-block-padding, 10px 12px );
		white-space: pre;
		overflow-x: auto;
	}

	/*
	 * Copy button. Anchored to the right; on the inline variant it's
	 * tucked alongside the code via inline-flex; on \`block\` it sits
	 * top-right inside the snippet box. Uses the same dashicon-like
	 * glyphs the rest of the shell ships, no external icon font.
	 */
	:host( [ copy ] ) {
		position: relative;
	}
	:host( [ copy ] ):not( [ block ] ) {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.copy {
		appearance: none;
		background: transparent;
		border: 0;
		padding: 0;
		margin: 0;
		font: inherit;
		cursor: pointer;
		color: var( --wpd-code-copy-color, var( --wp-desktop-text-muted, #57606a ) );
		opacity: var( --wpd-code-copy-opacity, 0.6 );
		transition: opacity 120ms ease, color 120ms ease;
		line-height: 1;
		font-size: 0.95em;
	}
	.copy:hover,
	.copy:focus-visible {
		opacity: 1;
		color: var( --wpd-code-copy-color-hover, var( --wp-admin-theme-color, #007cba ) );
	}
	:host( [ block ] ) .copy {
		position: absolute;
		top: 6px;
		inset-inline-end: 8px;
		padding: 4px 6px;
		background: var( --wpd-code-copy-bg, rgba( 255, 255, 255, 0.6 ) );
		border-radius: 4px;
		opacity: 0;
	}
	:host( [ block ] ):hover .copy,
	:host( [ block ] ):focus-within .copy {
		opacity: 1;
	}
`;
