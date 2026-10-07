let _cache: Map< string, string > | null = null;

function parseCssContentToChar( raw: string ): string | null {
	let value = raw.trim();
	if ( value === '' ) {
		return null;
	}

	if (
		( value.startsWith( '"' ) && value.endsWith( '"' ) ) ||
		( value.startsWith( "'" ) && value.endsWith( "'" ) )
	) {
		value = value.slice( 1, -1 );
	}

	const escaped = value.match( /^\\([0-9a-f]{1,6})\s?$/i );
	if ( escaped ) {
		return String.fromCodePoint( parseInt( escaped[ 1 ], 16 ) );
	}

	return value || null;
}

function buildMap(): Map< string, string > {
	const map = new Map< string, string >();
	if ( typeof document === 'undefined' ) {
		return map;
	}
	const sheets = Array.from( document.styleSheets ?? [] );
	for ( const sheet of sheets ) {
		let rules: CSSRuleList | null = null;
		try {
			rules = sheet.cssRules;
		} catch {
			continue;
		}
		if ( ! rules ) {
			continue;
		}
		for ( const rule of Array.from( rules ) ) {
			const styleRule = rule as CSSStyleRule;
			if ( ! styleRule || ! styleRule.selectorText ) {
				continue;
			}
			const match = styleRule.selectorText.match(
				/\.dashicons-([a-z0-9-]+)::?before/i,
			);
			if ( ! match ) {
				continue;
			}
			const content = styleRule.style?.content;
			if ( ! content ) {
				continue;
			}
			const char = parseCssContentToChar( content );
			if ( char ) {
				map.set( match[ 1 ], char );
			}
		}
	}
	return map;
}

export function resolveDashicon( name: string ): string | null {
	if ( ! _cache ) {
		_cache = buildMap();
	}
	const slug = name.startsWith( 'dashicons-' )
		? name.slice( 'dashicons-'.length )
		: name;
	return _cache.get( slug ) ?? null;
}

export function refreshDashiconCache(): void {
	_cache = buildMap();
}

let _scheduled = false;
export function primeOnLoad(): void {
	if ( _scheduled || typeof window === 'undefined' ) {
		return;
	}
	_scheduled = true;
	const refresh = (): void => {
		refreshDashiconCache();
	};
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', refresh, { once: true } );
	}
	window.addEventListener( 'load', refresh, { once: true } );
}
