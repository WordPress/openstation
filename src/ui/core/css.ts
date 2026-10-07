export interface StyleDef {
	readonly __wpdCss: true;
	readonly sheet: CSSStyleSheet | null;
	readonly cssText: string;
}

const SUPPORTS_CONSTRUCTABLE_SHEETS = ( () => {
	try {
		const s = new CSSStyleSheet();
		return typeof s.replaceSync === 'function';
	} catch {
		return false;
	}
} )();

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
			throw new TypeError(
				'[os-ui] css`` interpolations must be strings, numbers, or other css`` results. Got: ' +
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
