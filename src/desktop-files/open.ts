/**
 * OpenStation — File-open dispatcher.
 *
 * Glue between {@link resolveOpener} and the shell's window
 * manager / native-window registry. Dependencies (the manager,
 * the native-window opener) are injected at boot via
 * {@link installOpenDeps} so the opener module stays free of a
 * direct import on `desktop.ts` (which would create a cycle).
 */

import { doAction } from '../hooks';
import { resolveOpener, type OpenerContext } from './openers';
import type { DesktopFile } from './file';

export interface OpenDeps {
	/** Open a chromeless iframe window at `url`. Returns true on open/focus. */
	openUrl: ( args: { id: string; url: string; title: string; icon: string } ) => boolean;
	/** Open a registered native window by id, optionally with a per-call config. */
	openNativeWindow: ( id: string, config?: unknown ) => boolean;
	/** Build a stable window id from a URL — mirrors `wp.os.deriveWindowId`. */
	deriveWindowId: ( url: string ) => string;
}

let deps: OpenDeps | null = null;

/** Install dependencies. Called once from `desktop.ts` after the shell mounts. */
export function installOpenDeps( next: OpenDeps ): void {
	deps = next;
}

/**
 * Open a desktop file using the resolved opener. Returns `true`
 * when something opened, `false` when no opener could handle the
 * file (caller may surface a "no app" toast).
 */
export async function openFile(
	file: DesktopFile,
	ctx?: OpenerContext,
): Promise< boolean > {
	if ( ! deps ) {
		// eslint-disable-next-line no-console
		console.warn(
			'[openstation] wp.os.files.open() called before the shell installed open deps. The file will not open.',
		);
		return false;
	}

	const opener = resolveOpener( file.type(), file );
	if ( ! opener ) {
		doAction( 'os.files.open-failed', {
			reason: 'no-opener',
			type: file.type(),
			ref: file.ref(),
		} );
		return false;
	}

	doAction( 'os.files.opening', { file, openerId: opener.id } );

	try {
		const handler = opener.handler;
		if ( handler.kind === 'url' ) {
			const url = await handler.url( file );
			if ( ! url ) {
				return false;
			}
			const id = handler.windowId
				? handler.windowId( file )
				: deps.deriveWindowId( url );
			const title = handler.title ? handler.title( file ) : file.title();
			const icon = file.icon();
			const opened = deps.openUrl( { id, url, title, icon } );
			doAction( 'os.files.opened', { file, openerId: opener.id, kind: 'url' } );
			return opened;
		}
		if ( handler.kind === 'window' ) {
			const config = handler.config ? handler.config( file ) : undefined;
			const opened = deps.openNativeWindow( handler.windowId, config );
			doAction( 'os.files.opened', { file, openerId: opener.id, kind: 'window' } );
			return opened;
		}
		// 'js'.
		await handler.open( file, ctx );
		doAction( 'os.files.opened', { file, openerId: opener.id, kind: 'js' } );
		return true;
	} catch ( err ) {
		doAction( 'os.files.open-failed', {
			reason: 'handler-threw',
			type: file.type(),
			ref: file.ref(),
			openerId: opener.id,
			error: err,
		} );
		// eslint-disable-next-line no-console
		console.error( '[openstation] file opener threw:', err );
		return false;
	}
}
