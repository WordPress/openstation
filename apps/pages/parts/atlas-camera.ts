import { wirePinchInput } from '../../../src/content-graph/pinch-input';

export interface AtlasCamera { x: number; y: number; zoom: number }
export function zoomAt( camera: AtlasCamera, zoom: number, x: number, y: number ): void {
	const next = Math.min( 1.8, Math.max( 0.08, zoom ) );
	const ratio = next / camera.zoom;
	camera.x = x - ( x - camera.x ) * ratio;
	camera.y = y - ( y - camera.y ) * ratio;
	camera.zoom = next;
}

export function wireAtlasCamera( stage: HTMLElement, camera: AtlasCamera, draw: () => void ): () => void {
	const pointers = new Map< number, { x: number; y: number } >();
	const controller = new AbortController();
	const { signal } = controller;
	const pinch = wirePinchInput( stage, {
		read: () => ( { x: camera.x, y: camera.y, scale: camera.zoom } ),
		write: ( next ) => {
			camera.x = next.x; camera.y = next.y; camera.zoom = next.scale; draw();
		},
		bounds: { min: .08, max: 1.8 },
		start: () => {
			pointers.clear(); stage.classList.add( 'is-panning' );
		},
		end: () => stage.classList.remove( 'is-panning' ),
	} );
	const point = ( e: PointerEvent ): { x: number; y: number } => {
		const rect = stage.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	};
	stage.addEventListener( 'pointerdown', ( e ) => {
		if ( pinch.active() || e.button !== 0 || ( e.target as Element ).closest( 'os-button, a' ) ) {
			return;
		}
		pointers.set( e.pointerId, point( e ) );
		stage.setPointerCapture( e.pointerId );
		stage.classList.add( 'is-panning' );
	}, { signal } );
	stage.addEventListener( 'pointermove', ( e ) => {
		const previous = pointers.get( e.pointerId );
		if ( pinch.active() || ! previous ) {
			return;
		}
		const current = point( e ); pointers.set( e.pointerId, current );
		camera.x += current.x - previous.x; camera.y += current.y - previous.y;
		draw();
	}, { signal } );
	const release = ( e: PointerEvent ): void => {
		pointers.delete( e.pointerId );
		if ( ! pointers.size ) {
			stage.classList.remove( 'is-panning' );
		}
	};
	stage.addEventListener( 'pointerup', release, { signal } );
	stage.addEventListener( 'pointercancel', release, { signal } );
	stage.addEventListener( 'lostpointercapture', release, { signal } );
	stage.addEventListener( 'wheel', ( e ) => {
		e.preventDefault();
		const rect = stage.getBoundingClientRect();
		zoomAt( camera, camera.zoom * Math.exp( -e.deltaY * 0.0015 ), e.clientX - rect.left, e.clientY - rect.top ); draw();
	}, { signal, passive: false } );
	stage.addEventListener( 'keydown', ( e ) => {
		if ( e.target !== stage ) {
			return;
		}
		const step = 70;
		if ( e.key === 'ArrowLeft' ) {
			camera.x += step;
		} else if ( e.key === 'ArrowRight' ) {
			camera.x -= step;
		} else if ( e.key === 'ArrowUp' ) {
			camera.y += step;
		} else if ( e.key === 'ArrowDown' ) {
			camera.y -= step;
		} else if ( e.key === '+' || e.key === '=' || e.key === '-' ) {
			zoomAt( camera, camera.zoom * ( e.key === '-' ? .8 : 1.25 ), stage.clientWidth / 2, stage.clientHeight / 2 );
		} else {
			return;
		}
		e.preventDefault(); draw();
	}, { signal } );
	return () => {
		controller.abort(); pinch.dispose(); pointers.clear(); stage.classList.remove( 'is-panning' );
	};
}
