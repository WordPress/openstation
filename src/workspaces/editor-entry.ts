/**
 * Workspace-editor lazy bundle — entry.
 *
 * Builds to `assets/js/workspace-editor[.min].js`. The editor is a
 * modal a user opens from the switcher; it can never be on screen at
 * first paint, and it is the only thing in the shell that needs
 * `<os-modal>`, `<os-checkbox>` and `<os-switch>` — so shipping it in
 * `desktop.min.js` would eagerly load three component classes for a
 * surface most sessions never open.
 *
 * The main bundle keeps `src/workspaces/editor-loader.ts`, which
 * injects this on first open and forwards the call.
 *
 * Cross-bundle safety: the editor takes its whole world through the
 * options object and returns its whole result through `onSave`. It
 * imports no store and reads no module-level state, so the copy
 * compiled here cannot drift from the shell's.
 */

import { openWorkspaceEditor, closeWorkspaceEditor } from './editor';

( window as unknown as {
	openStationWorkspaceEditor?: {
		openWorkspaceEditor: typeof openWorkspaceEditor;
		closeWorkspaceEditor: typeof closeWorkspaceEditor;
	};
} ).openStationWorkspaceEditor = { openWorkspaceEditor, closeWorkspaceEditor };
