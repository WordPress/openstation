import type { MultisiteConfig } from '../types';
import { hopToAdmin, wantsBrowserTab, type HopMinter } from './hop';
import { leaveInstance, type HopDirection } from './instance-transition';
import { isTextEntryFocus } from '../window-manager/switcher';
import { __ } from '../i18n';

import '../ui/components/os-segmented/os-segmented';

export const OVERVIEW_ARG = 'openstation_overview';

export interface SiteSwitcherEntry {

	value: string;
	label: string;

	shellUrl: string;

	external: boolean;

	foreign: boolean;

	tabUrl?: string;
}

export const HOP_FROM_ARG = 'openstation_hop_from';

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

export function isOtherOrigin( shellUrl: string ): boolean {
	try {
		return new URL( shellUrl, window.location.href ).origin !== window.location.origin;
	} catch {
		return false;
	}
}

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

export interface SiteSwitchDeps {

	hop?: ( url: string, event?: MouseEvent ) => void;

	mint?: HopMinter;
}

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

function externalMark(): HTMLElement {
	const mark = document.createElement( 'span' );
	mark.className = 'dashicons dashicons-external os-site-switcher__mark';
	mark.setAttribute( 'aria-hidden', 'true' );
	return mark;
}

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

	const openBeside = ( e: MouseEvent ): void => {
		const segment = ( e.target as Element | null )?.closest( 'os-segment' );
		const entry = segment
			? byValue.get( segment.getAttribute( 'value' ) ?? '' )
			: undefined;
		if ( ! entry ) {
			return;
		}

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
