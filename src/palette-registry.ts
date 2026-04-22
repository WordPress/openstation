/**
 * Desktop Mode — palette registry.
 *
 * A "palette" is any Cmd+K-triggered overlay UI — the built-in AI
 * Assistant is one, a plugin's custom launcher could be another. The
 * registry solves the "who handles Cmd+K?" problem when multiple
 * palettes coexist: ONE shortcut handler lives in the shell and cycles
 * through every registered palette.
 *
 *   ┌─────────┐  press 1   ┌───────────┐
 *   │ nothing │ ─────────▶ │ palette 0 │
 *   │  open   │            │   open    │
 *   └─────────┘            └─────┬─────┘
 *        ▲                       │ press 2
 *        │ press N+1             ▼
 *        │                 ┌───────────┐
 *        │                 │ palette 1 │
 *        │                 │   open    │
 *        │                 └─────┬─────┘
 *        │                       │ press N (last)
 *        └───── closes last, back to "nothing open" ────┘
 *
 * Single-palette case degenerates cleanly: Cmd+K opens, Cmd+K again
 * closes (because cycling past the last lands on "nothing open").
 *
 * @since 0.14.0
 */

/**
 * A Cmd+K-triggered overlay. Just three methods — the registry doesn't
 * care about visuals; only the open/closed contract.
 */
export interface Palette {
	/** Unique id. Re-registering the same id REPLACES the previous entry. */
	id: string;
	/** Human label, used in debug output and potential picker UIs. */
	label?: string;
	/** Open the palette UI. */
	open(): void;
	/** Close the palette UI. */
	close(): void;
	/** Synchronously report whether the palette is currently visible. */
	isOpen(): boolean;
}

const palettes: Palette[] = [];
const listeners = new Set<() => void >();

/**
 * Add a palette to the registry. Returns an unsubscribe function — call
 * it when your plugin tears down to keep the registry clean.
 *
 * Re-registering the same id replaces the previous entry (mirrors WP's
 * `register_*` semantics), so it's safe to call during module-HMR cycles
 * or after live plugin activation.
 */
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

/** Remove by id. Idempotent. */
export function unregisterPalette( id: string ): void {
	const idx = palettes.findIndex( ( x ) => x.id === id );
	if ( idx >= 0 ) {
		palettes.splice( idx, 1 );
		notify();
	}
}

/** Snapshot of all palettes in registration order. */
export function listPalettes(): Palette[] {
	return palettes.slice();
}

/** Subscribe to registry changes. */
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
				console.error( '[wp-desktop-mode] palette-registry listener threw:', err );
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

/**
 * Advance the palette cycle one step. Called by the global Cmd+K
 * handler the shell installs at boot.
 *
 *   nothing open        → open palette 0
 *   palette i open      → close i, open i+1 (if it exists)
 *   last palette open   → close it (nothing open after)
 */
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
		} catch {
			/* swallow — one bad palette shouldn't break the shortcut */
		}
		return;
	}

	try {
		palettes[ cur ].close();
	} catch {
		/* swallow */
	}

	const next = cur + 1;
	if ( next < palettes.length ) {
		try {
			palettes[ next ].open();
		} catch {
			/* swallow */
		}
	}
	// else: cycle ended — everything is now closed. Next press re-opens palette 0.
}

/**
 * Open a specific palette by id, closing any others that are currently
 * open. Used by entry points that target a particular palette (e.g. the
 * admin-bar "Ask AI" button) so they don't need to reason about the cycle.
 */
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
				}
			} catch {
				/* swallow */
			}
		}
	}
	try {
		target.open();
	} catch {
		/* swallow */
	}
}

// ---------------------------------------------------------------------------
// Global shortcut installer
// ---------------------------------------------------------------------------

let installed = false;

/**
 * Install the one-and-only Cmd+K / Ctrl+K shortcut handler. Idempotent —
 * calling it twice is safe (only the first call attaches the listener).
 *
 * Registers in capture phase on `document` so it fires before any
 * nested palette's own keydown handlers. Each palette is responsible
 * for closing itself cleanly on its own Escape handler; the cycle logic
 * never listens for Escape.
 */
export function installPaletteShortcut(): void {
	if ( installed ) {
		return;
	}
	installed = true;

	// Parent-document keydown — catches Cmd+K when focus is on the shell
	// itself (admin bar, dock, wallpaper, anywhere outside an iframe).
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
			cyclePalettes();
		},
		true,
	);

	// Iframe forwarder — the chromeless bridge script inside every
	// wp-admin iframe captures Cmd+K at its own document level and
	// postMessages us this event. Gives us a consistent shortcut
	// regardless of whether focus lives on the shell or inside
	// Gutenberg / TinyMCE / a plugin admin screen.
	const origin = window.location.origin;
	window.addEventListener( 'message', ( e: MessageEvent ) => {
		if ( e.origin !== origin ) {
			return;
		}
		const data = e.data as { type?: string } | null;
		if ( data && data.type === 'wp-desktop-palette-cycle' ) {
			cyclePalettes();
		}
	} );
}
