import { applyFilters, doAction, HOOKS } from '../../hooks';
import { slotsForWindow } from './registry';

import type { Window as DesktopWindow } from '../../window';
import type { WindowSlotName } from '../../types';

const SLOT_NAMES: ReadonlyArray< WindowSlotName > = [
	'before-titlebar',
	'before-icon',
	'icon',
	'title',
	'after-title',
	'before-controls',
	'after-controls',
	'after-titlebar',
];

const defaultsCache = new WeakMap<
	HTMLElement,
	Map< WindowSlotName, ChildNode[] >
>();

function getSlotHost(
	root: HTMLElement,
	name: WindowSlotName,
): HTMLElement | null {
	return root.querySelector< HTMLElement >(
		`[data-slot="${ name }"]`,
	);
}

function captureDefaults( root: HTMLElement ): Map< WindowSlotName, ChildNode[] > {
	const map = new Map< WindowSlotName, ChildNode[] >();
	for ( const name of SLOT_NAMES ) {
		const host = getSlotHost( root, name );
		if ( ! host ) {
			continue;
		}
		map.set( name, Array.from( host.childNodes ).map( ( n ) => n.cloneNode( true ) as ChildNode ) );
	}
	return map;
}

function clearHost( host: HTMLElement ): void {
	while ( host.firstChild ) {
		host.removeChild( host.firstChild );
	}
}

function restoreDefault(
	host: HTMLElement,
	defaults: ChildNode[],
): void {
	clearHost( host );
	for ( const node of defaults ) {
		host.appendChild( node.cloneNode( true ) );
	}
}

function syncRestoredTitle( host: HTMLElement, title: string ): void {
	const titleEl = host.querySelector< HTMLElement >( '.os-window__title' );
	if ( titleEl ) {
		titleEl.textContent = title;
	}
}

export function paintWindowSlots( win: DesktopWindow ): () => void {
	const teardowns: Array< () => void > = [];
	const root = win.element;
	if ( ! root ) {
		return () => {};
	}

	let defaults = defaultsCache.get( root );
	if ( ! defaults ) {
		defaults = captureDefaults( root );
		defaultsCache.set( root, defaults );
	}

	const overrides = win.config.appearance?.slots ?? {};

	for ( const name of SLOT_NAMES ) {
		const host = getSlotHost( root, name );
		if ( ! host ) {
			continue;
		}
		const slotDefaults = defaults.get( name ) ?? [];
		const override = overrides[ name as keyof typeof overrides ];
		const matchingRegistry = slotsForWindow( win, name );

		if ( override === null ) {
			clearHost( host );
		} else if ( override && 'html' in override ) {
			clearHost( host );
			host.textContent = override.html;
		} else if ( override && 'render' in override ) {
			const replace = override.replace !== false;
			if ( replace ) {
				clearHost( host );
			}
			try {
				const teardown = override.render( host );
				if ( typeof teardown === 'function' ) {
					teardowns.push( teardown );
				}
			} catch ( err ) {
				doAction( HOOKS.SHELL_ERROR, {
					scope: 'window-slot-inline-render',
					windowId: win.id,
					slot: name,
					error: err,
				} );
			}
		} else {
			restoreDefault( host, slotDefaults );
			if ( name === 'title' ) {
				syncRestoredTitle( host, win.config.title );
			}
		}

		if ( override !== null ) {
			let firstReplaceFired = false;
			for ( const def of matchingRegistry ) {
				const replace = def.replace !== false;
				if ( replace && ! firstReplaceFired ) {
					clearHost( host );
					firstReplaceFired = true;
				}
				try {
					const teardown = def.render( host, { window: win, slot: name } );
					if ( typeof teardown === 'function' ) {
						teardowns.push( teardown );
					}
				} catch ( err ) {
					doAction( HOOKS.SHELL_ERROR, {
						scope: 'window-slot-registry-render',
						windowId: win.id,
						slot: name,
						id: def.id,
						error: err,
					} );
				}
			}
		}

		applyFilters< HTMLElement, [ { windowId: string; slot: WindowSlotName; config: DesktopWindow[ 'config' ] } ] >(
			HOOKS.WINDOW_CHROME_SLOT,
			host,
			{ windowId: win.id, slot: name, config: win.config },
		);
	}

	doAction( HOOKS.WINDOW_CHROME_APPLIED, {
		windowId: win.id,
		layer: 'slots',
	} );

	return () => {
		for ( const fn of teardowns ) {
			try {
				fn();
			} catch {

			}
		}
	};
}
