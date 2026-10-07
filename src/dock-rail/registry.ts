import { createSharedStore } from '../shared-store';
import type { DockRailRenderer } from './types';

interface DockRailRegistryStore {
	registry: Map< string, DockRailRenderer >;
	listeners: Set< () => void >;
	activeId: string;
}
const store = createSharedStore< DockRailRegistryStore >(
	'desktop-mode/dock-rail-registry',
	() => ( {
		registry: new Map< string, DockRailRenderer >(),
		listeners: new Set<() => void >(),
		activeId: 'default',
	} ),
);
const registry = store.state.registry;
const listeners = store.state.listeners;

const ID_RE = /^[a-z0-9_-]+$/;

export function register( renderer: DockRailRenderer ): void {
	if ( ! renderer || typeof renderer !== 'object' ) {
		throw new TypeError(
			'[openstation] registerDockRailRenderer: renderer must be an object.',
		);
	}
	if ( typeof renderer.id !== 'string' || ! ID_RE.test( renderer.id ) ) {
		throw new TypeError(
			`[openstation] registerDockRailRenderer: id must match /^[a-z0-9_-]+$/, got: ${ String( renderer.id ) }`,
		);
	}
	if ( typeof renderer.label !== 'string' || renderer.label === '' ) {
		throw new TypeError(
			'[openstation] registerDockRailRenderer: label must be a non-empty string.',
		);
	}
	if ( typeof renderer.mount !== 'function' ) {
		throw new TypeError(
			'[openstation] registerDockRailRenderer: mount must be a function.',
		);
	}
	if (
		renderer.apiVersion !== undefined &&
		renderer.apiVersion !== 1
	) {
		throw new TypeError(
			`[openstation] registerDockRailRenderer: unsupported apiVersion ${ renderer.apiVersion } (this shell speaks v1).`,
		);
	}
	registry.set( renderer.id, renderer );
	notify();
}

export function unregister( id: string ): void {
	if ( registry.delete( id ) ) {
		notify();
	}
}

export function unregisterByOwner( owner: string ): number {
	if ( ! owner ) {
		return 0;
	}
	let removed = 0;
	for ( const [ id, renderer ] of Array.from( registry.entries() ) ) {
		if ( renderer.owner === owner ) {
			registry.delete( id );
			removed++;
		}
	}
	if ( removed > 0 ) {
		notify();
	}
	return removed;
}

export function get( id: string ): DockRailRenderer | undefined {
	return registry.get( id );
}

export function list(): DockRailRenderer[] {
	return Array.from( registry.values() );
}

export function subscribe( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

export function setActiveRenderer( id: string ): void {
	if ( store.state.activeId === id ) {
		return;
	}
	store.state.activeId = id;
	notify();
}

export function getActiveRendererId(): string {
	return store.state.activeId;
}

export function resolveActive(): DockRailRenderer | undefined {
	return (
		registry.get( store.state.activeId ) ??
		registry.get( 'default' ) ??
		registry.values().next().value
	);
}

export function _resetForTests(): void {
	registry.clear();
	listeners.clear();
	store.state.activeId = 'default';
}

function notify(): void {
	const snapshot = Array.from( listeners );
	for ( const cb of snapshot ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[openstation] dock-rail-renderer listener threw:',
					err,
				);
			}
		}
	}
}
