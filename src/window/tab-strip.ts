export interface PanelTabEntry {

	value: string;

	label: string;
}

export const PANEL_TAB_CHANGE_EVENT = 'os-window-tab-change';

function tabsIn( strip: HTMLElement ): HTMLElement[] {
	return Array.from(
		strip.querySelectorAll< HTMLElement >( '.os-window__tab' ),
	);
}

function slug( value: string ): string {
	return value.replace( /[^a-zA-Z0-9_-]/g, '-' );
}

function tabId( winEl: HTMLElement, value: string ): string {
	return `${ winEl.id || 'os-window' }-tab-${ slug( value ) }`;
}

function panelId( winEl: HTMLElement, value: string ): string {
	return `${ winEl.id || 'os-window' }-panel-${ slug( value ) }`;
}

export function positionTabPlate( strip: HTMLElement ): void {
	const plate = strip.querySelector< HTMLElement >(
		'.os-window__tab-plate',
	);
	if ( ! plate ) {
		return;
	}
	const active = strip.querySelector< HTMLElement >(
		'.os-window__tab--active',
	);
	if ( ! active ) {
		plate.dataset.empty = '';
		strip.dataset.tabPlateEmpty = '';
		return;
	}
	delete plate.dataset.empty;
	delete strip.dataset.tabPlateEmpty;
	strip.style.setProperty( '--_tab-plate-x', `${ active.offsetLeft }px` );
	strip.style.setProperty( '--_tab-plate-w', `${ active.offsetWidth }px` );
	strip.style.setProperty( '--_tab-strip-w', `${ strip.clientWidth }px` );

	if ( active.offsetWidth > 0 ) {
		plate.dataset.placed = '';
	}
}

export function syncTabStripSemantics( strip: HTMLElement | null ): void {
	if ( ! strip ) {
		return;
	}
	if ( strip.querySelector( ':scope > .os-window__tab' ) ) {
		strip.setAttribute( 'role', 'tablist' );
		const label = strip.dataset.tablistLabel;
		if ( label ) {
			strip.setAttribute( 'aria-label', label );
		}
		return;
	}
	strip.setAttribute( 'role', 'presentation' );
	strip.removeAttribute( 'aria-label' );
}

export function syncTabRoving( strip: HTMLElement ): void {
	const tabs = tabsIn( strip );
	if ( tabs.length === 0 ) {
		return;
	}
	const active =
		tabs.find( ( t ) => t.classList.contains( 'os-window__tab--active' ) ) ??
		tabs[ 0 ];
	for ( const tab of tabs ) {
		const next = tab === active ? 0 : -1;

		if ( tab.tabIndex !== next ) {
			tab.tabIndex = next;
		}
	}
}

export function handleTabStripKeydown( strip: HTMLElement, e: Event ): void {
	const event = e as KeyboardEvent;
	if ( event.altKey || event.ctrlKey || event.metaKey ) {
		return;
	}
	const target = event.target as HTMLElement | null;
	const current = target?.closest< HTMLElement >( '.os-window__tab' );
	if ( ! current ) {
		return;
	}
	const tabs = tabsIn( strip );
	const index = tabs.indexOf( current );
	if ( index < 0 ) {
		return;
	}

	const rtl = getComputedStyle( strip ).direction === 'rtl';
	let next: HTMLElement | undefined;
	switch ( event.key ) {
		case 'ArrowRight':
			next = tabs[ rtl ? index - 1 : index + 1 ];
			break;
		case 'ArrowLeft':
			next = tabs[ rtl ? index + 1 : index - 1 ];
			break;
		case 'Home':
			next = tabs[ 0 ];
			break;
		case 'End':
			next = tabs[ tabs.length - 1 ];
			break;
		default:
			return;
	}
	if ( ! next || next === current ) {
		return;
	}
	event.preventDefault();
	current.tabIndex = -1;
	next.tabIndex = 0;
	next.focus();

	next.scrollIntoView?.( { block: 'nearest', inline: 'nearest' } );
}

function panelTabsIn( strip: HTMLElement ): Map< string, HTMLElement > {
	const found = new Map< string, HTMLElement >();
	for ( const tab of tabsIn( strip ) ) {
		if ( tab.dataset.kind === 'panel' && tab.dataset.panel ) {
			found.set( tab.dataset.panel, tab );
		}
	}
	return found;
}

function panesIn( winEl: HTMLElement ): HTMLElement[] {
	const body = winEl.querySelector< HTMLElement >( '.os-window__body' );
	if ( ! body ) {
		return [];
	}
	return Array.from(
		body.querySelectorAll< HTMLElement >( 'os-tabpanel[ for ]' ),
	).filter(
		( pane ) => ! pane.parentElement?.closest( 'os-tabpanel, os-tabs' ),
	);
}

export function activatePanelTab( winEl: HTMLElement, value: string ): void {
	const strip = winEl.querySelector< HTMLElement >( '.os-window__tabs' );
	if ( ! strip ) {
		return;
	}
	let matched = false;
	for ( const [ tabValue, tab ] of panelTabsIn( strip ) ) {
		const on = tabValue === value;
		matched = matched || on;
		tab.classList.toggle( 'os-window__tab--active', on );
		tab.setAttribute( 'aria-selected', on ? 'true' : 'false' );
	}
	if ( ! matched ) {
		return;
	}
	for ( const pane of panesIn( winEl ) ) {
		const on = pane.getAttribute( 'for' ) === value;
		pane.toggleAttribute( 'hidden', ! on );
		pane.setAttribute( 'aria-hidden', on ? 'false' : 'true' );
	}
	syncTabRoving( strip );
	positionTabPlate( strip );
	winEl.dispatchEvent(
		new CustomEvent( PANEL_TAB_CHANGE_EVENT, {
			bubbles: true,
			detail: { value },
		} ),
	);
}

export function setPanelTabs(
	winEl: HTMLElement,
	entries: readonly PanelTabEntry[],
	activeValue?: string,
): void {
	const strip = winEl.querySelector< HTMLElement >( '.os-window__tabs' );
	if ( ! strip ) {
		return;
	}
	const existing = panelTabsIn( strip );
	const previouslyActive = Array.from( existing.entries() ).find( ( [ , t ] ) =>
		t.classList.contains( 'os-window__tab--active' ),
	)?.[ 0 ];

	let after: Element | null = strip.querySelector(
		'.os-window__tab-plate',
	);

	for ( const entry of entries ) {
		let tab = existing.get( entry.value );
		if ( tab ) {
			existing.delete( entry.value );
		} else {
			const button = document.createElement( 'button' );

			button.type = 'button';
			tab = button;
			tab.className = 'os-window__tab';
			tab.dataset.kind = 'panel';
			tab.dataset.panel = entry.value;
			tab.setAttribute( 'role', 'tab' );
			tab.setAttribute( 'aria-selected', 'false' );
			tab.tabIndex = -1;
		}
		if ( tab.textContent !== entry.label ) {
			tab.textContent = entry.label;
		}
		tab.id = tabId( winEl, entry.value );
		tab.setAttribute( 'aria-controls', panelId( winEl, entry.value ) );

		if ( tab.previousElementSibling !== after ) {
			strip.insertBefore( tab, after ? after.nextSibling : strip.firstChild );
		}
		after = tab;
	}

	for ( const stale of existing.values() ) {
		stale.remove();
	}

	syncTabStripSemantics( strip );

	const paired = strip.querySelector( ':scope > .os-window__tab' ) !== null;
	for ( const pane of panesIn( winEl ) ) {
		const value = pane.getAttribute( 'for' );
		if ( ! value ) {
			continue;
		}
		pane.id = panelId( winEl, value );
		if ( paired ) {
			pane.setAttribute( 'aria-labelledby', tabId( winEl, value ) );
		} else {
			pane.removeAttribute( 'aria-labelledby' );
		}
	}

	const valid = ( v: string | undefined ): v is string =>
		v !== undefined && entries.some( ( e ) => e.value === v );
	const next = [ activeValue, previouslyActive, entries[ 0 ]?.value ].find(
		valid,
	);
	if ( next !== undefined ) {
		activatePanelTab( winEl, next );
	}
}
