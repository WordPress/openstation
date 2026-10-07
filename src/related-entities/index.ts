import { addAction, applyFilters, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { registerTitleBarButton } from '../title-bar-buttons/registry';
import { getWindowContent } from '../window-links/engine';
import type { RelatedEntityItem, WindowContentRef } from '../window-links/types';
import { buildRelatedMenu } from './menu';

import type { Window as DesktopWindow } from '../window';

interface RelatedEntitiesWindowLike {
	renderCustomTitleBarButtons?: () => void;
	element?: HTMLElement;
}

interface RelatedEntitiesManager {
	getById: (
		id: string,
	) => RelatedEntitiesWindowLike | null | undefined;
}

export type OpenRelatedEntity = ( item: RelatedEntityItem ) => void;

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

		( requiredString( candidate.url ) ||
			requiredString( candidate.windowId ) ) &&
		( candidate.url === undefined ||
			typeof candidate.url === 'string' ) &&
		( candidate.windowId === undefined ||
			typeof candidate.windowId === 'string' ) &&
		( candidate.params === undefined ||
			( !! candidate.params && typeof candidate.params === 'object' ) ) &&
		( candidate.groupLabel === undefined ||
			typeof candidate.groupLabel === 'string' ) &&
		( candidate.icon === undefined ||
			typeof candidate.icon === 'string' ) &&
		( candidate.count === undefined ||
			( typeof candidate.count === 'number' &&
				Number.isFinite( candidate.count ) ) )
	);
}

export function resolveRelatedItems(
	windowId: string,
): RelatedEntityItem[] {
	const content: WindowContentRef | null =
		getWindowContent( windowId ) ?? null;

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
				'[openstation] `os.related-entities.items` filter ' +
					'returned a non-array; falling back to the identity list.',
			);
		}
		return base.filter( isValidItem );
	}
	return filtered.filter( isValidItem );
}

type RelatedPanelElement = HTMLElement & { _wpdRelatedClose?: () => void };

function closePanels( root: HTMLElement | undefined ): void {
	root
		?.querySelectorAll< RelatedPanelElement >(
			'.os-window__related-panel',
		)
		.forEach( ( el ) => {
			if ( el._wpdRelatedClose ) {
				el._wpdRelatedClose();
			} else {
				el.remove();
			}
		} );
}

function suppressNextDblclick( titleBar: HTMLElement ): void {
	const swallow = ( e: Event ): void => {
		e.stopImmediatePropagation();
	};
	titleBar.addEventListener( 'dblclick', swallow, true );
	setTimeout( () => {
		titleBar.removeEventListener( 'dblclick', swallow, true );
	}, 500 );
}

function openRelatedMenu(
	host: HTMLElement,
	win: DesktopWindow,
	openUrl: OpenRelatedEntity,
): void {
	const titleBar = host.closest< HTMLElement >(
		'.os-window__titlebar',
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

	setTimeout( () => {
		if ( onDocPointerDown ) {
			document.addEventListener( 'pointerdown', onDocPointerDown, true );
		}
	}, 0 );

	panel.querySelector< HTMLElement >( '[role="menuitem"]' )?.focus();
}

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
			closePanels( win.element );
			host.setAttribute( 'aria-haspopup', 'menu' );
			host.setAttribute( 'aria-expanded', 'false' );
			host.addEventListener( 'click', ( e: Event ) => {
				e.stopPropagation();
				const open = win.element?.querySelector(
					'.os-window__related-panel',
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

			closePanels( win.element );
			win.renderCustomTitleBarButtons?.();
		},
	);
}
