/**
 * App Framework — the clipboard, as one call.
 *
 * Every list window ends up with a "Copy link" / "Copy ID" somewhere,
 * and every one of them used to reach for `navigator.clipboard` bare
 * — which is `undefined` on a plain-HTTP dev site, in an old WebView,
 * and in jsdom, so the copy silently did nothing and the toast still
 * said it worked. `copyText()` tries the async API first and falls
 * back to a selection-and-`execCommand` copy, and it tells the truth:
 * the promise resolves to whether the text is on the clipboard.
 *
 * @public
 */

/**
 * Put `text` on the clipboard. Resolves `true` when it is there,
 * `false` when neither the async API nor the legacy fallback could
 * copy — the caller decides what the toast says.
 */
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
			// Denied (no permission, not focused) — try the fallback.
		}
	}
	return copyThroughSelection( text );
}

/**
 * The legacy path: a hidden, off-screen textarea selected and copied
 * with `document.execCommand( 'copy' )`. Deprecated in name, still
 * the only way on an insecure origin.
 */
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
