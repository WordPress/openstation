/** Await the existing store's save lifecycle; never tell MIO an optimistic write saved. */
import { settings } from './store';
import type { OsSettingsState } from '../../../src/settings/types';
import type { OsSettingsSaveLifecycleDetail } from '../../../src/settings/state';

export function saveForMio(
	change: () => void,
	signal: AbortSignal,
	expected?: Partial<OsSettingsState>,
): Promise<unknown> {
	// Snapshot before the optimistic store update; later prompts already see the new state.
	const before = JSON.parse( JSON.stringify( settings() ) ) as OsSettingsState;
	return new Promise( ( resolve, reject ) => {
		let done = false;
		const finish = ( error?: Error ): void => {
			if ( done ) {
				return;
			}
			done = true;
			clearTimeout( timer );
			document.removeEventListener( 'os-settings-save-lifecycle', onSave );
			signal.removeEventListener( 'abort', onAbort );
			if ( error ) {
				reject( error );
			} else {
				const after = settings();
				const changes = Object.keys( after ).flatMap( ( name ) => {
					const key = name as keyof OsSettingsState;
					return JSON.stringify( before[ key ] ) === JSON.stringify( after[ key ] ) ? []
						: [ { setting: key, before: before[ key ], after: after[ key ] } ];
				} );
				resolve( { saved: true, changed: changes.length > 0, changes, settings: expected } );
			}
		};
		const onAbort = (): void =>
			finish( new DOMException( 'Cancelled; a submitted save may still finish.', 'AbortError' ) );
		const onSave = ( event: Event ): void => {
			const detail = ( event as CustomEvent<OsSettingsSaveLifecycleDetail> ).detail;
			if ( detail.phase === 'failed' ) {
				finish( new Error( detail.error || 'Preferences could not be saved.' ) );
			} else if ( detail.phase === 'saved' ) {
				const current = settings();
				const matches =
					! expected ||
					Object.entries( expected ).every(
						( [ key, value ] ) =>
							JSON.stringify( current[ key as keyof OsSettingsState ] ) ===
							JSON.stringify( value ),
					);
				// A previous in-flight write can finish while ours is queued.
				const saved = detail.savedSettings;
				const confirmed = saved && Object.entries( expected ?? current ).every(
					( [ key, value ] ) => JSON.stringify( saved[ key as keyof OsSettingsState ] ) === JSON.stringify( value ),
				);
				if ( matches && ! confirmed ) {
					return;
				}
				finish(
					matches
						? undefined
						: new Error( 'The setting changed during this request. Review Preferences.' ),
				);
			}
		};
		const timer = setTimeout(
			() =>
				finish(
					new Error(
						'Save confirmation timed out. Changes may still be saving; review Preferences.',
					),
				),
			20000,
		);
		document.addEventListener( 'os-settings-save-lifecycle', onSave );
		signal.addEventListener( 'abort', onAbort, { once: true } );
		if ( signal.aborted ) {
			onAbort();
			return;
		}
		try {
			change();
		} catch ( error ) {
			finish( error instanceof Error ? error : new Error( String( error ) ) );
		}
	} );
}
