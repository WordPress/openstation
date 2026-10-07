import { __, sprintf } from '../i18n';
import { osIconSvg } from '../ui/icons';
import { workAreaRectOf } from '../work-area';
import type { WidgetDef, WidgetGeometry } from './types';

const FLOATING_CLASS = 'os-widgets__card--floating';
const MOVABLE_CLASS = 'os-widgets__card--movable';
const RESIZABLE_CLASS = 'os-widgets__card--resizable';
const DRAGGING_CLASS = 'os-widgets__card--dragging';
const RESIZING_CLASS = 'os-widgets__card--resizing';

const DEFAULT_MIN_WIDTH = 160;
const DEFAULT_MIN_HEIGHT = 80;
const DEFAULT_WIDTH = 280;
const DEFAULT_HEIGHT = 180;

const VIEWPORT_MARGIN = 20;

const SNAP_GRID = 20;

const DRAG_THRESHOLD_PX = 5;
const DRAG_THRESHOLD_SQUARED = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

const DRAG_EXCLUDED_SELECTORS =
	'input, textarea, select, button, a, [contenteditable="true"]';

type ResizeDir = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export interface FrameHandlers {

	onRemove(): void;

	onGeometryChanged( geometry: WidgetGeometry ): void;

	onDockedHeightChanged( height: number ): void;

	onLiberate( initialGeometry: WidgetGeometry ): void;

	onRedock(): void;
}

export interface FrameContext {

	floatingParent: HTMLElement;

	geometry: WidgetGeometry | undefined;

	dockedHeight?: number;
}

export interface Frame {
	card: HTMLElement;
	body: HTMLElement;

	dispose(): void;
}

export function buildFrame(
	def: WidgetDef,
	ctx: FrameContext,
	handlers: FrameHandlers,
): Frame {
	const card = document.createElement( 'div' );
	card.className = 'os-widgets__card';
	card.dataset.widgetId = def.id;

	const movable = def.movable === true;
	const resizable = def.resizable === true;
	if ( movable ) {
		card.classList.add( MOVABLE_CLASS );
	}
	if ( resizable ) {
		card.classList.add( RESIZABLE_CLASS );
	}

	if ( movable ) {
		card.appendChild( buildChrome( def, handlers.onRemove, handlers.onRedock ) );
	} else {
		card.appendChild( buildCornerClose( def, handlers.onRemove ) );
	}

	const body = document.createElement( 'div' );
	body.className = 'os-widgets__card-body';
	card.appendChild( body );

	if ( ctx.geometry ) {
		applyGeometry(
			card,
			clampGeometryToParent( ctx.geometry, ctx.floatingParent ),
		);
		card.classList.add( FLOATING_CLASS );
	} else if ( resizable && typeof ctx.dockedHeight === 'number' ) {
		card.style.height = `${ clampDockedHeight( ctx.dockedHeight, def ) }px`;
	}

	const isFloating = (): boolean =>
		card.classList.contains( FLOATING_CLASS );

	const resizeCleanups: Array< () => void > = [];
	if ( resizable ) {
		for ( const dir of allHandleDirs() ) {
			const handle = document.createElement( 'div' );
			handle.className = `os-widgets__resize os-widgets__resize--${ dir }`;
			handle.setAttribute( 'aria-hidden', 'true' );
			handle.dataset.dir = dir;
			card.appendChild( handle );
			resizeCleanups.push(
				attachResize( card, handle, dir, def, ctx, handlers, isFloating ),
			);
		}
	}

	let dragCleanup: ( () => void ) | null = null;
	if ( movable ) {
		const chrome = card.querySelector<HTMLElement>(
			'.os-widgets__chrome',
		);
		if ( chrome ) {
			dragCleanup = attachDrag( card, chrome, def, ctx, handlers );
		}
	}

	return {
		card,
		body,
		dispose: () => {
			for ( const fn of resizeCleanups ) {
				try {
					fn();
				} catch {

				}
			}
			if ( dragCleanup ) {
				try {
					dragCleanup();
				} catch {

				}
			}
			card.remove();
		},
	};
}

function buildChrome(
	def: WidgetDef,
	onRemove: () => void,
	onRedock: () => void,
): HTMLElement {
	const chrome = document.createElement( 'header' );
	chrome.className = 'os-widgets__chrome';

	const grip = document.createElement( 'span' );
	grip.className = 'os-widgets__grip';
	grip.setAttribute( 'aria-hidden', 'true' );

	chrome.appendChild( grip );

	const title = document.createElement( 'span' );
	title.className = 'os-widgets__title';
	title.textContent = def.label;
	chrome.appendChild( title );

	chrome.appendChild( buildRedockButton( def, onRedock ) );

	const close = buildCloseButton( def, onRemove );
	chrome.appendChild( close );

	return chrome;
}

function buildRedockButton(
	def: WidgetDef,
	onRedock: () => void,
): HTMLButtonElement {
	const btn = document.createElement( 'button' );
	btn.type = 'button';
	btn.className = 'os-widgets__card-redock';
	btn.setAttribute(
		'aria-label',

		sprintf( __( 'Dock %s back to widget column' ), def.label ),
	);

	btn.innerHTML =
		'<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
		'<path d="M2 6h6M5.5 3.5L8 6l-2.5 2.5M10 2.5v7" ' +
		'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
		'stroke-linejoin="round" fill="none"/></svg>';
	btn.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		onRedock();
	} );

	btn.dataset.noDrag = 'true';
	return btn;
}

function buildCornerClose( def: WidgetDef, onRemove: () => void ): HTMLElement {
	const close = buildCloseButton( def, onRemove );
	close.classList.add( 'os-widgets__card-close--corner' );
	return close;
}

function buildCloseButton(
	def: WidgetDef,
	onRemove: () => void,
): HTMLButtonElement {
	const close = document.createElement( 'button' );
	close.type = 'button';
	close.className = 'os-widgets__card-close';

	close.setAttribute( 'aria-label', sprintf( __( 'Remove %s' ), def.label ) );
	close.innerHTML = osIconSvg( 'close', { size: 16 } );
	close.addEventListener( 'click', ( e ) => {
		e.preventDefault();
		e.stopPropagation();
		onRemove();
	} );
	return close;
}

function attachDrag(
	card: HTMLElement,
	chrome: HTMLElement,
	def: WidgetDef,
	ctx: FrameContext,
	handlers: FrameHandlers,
): () => void {
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let initialLeft = 0;
	let initialTop = 0;

	let committed = false;

	const onDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 ) {
			return;
		}
		const target = e.target as HTMLElement | null;

		if ( target && target.closest( DRAG_EXCLUDED_SELECTORS ) ) {
			return;
		}
		e.preventDefault();

		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		committed = false;

		initialLeft = parseFloat( card.style.left ) || 0;
		initialTop = parseFloat( card.style.top ) || 0;
		chrome.setPointerCapture( pointerId );
	};

	const commitDrag = (): void => {
		if ( ! card.classList.contains( FLOATING_CLASS ) ) {
			const parentRect = ctx.floatingParent.getBoundingClientRect();
			const rect = card.getBoundingClientRect();

			const initial: WidgetGeometry = {
				x: rect.left - parentRect.left,
				y: rect.top - parentRect.top,
				width: rect.width || def.defaultWidth || DEFAULT_WIDTH,
				height: rect.height || def.defaultHeight || DEFAULT_HEIGHT,
			};
			applyGeometry( card, initial );
			card.classList.add( FLOATING_CLASS );
			handlers.onLiberate( initial );

			initialLeft = parseFloat( card.style.left ) || 0;
			initialTop = parseFloat( card.style.top ) || 0;
		}
		card.classList.add( DRAGGING_CLASS );
	};

	const onMove = ( e: PointerEvent ): void => {
		if ( pointerId === null || e.pointerId !== pointerId ) {
			return;
		}
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;

		if ( ! committed ) {
			if ( dx * dx + dy * dy < DRAG_THRESHOLD_SQUARED ) {
				return;
			}
			committed = true;
			commitDrag();
		}

		const clamped = clampToParent(
			snapToGrid( initialLeft + dx ),
			snapToGrid( initialTop + dy ),
			card.offsetWidth,
			card.offsetHeight,
			ctx.floatingParent,
		);
		card.style.left = `${ snapWithin( clamped.x ) }px`;
		card.style.top = `${ snapWithin( clamped.y ) }px`;
	};

	const onUp = ( e: PointerEvent ): void => {
		if ( pointerId === null || e.pointerId !== pointerId ) {
			return;
		}
		try {
			chrome.releasePointerCapture( pointerId );
		} catch {

		}
		pointerId = null;

		if ( ! committed ) {
			return;
		}
		committed = false;
		card.classList.remove( DRAGGING_CLASS );
		handlers.onGeometryChanged( currentGeometry( card ) );
	};

	chrome.addEventListener( 'pointerdown', onDown );
	chrome.addEventListener( 'pointermove', onMove );
	chrome.addEventListener( 'pointerup', onUp );
	chrome.addEventListener( 'pointercancel', onUp );

	return () => {
		chrome.removeEventListener( 'pointerdown', onDown );
		chrome.removeEventListener( 'pointermove', onMove );
		chrome.removeEventListener( 'pointerup', onUp );
		chrome.removeEventListener( 'pointercancel', onUp );
	};
}

function attachResize(
	card: HTMLElement,
	handle: HTMLElement,
	dir: ResizeDir,
	def: WidgetDef,
	ctx: FrameContext,
	handlers: FrameHandlers,
	isFloating: () => boolean,
): () => void {
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let startLeft = 0;
	let startTop = 0;
	let startW = 0;
	let startH = 0;

	const onDown = ( e: PointerEvent ): void => {
		if ( e.button !== 0 ) {
			return;
		}

		if ( ! isFloating() && ! isHeightOnlyDir( dir ) ) {
			return;
		}
		e.preventDefault();
		e.stopPropagation();

		pointerId = e.pointerId;
		startX = e.clientX;
		startY = e.clientY;
		const rect = card.getBoundingClientRect();
		const parentRect = ctx.floatingParent.getBoundingClientRect();
		startLeft = rect.left - parentRect.left;
		startTop = rect.top - parentRect.top;
		startW = rect.width;
		startH = rect.height;
		handle.setPointerCapture( pointerId );
		card.classList.add( RESIZING_CLASS );
	};

	const onMove = ( e: PointerEvent ): void => {
		if ( pointerId === null || e.pointerId !== pointerId ) {
			return;
		}
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		const next = computeResize(
			dir,
			dx,
			dy,
			startLeft,
			startTop,
			startW,
			startH,
			def,
			ctx.floatingParent,
			isFloating(),
		);

		if ( isFloating() ) {
			card.style.left = `${ next.x }px`;
			card.style.top = `${ next.y }px`;
			card.style.width = `${ next.width }px`;
		}
		card.style.height = `${ next.height }px`;
	};

	const onUp = ( e: PointerEvent ): void => {
		if ( pointerId === null || e.pointerId !== pointerId ) {
			return;
		}
		try {
			handle.releasePointerCapture( pointerId );
		} catch {

		}
		pointerId = null;
		card.classList.remove( RESIZING_CLASS );

		if ( isFloating() ) {
			handlers.onGeometryChanged( currentGeometry( card ) );
		} else {
			handlers.onDockedHeightChanged( card.offsetHeight );
		}
	};

	handle.addEventListener( 'pointerdown', onDown );
	handle.addEventListener( 'pointermove', onMove );
	handle.addEventListener( 'pointerup', onUp );
	handle.addEventListener( 'pointercancel', onUp );

	return () => {
		handle.removeEventListener( 'pointerdown', onDown );
		handle.removeEventListener( 'pointermove', onMove );
		handle.removeEventListener( 'pointerup', onUp );
		handle.removeEventListener( 'pointercancel', onUp );
	};
}

function allHandleDirs(): ResizeDir[] {
	return [ 'n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw' ];
}

function isHeightOnlyDir( dir: ResizeDir ): boolean {
	return dir === 's';
}

export function applyGeometry(
	card: HTMLElement,
	geometry: WidgetGeometry,
): void {
	card.style.left = `${ geometry.x }px`;
	card.style.top = `${ geometry.y }px`;
	card.style.width = `${ geometry.width }px`;
	card.style.height = `${ geometry.height }px`;
}

function currentGeometry( card: HTMLElement ): WidgetGeometry {
	return {
		x: parseFloat( card.style.left ) || 0,
		y: parseFloat( card.style.top ) || 0,
		width: card.offsetWidth,
		height: card.offsetHeight,
	};
}

function clampDockedHeight( height: number, def: WidgetDef ): number {
	return clamp(
		height,
		def.minHeight ?? DEFAULT_MIN_HEIGHT,
		def.maxHeight ?? Infinity,
	);
}

export function clampGeometryToParent(
	geometry: WidgetGeometry,
	parent: HTMLElement,
): WidgetGeometry {
	if ( ! parent.clientWidth || ! parent.clientHeight ) {
		return geometry;
	}
	const clamped = clampToParent(
		geometry.x,
		geometry.y,
		geometry.width,
		geometry.height,
		parent,
	);
	return { ...geometry, x: clamped.x, y: clamped.y };
}

function snapToGrid( value: number ): number {
	return Math.round( value / SNAP_GRID ) * SNAP_GRID;
}

function snapWithin( value: number ): number {
	const snapped = Math.floor( value / SNAP_GRID ) * SNAP_GRID;
	return snapped >= VIEWPORT_MARGIN ? snapped : Math.min( value, VIEWPORT_MARGIN );
}

function clampToParent(
	x: number,
	y: number,
	width: number,
	height: number,
	parent: HTMLElement,
): { x: number; y: number } {
	const area = workAreaRectOf( parent );
	const minX = area.x + VIEWPORT_MARGIN;
	const minY = area.y + VIEWPORT_MARGIN;
	const maxX = Math.max( area.x, area.x + area.width - width - VIEWPORT_MARGIN );
	const maxY = Math.max( area.y, area.y + area.height - height - VIEWPORT_MARGIN );
	return {
		x: Math.min( Math.max( minX, x ), maxX ),
		y: Math.min( Math.max( minY, y ), maxY ),
	};
}

export function computeResize(
	dir: ResizeDir,
	dx: number,
	dy: number,
	startLeft: number,
	startTop: number,
	startW: number,
	startH: number,
	def: WidgetDef,
	parent: HTMLElement,
	floating: boolean,
): WidgetGeometry {
	const minW = def.minWidth ?? DEFAULT_MIN_WIDTH;
	const minH = def.minHeight ?? DEFAULT_MIN_HEIGHT;
	const maxW = def.maxWidth ?? Infinity;
	const maxH = def.maxHeight ?? Infinity;

	const area = workAreaRectOf( parent );
	const parentWidth = area.x + area.width;
	const parentHeight = area.y + area.height;

	let x = startLeft;
	let y = startTop;
	let width = startW;
	let height = startH;

	if ( dir === 'e' || dir === 'ne' || dir === 'se' ) {
		if ( floating ) {
			const right = snapIntoRange(
				snapToGrid( startLeft + startW + dx ),
				startLeft + minW,
				Math.min( startLeft + maxW, parentWidth ),
			);
			width = right - startLeft;
		} else {
			width = clamp( startW + dx, minW, Math.min( maxW, parentWidth - startLeft ) );
		}
	}
	if ( dir === 'w' || dir === 'nw' || dir === 'sw' ) {
		const right = startLeft + startW;
		if ( floating ) {
			x = snapIntoRange(
				snapToGrid( startLeft + dx ),
				Math.max( 0, right - Math.min( maxW, right ) ),
				right - minW,
			);
			width = right - x;
		} else {
			const nextWidth = clamp( startW - dx, minW, Math.min( maxW, right ) );
			x = startLeft + ( startW - nextWidth );
			width = nextWidth;
		}
	}
	if ( dir === 's' || dir === 'se' || dir === 'sw' ) {
		if ( floating ) {
			const bottom = snapIntoRange(
				snapToGrid( startTop + startH + dy ),
				startTop + minH,
				Math.min( startTop + maxH, parentHeight ),
			);
			height = bottom - startTop;
		} else {
			height = clamp(
				startH + dy,
				minH,
				Math.min( maxH, parentHeight - startTop ),
			);
		}
	}
	if ( dir === 'n' || dir === 'ne' || dir === 'nw' ) {
		const bottom = startTop + startH;
		if ( floating ) {
			y = snapIntoRange(
				snapToGrid( startTop + dy ),
				Math.max( 0, bottom - Math.min( maxH, bottom ) ),
				bottom - minH,
			);
			height = bottom - y;
		} else {
			const nextHeight = clamp( startH - dy, minH, Math.min( maxH, bottom ) );
			y = startTop + ( startH - nextHeight );
			height = nextHeight;
		}
	}

	if ( ! floating ) {
		width = startW;
		x = startLeft;
	}

	return { x, y, width, height };
}

function snapIntoRange( value: number, min: number, max: number ): number {
	const clamped = clamp( value, min, max );
	const down = Math.floor( clamped / SNAP_GRID ) * SNAP_GRID;
	if ( down >= min ) {
		return down;
	}
	const up = down + SNAP_GRID;
	return up <= max ? up : clamped;
}

function clamp( value: number, min: number, max: number ): number {
	if ( max < min ) {
		return min;
	}
	return Math.min( Math.max( value, min ), max );
}
