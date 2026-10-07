import { isTextEntryElement } from './window-manager/switcher';

let uninstall: ( () => void ) | null = null;

export function isShadowTextEntryKeydown( e: KeyboardEvent ): boolean {
	if ( e.ctrlKey || e.metaKey || e.altKey ) {
		return false;
	}

	if ( e.key.length !== 1 ) {
		return false;
	}
	const path = e.composedPath();
	const leaf = path.length > 0 ? path[ 0 ] : null;
	if ( ! ( leaf instanceof Element ) ) {
		return false;
	}
	if ( ! ( leaf.getRootNode() instanceof ShadowRoot ) ) {
		return false;
	}
	return isTextEntryElement( leaf );
}

export function installTextEntryGuard( target: Window = window ): () => void {
	if ( uninstall ) {
		return uninstall;
	}
	const onKeyDown = ( e: KeyboardEvent ): void => {
		if ( isShadowTextEntryKeydown( e ) ) {
			e.stopPropagation();
		}
	};
	target.addEventListener( 'keydown', onKeyDown, true );
	const off = (): void => {
		target.removeEventListener( 'keydown', onKeyDown, true );
		if ( uninstall === off ) {
			uninstall = null;
		}
	};
	uninstall = off;
	return off;
}
