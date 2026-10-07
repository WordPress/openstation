import { createSharedStore } from '../shared-store';
import { addAction, doAction, HOOKS, removeAction } from '../hooks';
import {
	computeInsets,
	elementInsets,
	insetsEqual,
	rectFromInsets,
	rectLike,
	rectsEqual,
	ZERO_INSETS,
	type RectLike,
	type WorkAreaInsets,
	type WorkAreaRect,
} from './compute';

export {
	WORK_AREA_GAP,
	computeInsets,
	edgeFor,
	elementInsets,
	rectFromInsets,
	type RectLike,
	type WorkAreaEdge,
	type WorkAreaInsets,
	type WorkAreaRect,
} from './compute';

export const WORK_AREA_CHANGED_EVENT = 'os-work-area-changed';

export const DYNAMIC_DOCK_ATTR = 'data-os-dock-behavior';

export interface WorkAreaSnapshot {
	insets: WorkAreaInsets;
	rect: WorkAreaRect;
	viewport: WorkAreaRect;
	area: { width: number; height: number };
}

interface WorkAreaState {
	snapshot: WorkAreaSnapshot;

	installed: boolean;

	areaEl: HTMLElement | null;
}

export const WORK_AREA_STORE_KEY = 'os/work-area';

function emptySnapshot(): WorkAreaSnapshot {
	return {
		insets: { ...ZERO_INSETS },
		rect: { x: 0, y: 0, width: 0, height: 0 },
		viewport: { x: 0, y: 0, width: 0, height: 0 },
		area: { width: 0, height: 0 },
	};
}

const store = createSharedStore< WorkAreaState >( WORK_AREA_STORE_KEY, () => ( {
	snapshot: emptySnapshot(),
	installed: false,
	areaEl: null,
} ) );

export interface WorkAreaInstallDeps {

	shell: HTMLElement;

	shellBody: HTMLElement;

	area: HTMLElement;

	chromeSelector?: string;
}

export interface WorkAreaController {

	refresh(): void;

	destroy(): void;
}

const CSS_PROPS = {
	top: '--os-work-area-inset-top',
	right: '--os-work-area-inset-right',
	bottom: '--os-work-area-inset-bottom',
	left: '--os-work-area-inset-left',
	width: '--os-work-area-width',
	height: '--os-work-area-height',
} as const;

function cloneSnapshot( s: Readonly< WorkAreaSnapshot > ): WorkAreaSnapshot {
	return {
		insets: { ...s.insets },
		rect: { ...s.rect },
		viewport: { ...s.viewport },
		area: { ...s.area },
	};
}

export function getWorkArea(): WorkAreaSnapshot {
	return cloneSnapshot( store.state.snapshot );
}

export function getWorkAreaInsets(): WorkAreaInsets {
	return { ...store.state.snapshot.insets };
}

export function workAreaRectOf( areaEl?: HTMLElement | null ): WorkAreaRect {
	const el = areaEl ?? store.state.areaEl;
	if ( ! el ) {
		return { ...store.state.snapshot.rect };
	}

	const width = el.clientWidth || el.getBoundingClientRect().width;
	const height = el.clientHeight || el.getBoundingClientRect().height;
	return rectFromInsets( width, height, store.state.snapshot.insets );
}

export function workAreaInsetsOf( element: Element ): WorkAreaInsets {
	const { installed, snapshot } = store.state;
	if ( ! installed ) {
		return { ...ZERO_INSETS };
	}
	const v = snapshot.viewport;
	return elementInsets(
		rectLike( v.x, v.y, v.width, v.height ),
		element.getBoundingClientRect(),
	);
}

export function subscribeWorkArea(
	cb: ( snapshot: WorkAreaSnapshot ) => void,
): () => void {
	return store.subscribe( ( state ) => {
		cb( cloneSnapshot( state.snapshot ) );
	} );
}

export function measureWorkArea( deps: WorkAreaInstallDeps ): WorkAreaSnapshot {
	const areaRect = areaViewportRect( deps );
	const chrome: RectLike[] = [];

	const nodes = deps.shellBody.querySelectorAll< HTMLElement >(
		deps.chromeSelector ?? '.os-dock',
	);
	for ( const node of Array.from( nodes ) ) {
		if ( node.hidden || node.getAttribute( DYNAMIC_DOCK_ATTR ) === 'dynamic' ) {
			continue;
		}
		chrome.push( node.getBoundingClientRect() );
	}
	const insets = computeInsets( areaRect, chrome );

	const width = deps.area.clientWidth || areaRect.width;
	const height = deps.area.clientHeight || areaRect.height;
	const rect = rectFromInsets( width, height, insets );
	return {
		insets,
		rect,
		viewport: {
			x: areaRect.left + rect.x,
			y: areaRect.top + rect.y,
			width: rect.width,
			height: rect.height,
		},
		area: { width, height },
	};
}

function areaViewportRect( deps: WorkAreaInstallDeps ): RectLike {
	const { area } = deps;
	if ( area.offsetWidth > 0 && area.offsetParent === deps.shellBody ) {
		const body = deps.shellBody.getBoundingClientRect();
		return rectLike(
			body.left + area.offsetLeft,
			body.top + area.offsetTop,
			area.offsetWidth,
			area.offsetHeight,
		);
	}
	return area.getBoundingClientRect();
}

function writeCssProps( shell: HTMLElement, s: WorkAreaSnapshot ): void {
	shell.style.setProperty( CSS_PROPS.top, `${ s.insets.top }px` );
	shell.style.setProperty( CSS_PROPS.right, `${ s.insets.right }px` );
	shell.style.setProperty( CSS_PROPS.bottom, `${ s.insets.bottom }px` );
	shell.style.setProperty( CSS_PROPS.left, `${ s.insets.left }px` );
	shell.style.setProperty( CSS_PROPS.width, `${ s.rect.width }px` );
	shell.style.setProperty( CSS_PROPS.height, `${ s.rect.height }px` );
}

function snapshotsEqual(
	a: Readonly< WorkAreaSnapshot >,
	b: Readonly< WorkAreaSnapshot >,
): boolean {
	return (
		insetsEqual( a.insets, b.insets ) &&
		rectsEqual( a.rect, b.rect ) &&
		rectsEqual( a.viewport, b.viewport ) &&
		a.area.width === b.area.width &&
		a.area.height === b.area.height
	);
}

export function installWorkArea( deps: WorkAreaInstallDeps ): WorkAreaController {
	const railObservers = new Map< Element, ResizeObserver >();
	let areaObserver: ResizeObserver | null = null;
	let bodyObserver: MutationObserver | null = null;
	let destroyed = false;
	let frozen = false;
	let controller: WorkAreaController | null = null;

	const measure = (): void => {
		if ( destroyed || frozen ) {
			return;
		}
		const next = measureWorkArea( deps );
		const first = ! store.state.installed;
		if ( ! first && snapshotsEqual( store.state.snapshot, next ) ) {
			return;
		}
		writeCssProps( deps.shell, next );
		store.setState( { snapshot: next, installed: true, areaEl: deps.area } );
		const detail = cloneSnapshot( next );
		doAction( HOOKS.WORK_AREA_CHANGED, detail );
		document.dispatchEvent(
			new CustomEvent( WORK_AREA_CHANGED_EVENT, { detail } ),
		);
	};

	const hasResizeObserver = typeof ResizeObserver !== 'undefined';

	const observeRails = (): void => {
		if ( ! hasResizeObserver ) {
			return;
		}
		const live = new Set< Element >(
			Array.from(
				deps.shellBody.querySelectorAll( deps.chromeSelector ?? '.os-dock' ),
			),
		);
		for ( const [ el, ro ] of railObservers ) {
			if ( ! live.has( el ) ) {
				ro.disconnect();
				railObservers.delete( el );
			}
		}
		for ( const el of live ) {
			if ( railObservers.has( el ) ) {
				continue;
			}
			const ro = new ResizeObserver( measure );

			ro.observe( el, { box: 'border-box' } );
			railObservers.set( el, ro );
		}
	};

	if ( hasResizeObserver ) {
		areaObserver = new ResizeObserver( measure );
		areaObserver.observe( deps.area );
	}
	if ( typeof MutationObserver !== 'undefined' ) {
		bodyObserver = new MutationObserver( () => {
			observeRails();
			measure();
		} );
		bodyObserver.observe( deps.shellBody, { childList: true } );
	}
	const onLayoutChanged = (): void => {
		observeRails();
		measure();
	};
	document.addEventListener( 'os-layout-changed', onLayoutChanged );
	window.addEventListener( 'resize', measure );

	const onOverviewEntering = (): void => {
		frozen = true;
	};
	const onOverviewExited = (): void => {
		frozen = false;
		measure();
	};
	addAction( HOOKS.OVERVIEW_ENTERING, HOOKS_NAMESPACE, onOverviewEntering );
	addAction( HOOKS.OVERVIEW_EXITED, HOOKS_NAMESPACE, onOverviewExited );

	observeRails();
	measure();

	controller = {
		refresh: measure,
		destroy: () => {
			destroyed = true;
			areaObserver?.disconnect();
			bodyObserver?.disconnect();
			for ( const ro of railObservers.values() ) {
				ro.disconnect();
			}
			railObservers.clear();
			document.removeEventListener( 'os-layout-changed', onLayoutChanged );
			window.removeEventListener( 'resize', measure );
			removeAction( HOOKS.OVERVIEW_ENTERING, HOOKS_NAMESPACE );
			removeAction( HOOKS.OVERVIEW_EXITED, HOOKS_NAMESPACE );
			if ( installed === controller ) {
				installed = null;
			}
		},
	};
	installed = controller;
	return controller;
}

const HOOKS_NAMESPACE = 'openstation/work-area';

let installed: WorkAreaController | null = null;

export function refreshWorkArea(): void {
	installed?.refresh();
}

export function _resetWorkAreaForTests(): void {
	store.reset();
}

export interface WorkAreaApi {

	get(): WorkAreaSnapshot;

	rectOf( areaEl?: HTMLElement | null ): WorkAreaRect;

	insetsOf( element: Element ): WorkAreaInsets;

	subscribe( cb: ( snapshot: WorkAreaSnapshot ) => void ): () => void;
}

export const workAreaApi: WorkAreaApi = {
	get: getWorkArea,
	rectOf: workAreaRectOf,
	insetsOf: workAreaInsetsOf,
	subscribe: subscribeWorkArea,
};
