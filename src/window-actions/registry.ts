import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';

import type { Window as DesktopWindow } from '../window';

export interface WindowActionDef {

	id: string;

	label: string | ( ( window: DesktopWindow ) => string );

	icon?: string | ( ( window: DesktopWindow ) => string );

	order?: number;

	isVisible?: ( window: DesktopWindow ) => boolean;

	checkable?: boolean;

	checked?: ( window: DesktopWindow ) => boolean;

	closeOnSelect?: boolean;

	onSelect: ( window: DesktopWindow ) => void;

	owner?: string;
}

interface RegistryStore {
	registry: Map< string, WindowActionDef >;
	listeners: Set< () => void >;
}
const store = createSharedStore< RegistryStore >(
	'desktop-mode/window-actions-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const WINDOW_ACTION_ID = /^[a-z0-9_/-]+$/;

function notify(): void {
	for ( const listener of Array.from( listeners ) ) {
		try {
			listener();
		} catch {

		}
	}
}

export function registerWindowAction( def: WindowActionDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! WINDOW_ACTION_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ WINDOW_ACTION_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		}
		if (
			typeof def.label !== 'string' &&
			typeof def.label !== 'function'
		) {
			errors.push( 'label (must be a string or a function)' );
		} else if ( typeof def.label === 'string' && def.label.trim() === '' ) {
			errors.push( 'label (empty)' );
		}
		if ( typeof def.onSelect !== 'function' ) {
			errors.push( 'onSelect (must be a function)' );
		}
		if (
			def.isVisible !== undefined &&
			typeof def.isVisible !== 'function'
		) {
			errors.push( 'isVisible (must be a function when set)' );
		}
		if ( def.checked !== undefined && typeof def.checked !== 'function' ) {
			errors.push( 'checked (must be a function when set)' );
		} else if ( def.checkable && typeof def.checked !== 'function' ) {
			errors.push( 'checked (required when checkable is set)' );
		}
	}

	throwOnRegistrationErrors( 'WindowAction', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterWindowAction( id: string ): void {
	if ( registry.delete( String( id || '' ).toLowerCase() ) ) {
		notify();
	}
}

export function unregisterWindowActionsByOwner( owner: string ): number {
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

export function listWindowActions(): WindowActionDef[] {
	return Array.from( registry.values() ).sort(
		( a, b ) => ( a.order ?? 100 ) - ( b.order ?? 100 ),
	);
}

export function subscribeWindowActions( listener: () => void ): () => void {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

export function resolveActionLabel(
	def: WindowActionDef,
	window: DesktopWindow,
): string {
	if ( typeof def.label === 'function' ) {
		try {
			return String( def.label( window ) ?? '' );
		} catch {
			return '';
		}
	}
	return def.label;
}

export function resolveActionIcon(
	def: WindowActionDef,
	window: DesktopWindow,
): string {
	if ( typeof def.icon === 'function' ) {
		try {
			return String( def.icon( window ) ?? '' );
		} catch {
			return '';
		}
	}
	return def.icon ?? '';
}

export function isActionChecked(
	def: WindowActionDef,
	window: DesktopWindow,
): boolean {
	if ( ! def.checkable || typeof def.checked !== 'function' ) {
		return false;
	}
	try {
		return !! def.checked( window );
	} catch {
		return false;
	}
}

export function isActionVisible(
	def: WindowActionDef,
	window: DesktopWindow,
): boolean {
	if ( typeof def.isVisible !== 'function' ) {
		return true;
	}
	try {
		return !! def.isVisible( window );
	} catch {
		return false;
	}
}
