/**
 * The site switcher: on a network, every site is its own OpenStation.
 *
 * A site's shell is a whole instance — its own plugins, native windows,
 * widgets, dock, desktops and session (`openstation_session_meta_key()`
 * keeps one per admin) — so switching site is a navigation to that
 * site's shell screen, animated by the cross-document view transition
 * the shell's stylesheet opts into (`assets/css/desktop.css`). The
 * switcher is a row of segments above the desktop tiles in overview:
 * the network admin, for those who can reach it, then every site the
 * user belongs to, with the current instance selected. Picking another
 * lands in THAT site's overview (`openstation_overview=1`, read once
 * server-side like the boot target), so the panel reads as one surface
 * whose tiles changed.
 *
 * A modifier or middle click on a segment opens the site in a browser
 * tab instead — the universal "open elsewhere" gesture, and the way to
 * stand two sites side by side. See docs/multisite.md.
 *
 * An install that joined from elsewhere (an OpenStation network member,
 * docs/network.md) is marked as external: a mark before its name, a
 * line before the first of them, and the segment's tooltip says so. A
 * user reading the row knows which sites are this network's own.
 */

import type { MultisiteConfig } from '../types';
import { hopToAdmin, wantsBrowserTab, type HopMinter } from './hop';
import { leaveInstance, type HopDirection } from './instance-transition';
import { isTextEntryFocus } from '../window-manager/switcher';
import { __ } from '../i18n';
// The switcher is a kit component; the shell bundle registers only
// what it uses, so the definition rides in with its one user.
import '../ui/components/os-segmented/os-segmented';

/**
 * Query arg asking the shell screen to boot straight into overview.
 * Mirrors `OPENSTATION_SHELL_OVERVIEW_ARG`.
 */
export const OVERVIEW_ARG = 'openstation_overview';

/** One instance the switcher offers. */
export interface SiteSwitcherEntry {
	/** `network`, or the blog id as a string — `MultisiteConfig.current`. */
	value: string;
	label: string;
	/** That instance's shell screen. */
	shellUrl: string;
	/** An install that joined from elsewhere, marked as such in the row. */
	external: boolean;
	/** Another install than this shell's, so a switch there mints a login token. */
	foreign: boolean;
	/**
	 * A site without OpenStation has no shell to switch to: its regular
	 * admin, opened in a browser tab instead.
	 */
	tabUrl?: string;
}

/** The direction arg a cross-origin arrival slides in from. Mirrors `OPENSTATION_NETWORK_HOP_FROM_ARG`. */
export const HOP_FROM_ARG = 'openstation_hop_from';

/**
 * The shell URL that boots into overview — and, for another origin,
 * carries the slide direction, since the sessionStorage hint a
 * same-origin switch leaves cannot follow the navigation there.
 */
export function shellUrlInOverview(
	shellUrl: string,
	direction?: HopDirection,
): string {
	try {
		const url = new URL( shellUrl, window.location.href );
		url.searchParams.set( OVERVIEW_ARG, '1' );
		if ( direction && url.origin !== window.location.origin ) {
			url.searchParams.set( HOP_FROM_ARG, direction );
		}
		return url.toString();
	} catch {
		return shellUrl;
	}
}

/** Whether a shell URL lives on another origin than this shell. */
export function isOtherOrigin( shellUrl: string ): boolean {
	try {
		return new URL( shellUrl, window.location.href ).origin !== window.location.origin;
	} catch {
		return false;
	}
}

/**
 * The instances to offer: the network admin first, then the sites in
 * the order the server gave them.
 */
export function siteSwitcherEntries(
	multisite: MultisiteConfig,
): SiteSwitcherEntry[] {
	const entries: SiteSwitcherEntry[] = [];
	if ( multisite.networkAdmin?.shellUrl ) {
		entries.push( {
			value: 'network',
			label: __( 'Network Admin' ),
			shellUrl: multisite.networkAdmin.shellUrl,
			external: false,
			foreign: multisite.networkAdmin.foreign === true,
		} );
	}
	for ( const site of multisite.sites ?? [] ) {
		entries.push( {
			value: site.id,
			label: site.name,
			shellUrl: site.shellUrl,
			external: site.kind === 'member',
			foreign: site.foreign === true,
			tabUrl: site.active === false ? site.adminUrl : undefined,
		} );
	}
	return entries;
}

/** The collaborators a switch takes, both optional. */
export interface SiteSwitchDeps {
	/** The navigation; defaults to the same hop every cross-admin click takes. */
	hop?: ( url: string, event?: MouseEvent ) => void;
	/** Signs a login token before a hop to another origin; without it the user logs in there themselves. */
	mint?: HopMinter;
}

/**
 * Switch to another instance of the network by its switcher value: the
 * same hop a pick in the row takes, slide and login token included. The
 * Network window's Open buttons reach it through the `hop` effect the
 * shell handles, so an app switches exactly as the row does and never
 * anywhere the row does not offer. False when the value is unknown, or
 * is this very shell.
 */
export function switchToSite(
	multisite: MultisiteConfig,
	value: string,
	deps: SiteSwitchDeps = {},
): boolean {
	const hop = deps.hop ?? hopToAdmin;
	const entries = siteSwitcherEntries( multisite );
	const current = multisite.current ?? '';
	const to = entries.findIndex( ( x ) => x.value === value );
	if ( to < 0 || value === current ) {
		return false;
	}
	const entry = entries[ to ];
	if ( entry.tabUrl ) {
		window.open( entry.tabUrl, '_blank', 'noopener' );
		return true;
	}
	// Slide this desk out towards the site picked, then go; the shell
	// that arrives slides its desk in from the same side. Another
	// INSTALL gets a login token minted meanwhile, so the user arrives
	// logged in; a mint that fails hops without one. Origin is not the
	// line: a separate install on this hostname shares nothing but the
	// hostname, and a site of this install needs no token on any.
	const from = entries.findIndex( ( x ) => x.value === current );
	const direction: HopDirection = to > from ? 'next' : 'prev';
	const plain = shellUrlInOverview( entry.shellUrl, direction );
	const minted =
		deps.mint && entry.foreign
			? deps.mint( entry.shellUrl, direction ).catch( () => null )
			: Promise.resolve( null );
	void Promise.all( [ leaveInstance( direction ), minted ] ).then(
		( [ , url ] ) => hop( url ?? plain ),
	);
	return true;
}

/**
 * The Tab key, while the switcher is displayed: Tab moves to the next
 * site and Shift+Tab to the previous, wrapping at the ends, the same
 * switch a pick takes. Only then. On a desk, in a window, or in a
 * field being typed in, Tab stays the browser's, so the one place the
 * key means "next site" is the one place the row is on screen. And
 * only while focus is not on another control of the overview top bar
 * (a tile's rename, close or edit, the "+"): those stay reachable by
 * keyboard, and a click on the switcher, or Shift+Tab back onto it,
 * hands Tab back to the sites.
 *
 * `isShown` is the shell's answer to "is the row on screen right now";
 * the listener sits on the document so it outlives every rebuild of
 * the row. Returns a teardown.
 */
export function installSiteSwitcherKeys(
	deps: {
		multisite: () => MultisiteConfig | null | undefined;
		isShown: () => boolean;
	} & SiteSwitchDeps,
): () => void {
	const onKey = ( e: KeyboardEvent ): void => {
		if ( e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented ) {
			return;
		}
		const multisite = deps.multisite();
		if ( ! multisite || ! deps.isShown() || isTextEntryFocus( document ) ) {
			return;
		}
		const doc = ( e.target as Node | null )?.ownerDocument ?? document;
		const active = doc.activeElement;
		if (
			active &&
			active.closest( '.os-overview-top-bar' ) &&
			! active.closest( '.os-site-switcher' )
		) {
			return;
		}
		// A site without OpenStation opens a browser tab, not a switch, so
		// Tab steps over it.
		const current = multisite.current ?? '';
		const entries = siteSwitcherEntries( multisite ).filter(
			( x ) => ! x.tabUrl || x.value === current,
		);
		if ( entries.length < 2 ) {
			return;
		}
		const at = entries.findIndex( ( x ) => x.value === current );
		const step = e.shiftKey ? -1 : 1;
		const next = entries[ ( at + step + entries.length ) % entries.length ];
		e.preventDefault();
		switchToSite( multisite, next.value, deps );
	};
	document.addEventListener( 'keydown', onKey );
	return () => document.removeEventListener( 'keydown', onKey );
}

/** The mark an external site wears before its name. */
function externalMark(): HTMLElement {
	const mark = document.createElement( 'span' );
	mark.className = 'dashicons dashicons-external os-site-switcher__mark';
	mark.setAttribute( 'aria-hidden', 'true' );
	return mark;
}

/**
 * Build the switcher, or null when there is nothing to switch between:
 * a lone instance is no choice, and a row that only names where the
 * user already stands is noise above their desktops.
 *
 * @param multisite The shell's multisite block.
 * @param deps      Collaborators, both optional; see `SiteSwitchDeps`.
 */
export function buildSiteSwitcher(
	multisite: MultisiteConfig,
	deps: SiteSwitchDeps = {},
): HTMLElement | null {
	const hop = deps.hop ?? hopToAdmin;
	const entries = siteSwitcherEntries( multisite );
	if ( entries.length < 2 ) {
		return null;
	}
	const current = multisite.current ?? '';
	const byValue = new Map( entries.map( ( e ) => [ e.value, e ] ) );

	const group = document.createElement( 'os-segmented' );
	group.className = 'os-site-switcher';
	group.setAttribute( 'label', __( 'Site' ) );
	group.setAttribute( 'value', current );
	let divided = false;
	for ( const entry of entries ) {
		if ( entry.external && ! divided ) {
			// One line, before the first external site: the row reads as
			// this network's sites, then the ones that joined it.
			divided = true;
			const divider = document.createElement( 'span' );
			divider.className = 'os-site-switcher__divider';
			divider.setAttribute( 'role', 'separator' );
			divider.setAttribute( 'aria-orientation', 'vertical' );
			group.appendChild( divider );
		}
		const segment = document.createElement( 'os-segment' );
		segment.setAttribute( 'value', entry.value );
		if ( entry.external ) {
			segment.setAttribute( 'data-external', '' );
			segment.title = __( 'External site' );
			segment.appendChild( externalMark() );
			const spoken = document.createElement( 'span' );
			spoken.className = 'screen-reader-text';
			spoken.textContent = __( 'External site:' ) + ' ';
			segment.appendChild( spoken );
		} else if ( entry.tabUrl ) {
			segment.setAttribute( 'data-opens-tab', '' );
			segment.title = __( 'OpenStation is not active on this site. Opens its admin in a new tab.' );
			segment.appendChild( externalMark() );
			const spoken = document.createElement( 'span' );
			spoken.className = 'screen-reader-text';
			spoken.textContent = __( 'Opens in a new tab:' ) + ' ';
			segment.appendChild( spoken );
		}
		segment.appendChild( document.createTextNode( entry.label ) );
		group.appendChild( segment );
	}

	// The side-by-side gesture, decided BEFORE the segment's own click
	// turns into a pick: stopped here, the group never re-selects, so
	// the current segment stays lit while the other site opens beside
	// this one. `auxclick` is the middle button, which never fires
	// `click` at all.
	const openBeside = ( e: MouseEvent ): void => {
		const segment = ( e.target as Element | null )?.closest( 'os-segment' );
		const entry = segment
			? byValue.get( segment.getAttribute( 'value' ) ?? '' )
			: undefined;
		if ( ! entry ) {
			return;
		}
		// A site without OpenStation always opens beside this one, on
		// any click, so the current segment stays lit.
		if ( entry.tabUrl && ( e.type === 'click' || 1 === e.button ) ) {
			e.preventDefault();
			e.stopPropagation();
			window.open( entry.tabUrl, '_blank', 'noopener' );
			return;
		}
		if ( ! wantsBrowserTab( e ) ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		const plain = shellUrlInOverview( entry.shellUrl );
		if ( ! deps.mint || ! entry.foreign ) {
			hop( plain, e );
			return;
		}
		// Another install beside this one still wants the login token,
		// but a tab opened after an await is a popup to the browser. So
		// the tab opens inside the click, empty, and gets the minted URL
		// once signed, the plain one when the mint fails; a blocked tab
		// falls back to the same hop a plain click takes.
		const tab = window.open( '', '_blank' );
		void deps.mint( entry.shellUrl, 'next' )
			.catch( () => null )
			.then( ( url ) => {
				if ( tab ) {
					tab.location.href = url ?? plain;
				} else {
					hop( plain, e );
				}
			} );
	};
	group.addEventListener( 'click', openBeside, true );
	group.addEventListener( 'auxclick', openBeside, true );

	group.addEventListener( 'os-pick', ( e: Event ) => {
		const value = ( e as CustomEvent< { value?: string } > ).detail?.value;
		if ( value ) {
			switchToSite( multisite, value, deps );
		}
	} );

	return group;
}
