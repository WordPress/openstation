/**
 * `<os-section>` — shadow-DOM styles. Mounted via
 * `static styles = [ styles ]` on the component class.
 *
 * The host element is a transparent block; card styling (padding,
 * background, border) lives at the call-site in the OS Settings
 * stylesheet because the "how sections look" choice is surface-
 * specific, not component-intrinsic.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
		margin-block-end: 28px;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	.os-section__heading {
		margin: 0 0 2px;
		font-size: 14px;
		font-weight: 600;
		color: var( --os-ui-fg, #1d2327 );
	}
	.os-section__description {
		margin: 0 0 14px;
		font-size: 12px;
		color: var( --os-ui-fg-muted, #646970 );
		line-height: 1.45;
	}
	/* Collapse the description node when no text was
	 * supplied — avoids stray margin under the heading. */
	.os-section__description:empty {
		display: none;
	}
	/*
	 * Opt-in child stacking. Set the \`stack\` attribute to turn the
	 * default slot into a flex column with a consistent gap — saves
	 * every caller from reaching for a \`<os-stack>\` wrapper or
	 * discovering the cramped default. Existing callers whose slotted
	 * children already carry their own \`margin-block-end\` (the
	 * built-in OS Settings sections) omit the attribute and get
	 * original behaviour.
	 *
	 * \`--os-ui-section-gap\` is overridable per-instance.
	 */
	:host( [ stack ] ) .os-section__body {
		display: flex;
		flex-direction: column;
		gap: var( --os-ui-section-gap, 12px );
	}
`;
