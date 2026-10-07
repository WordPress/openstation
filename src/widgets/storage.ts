import type { WidgetStorage } from './types';

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
				return null;
			}
		},
		set< T = unknown >( key: string, value: T ): void {
			try {
				localStorage.setItem( prefix + key, JSON.stringify( value ) );
			} catch {

			}
		},
		remove( key: string ): void {
			try {
				localStorage.removeItem( prefix + key );
			} catch {

			}
		},
		clear(): void {
			try {
				for ( let i = localStorage.length - 1; i >= 0; i-- ) {
					const key = localStorage.key( i );
					if ( key && key.startsWith( prefix ) ) {
						localStorage.removeItem( key );
					}
				}
			} catch {

			}
		},
	};
}
