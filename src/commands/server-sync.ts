import { doAction, HOOKS } from './../hooks';
import { loadVendorScript } from './../wallpapers/vendor-loader';
import { listCommands, unregisterCommand } from './../commands';
import type {
	DesktopCommandScriptServerEntry,
	DesktopCommandServerEntry,
} from './../types';

export function createCommandRegistrySync(): (
	scripts: DesktopCommandScriptServerEntry[],
	commands?: DesktopCommandServerEntry[],
) => Promise< void > {
	const loadedHandles = new Set< string >();
	const loadedUrls = new Set< string >();

	let prevSlugsByHandle = new Map< string, Set< string > >();

	const ensureScript = async (
		entry: DesktopCommandScriptServerEntry,
	): Promise< void > => {
		if ( ! entry.scriptUrl || loadedUrls.has( entry.scriptUrl ) ) {
			loadedHandles.add( entry.handle );
			return;
		}
		try {
			await loadVendorScript( entry.scriptUrl, {
				translations: entry.scriptTranslations,

				deps: entry.scriptDeps,
				l10n: entry.scriptL10n,
				before: entry.scriptBefore,
				after: entry.scriptAfter,
			} );
		} catch ( err ) {
			doAction( HOOKS.SHELL_ERROR, {
				scope: 'command-script-load',
				handle: entry.handle,
				url: entry.scriptUrl,
				error: err,
			} );
			return;
		}
		loadedUrls.add( entry.scriptUrl );
		loadedHandles.add( entry.handle );
	};

	const slugsByHandleFrom = (
		commands: DesktopCommandServerEntry[] | undefined,
	): Map< string, Set< string > > => {
		const map = new Map< string, Set< string > >();
		if ( ! commands ) {
			return map;
		}
		for ( const entry of commands ) {
			if ( ! entry.scriptHandle || ! entry.slug ) {
				continue;
			}
			let set = map.get( entry.scriptHandle );
			if ( ! set ) {
				set = new Set< string >();
				map.set( entry.scriptHandle, set );
			}
			set.add( entry.slug );
		}
		return map;
	};

	const collectSlugsToRemove = (
		handle: string,
	): Set< string > => {
		const slugs = new Set< string >();

		for ( const cmd of listCommands() ) {
			if ( cmd.owner === handle ) {
				slugs.add( cmd.slug );
			}
		}

		const declared = prevSlugsByHandle.get( handle );
		if ( declared ) {
			for ( const slug of declared ) {
				slugs.add( slug );
			}
		}
		return slugs;
	};

	return async ( scripts, commands ) => {
		const incomingHandles = new Set< string >();
		for ( const entry of scripts ) {
			if ( entry.handle ) {
				incomingHandles.add( entry.handle );
			}
		}

		for ( const handle of Array.from( loadedHandles ) ) {
			if ( incomingHandles.has( handle ) ) {
				continue;
			}
			for ( const slug of collectSlugsToRemove( handle ) ) {
				unregisterCommand( slug );
			}
			loadedHandles.delete( handle );
		}

		for ( const entry of scripts ) {
			if ( ! entry.handle || loadedHandles.has( entry.handle ) ) {
				continue;
			}
			await ensureScript( entry );
		}

		prevSlugsByHandle = slugsByHandleFrom( commands );
	};
}
