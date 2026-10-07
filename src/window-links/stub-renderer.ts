import { __ } from '../i18n';
import { ensureWindowLinkVisuals } from './ensure-visuals';
import {
	listWindowLinkRenderers,
	registerWindowLinkRenderer,
} from './renderer-registry';
import type { WindowLinkRendererContext } from './types';

export const BUILT_IN_LINK_RENDERER = 'svg-splines';

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
