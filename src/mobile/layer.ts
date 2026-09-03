/**
 * OpenStation — phone layer: the orchestrator.
 *
 * Mounts the four surfaces (top bar, home, tab bar, switcher) around
 * the window manager and keeps them in step with it. The layer holds
 * no window state of its own: its `state` is DERIVED from the
 * manager on every change —
 *
 *   `switcher`  the sheet is open
 *   `app`       some window on the active desktop is not minimized
 *   `home`      otherwise
 *
 * — so "home" is exactly `minimizeAll()`, a tap on a tile is exactly
 * what a dock click does, and the switcher lists exactly
 * `manager.getAll()`. Whatever a plugin does to a window through the
 * public API, the phone reflects it, because there is nothing else
 * to reflect.
 *
 * Runs in `mobile[.min].js`; everything it needs from the shell
 * arrives through {@link MobileLayerDeps}.
 */
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

/**
 * The `view-transition-name` shared by the thing that opens and the
 * thing it opens into — a home tile and its window, a switcher card
 * and its window — so the View Transitions API morphs one into the
 * other instead of cross-fading two screens. Assigned to exactly one
 * element per snapshot: the old one before capture, the new one
 * after the DOM update. Two elements carrying it at once would make
 * the browser skip the transition.
 */
const HERO_NAME = 'os-mobile-hero';

/**
 * The desktop's Overview system tile — `OVERVIEW_TILE_ID` in
 * `src/dock-shell-tiles.ts`, repeated here so the phone bundle does
 * not carry the dock's tile module for one string.
 */
const OVERVIEW_TILE_ID = 'os-overview';

/** The window manager asks for the switcher when Overview is requested on a phone. */
const OPEN_SWITCHER_EVENT = 'os-mobile-open-switcher';

/** How long a tap waits for its window before the transition gives up on the morph. */
const OPEN_SETTLE_MS = 800;

/** Attribute-value escape for a selector; `CSS.escape` when the host has it (jsdom does not). */
function escapeAttr( value: string ): string {
	const css = ( globalThis as { CSS?: { escape?: ( v: string ) => string } } ).CSS;
	return typeof css?.escape === 'function' ? css.escape( value ) : value.replace( /["\\]/g, '\\$&' );
}

type ViewTransitionDocument = Document & {
	startViewTransition?: ( update: () => Promise< void > | void ) => {
		finished: Promise< void >;
	};
};

/** A history entry the layer pushed so the hardware Back goes home. */
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

	// ---- surfaces ---------------------------------------------------
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

	// Two edge zones. The start edge is the Back gesture; both cancel
	// the browser's own history swipe (`bindHistorySwipeGuard`), which
	// is why there is an end zone at all, and why both stay on the home
	// screen: a swipe that left the page would leave it from home too.
	const edge = document.createElement( 'div' );
	edge.className = 'os-mobile-edge os-mobile-edge--start';
	edge.setAttribute( 'aria-hidden', 'true' );
	area.appendChild( edge );
	const edgeEnd = document.createElement( 'div' );
	edgeEnd.className = 'os-mobile-edge os-mobile-edge--end';
	edgeEnd.setAttribute( 'aria-hidden', 'true' );
	area.appendChild( edgeEnd );

	// ---- derived state ----------------------------------------------
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
		// The switcher emptied itself: the last card was closed (or the
		// window went away underneath it). A sheet that says "Nothing
		// open" over a hidden home is a dead end — the user would have
		// to dismiss it by hand to reach the tiles — so it steps aside
		// and home shows. Opening the switcher from an empty home still
		// shows the empty message: nothing emptied there.
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
		// The CSS slide-up is the fallback for browsers without the
		// View Transitions API; under a running transition the morph
		// IS the entrance.
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
				// Sandboxed or file: origin — the hardware Back simply
				// leaves the page, as it would without the layer.
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

	/**
	 * Repaint the tab bar as a view transition when its membership
	 * changed: every tab carries a stable transition name for the
	 * duration, so a surviving tab glides to its new slot, a new one
	 * scales in and a removed one scales out (`mobile.css`, the
	 * `os-tab` transition class). A repaint with the same tabs — a
	 * badge count, a title — is a plain render.
	 */
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

	// ---- transitions ------------------------------------------------
	/** The home tile's icon for a navigation item, when it is painted. */
	const tileIconForItem = ( id: string ): HTMLElement | null =>
		home.el.querySelector< HTMLElement >(
			`.os-mobile-tile[data-nav-id="${ escapeAttr( id ) }"] .os-mobile-tile__icon`,
		);
	/** The home tile a window came from, by the id a tap would derive. */
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
	/** Resolves on the first of the named window events — or on the deadline. */
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
	/**
	 * Run a state change as a view transition: `oldHero` is what the
	 * user touched (a tile, a card, the app itself), `newHero()` is
	 * what it becomes once `update` has landed. The browser morphs one
	 * box into the other; the top bar and the tab bar, named in
	 * `mobile.css`, hold still. Without the API, or under reduced
	 * motion, the update simply runs.
	 */
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

	// ---- actions ----------------------------------------------------
	const openItem = ( item: NavItem ): void => {
		// The desktop's Overview tile: on a phone the switcher IS the
		// overview, so the tile opens it directly rather than morphing
		// into a window that never comes.
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
			// Pop our own entry; the popstate handler goes home.
			history.back();
			return;
		}
		goHome();
	};
	/**
	 * What the switcher lists: the windows open on this phone, most
	 * recent first. Windows a phone boot parked (the session diet in
	 * `constraints.ts`) are not listed: they belong to the desktop and
	 * go back to it untouched.
	 */
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
		// The app already on screen: nothing to go to, nothing to morph.
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
		// `close()` may be vetoed (unsaved changes); repaint from truth
		// on the next frame either way.
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

	/**
	 * The × on the top bar: the app leaves the screen NOW — it is
	 * minimized in the same frame, which is what the transition
	 * morphs — and the close itself runs behind that. `close()` first
	 * asks an iframe page about unsaved changes (up to half a second)
	 * and may be vetoed; either way the user is already home, and a
	 * vetoed window is simply waiting in the switcher.
	 */
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

	// ---- wiring -----------------------------------------------------
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
	// A flick down on the top bar sends the app home, the way a sheet
	// is dismissed on a phone.
	const unbindSwipeDown = bindSwipeDown( topBar.el, { onCommit: () => goHome() } );
	const unsubscribeNav = deps.subscribeNav( refreshNav );

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
