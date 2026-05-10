/**
 * Native Plugins window — drag plugin cards to the dock to pin.
 *
 * Wires every card element as a drag source for the framework's
 * `wp.desktop.dragManager`. Payload type is `'wporg-plugin'` so any
 * plugin author can register their own drop targets that accept it.
 *
 * Drop targets we install:
 *
 *   - `dock` — calls `wp.desktop.registerSystemTile()` to create a
 *     transient dock entry that opens a window to the plugin's
 *     wp.org page. Lives for the session; not persisted.
 *
 * Wallpaper drop (creating a desktop icon) is deferred to a
 * follow-up — needs a server-side persistence path that doesn't yet
 * exist for client-only icons.
 *
 * @public
 * @since 0.9.0
 */

import { __, sprintf } from '../i18n';
import { pickIcon } from './card';
import type { WpOrgBrowsePlugin } from './types';

interface SystemTileShape {
	id: string;
	title: string;
	icon?: string;
	url?: string;
}

interface DragManagerLite {
	start( opts: {
		payload: {
			type: string;
			source: HTMLElement;
			data: Record< string, unknown >;
			ghost?: { offsetX: number; offsetY: number; element?: HTMLElement };
		};
		origin: PointerEvent;
		onClickOnly?: () => void;
	} ): { isFinished(): boolean } | null;
	registerDropTarget( target: {
		id: string;
		element: HTMLElement;
		accept: ( payload: { type: string } ) => boolean;
		onEnter?: () => void;
		onLeave?: () => void;
		onDrop: ( session: { payload: { data: Record< string, unknown > } } ) => void;
	} ): () => void;
}

interface DesktopApi {
	dragManager?: DragManagerLite;
	registerSystemTile?: ( tile: SystemTileShape ) => void;
	showToast?: ( opts: { message: string; duration?: number } ) => void;
}

function api(): DesktopApi | null {
	return ( window.wp?.desktop ?? null ) as DesktopApi | null;
}

/**
 * Mark a plugin card element as a drag source. Must be called for
 * every card that's added to the gallery. Idempotent — safe to call
 * twice on the same element.
 */
export function makeCardDraggable(
	card: HTMLElement,
	plugin: WpOrgBrowsePlugin,
): void {
	if ( card.dataset.dragWired === '1' ) {
		return;
	}
	card.dataset.dragWired = '1';

	card.addEventListener( 'pointerdown', ( ev: PointerEvent ) => {
		const desktop = api();
		const manager = desktop?.dragManager;
		if ( ! manager ) {
			return;
		}
		// Don't escalate when the user clicked the CTA — they're
		// triggering an action, not starting a drag.
		const t = ev.target as HTMLElement | null;
		if ( t?.closest( '[data-plugin-card-cta]' ) ) {
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
 * Install the framework drop targets that accept `wporg-plugin`
 * payloads. Returns a teardown that removes every registered target.
 *
 * Currently: dock (pin a system tile). Wallpaper deferred.
 */
export function installPluginDropTargets(): () => void {
	const desktop = api();
	const manager = desktop?.dragManager;
	if ( ! manager ) {
		return () => {};
	}

	const teardowns: Array< () => void > = [];

	const dock = findDockElement();
	if ( dock ) {
		const off = manager.registerDropTarget( {
			id: 'desktop-mode-plugins-window/dock',
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
				const data = session.payload.data;
				const slug = String( data.slug ?? '' );
				if ( ! slug ) {
					return;
				}
				const name = String( data.name ?? slug );
				const icon = typeof data.iconUrl === 'string' && data.iconUrl
					? data.iconUrl
					: 'dashicons-admin-plugins';
				const homepage = String( data.homepage ?? '' );
				const url = homepage !== ''
					? homepage
					: `https://wordpress.org/plugins/${ encodeURIComponent( slug ) }/`;

				if ( typeof desktop?.registerSystemTile === 'function' ) {
					desktop.registerSystemTile( {
						id: `wporg-plugin-${ slug }`,
						title: name,
						icon,
						url,
					} );
				}
				if ( typeof desktop?.showToast === 'function' ) {
					desktop.showToast( {
						message: sprintf(
							/* translators: %s: plugin name */
							__( 'Pinned %s to the dock.', 'desktop-mode' ),
							name,
						),
						duration: 3500,
					} );
				}
			},
		} );
		teardowns.push( off );
	}

	return () => {
		for ( const off of teardowns ) {
			try {
				off();
			} catch {
				/* best-effort cleanup */
			}
		}
	};
}

function findDockElement(): HTMLElement | null {
	// Match the canonical dock root selectors used by `dock-rail-renderer`
	// and `bottomDock` paint. Order matters — bottom dock first because
	// it's on top in the spatial layout.
	return (
		document.querySelector< HTMLElement >( '.desktop-mode-bottom-dock' ) ??
		document.querySelector< HTMLElement >( '.desktop-mode-dock' ) ??
		document.querySelector< HTMLElement >( '[data-desktop-mode-dock]' )
	);
}

function buildGhost(
	plugin: WpOrgBrowsePlugin,
	card: HTMLElement,
	origin: PointerEvent,
): { offsetX: number; offsetY: number; element?: HTMLElement } {
	const rect = card.getBoundingClientRect();
	const offsetX = origin.clientX - rect.left;
	const offsetY = origin.clientY - rect.top;

	const ghost = document.createElement( 'div' );
	ghost.className = 'desktop-mode-plugins__drag-ghost';
	const iconUrl = pickIcon( plugin.icons );
	if ( iconUrl ) {
		const img = document.createElement( 'img' );
		img.src = iconUrl;
		img.alt = '';
		ghost.appendChild( img );
	} else {
		const fallback = document.createElement( 'span' );
		fallback.className =
			'dashicons dashicons-admin-plugins desktop-mode-plugins__drag-ghost-fallback';
		ghost.appendChild( fallback );
	}
	const label = document.createElement( 'span' );
	label.textContent = plugin.name;
	ghost.appendChild( label );
	return { offsetX, offsetY, element: ghost };
}

function stripHtml( html: string ): string {
	const tmp = document.createElement( 'div' );
	tmp.innerHTML = html;
	return tmp.textContent ?? '';
}
