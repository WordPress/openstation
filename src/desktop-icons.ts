import { activity } from './activity';
import { findMenuEntryForUrl } from './desktop-files/menu-entry';
import { tryOpenExternalUrl } from './external-url';
import { __, _n, sprintf } from './i18n';
import { doAction, HOOKS } from './hooks';
import { renderIcon } from './icon';
import { getActiveDesktopThemeId } from './desktop-themes/registry';
import { slotForTileId } from './desktop-themes/slots';
import { openItemVisibilityMenu } from './item-visibility-menu-loader';
import type { DesktopIconServerEntry } from './types';
import type { WindowManager } from './window-manager';

export interface DesktopIconRenderDeps {

	openWindow: ( id: string ) => boolean;

	manager: WindowManager;

	deriveWindowId: ( url: string ) => string;
}

const BADGE_CLASS = 'os-icon__badge';
const _badges = new Map< string, number >();
const _art = new Map< string, string >();

function _safeBadge( count: number ): number {
	return Math.max( 0, Math.floor( Number( count ) || 0 ) );
}

export function setIconBadge( iconId: string, count: number ): void {
	if ( ! iconId ) {
		return;
	}
	const tile = _findIconTile( iconId );
	if ( ! tile ) {
		return;
	}
	const safe = _safeBadge( count );
	const previous = _badges.get( iconId ) ?? 0;
	if ( safe === previous ) {
		return;
	}
	if ( safe === 0 ) {
		_badges.delete( iconId );
	} else {
		_badges.set( iconId, safe );
	}
	_paintBadgeNode( tile, safe );
	activity.publish( 'os/badge-changed', {
		itemId: iconId,
		count: safe,
		rail: 'icon',
	} );
	doAction( HOOKS.ICON_BADGE_CHANGED, {
		iconId,
		count: safe,
		previousCount: previous,
	} );
}

export function clearIconBadge( iconId: string ): void {
	setIconBadge( iconId, 0 );
}

export function getIconBadge( iconId: string ): number {
	return _badges.get( iconId ) ?? 0;
}

export function setIconArt( iconId: string, svg: string ): void {
	if ( ! iconId ) {
		return;
	}
	if ( ! svg ) {
		_art.delete( iconId );
		return;
	}
	if ( _art.get( iconId ) === svg ) {
		return;
	}
	_art.set( iconId, svg );
	_paintArtNodes( iconId, svg );
	activity.publish( 'os/art-changed', {
		itemId: iconId,
		icon: svg,
		rail: 'icon',
	} );
}

export function getIconArt( iconId: string ): string {
	return _art.get( iconId ) ?? '';
}

function _escapeAttr( value: string ): string {
	if ( typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ) {
		return CSS.escape( value );
	}
	return value.replace( /["\\]/g, '\\$&' );
}

function _paintArtNodes( iconId: string, svg: string ): void {
	const tile = _findIconTile( iconId );
	const img = tile?.querySelector< HTMLElement >( '.os-icon__image' );
	if ( img ) {
		const next = renderIcon( svg, {
			className: 'os-icon__image',
			title: '',
		} );
		img.replaceWith( next );
	}

	document
		.querySelectorAll< HTMLElement >(
			`os-tile[data-file-ref="${ _escapeAttr( iconId ) }"]`,
		)
		.forEach( ( el ) => el.setAttribute( 'icon', svg ) );
}

export function _resetIconArtForTests(): void {
	_art.clear();
}

export function _resetIconBadgesForTests(): void {
	_badges.clear();
	_lastFingerprint = '';
}

export interface IconsApi {
	setBadge: ( iconId: string, count: number ) => void;
	clearBadge: ( iconId: string ) => void;
	getBadge: ( iconId: string ) => number;
	setArt: ( iconId: string, svg: string ) => void;
	getArt: ( iconId: string ) => string;
}

export const iconsApi: IconsApi = {
	setBadge: setIconBadge,
	clearBadge: clearIconBadge,
	getBadge: getIconBadge,
	setArt: setIconArt,
	getArt: getIconArt,
};

function fingerprintIcons(
	icons: readonly DesktopIconServerEntry[] | undefined,
): string {
	if ( ! icons || icons.length === 0 ) {
		return '';
	}

	const themePrefix = `${ getActiveDesktopThemeId() ?? '' }::`;
	return themePrefix + icons
		.map(
			( i ) =>
				`${ i.id }|${ i.title }|${ i.icon }|${ i.window ?? '' }|${
					i.url ?? ''
				}|${ i.position ?? 0 }|${ i.pinned ? 1 : 0 }`,
		)
		.join( ';' );
}

let _lastFingerprint = '';

export function renderDesktopIcons(
	host: HTMLElement,
	icons: readonly DesktopIconServerEntry[] | undefined,
	deps: DesktopIconRenderDeps,
): void {
	const fp = fingerprintIcons( icons );
	if ( fp === _lastFingerprint && host.querySelector( ':scope > .os-icons' ) ) {
		return;
	}
	_lastFingerprint = fp;

	const existing = host.querySelector( ':scope > .os-icons' );
	if ( existing ) {
		existing.remove();
	}
	if ( ! icons || icons.length === 0 ) {
		return;
	}

	const container = document.createElement( 'div' );
	container.className = 'os-icons';
	container.setAttribute( 'role', 'list' );
	container.setAttribute( 'aria-label', __( 'Desktop icons' ) );

	const ordered = [ ...icons ].sort( ( a, b ) => {
		const ap = a.pinned ? 0 : 1;
		const bp = b.pinned ? 0 : 1;
		return ap - bp;
	} );

	const tiles = new Map< string, HTMLElement >();
	for ( const entry of ordered ) {
		const tile = buildIcon( entry, deps );
		const stored = _badges.get( entry.id ) ?? 0;
		if ( stored > 0 ) {
			_paintBadgeNode( tile, stored );
		}
		const storedArt = _art.get( entry.id );
		if ( storedArt ) {
			const img = tile.querySelector< HTMLElement >(
				'.os-icon__image',
			);
			if ( img ) {
				img.replaceWith(
					renderIcon( storedArt, {
						className: 'os-icon__image',
						title: '',
					} ),
				);
			}
		}
		container.appendChild( tile );
		tiles.set( entry.id, tile );
	}

	host.appendChild( container );

	doAction( HOOKS.DESKTOP_ICONS_RENDERED, {
		ids: ( icons ?? [] ).map( ( i ) => i.id ),
		container,
		tiles: tiles as ReadonlyMap< string, HTMLElement >,
	} );
}

function _findIconTile( iconId: string ): HTMLElement | null {
	if ( ! iconId ) {
		return null;
	}
	const container = document.querySelector< HTMLElement >(
		'.os-icons',
	);
	if ( ! container ) {
		return null;
	}
	return container.querySelector< HTMLElement >(
		`[data-icon-id="${ _cssEscape( iconId ) }"]`,
	);
}

function _paintBadgeNode( host: HTMLElement, count: number ): void {
	const existing = host.querySelector< HTMLElement >(
		`:scope > .${ BADGE_CLASS }`,
	);
	if ( count <= 0 ) {
		existing?.remove();
		return;
	}
	const display = count > 99 ? '99+' : String( count );
	const ariaLabel = sprintf(

		_n( '%d notification', '%d notifications', count ),
		count,
	);
	if ( existing ) {
		if ( existing.textContent !== display ) {
			existing.textContent = display;
		}
		existing.setAttribute( 'aria-label', ariaLabel );
		return;
	}
	const badge = document.createElement( 'span' );
	badge.className = BADGE_CLASS;
	badge.textContent = display;
	badge.setAttribute( 'aria-label', ariaLabel );
	host.appendChild( badge );
}

function _cssEscape( value: string ): string {
	const c = (
		window as unknown as {
			CSS?: { escape?: ( s: string ) => string };
		}
	).CSS;
	return c?.escape ? c.escape( value ) : value;
}

function buildIcon(
	entry: DesktopIconServerEntry,
	deps: DesktopIconRenderDeps,
): HTMLElement {
	const tile = document.createElement( 'button' );
	tile.type = 'button';
	tile.className = entry.pinned
		? 'os-icon os-icon--pinned'
		: 'os-icon';
	tile.dataset.iconId = entry.id;
	if ( entry.pinned ) {
		tile.dataset.pinned = '1';
	}
	tile.setAttribute( 'role', 'listitem' );
	tile.setAttribute( 'aria-label', entry.title );

	const icon = renderIcon( entry.icon, {
		title: entry.title,
		className: 'os-icon__image',
		slot: slotForTileId( entry.id ),
	} );
	tile.appendChild( icon );

	const label = document.createElement( 'span' );
	label.className = 'os-icon__label';
	label.textContent = entry.title;
	tile.appendChild( label );

	tile.addEventListener( 'click', ( e: MouseEvent ) => {
		e.stopPropagation();
		doAction( HOOKS.DESKTOP_ICON_CLICKED, {
			id: entry.id,
			target: entry.window ? 'window' : 'url',
		} );
		openTarget( entry, deps );
	} );

	tile.addEventListener( 'contextmenu', ( e: MouseEvent ) => {
		if ( entry.pinned ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		openItemVisibilityMenu( {
			x: e.clientX,
			y: e.clientY,
			id: entry.id,
			title: entry.title,
			surface: 'desktop',
		} );
	} );

	return tile;
}

function openTarget(
	entry: DesktopIconServerEntry,
	deps: DesktopIconRenderDeps,
): void {
	if ( entry.window ) {
		const opened = deps.openWindow( entry.window );
		if ( ! opened ) {
			return;
		}
		return;
	}
	if ( entry.url ) {
		if ( tryOpenExternalUrl( entry.url ) ) {
			return;
		}
		try {
			const parsed = new URL( entry.url, window.location.origin );

			const windowId = deps.deriveWindowId( parsed.toString() );

			const menuEntry = findMenuEntryForUrl( parsed.toString() );
			void deps.manager.open( {
				id: windowId,
				baseId: windowId,
				url: parsed.toString(),
				parentUrl: menuEntry?.url ?? parsed.toString(),
				title: entry.title,
				icon: entry.icon,
				submenu: menuEntry?.submenu,
				selfLabel: menuEntry?.selfLabel,
				multi: !! menuEntry?.multi,
			} );
		} catch {

		}
	}
}
