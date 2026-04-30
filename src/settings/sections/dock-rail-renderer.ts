/**
 * Dock-rail-renderer section — picker bound to `state.dockRailRenderer`.
 *
 * Lists every renderer registered via
 * `wp.desktop.registerDockRailRenderer`, keyed by id. Subscribes to
 * the registry so newly-activated plugins surface their renderer
 * immediately without an OS Settings reopen.
 *
 * Default renderer is the shipped icon-strip (`id: 'default'`);
 * plugin renderers append. Same `<wpd-segmented>` shape as the
 * submenu picker so the two read as a pair.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import {
	listDockRailRenderers,
	subscribeDockRailRenderers,
	type DockRailRenderer,
} from '../../dock-rail';
import type { SettingsCtx } from '../types';

export function buildDockRailRendererSection(
	ctx: SettingsCtx,
): HTMLElement {
	const wrapper = document.createElement( 'div' );

	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( id === '' ) {
			return;
		}
		ctx.state.dockRailRenderer = id;
		ctx.save();
		ctx.apply();
		paint();
	};

	let renderers: DockRailRenderer[] = listDockRailRenderers();

	const paint = (): void => {
		// Hide the picker entirely when there's only the shipped
		// default — a one-pill segmented control adds noise without
		// giving the user a real choice. Plugins that register a
		// renderer flip the count > 1 and the picker materializes
		// live (the registry-subscribe below repaints).
		if ( renderers.length <= 1 ) {
			render( html``, wrapper );
			return;
		}
		render(
			html`
				<wpd-section
					heading=${ __( 'Dock style' ) }
					description=${ __(
						'How the rail itself paints — the shipped icon strip, or anything a plugin replaces it with. Switching is instant; the dock rebuilds with the new renderer.',
					) }
				>
					<wpd-segmented
						value=${ ctx.state.dockRailRenderer }
						label=${ __( 'Dock style' ) }
						@wpd-pick=${ onPick }
					>
						${ renderers.map(
							( r ) => html`<wpd-segment value=${ r.id }
									>${ r.label }</wpd-segment
								>`,
						) }
					</wpd-segmented>
				</wpd-section>
			`,
			wrapper,
		);
	};

	const unsubscribe = subscribeDockRailRenderers( () => {
		renderers = listDockRailRenderers();
		paint();
	} );

	const observer = new MutationObserver( () => {
		if ( ! wrapper.isConnected ) {
			unsubscribe();
			observer.disconnect();
		}
	} );
	queueMicrotask( () => {
		if ( wrapper.parentNode ) {
			observer.observe( wrapper.parentNode, {
				childList: true,
				subtree: false,
			} );
		}
	} );

	paint();
	return wrapper;
}
