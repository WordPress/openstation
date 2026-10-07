import { addAction, removeAction, HOOKS } from '../hooks';
import { workAreaRectOf } from '../work-area';
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

const lastPersisted = new Map< string, SavedGeometry >();

export function openEmbedWindow(
	file: DesktopFile,
	ctx?: OpenerContext,
): void {
	const url = file.ref();
	if ( ! url ) {
		return;
	}

	const wm = ( window.wp as
		| { os?: { windowManager?: WindowManagerLike } }
		| undefined )?.os?.windowManager;
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

	const area = document.getElementById( 'os-area' );
	const canvas = area
		? workAreaRectOf( area )
		: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };

	if ( saved && Number.isFinite( saved.width ) && Number.isFinite( saved.height ) ) {
		const { x, y, width, height } = clampGeometry( saved, canvas );
		cfg.x = x;
		cfg.y = y;
		cfg.width = width;
		cfg.height = height;
	} else {
		cfg.width = Math.min( DEFAULT_W, Math.max( MIN_W, canvas.width - PADDING * 2 ) );
		cfg.height = Math.min( DEFAULT_H, Math.max( MIN_H, canvas.height - PADDING * 2 ) );
	}

	if ( placement ) {
		if ( saved ) {
			lastPersisted.set( windowId, { ...saved } );
		}
	}

	wm.open( cfg );
}

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
			return;
		}
		const wm = ( window.wp as
			| { os?: { windowManager?: WindowManagerLike } }
			| undefined )?.os?.windowManager;
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

	addAction( HOOKS.WINDOW_DRAG_END, 'os-embed-persist', onChange );
	addAction( HOOKS.WINDOW_RESIZE_END, 'os-embed-persist', onChange );
}

export function __uninstallEmbedPersistenceForTests(): void {
	if ( ! installed ) {
		return;
	}
	removeAction( HOOKS.WINDOW_DRAG_END, 'os-embed-persist' );
	removeAction( HOOKS.WINDOW_RESIZE_END, 'os-embed-persist' );
	lastPersisted.clear();
	installed = false;
}

async function persist( placementId: number, geo: SavedGeometry ): Promise< void > {
	try {
		const list = await filesRest.listPlacements( 0 );
		const row = list.placements.find( ( p ) => p.id === placementId );
		const prevMeta = ( row?.meta ?? {} ) as Record< string, unknown >;
		const nextMeta: Record< string, unknown > = {
			...prevMeta,
			window: geo,
		};
		await filesRest.updatePlacement( placementId, { meta: nextMeta } );
	} catch ( err ) {
		console.warn( '[openstation] embed window persist failed:', err );
	}
}

function clampGeometry(
	g: SavedGeometry,
	canvas: { x: number; y: number; width: number; height: number },
): SavedGeometry {
	const width = Math.max( MIN_W, Math.min( g.width, canvas.width - PADDING ) );
	const height = Math.max( MIN_H, Math.min( g.height, canvas.height - PADDING ) );
	const maxX = canvas.x + Math.max( 0, canvas.width - width );
	const maxY = canvas.y + Math.max( 0, canvas.height - height );
	const x = Math.max( canvas.x, Math.min( g.x, maxX ) );
	const y = Math.max( canvas.y, Math.min( g.y, maxY ) );
	return { x, y, width, height };
}

function hash( s: string ): string {
	let h = 0;
	for ( let i = 0; i < s.length; i++ ) {
		h = ( Math.imul( h, 31 ) + s.charCodeAt( i ) ) % 0x7fffffff;
	}
	return Math.abs( h ).toString( 36 );
}
