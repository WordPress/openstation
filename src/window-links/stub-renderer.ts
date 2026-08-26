/**
 * OpenStation — the built-in link renderer, present from boot.
 *
 * `svg-splines` registers itself as a load-time side effect of the
 * visuals bundle, and that bundle is lazy: the shell fetches it on the
 * first relation group the engine reports. Until then the registry held
 * nothing, which broke two things at once.
 *
 * The visible one was OpenStation Preferences, whose "Link style"
 * dropdown is built from the registry: it offered only `None` while the
 * stored value was still `svg-splines`, and `<os-select>` asked to show
 * a value no option carries renders blank. The other is a documented
 * contract — `listWindowLinkRenderers()` "always includes the built-in
 * `svg-splines` unless a filter removed it" — which was simply untrue
 * for any caller reading it before two windows happened to relate.
 *
 * So the METADATA registers here, in the shell, at boot: id, label and
 * description, which are three short strings. Only the drawing code
 * stays lazy. `mount` pulls the bundle in, and by the time it resolves
 * the real registration has replaced this entry (the registry is keyed
 * by id and `registerWindowLinkRenderer` overwrites), so the stub reads
 * the real def back out and delegates to it.
 *
 * The user-visible effect is unchanged: nothing is fetched until a link
 * actually needs drawing, or until someone opens the tab that lists the
 * renderers.
 */

import { __ } from '../i18n';
import { ensureWindowLinkVisuals } from './ensure-visuals';
import {
	listWindowLinkRenderers,
	registerWindowLinkRenderer,
} from './renderer-registry';
import type { WindowLinkRendererContext } from './types';

/** The id the shipped renderer registers under. */
export const BUILT_IN_LINK_RENDERER = 'svg-splines';

/**
 * Register the built-in renderer's metadata, if the real one has not
 * already arrived. Safe to call more than once.
 */
export function registerBuiltInLinkRendererStub(): void {
	if (
		listWindowLinkRenderers().some(
			( def ) => def.id === BUILT_IN_LINK_RENDERER,
		)
	) {
		return;
	}

	const stubMount = async ( ctx: WindowLinkRendererContext ) => {
		const loaded = await ensureWindowLinkVisuals();
		if ( ! loaded ) {
			return;
		}
		// The bundle's own registration has replaced this entry by now
		// — the registry is keyed by id and overwrites. Read it back
		// and hand over. Identity, not shape, decides whether the swap
		// happened: comparing against this very function means a failed
		// swap is a no-op instead of infinite recursion.
		const real = listWindowLinkRenderers().find(
			( def ) => def.id === BUILT_IN_LINK_RENDERER,
		);
		if ( ! real || real.mount === stubMount ) {
			return;
		}
		return real.mount( ctx );
	};

	registerWindowLinkRenderer( {
		id: BUILT_IN_LINK_RENDERER,
		label: __( 'Splines' ),
		description: __(
			'Curved connectors between related windows, ending in circular dots — the larger dot sits on the window the content belongs to; windows that reference each other get large dots on both ends.',
		),
		mount: stubMount,
	} );
}
