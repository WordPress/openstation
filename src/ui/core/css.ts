/**
 * wpd-ui — CSS tagged template.
 *
 * Returns a `CSSStyleSheet` when the browser supports
 * constructable stylesheets (every evergreen, including Safari
 * 16.4+), otherwise a lazy-inline-stringy object that
 * `Component.adoptStyles()` mounts as a `<style>` tag. Either way
 * the call-site reads identically:
 *
 *     static styles = [ css`:host { display: block }` ];
 */

/**
 * Opaque shape returned by `css\`...\`` tagged templates. Either a
 * real `CSSStyleSheet` or a fallback carrying the raw text so the
 * Component base class can mount a `<style>` element.
 */
export interface StyleDef {
	readonly __wpdCss: true;
	readonly sheet: CSSStyleSheet | null;
	readonly cssText: string;
}

/**
 * True if this runtime supports constructable stylesheets INCLUDING
 * the `replaceSync` method. jsdom ships the constructor but not
 * `replaceSync`, which would silently break `<style>` fallbacks
 * in tests — so we require both before committing to the sheet
 * path.
 */
const SUPPORTS_CONSTRUCTABLE_SHEETS = ( () => {
	try {
		const s = new CSSStyleSheet();
		return typeof s.replaceSync === 'function';
	} catch {
		return false;
	}
} )();

/** CSS tagged template. */
export function css(
	strings: TemplateStringsArray,
	...values: ( string | number | StyleDef )[]
): StyleDef {
	let text = strings[ 0 ];
	for ( let i = 1; i < strings.length; i++ ) {
		const v = values[ i - 1 ];
		if ( typeof v === 'string' || typeof v === 'number' ) {
			text += String( v );
		} else if ( v && ( v as StyleDef ).__wpdCss ) {
			text += ( v as StyleDef ).cssText;
		} else {
			// Refuse arbitrary expressions — they're the typical
			// injection vector for CSS tagged templates. The
			// error is clearer than a silent malformed sheet.
			throw new TypeError(
				'[wpd-ui] css`` interpolations must be strings, numbers, or other css`` results. Got: ' +
					typeof v,
			);
		}
		text += strings[ i ];
	}

	if ( SUPPORTS_CONSTRUCTABLE_SHEETS ) {
		const sheet = new CSSStyleSheet();
		sheet.replaceSync( text );
		return { __wpdCss: true, sheet, cssText: text };
	}
	return { __wpdCss: true, sheet: null, cssText: text };
}
