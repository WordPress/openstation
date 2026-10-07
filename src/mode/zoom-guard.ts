import { isMobileStamped, isStandaloneStamped } from './stamp';

export interface ZoomGuardOptions {

	root?: Element;

	doc?: Pick< Document, 'addEventListener' | 'removeEventListener' >;
}

export function zoomGuardActive( root: Element ): boolean {
	return isMobileStamped( root ) || isStandaloneStamped( root );
}

export function installZoomGuard( opts: ZoomGuardOptions = {} ): () => void {
	const root = opts.root ?? document.documentElement;
	const doc = opts.doc ?? document;

	const cancel = ( e: Event ): void => {
		if ( zoomGuardActive( root ) && e.cancelable ) {
			e.preventDefault();
		}
	};
	const onTouchMove = ( e: Event ): void => {
		if ( ( e as TouchEvent ).touches?.length > 1 ) {
			cancel( e );
		}
	};
	const onWheel = ( e: Event ): void => {
		if ( ( e as WheelEvent ).ctrlKey ) {
			cancel( e );
		}
	};

	const active = { passive: false } as const;
	doc.addEventListener( 'gesturestart', cancel, active );
	doc.addEventListener( 'gesturechange', cancel, active );
	doc.addEventListener( 'gestureend', cancel, active );
	doc.addEventListener( 'touchmove', onTouchMove, active );
	doc.addEventListener( 'wheel', onWheel, active );

	return () => {
		doc.removeEventListener( 'gesturestart', cancel );
		doc.removeEventListener( 'gesturechange', cancel );
		doc.removeEventListener( 'gestureend', cancel );
		doc.removeEventListener( 'touchmove', onTouchMove );
		doc.removeEventListener( 'wheel', onWheel );
	};
}
