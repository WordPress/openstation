/**
 * Desktop Mode — `embed` file-type opener glue.
 *
 * Opens a stored URL in an iframe-backed desktop window. Window
 * geometry persists per-placement: every drag-end / resize-end on
 * the spawned window writes `{ x, y, width, height }` back into the
 * placement's `meta.window` via REST so the next open restores the
 * same shape. On open, the saved geometry is clamped to the
 * current desktop area — a window saved on a 4K monitor still
 * fits when the user comes back on a laptop.
 *
 * @since 0.8.1
 */

import { addAction, removeAction, HOOKS } from '../hooks';
import * as filesRest from './rest';
import type { DesktopFile } from './file';
import type { OpenerContext } from './openers';

interface SavedGeometry {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface EmbedMeta {
	name?: string;
	window?: SavedGeometry;
}

interface WindowManagerLike {
	open: ( cfg: Record< string, unknown > ) => unknown;
	getById?: (
		id: string,
	) => { element?: HTMLElement } | undefined;
}

const ID_PREFIX = 'desktop-mode-embed-';

const DEFAULT_W = 800;
const DEFAULT_H = 600;
const MIN_W = 360;
const MIN_H = 240;
const PADDING = 16;

/** Tracks placement id -> last persisted geometry, to skip noop PATCHes. */
const lastPersisted = new Map< string, SavedGeometry >();

/**
 * Open the embed window for `file` with placement context `ctx`.
 * No-op when the URL is empty or the window manager isn't ready.
 */
export function openEmbedWindow(
	file: DesktopFile,
	ctx?: OpenerContext,
): void {
	const url = file.ref();
	if ( ! url ) {
		return;
	}
	// External URLs only — same-origin URLs would be served as
	// chromeless admin pages anyway, but we don't second-guess the
	// user; whatever they pasted lands in the iframe src as-is.
	const wm = ( window.wp as
		| { desktop?: { windowManager?: WindowManagerLike } }
		| undefined )?.desktop?.windowManager;
	if ( ! wm ) {
		return;
	}

	const placement = ctx?.placement;
	const meta = ( placement?.meta ?? null ) as EmbedMeta | null;

	const windowId = placement
		? `${ ID_PREFIX }${ placement.id }`
		: `${ ID_PREFIX }anon-${ hash( url ) }`;
	const customName = meta?.name?.trim() ?? '';
	const title = customName !== '' ? customName : file.title();

	const cfg: Record< string, unknown > = {
		id: windowId,
		baseId: windowId,
		url,
		title,
		icon: file.icon(),
		minWidth: MIN_W,
		minHeight: MIN_H,
	};

	const saved = meta?.window;
	const area = document.getElementById( 'desktop-mode-area' );
	const aw = area?.clientWidth ?? window.innerWidth;
	const ah = area?.clientHeight ?? window.innerHeight;

	if ( saved && Number.isFinite( saved.width ) && Number.isFinite( saved.height ) ) {
		const { x, y, width, height } = clampGeometry( saved, aw, ah );
		cfg.x = x;
		cfg.y = y;
		cfg.width = width;
		cfg.height = height;
	} else {
		cfg.width = Math.min( DEFAULT_W, Math.max( MIN_W, aw - PADDING * 2 ) );
		cfg.height = Math.min( DEFAULT_H, Math.max( MIN_H, ah - PADDING * 2 ) );
	}

	if ( placement ) {
		// Subscribe to drag/resize-end for this window so we
		// persist geometry as the user moves it. We don't
		// subscribe more than once per placement — `installEmbedPersistence`
		// installs the global router, this just ensures the
		// `lastPersisted` cache reflects the on-open state.
		if ( saved ) {
			lastPersisted.set( windowId, { ...saved } );
		}
	}

	wm.open( cfg );
}

/**
 * Wire global drag-end / resize-end listeners that persist the
 * geometry of any embed window back to its placement. Called once
 * from the bundle entry. Idempotent.
 */
let installed = false;
export function installEmbedPersistence(): void {
	if ( installed ) {
		return;
	}
	installed = true;

	const onChange = ( payload: unknown ): void => {
		const p = payload as { windowId?: string } | null;
		const id = p?.windowId;
		if ( ! id || ! id.startsWith( ID_PREFIX ) ) {
			return;
		}
		const placementIdStr = id.slice( ID_PREFIX.length );
		const placementId = parseInt( placementIdStr, 10 );
		if ( ! placementId ) {
			return; // anon embed — nowhere to persist
		}
		const wm = ( window.wp as
			| { desktop?: { windowManager?: WindowManagerLike } }
			| undefined )?.desktop?.windowManager;
		const win = wm?.getById?.( id );
		const el = win?.element;
		if ( ! el ) {
			return;
		}
		const next: SavedGeometry = {
			x: el.offsetLeft,
			y: el.offsetTop,
			width: el.offsetWidth,
			height: el.offsetHeight,
		};
		const prev = lastPersisted.get( id );
		if (
			prev &&
			prev.x === next.x &&
			prev.y === next.y &&
			prev.width === next.width &&
			prev.height === next.height
		) {
			return;
		}
		lastPersisted.set( id, next );
		void persist( placementId, next );
	};

	addAction( HOOKS.WINDOW_DRAG_END, 'desktop-mode-embed-persist', onChange );
	addAction( HOOKS.WINDOW_RESIZE_END, 'desktop-mode-embed-persist', onChange );
}

/** For tests only — tear down the persistence wiring. */
export function __uninstallEmbedPersistenceForTests(): void {
	if ( ! installed ) {
		return;
	}
	removeAction( HOOKS.WINDOW_DRAG_END, 'desktop-mode-embed-persist' );
	removeAction( HOOKS.WINDOW_RESIZE_END, 'desktop-mode-embed-persist' );
	lastPersisted.clear();
	installed = false;
}

async function persist( placementId: number, geo: SavedGeometry ): Promise< void > {
	try {
		// Read current placement to preserve other meta keys
		// (notably `meta.name`). We can't fetch a single placement
		// directly — list the root and find it. Cheap enough for
		// the resize-end cadence; if it ever shows up in a profile
		// we add a single-placement REST GET.
		// NOTE: REST `updatePlacement` replaces `meta` wholesale,
		// so we MUST send the merged shape.
		const list = await filesRest.listPlacements( 0 );
		const row = list.placements.find( ( p ) => p.id === placementId );
		const prevMeta = ( row?.meta ?? {} ) as Record< string, unknown >;
		const nextMeta: Record< string, unknown > = {
			...prevMeta,
			window: geo,
		};
		await filesRest.updatePlacement( placementId, { meta: nextMeta } );
	} catch ( err ) {
		// Persistence is best-effort; user can still drag/resize
		// the window in the active session even if the write fails.
		// eslint-disable-next-line no-console
		console.warn( '[desktop-mode] embed window persist failed:', err );
	}
}

function clampGeometry(
	g: SavedGeometry,
	areaW: number,
	areaH: number,
): SavedGeometry {
	const width = Math.max( MIN_W, Math.min( g.width, areaW - PADDING ) );
	const height = Math.max( MIN_H, Math.min( g.height, areaH - PADDING ) );
	const x = Math.max( 0, Math.min( g.x, Math.max( 0, areaW - width ) ) );
	const y = Math.max( 0, Math.min( g.y, Math.max( 0, areaH - height ) ) );
	return { x, y, width, height };
}

function hash( s: string ): string {
	// Cheap deterministic hash for anonymous embed window ids.
	// 32-bit math via Math.imul keeps the loop branch-free without
	// reaching for bitwise ops (bitwise ops are linted off in the
	// shell). Collision risk is irrelevant — these ids only need to
	// be stable per URL within a single session.
	let h = 0;
	for ( let i = 0; i < s.length; i++ ) {
		h = ( Math.imul( h, 31 ) + s.charCodeAt( i ) ) % 0x7fffffff;
	}
	return Math.abs( h ).toString( 36 );
}
