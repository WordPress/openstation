import { doAction } from '../hooks';
import { resolveOpener, type OpenerContext } from './openers';
import type { DesktopFile } from './file';

export interface OpenDeps {

	openUrl: ( args: { id: string; url: string; title: string; icon: string } ) => boolean;

	openNativeWindow: ( id: string, config?: unknown ) => boolean;

	deriveWindowId: ( url: string ) => string;
}

let deps: OpenDeps | null = null;

export function installOpenDeps( next: OpenDeps ): void {
	deps = next;
}

export function openUrlWindow( args: { url: string; title: string; icon: string } ): boolean {
	if ( ! deps || ! args.url ) {
		return false;
	}
	return deps.openUrl( { id: deps.deriveWindowId( args.url ), ...args } );
}

export async function openFile(
	file: DesktopFile,
	ctx?: OpenerContext,
): Promise< boolean > {
	if ( ! deps ) {
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

		console.error( '[openstation] file opener threw:', err );
		return false;
	}
}
