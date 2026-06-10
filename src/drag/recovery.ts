/**
 * Desktop Mode — Drag-session recovery handlers.
 *
 * Wires the global cancel paths the system used to lack:
 *
 *   - `Escape` keypress           → user explicitly aborts
 *   - `window` blur                → tab loses focus mid-drag
 *   - `document` visibilitychange  → tab hidden mid-drag
 *
 * Drop-handler errors are caught locally in the manager via
 * `try/catch` around each callback invocation — a global
 * `window.error` listener was tried and rejected because it fires
 * for too many unrelated events (`<img>` load failures, third-party
 * script errors, etc.) and would spuriously cancel in-flight drags.
 *
 * Listeners are attached lazily on the first session start so cold
 * boots that never drag pay nothing. They are never removed — keeping
 * them attached forever costs three idle listeners and avoids race
 * conditions around session end vs handler removal.
 *
 * @since 0.8.1
 */

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

/** Test-only — resets the install latch so a new manager can re-arm. */
export function __resetRecoveryForTests(): void {
	_installed = false;
}
