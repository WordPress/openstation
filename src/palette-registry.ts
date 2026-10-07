export interface Palette {

	id: string;

	label?: string;

	open(): void;

	close(): void;

	isOpen(): boolean;
}

const palettes: Palette[] = [];
const listeners = new Set<() => void >();

export function registerPalette( p: Palette ): () => void {
	if ( ! p || typeof p.id !== 'string' || p.id === '' ) {
		return () => {};
	}
	if ( typeof p.open !== 'function' || typeof p.close !== 'function' || typeof p.isOpen !== 'function' ) {
		return () => {};
	}
	const idx = palettes.findIndex( ( x ) => x.id === p.id );
	if ( idx >= 0 ) {
		palettes[ idx ] = p;
	} else {
		palettes.push( p );
	}
	notify();
	return () => {
		const i = palettes.findIndex( ( x ) => x.id === p.id );
		if ( i >= 0 ) {
			palettes.splice( i, 1 );
			notify();
		}
	};
}

export function unregisterPalette( id: string ): void {
	const idx = palettes.findIndex( ( x ) => x.id === id );
	if ( idx >= 0 ) {
		palettes.splice( idx, 1 );
		notify();
	}
}

export function listPalettes(): Palette[] {
	return palettes.slice();
}

export function subscribePalettes( cb: () => void ): () => void {
	listeners.add( cb );
	return () => {
		listeners.delete( cb );
	};
}

function notify(): void {
	for ( const cb of Array.from( listeners ) ) {
		try {
			cb();
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.error( '[openstation] palette-registry listener threw:', err );
			}
		}
	}
}

export function notifyPaletteVisibility( id: string, open: boolean ): void {
	try {
		document.dispatchEvent(
			new CustomEvent( open ? 'os-palette-opened' : 'os-palette-closed', {
				detail: { id },
			} ),
		);
	} catch {

	}
}

export function cyclePalettes(): void {
	if ( palettes.length === 0 ) {
		return;
	}
	const cur = palettes.findIndex( ( p ) => {
		try {
			return p.isOpen();
		} catch {
			return false;
		}
	} );

	if ( cur === -1 ) {
		try {
			palettes[ 0 ].open();
			notifyPaletteVisibility( palettes[ 0 ].id, true );
		} catch {

		}
		return;
	}

	try {
		palettes[ cur ].close();
		notifyPaletteVisibility( palettes[ cur ].id, false );
	} catch {

	}

	const next = cur + 1;
	if ( next < palettes.length ) {
		try {
			palettes[ next ].open();
			notifyPaletteVisibility( palettes[ next ].id, true );
		} catch {

		}
	}
}

export function openPaletteOnly( id: string ): void {
	const target = palettes.find( ( p ) => p.id === id );
	if ( ! target ) {
		return;
	}
	for ( const p of palettes ) {
		if ( p.id !== id ) {
			try {
				if ( p.isOpen() ) {
					p.close();
					notifyPaletteVisibility( p.id, false );
				}
			} catch {

			}
		}
	}
	try {
		target.open();
		notifyPaletteVisibility( target.id, true );
	} catch {

	}
}

let installed = false;

export function installPaletteShortcut(): void {
	if ( installed ) {
		return;
	}
	installed = true;

	document.addEventListener(
		'keydown',
		( e: KeyboardEvent ) => {
			if ( ! ( e.metaKey || e.ctrlKey ) || e.key !== 'k' ) {
				return;
			}
			if ( e.shiftKey || e.altKey ) {
				return;
			}

			e.preventDefault();
			e.stopImmediatePropagation();
			cyclePalettes();
		},
		true,
	);

	const origin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== origin ) {
			return;
		}
		const data = e.data as { type?: string } | null;
		if ( data && data.type === 'os-palette-cycle' ) {
			cyclePalettes();
		}
	} );
}
