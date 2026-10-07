let _installed = false;

export function installRecovery( cancelActive: ( reason: 'escape' | 'blur' | 'visibility' ) => void ): void {
	if ( _installed ) {
		return;
	}
	_installed = true;

	document.addEventListener( 'keydown', ( e ) => {
		if ( e.key === 'Escape' ) {
			cancelActive( 'escape' );
		}
	} );

	window.addEventListener( 'blur', () => {
		cancelActive( 'blur' );
	} );

	document.addEventListener( 'visibilitychange', () => {
		if ( document.hidden ) {
			cancelActive( 'visibility' );
		}
	} );
}

export function __resetRecoveryForTests(): void {
	_installed = false;
}
