import { doAction, HOOKS } from '../hooks';
import { isMobileStamped } from '../mode/stamp';
import { workAreaRectOf, type WorkAreaRect } from '../work-area';
import { createShakeDetector, dispatchShake } from './shake';
import { DRAG_THRESHOLD_SQUARED, EDGE_MARGIN, GRAB_MARGIN } from './constants';
import type { Window } from './index';

function makeBoundsEmitter(
	win: Window,
	phase: 'drag' | 'resize',
): () => void {
	let pending = false;
	return () => {
		if ( pending ) {
			return;
		}
		pending = true;
		requestAnimationFrame( () => {
			pending = false;

			if ( phase === 'drag' && ! win._isDragging ) {
				return;
			}
			if ( phase === 'resize' && ! win._isResizing ) {
				return;
			}

			if ( win._isDestroyed || ! win.element.isConnected ) {
				return;
			}
			try {
				doAction( HOOKS.WINDOW_BOUNDS_CHANGED, {
					windowId: win.id,
					x: win.element.offsetLeft,
					y: win.element.offsetTop,
					width: win.element.offsetWidth,
					height: win.element.offsetHeight,
					state: win.state,
					phase,
				} );
			} catch {

			}
		} );
	};
}

interface UnstateParams {
	isMaximized: boolean;
	cursorRatioX: number;
	titleBarHeight: number;
	areaLeft: number;
	areaTop: number;
	targetW: number;
	targetH: number;
}

export function handleDragStart( win: Window, e: PointerEvent ): void {
	const target = e.target as HTMLElement;
	if (
		target.closest( '.os-window__btn' ) ||
		target.closest( '.os-window__custom-buttons' ) ||
		target.closest( '.os-window__controls' ) ||
		target.closest( '.os-window__screen-meta' ) ||
		target.closest( '.os-window__menu-btn' ) ||
		target.closest( '.os-window__menu-panel' )
	) {
		return;
	}

	if ( isMobileStamped() ) {
		return;
	}

	const isMaximized = win.state === 'maximized';
	const isSnapped =
		win.state === 'snapped-left' || win.state === 'snapped-right';
	const needsUnstate = isMaximized || isSnapped;

	const startClientX = e.clientX;
	const startClientY = e.clientY;
	const pointerId = e.pointerId;
	const unstateParams: UnstateParams | null = needsUnstate
		? captureUnstateParams( win, e )
		: null;

	win._titleBar.setPointerCapture( pointerId );

	const snap = win.snapConfigProvider?.() ?? { enabled: false, cellWidth: 0, cellHeight: 0 };

	const emitBoundsChanged = makeBoundsEmitter( win, 'drag' );

	const shake = createShakeDetector();

	let modifierDown = false;
	let lastClientX = startClientX;
	let lastClientY = startClientY;
	const setModifier = ( down: boolean, clientX: number, clientY: number ): void => {
		if ( down === modifierDown || ! win._isDragging ) {
			return;
		}
		modifierDown = down;
		win.onDragGesture?.( win, {
			type: 'modifier',
			active: down,
			clientX,
			clientY,
		} );
	};
	const onModifierKey = ( ke: KeyboardEvent ): void => {
		if ( ke.key !== 'Alt' ) {
			return;
		}

		ke.preventDefault();
		setModifier( ke.type === 'keydown', lastClientX, lastClientY );
	};

	let started = false;
	const beginDrag = ( cursorX: number, cursorY: number ): void => {
		if ( started ) {
			return;
		}
		started = true;

		let newLeft: number;
		let newTop: number;
		if ( unstateParams ) {
			const placed = commitUnstate( win, unstateParams, cursorX, cursorY );
			newLeft = placed.left;
			newTop = placed.top;
		} else {
			newLeft = win.element.offsetLeft;
			newTop = win.element.offsetTop;
		}

		win.element.classList.add( 'os-window--dragging' );
		if ( snap.enabled ) {
			win.element.classList.add( 'os-window--snap-drag' );
		}

		win._isDragging = true;
		win._dragOffsetX = cursorX - newLeft;
		win._dragOffsetY = cursorY - newTop;

		window.addEventListener( 'keydown', onModifierKey );
		window.addEventListener( 'keyup', onModifierKey );

		doAction( HOOKS.WINDOW_DRAG_START, { windowId: win.id } );
	};

	if ( ! needsUnstate ) {
		beginDrag( startClientX, startClientY );
	}

	const onDragMove = ( ev: PointerEvent ): void => {
		if ( ! started ) {
			const dx = ev.clientX - startClientX;
			const dy = ev.clientY - startClientY;
			if ( dx * dx + dy * dy < DRAG_THRESHOLD_SQUARED ) {
				return;
			}
			beginDrag( ev.clientX, ev.clientY );
		}
		if ( ! win._isDragging ) {
			return;
		}
		let x = ev.clientX - win._dragOffsetX;
		let y = ev.clientY - win._dragOffsetY;

		const desktop = win.element.parentElement;
		if ( desktop ) {
			const safe = clampWindowPosition( x, y, win.element.offsetWidth, {
				x: 0,
				y: 0,
				width: desktop.clientWidth,
				height: desktop.clientHeight,
			} );
			x = safe.x;
			y = safe.y;
		}

		if ( snap.enabled ) {
			x = Math.round( x / snap.cellWidth ) * snap.cellWidth;
			y = Math.round( y / snap.cellHeight ) * snap.cellHeight;
		}

		win.element.style.left = `${ x }px`;
		win.element.style.top = `${ y }px`;

		lastClientX = ev.clientX;
		lastClientY = ev.clientY;

		setModifier( ev.altKey, ev.clientX, ev.clientY );

		win.onDragMove?.( win, ev.clientX, ev.clientY );

		const shaken = shake.feed( ev.clientX, ev.clientY, ev.timeStamp );
		if ( shaken ) {
			dispatchShake( win.element, shaken );
			doAction( HOOKS.POINTER_SHAKE, { ...shaken, windowId: win.id } );
			win.onDragGesture?.( win, {
				type: 'shake',
				clientX: ev.clientX,
				clientY: ev.clientY,
			} );
		}

		emitBoundsChanged();
	};

	const releaseCapture = (): void => {
		try {
			win._titleBar.releasePointerCapture( pointerId );
		} catch {

		}
	};

	const detachListeners = (): void => {
		win._titleBar.removeEventListener( 'pointermove', onDragMove );
		win._titleBar.removeEventListener( 'pointerup', onDragEnd );
		win._titleBar.removeEventListener( 'pointercancel', onDragEnd );
		win._titleBar.removeEventListener( 'lostpointercapture', onDragEnd );
		window.removeEventListener( 'keydown', onModifierKey );
		window.removeEventListener( 'keyup', onModifierKey );
		shake.reset();
	};

	const onDragEnd = (): void => {
		if ( ! started ) {
			releaseCapture();
			detachListeners();
			return;
		}

		if ( ! win._isDragging ) {
			return;
		}
		win._isDragging = false;
		win.element.classList.remove( 'os-window--dragging' );
		win.element.classList.remove( 'os-window--snap-drag' );
		releaseCapture();
		detachListeners();

		const consumed = win.onDragEnd?.( win ) ?? false;
		if ( consumed ) {
			return;
		}

		win._gridSpan = null;
		win._emitChange( 'moved' );
		const payload = {
			windowId: win.id,
			x: win.element.offsetLeft,
			y: win.element.offsetTop,
		};
		doAction( HOOKS.WINDOW_DRAG_END, payload );
		doAction( HOOKS.WINDOW_MOVED, payload );
	};

	win._titleBar.addEventListener( 'pointermove', onDragMove );
	win._titleBar.addEventListener( 'pointerup', onDragEnd );
	win._titleBar.addEventListener( 'pointercancel', onDragEnd );
	win._titleBar.addEventListener( 'lostpointercapture', onDragEnd );
}

function captureUnstateParams(
	win: Window,
	e: PointerEvent,
): UnstateParams {
	const titleRect = win._titleBar.getBoundingClientRect();
	const cursorRatioX =
		titleRect.width > 0
			? ( e.clientX - titleRect.left ) / titleRect.width
			: 0.5;

	const parent = win.element.parentElement;
	const workArea = parent ? workAreaRectOf( parent ) : null;
	const fallbackW = workArea
		? Math.min( 960, Math.round( workArea.width * 0.6 ) )
		: 640;
	const fallbackH = workArea
		? Math.min( 640, Math.round( workArea.height * 0.7 ) )
		: 480;
	const w = win._savedGeometry?.width ?? fallbackW;
	const h = win._savedGeometry?.height ?? fallbackH;

	const parentRect = parent?.getBoundingClientRect();

	return {
		isMaximized: win.state === 'maximized',
		cursorRatioX,
		titleBarHeight: titleRect.height,

		areaLeft: parentRect?.left ?? 0,
		areaTop: parentRect?.top ?? 0,
		targetW: w,
		targetH: h,
	};
}

function commitUnstate(
	win: Window,
	params: UnstateParams,
	cursorX: number,
	cursorY: number,
): { left: number; top: number } {
	win.element.classList.remove(
		'os-window--maximized',
		'os-window--snapped-left',
		'os-window--snapped-right',
	);
	win.element.style.width = `${ params.targetW }px`;
	win.element.style.height = `${ params.targetH }px`;

	const left = Math.max(
		EDGE_MARGIN,
		Math.round(
			cursorX - params.areaLeft - params.targetW * params.cursorRatioX,
		),
	);
	const top = Math.max(
		EDGE_MARGIN,
		Math.round( cursorY - params.areaTop - params.titleBarHeight / 2 ),
	);
	win.element.style.left = `${ left }px`;
	win.element.style.top = `${ top }px`;
	win.state = 'normal';
	win._emitChange( 'state' );
	if ( params.isMaximized ) {
		doAction( HOOKS.WINDOW_UNMAXIMIZED, { windowId: win.id } );
	}
	return { left, top };
}

type ResizeDir = 'ne' | 'nw' | 'se' | 'sw';

export function handleResizeStart( win: Window, e: PointerEvent ): void {
	if ( win.state === 'maximized' || win.state === 'fullscreen' ) {
		return;
	}

	e.preventDefault();
	e.stopPropagation();

	const handle = e.target as HTMLElement;
	const dir = ( handle.dataset.dir as ResizeDir | undefined ) ?? 'se';

	win._isResizing = true;
	win._resizeStartX = e.clientX;
	win._resizeStartY = e.clientY;
	win._resizeStartW = win.element.offsetWidth;
	win._resizeStartH = win.element.offsetHeight;
	const startLeft = win.element.offsetLeft;
	const startTop = win.element.offsetTop;

	handle.setPointerCapture( e.pointerId );
	win.element.classList.add( 'os-window--resizing' );
	doAction( HOOKS.WINDOW_RESIZE_START, { windowId: win.id } );

	const emitBoundsChanged = makeBoundsEmitter( win, 'resize' );

	const snap = win.snapConfigProvider?.() ?? { enabled: false, cellWidth: 0, cellHeight: 0 };
	if ( snap.enabled ) {
		win.element.classList.add( 'os-window--snap-drag' );
	}

	if ( win.state === 'snapped-left' || win.state === 'snapped-right' ) {
		win.element.classList.remove(
			'os-window--snapped-left',
			'os-window--snapped-right',
		);
		win.state = 'normal';
	}

	const onResizeMove = ( ev: PointerEvent ): void => {
		if ( ! win._isResizing ) {
			return;
		}
		const dx = ev.clientX - win._resizeStartX;
		const dy = ev.clientY - win._resizeStartY;
		const geom = computeResize(
			dir,
			dx,
			dy,
			startLeft,
			startTop,
			win._resizeStartW,
			win._resizeStartH,
			win.config.minWidth,
			win.config.minHeight,
			snap,
		);

		win.element.style.left = `${ geom.x }px`;
		win.element.style.top = `${ geom.y }px`;
		win.element.style.width = `${ geom.width }px`;
		win.element.style.height = `${ geom.height }px`;

		emitBoundsChanged();
	};

	const onResizeEnd = (): void => {
		if ( ! win._isResizing ) {
			return;
		}
		win._isResizing = false;
		win.element.classList.remove( 'os-window--resizing' );
		win.element.classList.remove( 'os-window--snap-drag' );
		handle.removeEventListener( 'pointermove', onResizeMove );
		handle.removeEventListener( 'pointerup', onResizeEnd );
		handle.removeEventListener( 'pointercancel', onResizeEnd );
		handle.removeEventListener( 'lostpointercapture', onResizeEnd );

		win._gridSpan = null;
		win._emitChange( 'resized' );
		const payload = {
			windowId: win.id,
			width: win.element.offsetWidth,
			height: win.element.offsetHeight,
		};
		doAction( HOOKS.WINDOW_RESIZE_END, payload );
		doAction( HOOKS.WINDOW_RESIZED, payload );
	};

	handle.addEventListener( 'pointermove', onResizeMove );
	handle.addEventListener( 'pointerup', onResizeEnd );
	handle.addEventListener( 'pointercancel', onResizeEnd );
	handle.addEventListener( 'lostpointercapture', onResizeEnd );
}

export function computeResize(
	dir: ResizeDir,
	dx: number,
	dy: number,
	startLeft: number,
	startTop: number,
	startW: number,
	startH: number,
	minWidth: number,
	minHeight: number,
	snap: { enabled: boolean; cellWidth: number; cellHeight: number },
): { x: number; y: number; width: number; height: number } {
	let width = startW;
	let height = startH;
	let x = startLeft;
	let y = startTop;

	if ( dir === 'ne' || dir === 'se' ) {
		width = Math.max( minWidth, startW + dx );
	}

	if ( dir === 'nw' || dir === 'sw' ) {
		const nextWidth = Math.max( minWidth, startW - dx );
		x = startLeft + ( startW - nextWidth );
		width = nextWidth;
	}

	if ( dir === 'se' || dir === 'sw' ) {
		height = Math.max( minHeight, startH + dy );
	}

	if ( dir === 'ne' || dir === 'nw' ) {
		const nextHeight = Math.max( minHeight, startH - dy );
		y = startTop + ( startH - nextHeight );
		height = nextHeight;
	}

	if ( snap.enabled ) {
		const nextWidth = Math.max(
			minWidth,
			Math.round( width / snap.cellWidth ) * snap.cellWidth,
		);
		const nextHeight = Math.max(
			minHeight,
			Math.round( height / snap.cellHeight ) * snap.cellHeight,
		);

		if ( dir === 'nw' || dir === 'sw' ) {
			x = startLeft + ( width - nextWidth );
		}
		if ( dir === 'nw' || dir === 'ne' ) {
			y = startTop + ( height - nextHeight );
		}
		width = nextWidth;
		height = nextHeight;
	}

	if ( x < EDGE_MARGIN ) {
		const diff = EDGE_MARGIN - x;
		x = EDGE_MARGIN;
		width = Math.max( minWidth, width - diff );
	}
	if ( y < EDGE_MARGIN ) {
		const diff = EDGE_MARGIN - y;
		y = EDGE_MARGIN;
		height = Math.max( minHeight, height - diff );
	}

	return { x, y, width, height };
}

export function clampWindowPosition(
	x: number,
	y: number,
	width: number,
	bounds: WorkAreaRect,
): { x: number; y: number } {
	const minX = bounds.x + GRAB_MARGIN - width;
	const maxX = bounds.x + bounds.width - GRAB_MARGIN;
	const safeX = Math.max( minX, Math.min( x, maxX ) );

	const minY = bounds.y + EDGE_MARGIN;
	const maxY = bounds.y + bounds.height - GRAB_MARGIN;
	const safeY = Math.max( minY, Math.min( y, maxY ) );

	return { x: safeX, y: safeY };
}
