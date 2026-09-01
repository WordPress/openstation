/**
 * The `⌘K` / `Ctrl+K` hint.
 *
 * Shared because the assistant is offered from two places — the tray's
 * strip on a bottom dock, a rail tile on a side one — and a shortcut
 * hint that disagreed between them would be worse than one missing
 * from the second.
 */

/**
 * Is this a Mac keyboard? `userAgentData.platform` where it exists,
 * `navigator.platform` where it doesn't: the latter is deprecated and
 * the former is Chromium-only, so neither alone covers the field.
 */
export function isMacKeyboard(): boolean {
	const uaData = ( navigator as Navigator & {
		userAgentData?: { platform?: string };
	} ).userAgentData;
	return /mac/i.test( uaData?.platform || navigator.platform || '' );
}

/**
 * `⌘K`, but `Ctrl+K`. The separator is the difference between a chord
 * and a word: `⌘` is a symbol and reads as its own key, `Ctrl` is
 * letters and against another letter comes out as "CtrlK". The `+` is
 * a span, not a `<kbd>` — punctuation between keys, not a key.
 *
 * `aria-hidden`: every control showing one also carries an `aria-label`
 * naming the action, and announcing both would read it twice.
 */
export function buildChord(): HTMLElement {
	const mac = isMacKeyboard();
	const chord = document.createElement( 'span' );
	chord.className = 'os-chord';
	chord.setAttribute( 'aria-hidden', 'true' );

	( mac ? [ '⌘', 'K' ] : [ 'Ctrl', 'K' ] ).forEach( ( key, i ) => {
		if ( i > 0 && ! mac ) {
			const plus = document.createElement( 'span' );
			plus.className = 'os-chord__plus';
			plus.textContent = '+';
			chord.appendChild( plus );
		}
		const kbd = document.createElement( 'kbd' );
		kbd.textContent = key;
		chord.appendChild( kbd );
	} );

	return chord;
}
