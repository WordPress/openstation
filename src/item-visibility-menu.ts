import { __, sprintf } from './i18n';
import { restErrorFromResponse } from './core/api-client';
import { toastRestFailure } from './core/rest-failure';
import { openWithShellOverlays } from './shell-overlays/loader';
import { ITEM_MENU_OPENING_EVENT } from './item-visibility-menu-events';
import {
	findNavItem,
	onDesktop,
	onRail,
	railFor,
	readNavConfig,
	resolvePlacement,
	setPlacement,
	setRegion,
	type NavItem,
	type NavLayout,
	type NavRail,
} from './nav';
import { osConfirm } from './ui/components/os-confirm-dialog/os-confirm-dialog';
import { placeAfterRender } from './ui/util/menu-position';
import { trackedFetch } from './tracked-fetch';
import { showToast } from './toast';
import { joinRestUrl } from './rest-url';

interface OpenStationShim {
	getOsSettings?: () => { desktopLayout?: NavLayout; mioShowOnWallpaper?: boolean };
	updateOsSettings?: ( patch: { mioShowOnWallpaper: boolean } ) => void;
	openOsSettings?: ( opts?: { tabId?: string } ) => void;
}

function getApi(): OpenStationShim | null {
	const w = window as unknown as { wp?: { os?: OpenStationShim } };
	return w.wp?.os ?? null;
}

let activeMenu: HTMLElement | null = null;

function closeMenu(): void {
	if ( activeMenu ) {
		activeMenu.remove();
		activeMenu = null;
	}
}

function railForItem( item: NavItem ): NavRail {
	const layout = getApi()?.getOsSettings?.().desktopLayout ?? 'unified';
	return railFor( item.kind, layout );
}

function railName( rail: NavRail ): string {
	return 'sidebar' === rail ? __( 'sidebar' ) : __( 'dock' );
}

export interface OpenItemVisibilityMenuOpts {

	x: number;
	y: number;

	id: string;

	title: string;

	surface: 'dock' | 'desktop';

	pluginFile?: string | null;

	pluginName?: string | null;
}

let openGeneration = 0;

export { ITEM_MENU_OPENING_EVENT } from './item-visibility-menu-events';

export function openItemVisibilityMenu(
	opts: OpenItemVisibilityMenuOpts,
): void {
	document.dispatchEvent(
		new CustomEvent( ITEM_MENU_OPENING_EVENT, {
			detail: { id: opts.id, surface: opts.surface },
		} ),
	);
	closeMenu();
	const myGen = ++openGeneration;
	openWithShellOverlays(
		() => myGen === openGeneration,
		() => openItemVisibilityMenuImmediate( opts ),
	);
}

function openItemVisibilityMenuImmediate(
	opts: OpenItemVisibilityMenuOpts,
): void {
	closeMenu();

	const item = findNavItem( opts.id );

	if ( ! item || item.locked || item.transient ) {
		return;
	}

	const placement = resolvePlacement( item, readNavConfig().placement );
	const rail = railForItem( item );
	const railWord = railName( rail );

	type MenuOption =
		| {
				kind?: 'option';
				id: string;
				label: string;
				icon?: string;
				danger?: boolean;
				onPick: () => void;
			}
		| { kind: 'separator' };

	const options: MenuOption[] = [];

	if ( item.id === 'os-mio-toggle' ) {
		const shown = getApi()?.getOsSettings?.().mioShowOnWallpaper !== false;
		options.push( {
			id: 'mio-wallpaper',
			label: shown ? __( 'Hide MIO on wallpaper' ) : __( 'Show MIO on wallpaper' ),
			icon: shown ? 'dashicons-hidden' : 'dashicons-visibility',
			onPick: () => getApi()?.updateOsSettings?.( { mioShowOnWallpaper: ! shown } ),
		}, { kind: 'separator' } );
	}

	if ( opts.surface === 'dock' ) {
		if ( onRail( placement ) ) {
			options.push( {
				id: 'hide-from-rail',

				label: sprintf( __( 'Hide from %s' ), railWord ),
				icon: 'dashicons-hidden',
				onPick: () => setRegion( item, 'rail', false ),
			} );
		} else {
			options.push( {
				id: 'keep-in-rail',

				label: sprintf( __( 'Keep in %s' ), railWord ),
				icon: 'dashicons-admin-post',
				onPick: () => setRegion( item, 'rail', true ),
			} );
		}
		if ( ! onDesktop( placement ) ) {
			options.push( {
				id: 'show-on-desktop',
				label: __( 'Also show on desktop' ),
				icon: 'dashicons-desktop',
				onPick: () => setRegion( item, 'desktop', true ),
			} );
		}
	} else {
		options.push( {
			id: 'hide-from-desktop',
			label: __( 'Hide from desktop' ),
			icon: 'dashicons-hidden',
			onPick: () => setRegion( item, 'desktop', false ),
		} );
		if ( ! onRail( placement ) ) {
			options.push( {
				id: 'show-on-rail',

				label: sprintf( __( 'Also show on %s' ), railWord ),
				icon: 'dashicons-menu',
				onPick: () => setRegion( item, 'rail', true ),
			} );
		}
	}

	if ( onRail( placement ) || onDesktop( placement ) ) {
		options.push( {
			id: 'hide-everywhere',
			label: __( 'Hide everywhere' ),
			icon: 'dashicons-no',
			danger: true,
			onPick: () => setPlacement( [ { item, placement: 'hidden' } ] ),
		} );
	}

	options.push( {
		id: 'open-settings',
		label: __( 'Navigation settings…' ),
		icon: 'dashicons-admin-generic',
		onPick: () => {
			const api = getApi();
			api?.openOsSettings?.( { tabId: 'navigation' } );
		},
	} );

	if ( opts.pluginFile ) {
		const pluginFile = opts.pluginFile;

		const pluginLabel = opts.pluginName || opts.title;
		options.push( { kind: 'separator' } );
		options.push( {
			id: 'deactivate-plugin',

			label: sprintf( __( 'Deactivate %s…' ), pluginLabel ),
			icon: 'dashicons-trash',
			danger: true,
			onPick: () => {
				void confirmAndDeactivatePlugin( pluginFile, pluginLabel );
			},
		} );
	}

	const menu = document.createElement( 'os-context-menu' );
	menu.setAttribute( 'open', '' );
	menu.classList.add( 'os-item-visibility-menu' );
	( menu as HTMLElement ).dataset.itemId = opts.id;
	menu.style.position = 'fixed';

	menu.style.left = '-9999px';
	menu.style.top = '-9999px';

	menu.style.zIndex = '1000000';

	type PickableOption = Exclude< MenuOption, { kind: 'separator' } >;
	const byKey = new Map< string, PickableOption >();
	for ( const opt of options ) {
		if ( opt.kind === 'separator' ) {
			const hr = document.createElement( 'hr' );

			hr.style.cssText =
				'border: 0; border-top: 1px solid var( --os-ui-context-menu-separator-color, rgba(255,255,255,0.12) ); margin: 4px 6px;';
			menu.appendChild( hr );
			continue;
		}
		byKey.set( opt.id, opt );
		const node = document.createElement( 'os-context-menu-option' );

		( node as HTMLElement ).dataset.menuItemId = opt.id;
		node.setAttribute( 'value', opt.id );
		if ( opt.icon ) {
			node.setAttribute( 'icon', opt.icon );
		}
		if ( opt.danger ) {
			node.setAttribute( 'danger', '' );
		}
		node.textContent = opt.label;
		menu.appendChild( node );
	}

	menu.addEventListener( 'os-context-menu-pick', ( e: Event ) => {
		const detail = ( e as CustomEvent< { id: string; value: string } > ).detail;

		const key = detail?.id || detail?.value || '';
		const opt = byKey.get( key );
		closeMenu();
		try {
			opt?.onPick();
		} catch {

		}
	} );

	document.body.appendChild( menu );
	activeMenu = menu;

	placeAfterRender( menu, ( rect ) => {
		const margin = 8;
		let left = opts.x;
		let top: number;

		if ( opts.surface === 'dock' ) {
			top = Math.max( margin, opts.y - rect.height - margin );
		} else {
			top = opts.y;
			if ( top + rect.height + margin > window.innerHeight ) {
				top = Math.max( margin, opts.y - rect.height );
			}
		}
		if ( left + rect.width + margin > window.innerWidth ) {
			left = Math.max( margin, opts.x - rect.width );
		}
		menu.style.left = `${ left }px`;
		menu.style.top = `${ top }px`;
	} );

	const onOutside = ( ev: MouseEvent ): void => {
		if ( ! activeMenu ) {
			return;
		}
		if ( ! activeMenu.contains( ev.target as Node ) ) {
			closeMenu();
			document.removeEventListener( 'mousedown', onOutside, true );
			document.removeEventListener( 'keydown', onKey, true );
		}
	};
	const onKey = ( ev: KeyboardEvent ): void => {
		if ( ev.key === 'Escape' ) {
			closeMenu();
			document.removeEventListener( 'mousedown', onOutside, true );
			document.removeEventListener( 'keydown', onKey, true );
		}
	};
	document.addEventListener( 'mousedown', onOutside, true );
	document.addEventListener( 'keydown', onKey, true );
}

async function confirmAndDeactivatePlugin(
	pluginFile: string,
	title: string,
): Promise< void > {
	const confirmed = await osConfirm( {

		title: sprintf( __( 'Deactivate %s?' ), title ),
		message: __(
			'This plugin will stop running on the site. You can re-activate it later from the Plugins screen.',
		),
		confirmLabel: __( 'Deactivate' ),
		cancelLabel: __( 'Cancel' ),
		danger: true,
	} );
	if ( ! confirmed ) {
		return;
	}

	type ConfigShape = { restRoot?: string; restNonce?: string };
	const cfg =
		( window as unknown as { openStationConfig?: ConfigShape } )
			.openStationConfig ?? {};
	const restRoot =
		typeof cfg.restRoot === 'string' && cfg.restRoot
			? cfg.restRoot
			: `${ window.location.origin }/wp-json/`;
	const restNonce =
		typeof cfg.restNonce === 'string' && cfg.restNonce ? cfg.restNonce : '';

	const stripped = pluginFile.endsWith( '.php' )
		? pluginFile.slice( 0, -4 )
		: pluginFile;
	const encoded = stripped
		.split( '/' )
		.map( encodeURIComponent )
		.join( '/' );
	const url = joinRestUrl( restRoot, `wp/v2/plugins/${ encoded }` );

	try {
		const res = await trackedFetch(
			url,
			{
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': restNonce,
				},
				body: JSON.stringify( { status: 'inactive' } ),
				credentials: 'same-origin',
			},
			{ source: 'desktop-mode/dock-deactivate-plugin' },
		);
		if ( ! res.ok ) {
			throw await restErrorFromResponse( res );
		}
	} catch ( err ) {
		toastRestFailure( showToast, err, {

			lead: sprintf( __( 'Could not deactivate %s' ), title ),

			fallback: sprintf( __( 'Could not deactivate %s.' ), title ),
			duration: 4000,
		} );

		console.error( '[openstation] deactivate plugin failed', err );
		return;
	}

	const closedTitles = closeWindowsForPlugin( pluginFile );

	const deactivatedMsg =
		closedTitles.length > 0
			? sprintf(

				__( '%1$s deactivated. Closed %2$d window(s).' ),
				title,
				closedTitles.length,
			)
			: sprintf(

				__( '%s deactivated.' ),
				title,
			);
	showToast( { message: deactivatedMsg, duration: 3000 } );

	const w = window as unknown as {
		wp?: { os?: { refreshMenu?: () => void } };
	};
	w.wp?.os?.refreshMenu?.();
}

function closeWindowsForPlugin( pluginFile: string ): string[] {
	interface DockItemLike {
		id: string;
		title: string;
		url: string;
		pluginFile?: string | null;
	}
	interface WindowLike {
		id: string;
		iframe?: HTMLIFrameElement | null;
		config?: { title?: string; baseId?: string; url?: string };
		close: () => void;
	}
	interface ShellShim {
		getMenuItems?: () => DockItemLike[];
		deriveWindowId?: ( url: string ) => string;
		windowManager?: {
			getAll?: () => WindowLike[];
		};
	}
	const api = ( window as unknown as { wp?: { os?: ShellShim } } )
		.wp?.os;
	if ( ! api?.windowManager?.getAll ) {
		return [];
	}

	const items = api.getMenuItems?.() ?? [];
	const owned = items.filter( ( i ) => i.pluginFile === pluginFile );
	if ( owned.length === 0 ) {
		return [];
	}

	const ownedKeys = new Set< string >();
	for ( const item of owned ) {
		ownedKeys.add( item.id );
		if ( api.deriveWindowId ) {
			ownedKeys.add( api.deriveWindowId( item.url ) );
		}
	}

	const toClose = new Map< string, WindowLike >();
	const windows = api.windowManager.getAll() ?? [];
	const derive = api.deriveWindowId;
	for ( const w of windows ) {
		if ( ownedKeys.has( w.id ) ) {
			toClose.set( w.id, w );
			continue;
		}
		if ( w.config?.baseId && ownedKeys.has( w.config.baseId ) ) {
			toClose.set( w.id, w );
			continue;
		}
		if ( derive && w.config?.url ) {
			const derivedFromConfig = derive( w.config.url );
			if ( ownedKeys.has( derivedFromConfig ) ) {
				toClose.set( w.id, w );
				continue;
			}
		}
		if ( derive && w.iframe ) {
			let liveUrl = '';
			try {
				liveUrl = w.iframe.src || '';
			} catch {

			}
			if ( liveUrl ) {
				const derivedFromLive = derive( liveUrl );
				if ( ownedKeys.has( derivedFromLive ) ) {
					toClose.set( w.id, w );
				}
			}
		}
	}

	const titles: string[] = [];
	for ( const w of toClose.values() ) {
		titles.push( w.config?.title ?? w.id );
		try {
			w.close();
		} catch {

		}
	}
	return titles;
}
