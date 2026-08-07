/**
 * Shared `<os-text-field>` plumbing for the shell's two built-in
 * modals (create-folder / rename, and the web-link dialog).
 *
 * Both dialogs are light-DOM overlays that slot component controls,
 * so they need the same three things: read a value back out, toggle
 * the disabled state while a submit is in flight, and reach the
 * inner native input to focus it. The component's own prop
 * accessors cover the first two — the fallbacks exist for the
 * window between `document.createElement` and custom-element
 * upgrade, where the element is still a bare `HTMLElement` with no
 * accessors installed.
 */

/** Read the current value of an `<os-text-field>`. */
export function readFieldValue( field: HTMLElement ): string {
	const value = ( field as unknown as { value?: string } ).value;
	if ( typeof value === 'string' ) {
		return value;
	}
	// Pre-upgrade (or a caller that only ever set the attribute):
	// fall back to the attribute, then to the rendered input.
	return (
		field.getAttribute( 'value' ) ??
		field.shadowRoot?.querySelector< HTMLInputElement >( 'input' )?.value ??
		''
	);
}

/**
 * Enable / disable an `<os-*>` control. Works for `<os-text-field>`
 * and `<os-button>` alike — both declare `disabled` in `static
 * props`, so the accessor reflects it to the attribute that their
 * styles and native inner control key off.
 */
export function setControlDisabled( control: HTMLElement, disabled: boolean ): void {
	( control as unknown as { disabled: boolean } ).disabled = disabled;
	// Pre-upgrade fallback: no accessor yet, so write the attribute
	// ourselves. Harmless once upgraded — the setter did the same.
	if ( disabled ) {
		control.setAttribute( 'disabled', '' );
	} else {
		control.removeAttribute( 'disabled' );
	}
}

/**
 * Focus an `<os-text-field>` and select its contents, so the user
 * can type straight over the current name — the same affordance
 * Finder gives a freshly created folder.
 *
 * Custom elements upgrade and render asynchronously, so the inner
 * `<input>` may not exist on the tick the dialog is mounted. We try
 * immediately, then once more on the next microtask; the `select()`
 * is a no-op the second time if the first already took.
 */
export function focusField( field: HTMLElement ): void {
	const attempt = (): boolean => {
		const input =
			field.shadowRoot?.querySelector< HTMLInputElement >( 'input' );
		if ( ! input ) {
			return false;
		}
		input.focus();
		input.select();
		return true;
	};
	if ( ! attempt() ) {
		queueMicrotask( () => void attempt() );
	}
}
