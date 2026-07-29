/**
 * Native Comments window — bundle entry.
 *
 * Registers the conversation renderer as the `desktop-mode-comments`
 * native window. All rendering + interaction lives in ./conversation;
 * the REST transport lives in ./rest. This file only wires the two into
 * the native-window registry.
 *
 * @public
 */

export type { BulkAction, CommentRow, CommentTab, CommentsConfig } from './types';

import { renderConversation } from './conversation';
import { setActiveWindowId } from './rest';

type RenderCallback = ( body: HTMLElement ) => void;

const win = window as unknown as {
	desktopModeNativeWindows?: Record< string, RenderCallback | undefined >;
};
const registry = ( win.desktopModeNativeWindows ??= {} );

registry[ 'desktop-mode-comments' ] = ( body: HTMLElement ) => {
	setActiveWindowId( 'desktop-mode-comments' );
	void renderConversation( body ).catch( ( err ) => {
		// eslint-disable-next-line no-console
		console.error( '[comments-window] render failed:', err );
	} );
};
