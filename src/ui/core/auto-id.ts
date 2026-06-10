/**
 * Deterministic auto-id generation for form controls.
 *
 * Plugin authors expect form primitives (`<wpd-text-field>`,
 * `<wpd-select>`, `<wpd-number-field>`) to ship stable, predictable
 * `id` attributes — for `<label for>` pairing inside the shadow
 * root, for `document.querySelector` reuse across renders, and for
 * devtools inspection. Hand-typing `id` on every control is the
 * drudge-work the kit exists to eliminate.
 *
 * {@link computeAutoId} walks up the element's ancestry collecting
 * context tokens and joins them into a slug:
 *
 *   1. Native-window id — found via the nearest ancestor whose
 *      `id` starts with `wp-window-` (the shell's window-root
 *      naming convention).
 *   2. Tabpanel context — each enclosing `<wpd-tabpanel for="X">`
 *      contributes a `tab-X` token, outermost first.
 *   3. The element's own `label` attribute, slugified.
 *
 * Combined as `wpd-<window>-<tab…>-<label>`. Deterministic: same
 * ancestry + same label yields the same id across renders. Unique
 * within a page as long as any two controls either live in
 * different tab panes or carry different labels — which is the
 * common form-design case.
 *
 * Controls that live outside a native window (or whose plugin
 * author passed an explicit `id`) are left alone — the function is
 * opt-in per component via a connected-callback check.
 *
 * @since 0.5.0
 */

/**
 * Compute the deterministic auto-id for an element based on its
 * ancestry + `label` attribute. Returns `'wpd-unnamed'` as a last
 * resort so the shell never produces an empty id.
 *
 * @param element The element requesting an auto-id.
 * @return Deterministic slug id.
 */
export function computeAutoId( element: HTMLElement ): string {
	const parts: string[] = [];
	const tabs: string[] = [];
	let windowId: string | null = null;

	// Walk the DOM up from the element, stopping once we hit a
	// native-window root (the outermost context we care about) or
	// run out of ancestors.
	let node: Element | null = element.parentElement;
	while ( node ) {
		if ( node === document.body || node === document.documentElement ) {
			break;
		}
		const id = node.id || '';
		if ( id.startsWith( 'wp-window-' ) ) {
			windowId = id.slice( 'wp-window-'.length );
			break;
		}
		// Tabpanels may be nested (a tabbed pane inside a tab).
		// Collect in reverse order so the outermost tab comes first
		// in the slug — matches the "window → outer tab → inner
		// tab → label" reading order.
		if ( node.tagName.toLowerCase() === 'wpd-tabpanel' ) {
			const forValue = node.getAttribute( 'for' );
			if ( forValue ) {
				tabs.unshift( forValue );
			}
		}
		node = node.parentElement;
	}

	if ( windowId ) {
		parts.push( slugify( windowId ) );
	}
	for ( const tab of tabs ) {
		parts.push( 'tab-' + slugify( tab ) );
	}
	const label = element.getAttribute( 'label' );
	if ( label ) {
		parts.push( slugify( label ) );
	}

	if ( parts.length === 0 ) {
		return 'wpd-unnamed';
	}
	return 'wpd-' + parts.filter( ( p ) => p !== '' ).join( '-' );
}

/**
 * Slugify a string to kebab-case `[a-z0-9-]+`. Collapses
 * consecutive non-alphanumerics to a single hyphen and trims
 * leading/trailing hyphens. Empty input returns empty string.
 */
function slugify( s: string ): string {
	return s
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

/**
 * Assign an auto-id to the host element if it doesn't already
 * carry one. Idempotent — a second call with the same ancestry
 * is a no-op (id already set). Stable across disconnect/reconnect
 * cycles because the computation only reads the DOM, never
 * generates a counter.
 *
 * Returns the resolved id so callers can derive inner-control
 * ids (e.g. `${hostId}__input` for `<label for>` pairing).
 *
 * @param element Component host element.
 * @return The id now present on the host.
 */
export function ensureAutoId( element: HTMLElement ): string {
	if ( element.id ) {
		return element.id;
	}
	const id = computeAutoId( element );
	element.id = id;
	return id;
}
