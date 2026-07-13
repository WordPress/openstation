/**
 * Desktop Mode — Window content-relations engine.
 *
 * Pure state + events, per the event-driven doctrine: the engine
 * tracks which content each window shows, computes relation groups
 * from it, and broadcasts changes. It never draws anything — that's
 * the pluggable link renderers' job (`render-host.ts`).
 *
 * Identities arrive from three sources: seeded from
 * `WindowConfig.content` when a window opens, announced by the
 * chromeless iframe bridge (`desktop-mode-content-identity`, the
 * authoritative path for admin pages), or set explicitly via
 * `wp.desktop.relations.set()`.
 *
 * Cross-bundle: all state lives in a `createSharedStore` record
 * because identities are written from the window-system bundle (the
 * iframe-bridge message handler) and read from the main shell bundle
 * and the lazy OS-Settings panel — see AGENTS.md → "Cross-bundle
 * state".
 *
 * @since 0.9.4
 */

import { addAction, applyFilters, doAction, HOOKS } from '../hooks';
import {
	collectRegistrationErrors,
	logRegistrationErrors,
	throwOnRegistrationErrors,
} from '../registration-errors';
import { createSharedStore } from '../shared-store';
import type {
	WindowContentRef,
	WindowLinkEdge,
	WindowLinkGroup,
	WindowRelationsApi,
} from './types';

/**
 * Cap on stored `links` per identity — a post with hundreds of
 * internal links shouldn't turn the desktop into a loom.
 *
 * @internal
 */
const MAX_LINKS = 32;

/**
 * Valid content/root type: lower-case alphanum, hyphen, underscore,
 * slash — same shape as every other registry so third parties can
 * namespace `vendor/sub-type`.
 *
 * @internal
 */
const CONTENT_TYPE_ID = /^[a-z0-9_/-]+$/;

type EngineListener = () => void;

/**
 * The subset of the window manager the engine needs — structural so
 * tests can hand in a two-line fake.
 */
interface EngineManager {
	getById: (
		id: string,
	) => { config?: { content?: WindowContentRef } } | null | undefined;
	/**
	 * Map a `MessageEvent.source` back to the window whose iframe sent
	 * it — used by the engine's own `desktop-mode-content-identity`
	 * listener. Optional so unit-test fakes stay tiny.
	 */
	findByIframeSource?: (
		source: MessageEventSource | null,
	) => { id: string } | null | undefined;
}

interface WindowLinksStore {
	contentByWindow: Map< string, WindowContentRef >;
	/** Monotonic focus counter per window, for root-recency ordering. */
	focusSeq: Map< string, number >;
	seq: number;
	listeners: Set< EngineListener >;
	/** Membership signature of the last groups broadcast. */
	lastGroupsSignature: string;
	manager: EngineManager | null;
	started: boolean;
}

const store = createSharedStore< WindowLinksStore >(
	'desktop-mode/window-links',
	() => ( {
		contentByWindow: new Map(),
		focusSeq: new Map(),
		seq: 0,
		listeners: new Set(),
		lastGroupsSignature: '',
		manager: null,
		started: false,
	} ),
);

/** Stable object key: `'post:123'`. */
function keyOf( ref: { type: string; id: number | string } ): string {
	return `${ ref.type }:${ ref.id }`;
}

/** The group key a ref resolves to — its root's key, or its own. */
function rootKeyOf( ref: WindowContentRef ): string {
	return ref.root ? keyOf( ref.root ) : keyOf( ref );
}

function validateRef( ref: unknown ): string[] {
	const isValidId = ( v: unknown ): boolean =>
		( typeof v === 'number' && Number.isFinite( v ) ) ||
		( typeof v === 'string' && v.trim() !== '' );
	const isValidType = ( v: unknown ): boolean =>
		typeof v === 'string' &&
		CONTENT_TYPE_ID.test( v.trim().toLowerCase() );
	return collectRegistrationErrors< WindowContentRef >( ref, [
		{
			field: 'type',
			valid: ( r ) => isValidType( r.type ),
			message:
				'must match /^[a-z0-9_/-]+$/ — lowercase alphanum, hyphens, underscores, slashes for vendor/sub-type',
		},
		{
			field: 'id',
			valid: ( r ) => isValidId( r.id ),
			message: 'must be a finite number or non-empty string',
		},
		{
			field: 'root',
			valid: ( r ) =>
				r.root === undefined ||
				( !! r.root &&
					typeof r.root === 'object' &&
					isValidType( r.root.type ) &&
					isValidId( r.root.id ) ),
			message:
				'when present, must be { type, id } with the same shapes as the ref itself',
		},
		{
			field: 'links',
			valid: ( r ) =>
				r.links === undefined ||
				( Array.isArray( r.links ) &&
					r.links.every(
						( l ) =>
							!! l &&
							typeof l === 'object' &&
							isValidType( l.type ) &&
							isValidId( l.id ) &&
							( l.rel === undefined ||
								l.rel === 'references' ||
								l.rel === 'child' ),
					) ),
			message:
				"when present, must be an array of { type, id, rel?: 'references'|'child' } entries",
		},
	] );
}

/** Normalize a validated ref: trimmed lowercase types, stamped source. */
function normalizeRef(
	ref: WindowContentRef,
	source: 'config' | 'bridge' | 'api',
): WindowContentRef {
	const next: WindowContentRef = {
		type: ref.type.trim().toLowerCase(),
		id: ref.id,
		source,
	};
	if ( ref.root ) {
		next.root = {
			type: ref.root.type.trim().toLowerCase(),
			id: ref.root.id,
		};
	}
	if ( Array.isArray( ref.links ) && ref.links.length > 0 ) {
		next.links = ref.links.slice( 0, MAX_LINKS ).map( ( l ) => {
			const entry: NonNullable< WindowContentRef[ 'links' ] >[ number ] =
				{
					type: l.type.trim().toLowerCase(),
					id: l.id,
				};
			if ( l.rel === 'child' ) {
				entry.rel = 'child';
			}
			return entry;
		} );
	}
	if ( typeof ref.label === 'string' && ref.label !== '' ) {
		next.label = ref.label;
	}
	return next;
}

/** Stable serialization of a ref's relation-relevant parts. */
function refSignature( ref: WindowContentRef | null ): string {
	if ( ! ref ) {
		return '';
	}
	return [
		keyOf( ref ),
		rootKeyOf( ref ),
		...( ref.links ?? [] ).map(
			( l ) => keyOf( l ) + ( l.rel === 'child' ? '!child' : '' ),
		),
	].join( '|' );
}

/**
 * Set (or clear, with `null`) a window's content identity.
 *
 * The `desktop-mode.window-links.content` filter runs on every set —
 * a plugin can rewrite the ref (remap a custom type onto its own root
 * scheme) or return `null` to suppress it. Fires
 * `desktop-mode.window-links.content-changed` (hook + CustomEvent),
 * then recomputes groups.
 *
 * Malformed refs throw for `'api'` callers (audible failure at the
 * call site, like every registry) but only log for `'bridge'` /
 * `'config'` so bad server data can't break the message handler.
 *
 * @param  windowId    Target window id.
 * @param  ref         Content ref, or `null` to clear.
 * @param  opts        Options bag.
 * @param  opts.source Provenance; defaults to `'api'`.
 * @throws {RegistrationError} on a malformed ref from an `'api'` caller.
 */
export function setWindowContent(
	windowId: string,
	ref: WindowContentRef | null,
	opts: { source?: 'config' | 'bridge' | 'api' } = {},
): void {
	const source = opts.source ?? 'api';
	if ( typeof windowId !== 'string' || windowId === '' ) {
		throwOnRegistrationErrors(
			'WindowContentRef',
			[ 'windowId (must be a non-empty string)' ],
			ref,
		);
		return;
	}

	let next: WindowContentRef | null = null;
	if ( ref !== null && ref !== undefined ) {
		const errors = validateRef( ref );
		if ( errors.length > 0 ) {
			if ( source === 'api' ) {
				throwOnRegistrationErrors( 'WindowContentRef', errors, ref );
			}
			logRegistrationErrors( 'WindowContentRef', errors, ref );
			return;
		}
		next = normalizeRef( ref, source );
	}

	// Let plugins rewrite or suppress the identity — e.g. remap a
	// custom object type onto their own root scheme.
	next = applyFilters< WindowContentRef | null >(
		HOOKS.WINDOW_LINKS_CONTENT,
		next,
		{ windowId, source },
	);
	if ( next !== null && ( ! next || validateRef( next ).length > 0 ) ) {
		logRegistrationErrors(
			'WindowContentRef',
			[ 'filter (desktop-mode.window-links.content returned an invalid ref)' ],
			next,
		);
		return;
	}

	const previous = store.state.contentByWindow.get( windowId ) ?? null;
	if ( next === null && previous === null ) {
		return;
	}
	if (
		next !== null &&
		previous !== null &&
		refSignature( next ) === refSignature( previous ) &&
		next.label === previous.label
	) {
		return;
	}

	if ( next === null ) {
		store.state.contentByWindow.delete( windowId );
	} else {
		store.state.contentByWindow.set( windowId, next );
	}

	const changedDetail = { windowId, content: next, previous, source };
	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-window-content-changed', {
			detail: changedDetail,
		} ),
	);
	doAction( HOOKS.WINDOW_CONTENT_CHANGED, changedDetail );

	broadcastGroupsIfChanged();
	notify();
}

/** Current content identity of a window, if any. */
export function getWindowContent(
	windowId: string,
): WindowContentRef | undefined {
	return store.state.contentByWindow.get( windowId );
}

/**
 * Compute every current relation group, with the
 * `desktop-mode.window-links.groups` filter applied. Groups exist as
 * soon as one window carries an identity — including root-less groups
 * (children open, parent closed) so callers can offer "open the
 * parent"; renderers simply have nothing to draw for those.
 */
export function listWindowLinkGroups(): WindowLinkGroup[] {
	const byKey = new Map< string, WindowLinkGroup >();
	for ( const [ windowId, ref ] of store.state.contentByWindow ) {
		const groupKey = rootKeyOf( ref );
		let group = byKey.get( groupKey );
		if ( ! group ) {
			group = {
				key: groupKey,
				root: ref.root
					? { ...ref.root }
					: { type: ref.type, id: ref.id },
				rootWindowIds: [],
				children: [],
			};
			byKey.set( groupKey, group );
		}
		if ( ref.root ) {
			group.children.push( { windowId, content: ref } );
		} else {
			group.rootWindowIds.push( windowId );
		}
	}
	// Most recently focused root first — the default renderer draws
	// each child's tie to rootWindowIds[0].
	const seq = store.state.focusSeq;
	for ( const group of byKey.values() ) {
		group.rootWindowIds.sort(
			( a, b ) => ( seq.get( b ) ?? 0 ) - ( seq.get( a ) ?? 0 ),
		);
	}

	const copy = Array.from( byKey.values() );
	const filtered = applyFilters< WindowLinkGroup[] >(
		HOOKS.WINDOW_LINK_GROUPS,
		copy,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[desktop-mode] `desktop-mode.window-links.groups` filter ' +
					'returned a non-array; falling back to computed groups.',
			);
		}
		return copy;
	}
	return filtered;
}

/** The group a window belongs to, if any. */
export function getWindowLinkGroup(
	windowId: string,
): WindowLinkGroup | undefined {
	return listWindowLinkGroups().find(
		( g ) =>
			g.rootWindowIds.includes( windowId ) ||
			g.children.some( ( c ) => c.windowId === windowId ),
	);
}

/**
 * Ids of the other windows tied to this one — group members plus the
 * endpoints of any `reference` edges it participates in.
 */
export function getRelatedWindowIds( windowId: string ): string[] {
	const related = new Set< string >();
	const group = getWindowLinkGroup( windowId );
	if ( group ) {
		for ( const id of [
			...group.rootWindowIds,
			...group.children.map( ( c ) => c.windowId ),
		] ) {
			related.add( id );
		}
	}
	for ( const edge of listWindowLinkEdges() ) {
		if ( edge.fromWindowId === windowId ) {
			related.add( edge.toWindowId );
		} else if ( edge.toWindowId === windowId ) {
			related.add( edge.fromWindowId );
		}
	}
	related.delete( windowId );
	return Array.from( related );
}

/**
 * Derive the directed edges between open windows, with the
 * `desktop-mode.window-links.edges` filter applied:
 *
 *  - one `child-root` edge from every child window to the most
 *    recently focused open window showing its root object;
 *  - one `reference` edge from every window whose `links` include an
 *    object another open window is showing (most recent instance);
 *  - mutual `reference` pairs collapse into a single edge with
 *    `bidirectional: true`;
 *  - a directed pair covered by BOTH a `child-root` and a `reference`
 *    edge keeps only the stronger `child-root`.
 */
export function listWindowLinkEdges(): WindowLinkEdge[] {
	const seq = store.state.focusSeq;
	// Most recently focused open window per content key.
	const windowByKey = new Map< string, string >();
	for ( const [ windowId, ref ] of store.state.contentByWindow ) {
		const key = keyOf( ref );
		const current = windowByKey.get( key );
		if (
			! current ||
			( seq.get( windowId ) ?? 0 ) > ( seq.get( current ) ?? 0 )
		) {
			windowByKey.set( key, windowId );
		}
	}

	const edges = new Map< string, WindowLinkEdge >();
	const directedKey = ( from: string, to: string ): string =>
		`${ from }→${ to }`;

	for ( const [ windowId, ref ] of store.state.contentByWindow ) {
		if ( ref.root ) {
			const target = windowByKey.get( keyOf( ref.root ) );
			if ( target && target !== windowId ) {
				edges.set( directedKey( windowId, target ), {
					fromWindowId: windowId,
					toWindowId: target,
					kind: 'child-root',
					bidirectional: false,
				} );
			}
		}
		for ( const link of ref.links ?? [] ) {
			const target = windowByKey.get( keyOf( link ) );
			if ( ! target || target === windowId ) {
				continue;
			}
			if ( link.rel === 'child' ) {
				// The linked object belongs to THIS window's content
				// (media embedded in a post) — same direction as a
				// root tie: target → declarer, "belongs to" arrow.
				// Upgrades a plain reference already on that pair.
				const key = directedKey( target, windowId );
				const existing = edges.get( key );
				if ( ! existing || existing.kind !== 'child-root' ) {
					edges.set( key, {
						fromWindowId: target,
						toWindowId: windowId,
						kind: 'child-root',
						bidirectional: false,
					} );
				}
				continue;
			}
			const key = directedKey( windowId, target );
			// `child-root` wins over `reference` on the same directed
			// pair — "belongs to" subsumes "links to".
			if ( ! edges.has( key ) ) {
				edges.set( key, {
					fromWindowId: windowId,
					toWindowId: target,
					kind: 'reference',
					bidirectional: false,
				} );
			}
		}
	}

	// Collapse mutual reference pairs into one bidirectional edge, and
	// let a child-root edge absorb a reverse reference on the same
	// pair — media attached to AND embedded in a post would otherwise
	// draw two opposite splines between the same two windows.
	const merged: WindowLinkEdge[] = [];
	const dropped = new Set< string >();
	for ( const [ key, edge ] of edges ) {
		if ( dropped.has( key ) ) {
			continue;
		}
		const reverseKey = directedKey( edge.toWindowId, edge.fromWindowId );
		const reverse = edges.get( reverseKey );
		if ( reverse && edge.kind === 'reference' ) {
			if ( reverse.kind === 'reference' ) {
				dropped.add( reverseKey );
				merged.push( { ...edge, bidirectional: true } );
				continue;
			}
			// Reverse is child-root — "belongs to" subsumes "links
			// to"; skip this reference and let the child-root stand.
			continue;
		}
		merged.push( edge );
	}

	const filtered = applyFilters< WindowLinkEdge[] >(
		HOOKS.WINDOW_LINK_EDGES,
		merged,
	);
	if ( ! Array.isArray( filtered ) ) {
		if ( typeof console !== 'undefined' ) {
			console.warn(
				'[desktop-mode] `desktop-mode.window-links.edges` filter ' +
					'returned a non-array; falling back to derived edges.',
			);
		}
		return merged;
	}
	return filtered;
}

/**
 * Subscribe to relation changes — identity set/cleared or group
 * membership changed. Returns an unsubscribe.
 */
export function subscribeWindowLinks( cb: EngineListener ): () => void {
	store.state.listeners.add( cb );
	return () => {
		store.state.listeners.delete( cb );
	};
}

function notify(): void {
	for ( const cb of Array.from( store.state.listeners ) ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error(
					'[desktop-mode] window-links listener threw:',
					err,
				);
			}
		}
	}
}

/**
 * Relation signature — every window's stored key/root/links. Captures
 * membership AND edge structure (a `links` change reshapes edges even
 * though group membership is untouched). Focus reordering deliberately
 * doesn't change it: `groups-changed` means "who is tied to what
 * changed", not "focus moved".
 */
function relationsSignature(): string {
	return Array.from( store.state.contentByWindow )
		.map( ( [ id, ref ] ) => `${ id }=${ refSignature( ref ) }` )
		.sort()
		.join( ';' );
}

function broadcastGroupsIfChanged(): void {
	const signature = relationsSignature();
	if ( signature === store.state.lastGroupsSignature ) {
		return;
	}
	store.state.lastGroupsSignature = signature;
	const groups = listWindowLinkGroups();
	const detail = { groups };
	document.dispatchEvent(
		new CustomEvent( 'desktop-mode-window-link-groups-changed', {
			detail,
		} ),
	);
	doAction( HOOKS.WINDOW_LINK_GROUPS_CHANGED, detail );
}

/**
 * The `wp.desktop.relations` facade — thin bindings over the module
 * functions so the public surface and the internal one can't drift.
 */
export const relationsApi: WindowRelationsApi = {
	get: getWindowContent,
	set: ( windowId, ref ) =>
		setWindowContent( windowId, ref, { source: 'api' } ),
	groups: listWindowLinkGroups,
	edges: listWindowLinkEdges,
	groupOf: getWindowLinkGroup,
	related: getRelatedWindowIds,
	subscribe: subscribeWindowLinks,
};

/**
 * Wire the engine to the window lifecycle. Called once from
 * `desktop.ts` boot after the window manager exists; idempotent via a
 * shared-store guard (the flag must survive bundle boundaries, unlike
 * a module-level `let`).
 */
export function startWindowLinksEngine( {
	manager,
}: {
	manager: EngineManager;
} ): void {
	store.state.manager = manager;
	if ( store.state.started ) {
		return;
	}
	store.state.started = true;

	// Seed from the open-time config so native windows (and session
	// restores) that declare `content` join their group immediately.
	addAction(
		HOOKS.WINDOW_OPENED,
		'desktop-mode/window-links-seed',
		( e: { windowId?: string } ) => {
			if ( ! e?.windowId ) {
				return;
			}
			const win = store.state.manager?.getById( e.windowId );
			const content = win?.config?.content;
			if ( content ) {
				setWindowContent( e.windowId, content, { source: 'config' } );
			}
		},
	);

	addAction(
		HOOKS.WINDOW_CLOSED,
		'desktop-mode/window-links-clear',
		( e: { windowId?: string } ) => {
			if ( ! e?.windowId ) {
				return;
			}
			store.state.focusSeq.delete( e.windowId );
			setWindowContent( e.windowId, null, { source: 'config' } );
		},
	);

	addAction(
		HOOKS.WINDOW_FOCUSED,
		'desktop-mode/window-links-recency',
		( e: { windowId?: string } ) => {
			if ( ! e?.windowId ) {
				return;
			}
			store.state.seq += 1;
			store.state.focusSeq.set( e.windowId, store.state.seq );
		},
	);

	// The engine owns its bridge message directly. The per-window
	// handler in `src/window/iframe-bridge.ts` also forwards this
	// message (windows resolve their source trivially there), but that
	// module ships in the lazy window-system bundle — this listener
	// lives in the always-on shell bundle so the relations engine has
	// no cross-bundle dependency for its own protocol. Double delivery
	// is harmless: `setWindowContent` no-ops identical repeats.
	window.addEventListener( 'message', ( event: MessageEvent ) => {
		if ( event.origin !== window.location.origin ) {
			return;
		}
		const data = event.data as {
			type?: unknown;
			identity?: WindowContentRef | null;
		} | null;
		if ( ! data || data.type !== 'desktop-mode-content-identity' ) {
			return;
		}
		const win = store.state.manager?.findByIframeSource?.(
			event.source,
		);
		if ( ! win ) {
			return;
		}
		setWindowContent( win.id, data.identity ?? null, {
			source: 'bridge',
		} );
	} );
}
