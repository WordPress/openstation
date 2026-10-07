export function readFieldValue( field: HTMLElement ): string {
	const value = ( field as unknown as { value?: string } ).value;
	if ( typeof value === 'string' ) {
		return value;
	}

	return (
		field.getAttribute( 'value' ) ??
		field.shadowRoot?.querySelector< HTMLInputElement >( 'input' )?.value ??
		''
	);
}

export function setControlDisabled( control: HTMLElement, disabled: boolean ): void {
	( control as unknown as { disabled: boolean } ).disabled = disabled;

	if ( disabled ) {
		control.setAttribute( 'disabled', '' );
	} else {
		control.removeAttribute( 'disabled' );
	}
}

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
