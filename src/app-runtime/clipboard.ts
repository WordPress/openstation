export async function copyText( text: string ): Promise< boolean > {
	if ( text === '' ) {
		return false;
	}
	const clipboard = ( globalThis.navigator as Navigator | undefined )?.clipboard;
	if ( clipboard?.writeText ) {
		try {
			await clipboard.writeText( text );
			return true;
		} catch {

		}
	}
	return copyThroughSelection( text );
}

function copyThroughSelection( text: string ): boolean {
	const doc = globalThis.document as Document | undefined;
	if ( ! doc?.body || typeof doc.execCommand !== 'function' ) {
		return false;
	}
	const area = doc.createElement( 'textarea' );
	area.value = text;
	area.setAttribute( 'readonly', '' );
	area.setAttribute( 'aria-hidden', 'true' );
	area.style.position = 'fixed';
	area.style.insetInlineStart = '-9999px';
	area.style.opacity = '0';
	doc.body.appendChild( area );
	const active = doc.activeElement as HTMLElement | null;
	area.select();
	let copied = false;
	try {
		copied = doc.execCommand( 'copy' );
	} catch {
		copied = false;
	}
	area.remove();
	active?.focus?.();
	return copied;
}
