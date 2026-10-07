export function adminBaseUrl(): string {
	const desktop = ( window as unknown as {
		wp?: { os?: { config?: { adminUrl?: string } } };
	} ).wp?.os;
	return desktop?.config?.adminUrl || '/wp-admin/';
}

const IDENTITY_PARAMS: readonly string[] = [
	'post_type',
	'page',
	'taxonomy',

	'path',

	'post',

	'c',

	'tag_ID',

	'item',

	'p',
];

export const PAGE_IDENTITY_PARAMS: readonly string[] = IDENTITY_PARAMS.filter(
	( key ) => key !== 'p',
);

const NO_SCOPED_PARAMS: readonly string[] = [];

function scopedIdentityParams( parsed: URL ): readonly string[] {
	if ( ! parsed.pathname.endsWith( '/admin.php' ) ) {
		return NO_SCOPED_PARAMS;
	}
	if ( ! parsed.searchParams.get( 'page' ) ) {
		return NO_SCOPED_PARAMS;
	}
	const action = parsed.searchParams.get( 'action' );
	if ( 'edit' === action && parsed.searchParams.get( 'id' ) ) {
		return [ 'id' ];
	}
	if ( 'new' === action ) {
		return [ 'action' ];
	}
	return NO_SCOPED_PARAMS;
}

function slugify( path: string ): string {
	let decoded = path;
	try {
		decoded = decodeURIComponent( path );
	} catch {
		decoded = path;
	}
	return decoded
		.replace( /\.php/g, '-php' )
		.replace( /[?&=/]/g, '-' )
		.replace( /[^a-zA-Z0-9_-]/g, '' )
		.replace( /-+/g, '-' )
		.replace( /^-|-$/g, '' ) || 'index';
}

export function deriveWindowId( url: string, adminUrl: string ): string {
	let parsed: URL | null = null;
	try {
		parsed = new URL( url, adminUrl );
	} catch ( err ) {
		parsed = null;
	}

	if ( parsed ) {
		const basePath = new URL( adminUrl ).pathname;
		const filename = parsed.pathname.replace( basePath, '' ).replace( /^\/+/, '' );

		const significant = new URLSearchParams();
		const keys = [ ...IDENTITY_PARAMS, ...scopedIdentityParams( parsed ) ];
		for ( const key of keys ) {
			const value = parsed.searchParams.get( key );
			if ( value ) {
				significant.set( key, value );
			}
		}

		const query = significant.toString();
		return slugify( query ? `${ filename }?${ query }` : filename );
	}

	let path = url.replace( adminUrl, '' );
	if ( path.startsWith( '/' ) ) {
		path = path.substring( 1 );
	}
	return slugify( path );
}

export function sanitizeClassName( value: string ): string {
	return value.replace( /[^a-zA-Z0-9_-]/g, '' );
}

export function applyTileEntryStagger( tile: HTMLElement ): void {
	tile.style.setProperty(
		'--os-file-tile-enter-delay',
		`${ ( Math.random() * 0.25 ).toFixed( 3 ) }s`,
	);
	tile.style.setProperty(
		'--os-file-tile-enter-duration',
		`${ ( 0.3 + Math.random() * 0.25 ).toFixed( 3 ) }s`,
	);
}

export function pageIdentityKey( url: string ): string {
	try {
		const parsed = new URL( url, window.location.origin );
		const significant = new URLSearchParams();
		const keys = [
			...PAGE_IDENTITY_PARAMS,
			...scopedIdentityParams( parsed ),
		];
		for ( const key of keys ) {
			const value = parsed.searchParams.get( key );
			if ( value ) {
				significant.set( key, value );
			} else if (
				key === 'post_type' &&
				( parsed.pathname.endsWith( '/edit.php' ) ||
					parsed.pathname.endsWith( '/post-new.php' ) )
			) {
				significant.set( key, 'post' );
			}
		}
		significant.sort();
		const query = significant.toString();
		return (
			parsed.pathname.replace( /\/+$/, '' ) + ( query ? `?${ query }` : '' )
		);
	} catch {
		return url;
	}
}

export function urlMatchKey( url: string ): string {
	try {
		const parsed = new URL( url, window.location.origin );
		parsed.searchParams.delete( 'openstation_chromeless' );
		parsed.searchParams.delete( 'desktop_mode_portal' );
		return parsed.pathname.replace( /\/+$/, '' ) + '?' + parsed.searchParams.toString();
	} catch {
		return url;
	}
}

export function urlReuseKey( url: string ): string {
	try {
		const parsed = new URL( url, window.location.origin );
		parsed.searchParams.delete( 'openstation_chromeless' );
		parsed.searchParams.delete( 'desktop_mode_portal' );
		parsed.searchParams.delete( '_wp_http_referer' );
		parsed.searchParams.sort();
		return parsed.pathname.replace( /\/+$/, '' ) + '?' + parsed.searchParams.toString();
	} catch {
		return url;
	}
}

export function sanitizeIconSvg( svg: string ): string {
	if ( typeof svg !== 'string' || svg === '' ) {
		return '';
	}
	if ( typeof DOMParser === 'undefined' ) {
		return '';
	}
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString( svg, 'image/svg+xml' );
	} catch {
		return '';
	}
	const root = doc.documentElement;
	if ( ! root || root.nodeName.toLowerCase() !== 'svg' ) {
		return '';
	}

	if ( doc.getElementsByTagName( 'parsererror' ).length > 0 ) {
		return '';
	}

	const BANNED_TAGS = new Set( [ 'script', 'style', 'foreignobject', 'iframe', 'object', 'embed' ] );
	const walk = ( el: Element ): void => {
		const children = Array.from( el.children );
		for ( const child of children ) {
			if ( BANNED_TAGS.has( child.nodeName.toLowerCase() ) ) {
				child.remove();
				continue;
			}

			for ( const attr of Array.from( child.attributes ) ) {
				const name = attr.name.toLowerCase();
				const value = attr.value.trim().toLowerCase();
				if ( name.startsWith( 'on' ) ) {
					child.removeAttribute( attr.name );
					continue;
				}
				if ( value.startsWith( 'javascript:' ) ) {
					child.removeAttribute( attr.name );
				}
			}
			walk( child );
		}
	};
	walk( root );

	for ( const attr of Array.from( root.attributes ) ) {
		const name = attr.name.toLowerCase();
		const value = attr.value.trim().toLowerCase();
		if ( name.startsWith( 'on' ) || value.startsWith( 'javascript:' ) ) {
			root.removeAttribute( attr.name );
		}
	}

	return root.outerHTML;
}

export interface BackgroundActivateHandle {
	dispose: () => void;
}

export function bindBackgroundActivate(
	host: HTMLElement,
	isBackground: ( target: EventTarget | null ) => boolean,
	onActivate: ( x: number, y: number ) => void,
): BackgroundActivateHandle {
	let armed: EventTarget | null = null;

	const onPointerDown = ( e: PointerEvent ) => {
		if ( e.button !== 0 ) {
			armed = null;
			return;
		}
		armed = isBackground( e.target ) ? e.target : null;
	};

	const onPointerUp = ( e: PointerEvent ) => {
		const target = armed;
		armed = null;
		if ( e.button !== 0 || ! target ) {
			return;
		}
		if ( e.target !== target ) {
			return;
		}
		if ( ! isBackground( e.target ) ) {
			return;
		}
		onActivate( e.clientX, e.clientY );
	};

	const onPointerCancel = () => {
		armed = null;
	};

	host.addEventListener( 'pointerdown', onPointerDown );
	host.addEventListener( 'pointerup', onPointerUp );
	host.addEventListener( 'pointercancel', onPointerCancel );

	return {
		dispose() {
			host.removeEventListener( 'pointerdown', onPointerDown );
			host.removeEventListener( 'pointerup', onPointerUp );
			host.removeEventListener( 'pointercancel', onPointerCancel );
		},
	};
}

export function decodeHTML( raw: string ): string {
	const ta = document.createElement( 'textarea' );
	ta.innerHTML = raw;
	return ta.value;
}
