/**
 * `<os-code>` — inline code badge. Visually close to `<os-key>` but
 * renders via a semantic `<code>` element, with no global keypress
 * listeners — safe for URLs, slugs, flag names, or anything else that
 * would otherwise steal keystrokes if stamped out as `<os-key>`.
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
			--os-ui-code-font-family,
			ui-monospace,
			SFMono-Regular,
			Menlo,
			Consolas,
			"Liberation Mono",
			monospace
		);
		font-size: var( --os-ui-code-font-size, 0.92em );
		padding: var( --os-ui-code-padding, 0.1em 0.4em );
		border-radius: var( --os-ui-code-border-radius, 4px );
		background: var( --os-ui-code-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
		color: var( --os-ui-code-fg, var( --os-ui-fg, #1d2327 ) );
		border: var( --os-ui-code-border, 1px solid rgba( 0, 0, 0, 0.08 ) );
		white-space: var( --os-ui-code-white-space, nowrap );
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
	/*
	 * The scroll box is the \`code\` element, not the host: the copy
	 * button is positioned against the host, so a host that scrolled
	 * would carry the button away with the content and leave a long
	 * snippet with no way to copy it except from the top.
	 */
	:host( [ block ] ) code {
		display: block;
		padding: var( --os-ui-code-block-padding, 10px 12px );
		white-space: pre;
		max-block-size: var( --os-ui-code-block-max-block-size, none );
		overflow: auto;
	}

	/*
	 * Wrap variant — set \`wrap\` to fold long lines instead of
	 * scrolling them sideways. Declared AFTER the block rules and at
	 * the same specificity, so source order is what makes it win; a
	 * snippet in a narrow window (a stack trace in a window a third of
	 * the screen wide) is then readable where it stands rather than
	 * only after the window is dragged out to fit its longest line.
	 *
	 * The content's own line breaks still stand — this is \`pre-wrap\`,
	 * not \`normal\` — and \`anywhere\` is what stops a single unbroken
	 * token (a long path, a base64 blob) from reintroducing the
	 * sideways scroll the attribute was asked to remove.
	 */
	:host( [ wrap ] ) code {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
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
		gap: var( --os-ui-code-copy-gap, 8px );
	}
	/*
	 * Sized as a real control — a 24px square with its own hit area —
	 * rather than a bare glyph. A copy affordance that covers only its
	 * own character is a target you have to aim at, and it sits by
	 * definition right against text you may be trying to select
	 * instead, so neither the size nor the gap is decoration.
	 */
	.copy {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		inline-size: var( --os-ui-code-copy-size, 24px );
		block-size: var( --os-ui-code-copy-size, 24px );
		background: transparent;
		border: 0;
		border-radius: 4px;
		padding: 0;
		margin: 0;
		font: inherit;
		cursor: pointer;
		color: var( --os-ui-code-copy-color, var( --os-ui-fg-muted, #57606a ) );
		opacity: var( --os-ui-code-copy-opacity, 0.6 );
		transition: opacity 120ms ease, color 120ms ease, background-color 120ms ease;
		line-height: 1;
		font-size: 1.05em;
	}
	.copy:hover,
	.copy:focus-visible {
		opacity: 1;
		color: var( --os-ui-code-copy-color-hover, var( --wp-admin-theme-color, #007cba ) );
		background: var( --os-ui-code-copy-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
	}
	/*
	 * Dimmed rather than absent until hover: a control nobody can see
	 * is a control nobody uses, and a snippet box is exactly where
	 * someone arrives already wanting to copy.
	 */
	:host( [ block ] ) .copy {
		position: absolute;
		top: 6px;
		inset-inline-end: 6px;
		background: var( --os-ui-code-copy-bg, var( --os-ui-hover, rgba( 0, 0, 0, 0.06 ) ) );
		opacity: var( --os-ui-code-copy-opacity, 0.6 );
	}
	:host( [ block ] ):hover .copy,
	:host( [ block ] ):focus-within .copy {
		opacity: 1;
	}
	/*
	 * Reserve the button's corner so it never lands on the first line
	 * of the snippet. Declared apart from the block padding above
	 * because that token is a shorthand this cannot compose with.
	 */
	:host( [ block ][ copy ] ) code {
		padding-inline-end: var( --os-ui-code-copy-inset, 42px );
	}
`;
