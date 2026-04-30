/**
 * Submenu-renderer section — picker bound to `state.submenuRenderer`.
 *
 * Lists every renderer registered via `wp.desktop.registerSubmenuRenderer`,
 * keyed by id. Subscribes to the registry so newly-activated plugins
 * surface their renderer immediately without an OS Settings reopen.
 *
 * Default renderer is the shipped baseline (id `'default'`); plugin
 * renderers append. The picker stays a `<wpd-segmented>` until there
 * are too many entries to fit; we'll add an overflow renderer when
 * that becomes a real complaint.
 */

import { __ } from '../../i18n';
import { html, render } from '../../ui/core';
import {
	listSubmenuRenderers,
	subscribeSubmenuRenderers,
	type SubmenuRenderer,
} from '../../submenu';
import type { SettingsCtx } from '../types';

export function buildSubmenuRendererSection(
	ctx: SettingsCtx,
): HTMLElement {
	const wrapper = document.createElement( 'div' );

	const onPick = ( e: Event ): void => {
		const id = ( ( e as CustomEvent ).detail?.value ?? '' ) as string;
		if ( id === '' ) {
			return;
		}
		ctx.state.submenuRenderer = id;
		ctx.save();
		ctx.apply();
		paint();
	};

	let renderers: SubmenuRenderer[] = listSubmenuRenderers();

	const paint = (): void =>
		render(
			html`
				<wpd-section
					heading=${ __( 'Submenu style' ) }
					description=${ __(
						'How the popover that opens when you right-click a dock item with submenu links looks. Plugins can register their own.',
					) }
				>
					<wpd-segmented
						value=${ ctx.state.submenuRenderer }
						label=${ __( 'Submenu style' ) }
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

	// Repaint when the registry changes — a plugin activation
	// mid-OS-Settings-open should surface the new renderer
	// immediately rather than wait for a reopen.
	const unsubscribe = subscribeSubmenuRenderers( () => {
		renderers = listSubmenuRenderers();
		paint();
	} );

	// Tear the subscription down when the wrapper leaves the DOM.
	// MutationObserver on the parent body — the renderPanel call
	// rebuilds the tree, so the wrapper goes from in-DOM to detached
	// each open. We sweep on detach.
	const observer = new MutationObserver( () => {
		if ( ! wrapper.isConnected ) {
			unsubscribe();
			observer.disconnect();
		}
	} );
	// Wait for the wrapper to be inserted before starting the
	// observer; until then there's no parent to observe.
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
