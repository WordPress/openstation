import { pinchCamera, type Camera, type Point, type ZoomBounds } from './pinch';
export interface PinchInputOptions {
	read(): Camera;
	write( camera: Camera ): void;
	bounds: ZoomBounds;
	start(): void;
	end(): void;
}

export function wirePinchInput( surface: HTMLElement, options: PinchInputOptions ): { active(): boolean; dispose(): void } {
	const owner = surface.ownerDocument.defaultView!;
	const controller = new AbortController();
	const pointers = new Map< number, Point >();
	const originalTouchAction = surface.style.touchAction;
	surface.style.touchAction = 'none';
	let pinching = false;
	let suppressUntil = 0;
	const point = ( e: PointerEvent ): Point => {
		const r = surface.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	const listener = { capture: true, passive: false, signal: controller.signal };
	owner.addEventListener( 'pointerdown', ( e ) => {
		if ( e.pointerType !== 'touch' || ! e.composedPath().includes( surface ) ) {
			return;
		}
		pointers.set( e.pointerId, point( e ) );
		if ( pointers.size >= 2 ) {
			e.preventDefault();
			if ( ! pinching ) {
				pinching = true;
				options.start();
			}
		}
	}, listener );
	owner.addEventListener( 'pointermove', ( e ) => {
		if ( ! pointers.has( e.pointerId ) ) {
			return;
		}
		if ( ! pinching ) {
			pointers.set( e.pointerId, point( e ) );
			return;
		}
		const [ a, b ] = pointers.values();
		pointers.set( e.pointerId, point( e ) );
		e.preventDefault();
		if ( b ) {
			const [ nextA, nextB ] = pointers.values();
			options.write( pinchCamera( options.read(), { a, b }, { a: nextA, b: nextB }, options.bounds ) );
		}
	}, listener );
	const release = ( e: PointerEvent ): void => {
		if ( ! pointers.delete( e.pointerId ) ) {
			return;
		}
		if ( pinching ) {
			e.preventDefault();
			if ( ! pointers.size ) {
				pinching = false;
				suppressUntil = performance.now() + 300;
				options.end();
			}
		}
	};
	owner.addEventListener( 'pointerup', release, listener );
	owner.addEventListener( 'pointercancel', release, listener );
	owner.addEventListener( 'lostpointercapture', release, listener );
	owner.addEventListener( 'click', ( e ) => {
		if ( e.detail > 0 && ( pinching || performance.now() < suppressUntil ) && e.composedPath().includes( surface ) ) {
			e.preventDefault(); e.stopImmediatePropagation();
		}
	}, listener );
	return {
		active: () => pinching,
		dispose: () => {
			controller.abort(); pointers.clear();
			if ( pinching ) {
				options.end();
			}
			pinching = false;
			surface.style.touchAction = originalTouchAction;
		},
	};
}
