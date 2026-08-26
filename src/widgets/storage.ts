/**
 * Per-widget `localStorage` wrapper. Creates a `WidgetStorage`
 * bound to a single widget id so two widgets persisting a
 * `preferences` value can't collide.
 *
 * Backed by `localStorage` + `JSON.stringify` / `JSON.parse`. All
 * operations are wrapped in try/catch: a disabled storage engine
 * (private mode, quota exceeded) must not break the widget — it
 * falls back to "no persistence" silently. Widgets that truly
 * require persistence can wire their own defensive re-read after
 * set, but most shouldn't need to.
 */

import type { WidgetStorage } from './types';

/**
 * Build a `WidgetStorage` for the given widget id. Keys are
 * prefixed with `os.widget.<id>.` so the namespace is
 * guaranteed unique across widgets, and `clear()` only removes
 * keys under that prefix (never touches siblings).
 */
export function createWidgetStorage( widgetId: string ): WidgetStorage {
	const prefix = `os.widget.${ widgetId }.`;

	const safeGet = ( key: string ): string | null => {
		try {
			return localStorage.getItem( prefix + key );
		} catch {
			return null;
		}
	};

	return {
		get< T = unknown >( key: string ): T | null {
			const raw = safeGet( key );
			if ( raw === null ) {
				return null;
			}
			try {
				return JSON.parse( raw ) as T;
			} catch {
				// Value was written outside JSON.stringify (old data,
				// manual localStorage write). Rather than surface a
				// parse error to the widget, return `null` and let the
				// caller fall back to its default. A subsequent `set`
				// will replace the malformed value cleanly.
				return null;
			}
		},
		set< T = unknown >( key: string, value: T ): void {
			try {
				localStorage.setItem( prefix + key, JSON.stringify( value ) );
			} catch {
				/* QuotaExceeded / SecurityError / disabled storage —
				 * silently drop. Widget persistence is best-effort. */
			}
		},
		remove( key: string ): void {
			try {
				localStorage.removeItem( prefix + key );
			} catch {
				/* best-effort */
			}
		},
		clear(): void {
			try {
				// Walk backwards so index shifts don't trip us up as
				// we remove items mid-loop. Only matches the widget's
				// own prefix — sibling widgets are untouched.
				for ( let i = localStorage.length - 1; i >= 0; i-- ) {
					const key = localStorage.key( i );
					if ( key && key.startsWith( prefix ) ) {
						localStorage.removeItem( key );
					}
				}
			} catch {
				/* best-effort */
			}
		},
	};
}
