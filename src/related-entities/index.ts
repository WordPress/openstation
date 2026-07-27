/**
 * Desktop Mode — Related-entities title-bar button.
 *
 * Registers the built-in "Related" button through the very same
 * public surface a plugin would use (`registerTitleBarButton`). The
 * button appears only on windows whose content identity carries
 * related navigation targets — for posts/pages those are built
 * server-side (comments, assigned terms, attached media; see
 * `desktop_mode_window_related_entities_for_post()` in
 * `includes/window-links.php`) and travel with the
 * `desktop-mode-content-identity` bridge payload. Clicking an item
 * opens the target admin URL as its own desktop window.
 *
 * Developer surface: the `desktop_mode_window_related_entities` PHP
 * filter adds items for any screen; the
 * `desktop-mode.related-entities.items` JS filter
 * ({@link HOOKS.RELATED_ENTITIES_ITEMS}) rewrites the resolved list
 * per window. Both feed a single resolver used for the button's
 * `match` predicate AND the menu build, so visibility and menu
 * content can never disagree.
 */

import { addAction, applyFilters, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { registerTitleBarButton } from '../title-bar-buttons/registry';
import { getWindowContent } from '../window-links/engine';
import type { RelatedEntityItem, WindowContentRef } from '../window-links/types';
import { buildRelatedMenu } from './menu';

import type { Window as DesktopWindow } from '../window';

/**
 * The slice of a `Window` instance the repaint hook touches —
 * structural so the main-bundle boot never imports the lazy
 * window-system bundle's classes.
 */
interface RelatedEntitiesWindowLike {
	renderCustomTitleBarButtons?: () => void;
	element?: HTMLElement;
}

/**
 * The subset of the window manager the module needs — structural so
 * tests can hand in a tiny fake.
 */
interface RelatedEntitiesManager {
	getById: (
		id: string,
	) => RelatedEntitiesWindowLike | null | undefined;
}

/** Callback that opens a picked related entity as a desktop window. */
export type OpenRelatedEntity = ( item: RelatedEntityItem ) => void;

/** Well-formed check for a single filter-supplied item. */
function isValidItem( item: unknown ): item is RelatedEntityItem {
	if ( ! item || typeof item !== 'object' ) {
		return false;
	}
	const candidate = item as Record< string, unknown >;
	const requiredString = ( v: unknown ): boolean =>
		typeof v === 'string' && v.trim() !== '';
	return (
		requiredString( candidate.id ) &&
		requiredString( candidate.group ) &&
		requiredString( candidate.label ) &&
		requiredString( candidate.url ) &&
		( candidate.groupLabel === undefined ||
			typeof candidate.groupLabel === 'string' ) &&
		( candidate.icon === undefined ||
			typeof candidate.icon === 'string' ) &&
		( candidate.count === undefined ||
			( typeof candidate.count === 'number' &&
				Number.isFinite( candidate.count ) ) )
	);
}

/**
 * Resolve the related-entity items for a window: the identity's
 * server-built `related` list run through the
 * `desktop-mode.related-entities.items` filter, with malformed
 * filter output dropped item-wise (a plugin's one bad entry must not
 * hide the rest of the menu).
 *
 * @param windowId Target window id.
 * @return Well-formed items, possibly empty.
 */
export function resolveRelatedItems(
	windowId: string,
): RelatedEntityItem[] {
	const content: WindowContentRef | null =
		getWindowContent( windowId ) ?? null;
	// Shallow-copied items, NOT the live stored array: the resolver
	// runs on every repaint, and the documented filter idiom is
	// `items.push( … ); return items` — handing filters the engine's
	// stored array would make that push persist into the identity and
	// duplicate the item on every subsequent resolve.
	const base =
		content && Array.isArray( content.related )
			? content.related.map( ( item ) => ( { ...item } ) )
			: [];
	const filtered = applyFilters< RelatedEntityItem[] >(
		HOOKS.RELATED_ENTITIES_ITEMS,
		base,
		{ windowId, content },
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[desktop-mode] `desktop-mode.related-entities.items` filter ' +
					'returned a non-array; falling back to the identity list.',
			);
		}
		return base.filter( isValidItem );
	}
	return filtered.filter( isValidItem );
}

/**
 * A Related panel element with its close routine attached, so every
 * removal path (button toggle, content-change repaint, outside click)
 * runs the same teardown — including the document-level dismiss
 * listener that a bare `.remove()` would leak.
 */
type RelatedPanelElement = HTMLElement & { _wpdRelatedClose?: () => void };

/** Close any open Related panel inside a window's element. */
function closePanels( root: HTMLElement | undefined ): void {
	root
		?.querySelectorAll< RelatedPanelElement >(
			'.desktop-mode-window__related-panel',
		)
		.forEach( ( el ) => {
			if ( el._wpdRelatedClose ) {
				el._wpdRelatedClose();
			} else {
				el.remove();
			}
		} );
}

/**
 * Swallow the dblclick that a double-click's SECOND click would
 * produce right after a menu pick. The first click removes the panel,
 * so the second lands on the bare title bar — without this guard the
 * title bar's dblclick-to-maximize handler fires and the window
 * unexpectedly maximizes.
 */
function suppressNextDblclick( titleBar: HTMLElement ): void {
	const swallow = ( e: Event ): void => {
		e.stopImmediatePropagation();
	};
	titleBar.addEventListener( 'dblclick', swallow, true );
	setTimeout( () => {
		titleBar.removeEventListener( 'dblclick', swallow, true );
	}, 500 );
}

/**
 * Open the Related dropdown for a window, wiring outside-pointerdown
 * dismissal (capture phase, next microtask — same recipe as
 * `src/window/menus.ts`) and Escape-to-close returning focus to the
 * trigger.
 */
function openRelatedMenu(
	host: HTMLElement,
	win: DesktopWindow,
	openUrl: OpenRelatedEntity,
): void {
	const titleBar = host.closest< HTMLElement >(
		'.desktop-mode-window__titlebar',
	);
	if ( ! titleBar ) {
		return;
	}
	const items = resolveRelatedItems( win.id );
	if ( items.length === 0 ) {
		return;
	}

	let onDocPointerDown: ( ( e: PointerEvent ) => void ) | null = null;
	const close = (): void => {
		if ( onDocPointerDown ) {
			document.removeEventListener( 'pointerdown', onDocPointerDown, true );
			onDocPointerDown = null;
		}
		titleBar.removeEventListener( 'keydown', onTitleBarKeydown );
		panel.remove();
		host.setAttribute( 'aria-expanded', 'false' );
	};

	// Escape-to-close, bound on the TITLE BAR rather than the panel:
	// the shadow roots here don't delegate focus, so after opening the
	// menu the keyboard focus stays on the trigger button — a keydown
	// there bubbles through the title bar but never enters the sibling
	// panel. The title bar sees Escape from both the trigger and the
	// panel's items.
	const onTitleBarKeydown = ( e: Event ): void => {
		if ( ( e as KeyboardEvent ).key === 'Escape' ) {
			e.stopPropagation();
			close();
			host.focus();
		}
	};

	const panel: RelatedPanelElement = buildRelatedMenu( {
		items,
		onPick: ( item ) => {
			close();
			suppressNextDblclick( titleBar );
			openUrl( item );
		},
	} );
	panel._wpdRelatedClose = close;
	titleBar.appendChild( panel );
	titleBar.addEventListener( 'keydown', onTitleBarKeydown );
	host.setAttribute( 'aria-expanded', 'true' );

	onDocPointerDown = ( e: PointerEvent ) => {
		const target = e.target as Node | null;
		if ( ! target || panel.contains( target ) || host.contains( target ) ) {
			return;
		}
		close();
	};
	// Attach on the next microtask so the pointerdown that opened the
	// menu doesn't immediately close it.
	setTimeout( () => {
		if ( onDocPointerDown ) {
			document.addEventListener( 'pointerdown', onDocPointerDown, true );
		}
	}, 0 );

	panel.querySelector< HTMLElement >( '[role="menuitem"]' )?.focus();
}

/**
 * Register the built-in "Related" title-bar button and wire the
 * repaint-on-content-change subscription. Called once from the
 * `desktop.ts` boot after the window manager exists.
 *
 * The repaint hook is load-bearing: the title-bar-button registry
 * only repaints windows on register/unregister, but a window's
 * content identity arrives asynchronously (the chromeless bridge
 * announces it after the iframe loads, and again on every in-window
 * navigation) — without the targeted repaint the button would never
 * appear on a freshly opened post window, nor disappear when the
 * user navigates the window to a list table.
 *
 * @param opts         Options bag.
 * @param opts.manager Window manager (structural subset).
 * @param opts.openUrl Opens a picked item as a desktop window.
 */
export function bootRelatedEntities( {
	manager,
	openUrl,
}: {
	manager: RelatedEntitiesManager;
	openUrl: OpenRelatedEntity;
} ): void {
	registerTitleBarButton( {
		id: 'desktop-mode/related-entities',
		label: __( 'Related' ),
		icon: 'dashicons-networking',
		placement: 'right',
		order: 60,
		match: ( win ) => resolveRelatedItems( win.id ).length > 0,
		render: ( host, win ) => {
			// Repaints REPLACE the host element (the registry fan-out
			// fires on any title-bar-button registration, not just our
			// content-change hook) — an open panel would otherwise
			// survive with its close routine pointing at the detached
			// old host, reading as a stuck-open menu.
			closePanels( win.element );
			host.setAttribute( 'aria-haspopup', 'menu' );
			host.setAttribute( 'aria-expanded', 'false' );
			host.addEventListener( 'click', ( e: Event ) => {
				e.stopPropagation();
				const open = win.element?.querySelector(
					'.desktop-mode-window__related-panel',
				);
				if ( open ) {
					closePanels( win.element );
					return;
				}
				openRelatedMenu( host, win, openUrl );
			} );
		},
	} );

	addAction(
		HOOKS.WINDOW_CONTENT_CHANGED,
		'desktop-mode/related-entities',
		( e: { windowId?: string } ) => {
			if ( ! e?.windowId ) {
				return;
			}
			const win = manager.getById( e.windowId );
			if ( ! win ) {
				return;
			}
			// A stale open panel would list the previous content's
			// entities — drop it before the repaint decides whether the
			// button still applies.
			closePanels( win.element );
			win.renderCustomTitleBarButtons?.();
		},
	);
}
