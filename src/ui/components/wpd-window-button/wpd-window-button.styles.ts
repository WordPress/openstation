import { css } from '../../core';

/**
 * Button colors flip between "focused" and "unfocused" window
 * title bars. Shadow DOM can't reach the parent window's focus
 * class directly (no cross-boundary selectors in widely-shipped
 * browsers), so the OUTER `.desktop-mode-window[--focused]` CSS
 * sets these custom properties; the shadow DOM reads them via
 * `var()` with sensible fallbacks.
 *
 * Plugins that want custom buttons can override these on the
 * `<wpd-window-button>` element itself or on a parent selector.
 */
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
		border-radius: var( --wpd-btn-radius, 5px );
		/*
		 * TRANSPARENT at rest, which is what lets a themed title-bar
		 * texture run underneath the whole control cluster. A theme
		 * that wants each control to sit on its own key sets
		 * \`--wpd-btn-bg\` (colour) and/or the TITLEBAR_BUTTON texture
		 * slot (\`--wpd-btn-bg-image\`); everything here resolves to the
		 * old hardcoded values when unset.
		 *
		 * background-COLOR, not the shorthand: the hover / active /
		 * danger rules below override the colour only, and must not
		 * wipe a themed image out from under it.
		 */
		background-color: var( --wpd-btn-bg, transparent );
		background-image: var( --wpd-btn-bg-image, none );
		background-repeat: var( --wpd-btn-bg-image-repeat, no-repeat );
		background-size: var( --wpd-btn-bg-image-size, auto );
		background-position: var( --wpd-btn-bg-image-position, center );
		color: var( --wpd-btn-color, currentColor );
		cursor: pointer;
		transition: background-color 0.15s ease, color 0.15s ease;
	}
	button:hover {
		color: var( --wpd-btn-color-hover, currentColor );
		background-color: var( --wpd-btn-bg-hover, var( --wpd-hover, rgba( 0, 0, 0, 0.06 ) ) );
	}
	button:focus-visible {
		color: var( --wpd-btn-color-hover, currentColor );
		background-color: var( --wpd-btn-bg-hover, var( --wpd-hover, rgba( 0, 0, 0, 0.06 ) ) );
		outline: 2px solid var( --wpd-btn-outline, currentColor );
		outline-offset: 1px;
	}
	:host( [ active ] ) button {
		color: var( --wpd-btn-color-hover, currentColor );
		background-color: var( --wpd-btn-bg-active, var( --wpd-hover, rgba( 0, 0, 0, 0.08 ) ) );
	}
	:host( [ danger ] ) button:hover {
		color: var( --wpd-fg-on-accent, #fff );
		background-color: var( --wpd-btn-danger-hover, var( --wpd-danger, #d63638 ) );
	}
	svg {
		display: block;
		pointer-events: none;
		flex-shrink: 0;
	}
	/*
	 * When the icon attribute is empty or unrecognised (the case
	 * for plugin-registered buttons that pass their icon via the
	 * default slot — Dashicons span / inline SVG / etc.), the
	 * shadow built-in svg stays empty. Without this rule the
	 * empty 14×14 box still occupies flex space and pushes the
	 * slot icon off-centre. The :empty pseudo matches when the
	 * element has no children, which is exactly the
	 * no-built-in-icon case.
	 */
	svg:empty {
		display: none;
	}
	/*
	 * Desktop-theme control glyph (the \`icon-src\` attribute). The
	 * image is applied as a MASK by the render method and tinted
	 * here with \`currentColor\`, so a themed close button still
	 * turns white on a focused title bar and red on danger-hover —
	 * exactly like the built-in SVGs. An \`<img>\` would paint its
	 * own colours and go deaf to every \`--wpd-btn-*\` property.
	 *
	 * The trade-off, documented for theme authors: only the source
	 * image's alpha channel is used, so control glyphs are
	 * monochrome silhouettes.
	 *
	 * A theme that names an explicit fill for the slot pushes it in
	 * through \`--wpd-btn-icon-color\`, which wins over the inherited
	 * \`currentColor\` — an opt-out of the focus tinting above, taken
	 * deliberately by the author.
	 */
	.themed-icon {
		display: block;
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		pointer-events: none;
		background-color: var( --wpd-btn-icon-color, currentColor );
	}
	/*
	 * Slot content sits as a sibling of the built-in svg inside
	 * the flex button — already centred by the parent's
	 * align-items + justify-content. We only need to make sure
	 * slotted children don't introduce their own baseline gap
	 * (block-display SVGs, line-height-1 spans).
	 *
	 * For Dashicons spans we deliberately do NOT set width /
	 * height / font-size — the WP Dashicons stylesheet already
	 * sizes them to 20×20 with line-height: 1, which is the
	 * font's natural metric. Overriding either knocks the glyph
	 * off centre.
	 *
	 * Two explicit selectors instead of slotted-wildcard — the
	 * star char inside a template literal trips the TS parser.
	 * Listing the two real cases is more readable anyway.
	 */
	::slotted( span ) {
		line-height: 1;
	}
	::slotted( svg ) {
		display: block;
	}
`;
