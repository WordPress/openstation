import { throwOnRegistrationErrors } from '../../registration-errors';
import { createSharedStore } from '../../shared-store';

import type { Window as DesktopWindow } from '../../window';

export type WindowSlotName =
	| 'before-titlebar'
	| 'before-icon'
	| 'icon'
	| 'title'
	| 'after-title'
	| 'before-controls'
	| 'controls'
	| 'after-controls'
	| 'after-titlebar';

export type WindowSlotTeardown = () => void;

export interface WindowSlotRenderContext {

	window: DesktopWindow;

	slot: WindowSlotName;
}

export interface WindowSlotDef {

	id: string;

	slot: WindowSlotName;

	match: ( window: DesktopWindow ) => boolean;

	render: (
		host: HTMLElement,
		ctx: WindowSlotRenderContext,
	) => void | WindowSlotTeardown;

	order?: number;

	replace?: boolean;

	owner?: string;
}

interface RegistryStore {
	registry: Map< string, WindowSlotDef >;
	listeners: Set< () => void >;
}
const store = createSharedStore< RegistryStore >(
	'desktop-mode/window-slots-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const WINDOW_SLOT_ID = /^[a-z0-9_/-]+$/;

const KNOWN_SLOTS: ReadonlySet< WindowSlotName > = new Set( [
	'before-titlebar',
	'before-icon',
	'icon',
	'title',
	'after-title',
	'before-controls',
	'controls',
	'after-controls',
	'after-titlebar',
] );

export function registerWindowSlot( def: WindowSlotDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_SLOT_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_SLOT_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if ( typeof def.slot !== 'string' || def.slot.trim() === '' ) {
			errors.push( 'slot (missing)' );
		} else if ( ! KNOWN_SLOTS.has( def.slot as WindowSlotName ) ) {
			errors.push(
				`slot (must be one of ${ Array.from( KNOWN_SLOTS ).join( ', ' ) })`,
			);
		}
		if ( typeof def.match !== 'function' ) {
			errors.push( 'match (must be a function)' );
		}
		if ( typeof def.render !== 'function' ) {
			errors.push( 'render (must be a function)' );
		}
	}

	throwOnRegistrationErrors( 'WindowSlot', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterWindowSlot( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterWindowSlotsByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, def ] of Array.from( registry.entries() ) ) {
		if ( def.owner === owner ) {
			registry.delete( id );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

export function listWindowSlots(): WindowSlotDef[] {
	return Array.from( registry.values() ).sort( ( a, b ) => {
		const oa = a.order ?? 100;
		const ob = b.order ?? 100;
		if ( oa !== ob ) {
			return oa - ob;
		}
		return a.id.localeCompare( b.id );
	} );
}

export function slotsForWindow(
	win: DesktopWindow,
	slot: WindowSlotName,
): WindowSlotDef[] {
	const out: WindowSlotDef[] = [];
	for ( const def of listWindowSlots() ) {
		if ( def.slot !== slot ) {
			continue;
		}
		try {
			if ( ! def.match( win ) ) {
				continue;
			}
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					`[openstation] window-slot "${ def.id }" match() threw — skipping`,
					err,
				);
			}
			continue;
		}
		out.push( def );
	}
	return out;
}

export function subscribeWindowSlots( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[openstation] window-slot registry listener threw:',
					err,
				);
			}
		}
	}
}

export function _resetWindowSlotRegistryForTests(): void {
	registry.clear();
	listeners.clear();
}
