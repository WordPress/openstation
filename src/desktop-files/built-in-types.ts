/**
 * OpenStation — Built-in JS file-type registrations.
 *
 * Registers the built-in file types that ship with the plugin
 * against the JS-side registry. None of them ship a custom {@link DesktopFile}
 * subclass; they all use {@link DefaultDesktopFile} because the
 * PHP `serialize()` filter already produces the shape the renderer
 * needs. Plugins that want richer rendering can re-register the
 * same type slug with their own class — late registrations win.
 *
 * The labels here are duplicated from the PHP side on purpose:
 * the JS bundle runs even when a settings UI hasn't loaded the
 * server-payload yet, so a hard-coded fallback keeps pickers
 * usable in the brief gap before the payload arrives.
 */

import { registerType } from './registry';

export function registerBuiltInFileTypes(): void {
	registerType( { type: 'shortcut', label: 'Plugin shortcut', sort: 1 } );
	registerType( { type: 'folder', label: 'Folder', sort: 5 } );
	registerType( { type: 'post', label: 'Post', sort: 10 } );
	registerType( { type: 'attachment', label: 'Media', sort: 20 } );
	registerType( { type: 'upload', label: 'Uploaded file', sort: 25 } );
	registerType( { type: 'user', label: 'User', sort: 30 } );
	registerType( { type: 'term', label: 'Taxonomy term', sort: 40 } );
	registerType( { type: 'comment', label: 'Comment', sort: 50 } );
	registerType( { type: 'bookmark', label: 'Bookmark', sort: 60 } );
	registerType( { type: 'link', label: 'Web link', sort: 70 } );
	registerType( { type: 'embed', label: 'Embedded web window', sort: 80 } );
}
