import type { OsSettingsSnapshot } from './settings/registry';
import { createSharedStore } from './shared-store';

export const OS_TAB_PARAM = 'os_tab';

export const OS_PERSON_VIEW_PARAM = 'os_person_view';

export function isPersonViewClaimed( parsed: URL ): boolean {
	return parsed.searchParams.has( OS_PERSON_VIEW_PARAM );
}

export interface NativeUrlRemap {

	id: string;

	nativeWindowId: string;

	matches( url: string, parsed: URL ): boolean;

	enabled?( snapshot: OsSettingsSnapshot ): boolean;

	onMatch?( url: string, parsed: URL ): void;

	params?(
		url: string,
		parsed: URL,
	): Record< string, string | number | boolean > | undefined;
}

interface RemapDeps {
	getSnapshot(): OsSettingsSnapshot;
	openById(
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	): boolean;

	openNewById?(
		id: string,
		opts?: {
			source?: string;
			params?: Record< string, string | number | boolean >;
		},
	): boolean;
	adminUrl: string;
}

interface RemapRegistryState {
	remaps: NativeUrlRemap[];
	deps: RemapDeps | null;
}
const remapStore = createSharedStore< RemapRegistryState >(
	'desktop-mode/native-url-remap',
	() => ( { remaps: [], deps: null } ),
);

export function bindNativeUrlRemap( bound: RemapDeps ): void {
	remapStore.state.deps = bound;
}

export function registerNativeUrlRemap( entry: NativeUrlRemap ): () => void {
	if ( ! entry || typeof entry.id !== 'string' || entry.id.trim() === '' ) {
		return () => {};
	}
	if ( typeof entry.nativeWindowId !== 'string' || entry.nativeWindowId === '' ) {
		return () => {};
	}
	if ( typeof entry.matches !== 'function' ) {
		return () => {};
	}

	const remaps = remapStore.state.remaps;
	const existingIdx = remaps.findIndex( ( r ) => r.id === entry.id );
	if ( existingIdx >= 0 ) {
		remaps.splice( existingIdx, 1 );
	}
	remaps.push( entry );

	return () => unregisterNativeUrlRemap( entry.id );
}

export function unregisterNativeUrlRemap( id: string ): void {
	const remaps = remapStore.state.remaps;
	const i = remaps.findIndex( ( r ) => r.id === id );
	if ( i >= 0 ) {
		remaps.splice( i, 1 );
	}
}

export function listNativeUrlRemaps(): NativeUrlRemap[] {
	return remapStore.state.remaps.slice();
}

export function resolveNativeUrlRemap( url: string ): string | null {
	const { deps, remaps } = remapStore.state;
	if ( ! deps || ! url ) {
		return null;
	}
	let parsed: URL;
	try {
		parsed = new URL( url, deps.adminUrl );
	} catch {
		return null;
	}
	const snapshot = deps.getSnapshot();
	for ( const entry of remaps ) {
		if ( ! entry.matches( url, parsed ) ) {
			continue;
		}
		if ( entry.enabled && ! entry.enabled( snapshot ) ) {
			continue;
		}
		return entry.nativeWindowId;
	}
	return null;
}

export function tryNativeUrlRemap(
	url: string,
	opts: { newInstance?: boolean } = {},
): boolean {
	const { deps, remaps } = remapStore.state;
	if ( ! deps || ! url ) {
		return false;
	}
	let parsed: URL;
	try {
		parsed = new URL( url, deps.adminUrl );
	} catch {
		return false;
	}

	const snapshot = deps.getSnapshot();
	for ( const entry of remaps ) {
		if ( ! entry.matches( url, parsed ) ) {
			continue;
		}
		if ( entry.enabled && ! entry.enabled( snapshot ) ) {
			continue;
		}
		if ( entry.onMatch ) {
			try {
				entry.onMatch( url, parsed );
			} catch ( err ) {
				console.warn(
					`[openstation] URL remap onMatch hook threw for "${ entry.id }":`,
					err,
				);
			}
		}
		let params:
			| Record< string, string | number | boolean >
			| undefined;

		const tagged = parsed.searchParams.get( OS_TAB_PARAM );
		if ( entry.params ) {
			try {
				params = entry.params( url, parsed ) ?? undefined;
			} catch ( err ) {
				console.warn(
					`[openstation] URL remap params hook threw for "${ entry.id }":`,
					err,
				);
			}
		}
		if ( tagged && /^[a-z0-9_-]+$/.test( tagged ) ) {
			params = { ...( params ?? {} ), tab: tagged };
		}

		const open =
			opts.newInstance && deps.openNewById
				? deps.openNewById
				: deps.openById;
		const opened = params
			? open( entry.nativeWindowId, { params } )
			: open( entry.nativeWindowId );
		if ( opened ) {
			return true;
		}
	}
	return false;
}

export function _resetNativeUrlRemap(): void {
	remapStore.state.remaps.length = 0;
	remapStore.state.deps = null;
}
