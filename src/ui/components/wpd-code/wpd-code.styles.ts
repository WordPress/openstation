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
`;
