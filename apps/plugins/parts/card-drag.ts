/**
 * Plugins app — drag a plugin card to the dock to pin it.
 *
 * Part of the `desktop-mode-plugins` client view. Wires every card as
 * a drag source for the framework's `wp.os.dragManager`. Payload type
 * is `'wporg-plugin'`, so any plugin author can register their own
 * drop targets that accept it. The one target installed here is the
 * dock: `wp.os.registerSystemTile()` creates a transient tile opening
 * the plugin's wp.org page (session-only, not persisted).
 *
 * @public
 */

import { __, sprintf } from '@openstation/app';
import { pickIcon } from './card';
import { stripHtml, type WpOrgBrowsePlugin } from './types';

/**
 * Mark a card element as a drag source. Idempotent.
 */
export function makeCardDraggable( card: HTMLElement, plugin: WpOrgBrowsePlugin ): void {
	if ( card.dataset.dragWired === '1' ) {
		return;
	}
	card.dataset.dragWired = '1';

	card.addEventListener( 'pointerdown', ( ev: PointerEvent ) => {
		const manager = window.wp?.os?.dragManager;
		if ( ! manager ) {
			return;
		}
		// The CTA is an action, not the start of a drag.
		if ( ( ev.target as HTMLElement | null )?.closest( '[data-plugin-card-cta]' ) ) {
			return;
		}
		manager.start( {
			payload: {
				type: 'wporg-plugin',
				source: card,
				data: {
					slug: plugin.slug,
					name: plugin.name,
					iconUrl: pickIcon( plugin.icons ) ?? null,
					homepage: plugin.homepage ?? '',
					authorName: stripHtml( plugin.author ?? '' ),
					shortDescription: plugin.short_description ?? '',
				},
				ghost: buildGhost( plugin, card, ev ),
			},
			origin: ev,
			onClickOnly: () => {
				/* The card's own click handler runs; nothing to do. */
			},
		} );
	} );
}

/**
 * Install the drop targets that accept `wporg-plugin` payloads.
 * Returns a teardown that removes every registered target.
 */
export function installPluginDropTargets(): () => void {
	const desktop = window.wp?.os;
	const manager = desktop?.dragManager;
	const dock = findDockElement();
	if ( ! desktop || ! manager || ! dock ) {
		return () => {};
	}

	const off = manager.registerDropTarget( {
		id: 'os-plugins-window/dock',
		element: dock,
		accept: ( p ) => p.type === 'wporg-plugin',
		onEnter: () => {
			dock.setAttribute( 'data-plugins-card-drop-active', '' );
		},
		onLeave: () => {
			dock.removeAttribute( 'data-plugins-card-drop-active' );
		},
		onDrop: ( session ) => {
			dock.removeAttribute( 'data-plugins-card-drop-active' );
			const data = session.payload.data as Record< string, unknown >;
			const slug = String( data.slug ?? '' );
			if ( ! slug ) {
				return;
			}
			const name = String( data.name ?? slug );
			const icon =
				typeof data.iconUrl === 'string' && data.iconUrl ? data.iconUrl : 'dashicons-admin-plugins';
			const homepage = String( data.homepage ?? '' );
			const url = homepage !== '' ? homepage : `https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/`;
			desktop.registerSystemTile( {
				id: `wporg-plugin-${ slug }`,
				title: name,
				icon,
				onOpen: () => {
					window.open( url, '_blank', 'noopener,noreferrer' );
				},
			} );
			desktop.showToast( {
				message: sprintf(
					/* translators: %s: plugin name */
					__( 'Pinned %s to the dock.', 'desktop-mode' ),
					name,
				),
				duration: 3500,
			} );
		},
	} );

	return () => {
		try {
			off();
		} catch {
			/* best-effort cleanup */
		}
	};
}

function findDockElement(): HTMLElement | null {
	// Bottom dock first because it paints on top.
	return (
		document.querySelector< HTMLElement >( '.os-bottom-dock' ) ??
		document.querySelector< HTMLElement >( '.os-dock' ) ??
		document.querySelector< HTMLElement >( '[data-os-dock]' )
	);
}

function buildGhost(
	plugin: WpOrgBrowsePlugin,
	card: HTMLElement,
	origin: PointerEvent,
): { offsetX: number; offsetY: number; element?: HTMLElement } {
	const rect = card.getBoundingClientRect();
	const ghost = document.createElement( 'div' );
	ghost.className = 'os-plugins__drag-ghost';
	const iconUrl = pickIcon( plugin.icons );
	if ( iconUrl ) {
		const img = document.createElement( 'img' );
		img.src = iconUrl;
		img.alt = '';
		ghost.appendChild( img );
	} else {
		const fallback = document.createElement( 'span' );
		fallback.className = 'dashicons dashicons-admin-plugins os-plugins__drag-ghost-fallback';
		ghost.appendChild( fallback );
	}
	const label = document.createElement( 'span' );
	label.textContent = plugin.name;
	ghost.appendChild( label );
	return { offsetX: origin.clientX - rect.left, offsetY: origin.clientY - rect.top, element: ghost };
}
