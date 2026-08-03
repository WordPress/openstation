/**
 * Tinted-icon painting — the one place that knows how a themed fill
 * colour turns into pixels.
 *
 * Two glyph shapes, two mechanisms:
 *
 *   - **Dashicon** — a font glyph, so the tint is just `color`.
 *   - **Image** — painted as a CSS MASK filled with the tint, not as
 *     an `<img>`. Only the source's alpha channel survives, which is
 *     precisely the point: a monochrome iconset drawn in black is
 *     invisible on a dark dock as an image and perfect as a mask.
 *
 * `currentColor` is the interesting tint value. It resolves against
 * whatever the surface is already using for text, so one silhouette
 * set stays legible on a dark dock, a light title bar, and a red
 * danger-hover without the theme author naming any of them.
 *
 * The mask URL is interpolated into a CSS `url("…")`, so it is
 * re-validated here even though PHP already checked it — same
 * reasoning (and same character set) as `sanitizeIconSrc` in
 * `<os-window-button>`.
 */

/**
 * Whether a resolved icon value is safe to interpolate into a CSS
 * `url("…")`.
 *
 * The scheme allowlist is the security floor. The character denylist
 * is what makes the interpolation itself safe: with no quote, paren,
 * backslash, angle bracket or whitespace, the value cannot close the
 * string it lands in.
 *
 * @internal
 */
export function isMaskableIcon( icon: string ): boolean {
	if ( typeof icon !== 'string' || icon === '' || icon.length > 4096 ) {
		return false;
	}
	if ( ! /^(https?:\/\/|data:image\/)/i.test( icon ) ) {
		return false;
	}
	return ! /['"()\\<>\s]/.test( icon );
}

/**
 * Paint an image icon as a tinted mask onto an element.
 *
 * The caller owns sizing — this sets the mask, the fill, and nothing
 * that would fight the surrounding layout. `background-image` is
 * explicitly cleared so an element that previously carried one (the
 * dock's SVG-data-URI branch reuses the same span shape) can't show
 * through the mask.
 *
 * @public
 *
 * @param el    Element to paint on.
 * @param icon  Absolute URL or `data:` URI. Must pass {@link isMaskableIcon}.
 * @param color CSS colour, or `currentColor`.
 * @return `true` when the mask was applied.
 */
export function applyIconMask(
	el: HTMLElement,
	icon: string,
	color: string,
): boolean {
	if ( ! isMaskableIcon( icon ) ) {
		return false;
	}
	const mask = `url("${ icon }") center / contain no-repeat`;
	el.style.backgroundImage = 'none';
	el.style.backgroundColor = color;
	el.style.setProperty( '-webkit-mask', mask );
	el.style.setProperty( 'mask', mask );
	return true;
}
