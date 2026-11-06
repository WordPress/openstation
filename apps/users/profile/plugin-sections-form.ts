/**
 * `<os-user-profile>` plugin sections: what the element reads off the
 * embedded profile form.
 *
 * The embedded `profile.php` / `user-edit.php` form posts every field,
 * core ones included (hidden, but still in the form). So when the
 * element's own form saves while the user has edited a plugin field
 * here, the embed is not reloaded (that would drop the edit) and not
 * posted as loaded (that would undo the core change). The fields the
 * user left alone take the server's fresh values, the edited ones stay,
 * and then the embed saves.
 */

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

// Tag checks, never `instanceof`: the form lives in the iframe's own
// window, whose element classes are not this window's.
const isToggle = ( el: Control ): el is HTMLInputElement =>
	el.tagName === 'INPUT' && ( ( el as HTMLInputElement ).type === 'checkbox' || ( el as HTMLInputElement ).type === 'radio' );
const isMultiSelect = ( el: Control ): el is HTMLSelectElement =>
	el.tagName === 'SELECT' && ( el as HTMLSelectElement ).multiple;

/** A control's saved state, keyed by name and position among that name. */
export type FormSnapshot = Map< string, string >;

/** Whether the loaded page should be sent back to the narrowed screen. */
export function shouldRenarrow( doc: Document, onProfileScreen: boolean, alreadyTried: boolean ): boolean {
	return (
		onProfileScreen &&
		! alreadyTried &&
		doc.getElementById( 'your-profile' ) !== null &&
		doc.getElementById( 'os-profile-sections-start' ) === null
	);
}

function controls( form: HTMLFormElement ): Array< [ string, Control ] > {
	const seen = new Map< string, number >();
	const out: Array< [ string, Control ] > = [];
	for ( const el of Array.from( form.elements ) as Control[] ) {
		if ( ! el.name || ( el.tagName === 'INPUT' && [ 'submit', 'button', 'file' ].includes( ( el as HTMLInputElement ).type ) ) ) {
			continue;
		}
		const n = seen.get( el.name ) ?? 0;
		seen.set( el.name, n + 1 );
		out.push( [ `${ el.name }#${ n }`, el ] );
	}
	return out;
}

function stateOf( el: Control ): string {
	if ( isToggle( el ) ) {
		return el.checked ? '1' : '0';
	}
	if ( isMultiSelect( el ) ) {
		return Array.from( el.selectedOptions, ( o ) => o.value ).join( '\n' );
	}
	return el.value;
}

/** Record every control's state, to tell later what the user changed. */
export function snapshotForm( form: HTMLFormElement ): FormSnapshot {
	return new Map( controls( form ).map( ( [ key, el ] ) => [ key, stateOf( el ) ] ) );
}

/** Whether any control differs from the snapshot. */
export function isFormDirty( form: HTMLFormElement, snapshot: FormSnapshot ): boolean {
	return controls( form ).some( ( [ key, el ] ) => snapshot.get( key ) !== stateOf( el ) );
}

/**
 * Give every control the user left alone the value it has in `fresh`
 * (the same screen, fetched again after the element's own save).
 * Controls the user changed keep their value.
 */
export function refreshUntouched( form: HTMLFormElement, snapshot: FormSnapshot, fresh: HTMLFormElement ): void {
	const next = new Map( controls( fresh ) );
	for ( const [ key, el ] of controls( form ) ) {
		const source = next.get( key );
		if ( ! source || snapshot.get( key ) !== stateOf( el ) ) {
			continue;
		}
		if ( isToggle( el ) ) {
			el.checked = ( source as HTMLInputElement ).checked;
		} else if ( isMultiSelect( el ) ) {
			const picked = new Set( Array.from( ( source as HTMLSelectElement ).selectedOptions, ( o ) => o.value ) );
			for ( const option of Array.from( el.options ) ) {
				option.selected = picked.has( option.value );
			}
		} else {
			el.value = source.value;
		}
	}
}
