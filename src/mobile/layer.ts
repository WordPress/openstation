import { addAction, HOOKS, removeAction } from '../hooks';
import { __ } from '../i18n';
import type { NavItem } from '../nav/types';
import { osConfirm } from '../ui/components/os-confirm-dialog/os-confirm-dialog';
import type { Window as DesktopWindow } from '../window';
import { bindEdgeBack, bindHistorySwipeGuard, bindSwipeDown, bindSwipeUp } from './gestures';
import { createHome, homeGridItems } from './home';
import { createSwitcher, type SwitcherCard } from './switcher';
import { createTabBar, navItemWindowId, resolveTabBarItems } from './tab-bar';
import { createTopBar } from './top-bar';
import type { MobileLayerDeps, MobileLayerHandle, MobileState } from './types';

const NS = 'openstation/mobile-layer';
const WALLPAPER_REASON = 'openstation/mobile';
const ENTER_CLASS = 'os-mobile-enter';

const HERO_NAME = 'os-mobile-hero';

const OVERVIEW_TILE_ID = 'os-overview';

const OPEN_SWITCHER_EVENT = 'os-mobile-open-switcher';

const OPEN_SETTLE_MS = 800;

function escapeAttr( value: string ): string {
	const css = ( globalThis as { CSS?: { escape?: ( v: string ) => string } } ).CSS;
	return typeof css?.escape === 'function' ? css.escape( value ) : value.replace( /["\\]/g, '\\$&' );
}

type ViewTransitionDocument = Document & {
	startViewTransition?: ( update: () => Promise< void > | void ) => {
		finished: Promise< void >;
	};
};

const HISTORY_MARK = { osMobile: 'app' } as const;

function subtitleFor( win: DesktopWindow ): string {
	if ( win.config.native ) {
		return __( 'App' );
	}
	try {
		const url = new URL( win.getCurrentUrl(), window.location.origin );
		const page = url.pathname.split( '/' ).pop() || url.pathname;
		const screen = url.searchParams.get( 'page' ) || url.searchParams.get( 'post_type' );
		return screen ? `${ page } · ${ screen }` : page;
	} catch {
		return '';
	}
}

function liveTitle( win: DesktopWindow ): string {
	const el = win.element.querySelector( '.os-window__title' );
	const text = el?.textContent?.trim();
	return text || win.config.title || '';
}

export function mountMobileLayer( deps: MobileLayerDeps ): MobileLayerHandle {
	const { manager, shell, area } = deps;
	const shellBody = shell.querySelector< HTMLElement >( '.os-shell__body' );
	const reducedMotion =
		typeof window.matchMedia === 'function' &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

	shell.classList.add( 'os-mobile' );
	deps.wallpaper.suspend( WALLPAPER_REASON );

	const topBar = createTopBar( shell, {
		renderIcon: deps.renderIcon,
		onClose: () => closeApp(),
	} );
	if ( shellBody ) {
		shell.insertBefore( topBar.el, shellBody );
	}

	const home = createHome( area, {
		renderIcon: deps.renderIcon,
		getBadge: deps.getBadge,
		getArt: deps.getArt,
		onOpen: ( item ) => openItem( item ),
	} );

	const tabBar = createTabBar( shell, {
		renderIcon: deps.renderIcon,
		getBadge: deps.getBadge,
		onHome: () => goHome(),
		onSwitcher: () => toggleSwitcher(),
		onOpen: ( item ) => openItem( item ),
	} );

	const switcher = createSwitcher( shell, {
		renderIcon: deps.renderIcon,
		onPick: ( card ) => pickCard( card ),
		onClose: ( card ) => closeCard( card ),
		onCloseAll: () => {
			void closeAll();
		},
		onDismiss: () => closeSwitcher(),
	} );

	const edge = document.createElement( 'div' );
	edge.className = 'os-mobile-edge os-mobile-edge--start';
	edge.setAttribute( 'aria-hidden', 'true' );
	area.appendChild( edge );
	const edgeEnd = document.createElement( 'div' );
	edgeEnd.className = 'os-mobile-edge os-mobile-edge--end';
	edgeEnd.setAttribute( 'aria-hidden', 'true' );
	area.appendChild( edgeEnd );

	const onActiveDesktop = ( win: DesktopWindow ): boolean => {
		const active = manager.getActiveDesktopId();
		return ( win.config.desktopId ?? active ) === active;
	};
	const openWindows = (): DesktopWindow[] =>
		manager.getAll().filter( onActiveDesktop );
	const appWindow = (): DesktopWindow | null => {
		const all = openWindows();
		for ( let i = all.length - 1; i >= 0; i-- ) {
			if ( ! all[ i ].isMinimized() ) {
				return all[ i ];
			}
		}
		return null;
	};
	const state = (): MobileState => {
		if ( switcher.isOpen() ) {
			return 'switcher';
		}
		return appWindow() ? 'app' : 'home';
	};

	let pinned: NavItem[] = [];
	let lastAppId: string | null = null;
	let lastState: MobileState | null = null;
	let lastOpenCount = 0;
	let historyPushed = false;
	let syncScheduled = false;
	let heroTransition = false;

	const tabState = ( current: MobileState, app: DesktopWindow | null ) => {
		let active: string | null = null;
		if ( current === 'home' ) {
			active = 'home';
		} else if ( current === 'switcher' ) {
			active = 'switcher';
		} else if ( app ) {
			const baseId = app.config.baseId || app.id;
			active = pinned.find( ( item ) => navItemWindowId( item, deps.adminUrl ) === baseId )?.id ?? null;
		}
		return { active, openCount: openWindows().length };
	};

	const sync = (): void => {
		syncScheduled = false;

		const openCount = openWindows().length;
		if ( switcher.isOpen() && lastState === 'switcher' && openCount === 0 && lastOpenCount > 0 ) {
			switcher.close();
		}
		lastOpenCount = openCount;
		const app = appWindow();
		const current = state();
		shell.dataset.osMobileState = current;
		home.setHidden( current !== 'home' );
		topBar.setHidden( ! app );
		topBar.update( app ? { title: liveTitle( app ), icon: app.config.icon } : null );
		tabBar.setState( tabState( current, app ) );

		if ( current === 'home' && lastState !== 'home' ) {
			home.reset();
		}

		if ( app && app.id !== lastAppId && ! reducedMotion && ! heroTransition ) {
			app.element.classList.add( ENTER_CLASS );
			app.element.addEventListener(
				'animationend',
				() => app.element.classList.remove( ENTER_CLASS ),
				{ once: true },
			);
		}
		if ( current === 'app' && ! historyPushed ) {
			try {
				history.pushState( HISTORY_MARK, '' );
				historyPushed = true;
			} catch {

			}
		}
		if ( switcher.isOpen() ) {
			switcher.update( cards() );
		}
		lastAppId = app?.id ?? null;
		lastState = current;
	};
	const scheduleSync = (): void => {
		if ( syncScheduled ) {
			return;
		}
		syncScheduled = true;
		if ( typeof requestAnimationFrame === 'function' ) {
			requestAnimationFrame( sync );
		} else {
			setTimeout( sync, 0 );
		}
	};

	const tabIds = (): string[] =>
		Array.from( tabBar.el.querySelectorAll< HTMLElement >( '.os-mobile-tabs__item' ) ).map(
			( b ) => b.dataset.tab ?? '',
		);
	const nameTabs = ( on: boolean ): void => {
		for ( const b of tabBar.el.querySelectorAll< HTMLElement >( '.os-mobile-tabs__item' ) ) {
			if ( on ) {
				const slug = ( b.dataset.tab ?? '' ).replace( /[^a-zA-Z0-9_-]/g, '_' );
				b.style.setProperty( 'view-transition-name', `os-tab-${ slug }` );
				b.style.setProperty( 'view-transition-class', 'os-tab' );
			} else {
				b.style.removeProperty( 'view-transition-name' );
				b.style.removeProperty( 'view-transition-class' );
			}
		}
	};
	const paintTabBar = ( items: NavItem[] ): void => {
		const current = tabState( state(), appWindow() );
		const doc = document as ViewTransitionDocument;
		const before = tabIds();
		const after = [ 'home', ...items.map( ( i ) => i.id ), 'switcher' ];
		const unchanged = before.length === after.length && before.every( ( id, i ) => id === after[ i ] );
		if (
			unchanged ||
			before.length === 0 ||
			reducedMotion ||
			typeof doc.startViewTransition !== 'function' ||
			heroTransition
		) {
			tabBar.render( items, current );
			return;
		}
		heroTransition = true;
		nameTabs( true );
		const vt = doc.startViewTransition( () => {
			tabBar.render( items, current );
			nameTabs( true );
		} );
		void vt.finished
			.catch( () => undefined )
			.then( () => {
				nameTabs( false );
				heroTransition = false;
			} );
	};

	const refreshNav = (): void => {
		const nav = deps.getNav();
		home.render( nav );
		pinned = resolveTabBarItems( nav, deps.getPinnedTabIds() );
		paintTabBar( pinned );
	};

	const tileIconForItem = ( id: string ): HTMLElement | null =>
		home.el.querySelector< HTMLElement >(
			`.os-mobile-tile[data-nav-id="${ escapeAttr( id ) }"] .os-mobile-tile__icon`,
		);

	const tileIconFor = ( win: DesktopWindow ): HTMLElement | null => {
		const baseId = win.config.baseId || win.id;
		const nav = deps.getNav();
		if ( ! nav ) {
			return null;
		}
		const { apps, system } = homeGridItems( nav );
		const item = [ ...apps, ...system ].find(
			( i ) => navItemWindowId( i, deps.adminUrl ) === baseId,
		);
		return item ? tileIconForItem( item.id ) : null;
	};

	const nextWindowEvent = (
		names: readonly string[] = [ 'os-window-opened', 'os-window-reopened', 'os-window-focused' ],
	): Promise< void > =>
		new Promise( ( resolve ) => {
			let timer = 0;
			const done = (): void => {
				for ( const n of names ) {
					document.removeEventListener( n, done );
				}
				clearTimeout( timer );
				resolve();
			};
			for ( const n of names ) {
				document.addEventListener( n, done );
			}
			timer = window.setTimeout( done, OPEN_SETTLE_MS );
		} );

	const transition = (
		oldHero: HTMLElement | null,
		update: () => Promise< void > | void,
		newHero: () => HTMLElement | null,
	): void => {
		const doc = document as ViewTransitionDocument;
		if ( reducedMotion || typeof doc.startViewTransition !== 'function' || heroTransition ) {
			void Promise.resolve( update() ).then( sync );
			return;
		}
		heroTransition = true;
		oldHero?.style.setProperty( 'view-transition-name', HERO_NAME );
		let named: HTMLElement | null = null;
		const vt = doc.startViewTransition( async () => {
			oldHero?.style.removeProperty( 'view-transition-name' );
			await update();
			sync();
			named = newHero();
			named?.style.setProperty( 'view-transition-name', HERO_NAME );
		} );
		void vt.finished
			.catch( () => undefined )
			.then( () => {
				named?.style.removeProperty( 'view-transition-name' );
				heroTransition = false;
			} );
	};

	const openItem = ( item: NavItem ): void => {
		if ( item.id === OVERVIEW_TILE_ID ) {
			openSwitcher();
			return;
		}
		switcher.close();
		const fromHome = state() === 'home';
		transition(
			fromHome ? tileIconForItem( item.id ) : null,
			async () => {
				if ( deps.openNavItem( item ) ) {
					await nextWindowEvent();
				}
			},
			() => appWindow()?.element ?? null,
		);
	};
	const goHome = (): void => {
		switcher.close();
		const app = appWindow();
		transition(
			app?.element ?? null,
			() => {
				manager.minimizeAll();
			},
			() => ( app ? tileIconFor( app ) : null ),
		);
	};
	const back = (): void => {
		if ( switcher.isOpen() ) {
			closeSwitcher();
			return;
		}
		if ( historyPushed && history.state && ( history.state as { osMobile?: string } ).osMobile === 'app' ) {
			history.back();
			return;
		}
		goHome();
	};

	const cards = (): SwitcherCard[] => {
		const current = appWindow();
		return openWindows()
			.slice()
			.reverse()
			.map< SwitcherCard >( ( win ) => ( {
				id: win.id,
				title: liveTitle( win ),
				icon: win.config.icon,
				subtitle: subtitleFor( win ),
				active: win === current,
			} ) );
	};
	const openSwitcher = (): void => {
		switcher.open( cards() );
		scheduleSync();
	};
	const closeSwitcher = (): void => {
		switcher.close();
		scheduleSync();
	};
	const toggleSwitcher = (): void => {
		if ( switcher.isOpen() ) {
			closeSwitcher();
		} else {
			openSwitcher();
		}
	};
	const pickCard = ( card: SwitcherCard ): void => {
		if ( card.active ) {
			closeSwitcher();
			return;
		}
		const cardEl = switcher.el.querySelector< HTMLElement >(
			`.os-mobile-card[data-card-id="${ escapeAttr( card.id ) }"]`,
		);
		const win = manager.getById( card.id );
		transition(
			cardEl,
			() => {
				switcher.close();
				if ( win ) {
					if ( win.isMinimized() ) {
						win.restore();
					}
					manager.focus( win );
				}
			},
			() => win?.element ?? null,
		);
	};
	const closeCard = ( card: SwitcherCard ): void => {
		manager.getById( card.id )?.close();

		scheduleSync();
	};
	const closeAll = async (): Promise< void > => {
		const count = openWindows().length;
		if ( count === 0 ) {
			return;
		}
		const ok = await osConfirm( {
			title: __( 'Close all apps?' ),
			message: __( 'Anything unsaved in them will ask before it goes.' ),
			confirmLabel: __( 'Close all' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		manager.closeAll();
		switcher.close();
		scheduleSync();
	};

	const closeApp = (): void => {
		const app = appWindow();
		if ( ! app ) {
			return;
		}
		transition(
			app.element,
			() => {
				app.minimize();
				app.close();
			},
			() => tileIconFor( app ),
		);
	};

	const docEvents = [
		'os-window-opened',
		'os-window-closed',
		'os-window-focused',
		'os-window-blurred',
		'os-window-changed',
		'os-window-reopened',
	];
	for ( const name of docEvents ) {
		document.addEventListener( name, scheduleSync );
	}
	const hookNames = [
		HOOKS.WINDOW_MINIMIZED,
		HOOKS.WINDOW_RESTORED,
		HOOKS.WINDOW_TITLE_CHANGED,
		HOOKS.DESKTOP_SWITCHED,
	];
	for ( const name of hookNames ) {
		addAction( name, NS, scheduleSync );
	}
	const onPopState = (): void => {
		const mark = ( history.state as { osMobile?: string } | null )?.osMobile;
		if ( mark === 'app' ) {
			return;
		}
		if ( ! historyPushed ) {
			return;
		}
		historyPushed = false;
		if ( state() !== 'home' ) {
			goHome();
		}
	};
	window.addEventListener( 'popstate', onPopState );
	const onOpenSwitcherRequest = (): void => openSwitcher();
	document.addEventListener( OPEN_SWITCHER_EVENT, onOpenSwitcherRequest );

	const unbindEdge = bindEdgeBack( edge, {
		onProgress: ( p ) => topBar.setBackProgress( p ),
		onCommit: () => back(),
	} );
	const unbindGuards = [ bindHistorySwipeGuard( edge ), bindHistorySwipeGuard( edgeEnd ) ];
	const unbindSwipeUp = bindSwipeUp( tabBar.el, { onCommit: () => openSwitcher() } );

	const unbindSwipeDown = bindSwipeDown( topBar.el, { onCommit: () => goHome() } );
	const unsubscribeNav = deps.subscribeNav( refreshNav );

	const unsubscribeArt = deps.subscribeArt?.( refreshNav ) ?? ( () => undefined );

	refreshNav();
	sync();

	return {
		unmount() {
			for ( const name of docEvents ) {
				document.removeEventListener( name, scheduleSync );
			}
			for ( const name of hookNames ) {
				removeAction( name, NS );
			}
			window.removeEventListener( 'popstate', onPopState );
			document.removeEventListener( OPEN_SWITCHER_EVENT, onOpenSwitcherRequest );
			unbindEdge();
			for ( const unbind of unbindGuards ) {
				unbind();
			}
			unbindSwipeUp();
			unbindSwipeDown();
			unsubscribeNav();
			unsubscribeArt();
			switcher.close();
			topBar.el.remove();
			home.el.remove();
			tabBar.el.remove();
			switcher.el.remove();
			edge.remove();
			edgeEnd.remove();
			delete shell.dataset.osMobileState;
			shell.classList.remove( 'os-mobile' );
			deps.wallpaper.resume( WALLPAPER_REASON );
		},
		refresh: refreshNav,
		goHome,
		openSwitcher,
		closeSwitcher,
		getState: state,
	};
}
