import { applyFilters, HOOKS } from '../hooks';
import { __ } from '../i18n';
import { throwOnRegistrationErrors } from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type { UnfocusEffectDef } from './types';

type RegistryListener = () => void;

export const UNFOCUS_EFFECT_NONE = 'none';

interface UnfocusEffectRegistryStore {
	registry: Map< string, UnfocusEffectDef >;
	listeners: Set< RegistryListener >;
}
const store = createSharedStore< UnfocusEffectRegistryStore >(
	'desktop-mode/unfocus-effect-registry',
	() => ( { registry: new Map(), listeners: new Set() } ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const UNFOCUS_EFFECT_ID = /^[a-z0-9_/-]+$/;

export function registerUnfocusEffect( def: UnfocusEffectDef ): void {
	const errors: string[] = [];

	if ( ! def || typeof def !== 'object' ) {
		errors.push( 'def (not an object)' );
	} else {
		if ( typeof def.id !== 'string' || def.id.trim() === '' ) {
			errors.push( 'id (missing)' );
		} else if ( ! UNFOCUS_EFFECT_ID.test( def.id.trim().toLowerCase() ) ) {
			errors.push(
				`id (must match ${ UNFOCUS_EFFECT_ID } — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-id)`,
			);
		} else if ( def.id.trim().toLowerCase() === UNFOCUS_EFFECT_NONE ) {
			errors.push( 'id ("none" is reserved)' );
		}
		if ( typeof def.label !== 'string' || def.label.trim() === '' ) {
			errors.push( 'label (missing)' );
		}
		if (
			typeof def.className !== 'string' &&
			typeof def.apply !== 'function'
		) {
			errors.push(
				'className|apply (at least one must be provided — a CSS class to toggle or an apply callback)',
			);
		}
	}

	throwOnRegistrationErrors( 'UnfocusEffect', errors, def );

	const id = def.id.trim().toLowerCase();
	registry.set( id, { ...def, id } );
	notify();
}

export function unregisterUnfocusEffect( id: string ): void {
	if ( registry.delete( id.toLowerCase() ) ) {
		notify();
	}
}

export function unregisterUnfocusEffectsByOwner( owner: string ): number {
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

export function listUnfocusEffects(): UnfocusEffectDef[] {
	const copy = Array.from( registry.values() );
	const filtered = applyFilters< UnfocusEffectDef[] >(
		HOOKS.UNFOCUS_EFFECTS,
		copy,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[openstation] `os.unfocus-effects` filter ' +
					'returned a non-array; falling back to registry list.',
			);
		}
		return copy;
	}
	return filtered;
}

export function getUnfocusEffect( id: string ): UnfocusEffectDef | undefined {
	return listUnfocusEffects().find( ( e ) => e.id === id );
}

export function subscribeUnfocusEffects( cb: RegistryListener ): () => void {
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
					'[openstation] unfocus-effect registry listener threw:',
					err,
				);
			}
		}
	}
}

registerUnfocusEffect( {
	id: 'darken',
	label: __( 'Darken' ),
	description: __( 'Dim unfocused windows so the focused one stands out.' ),
	className: 'os-window--fx-darken',
} );

registerUnfocusEffect( {
	id: 'frost',
	label: __( 'Frost' ),
	description: __(
		'Throw unfocused windows out of focus — a soft, frosted-glass blur, as if you were looking at them through an iced-over pane.',
	),
	className: 'os-window--fx-frost',
} );

registerUnfocusEffect( {
	id: 'grayscale',
	label: __( 'Grayscale' ),
	description: __(
		'Drain the colour from unfocused windows so the focused one is the only thing still in colour — your eye snaps right to it.',
	),
	className: 'os-window--fx-grayscale',
} );
