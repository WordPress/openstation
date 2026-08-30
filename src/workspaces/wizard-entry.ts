/**
 * Workspace-wizard lazy bundle — entry.
 *
 * Builds to `assets/js/workspace-wizard[.min].js`. The wizard is a
 * modal a user opens from the overview bar's `+` or a tile's Edit; it
 * can never be on screen at first paint, and it is the only thing in
 * the shell that needs `<os-modal>`, `<os-steps>`, `<os-card>`,
 * `<os-swatch-grid>` and the rest of the picker kit at once — so
 * shipping it in `desktop.min.js` would eagerly load a dozen component
 * classes for a surface most sessions never open.
 *
 * The main bundle keeps `src/workspaces/wizard-loader.ts`, which
 * injects this on first open and forwards the call.
 *
 * Cross-bundle safety: the wizard takes its whole world through the
 * options object and returns its whole result through `onCreate` /
 * `onSave`. It imports no store and reads no module-level state, so
 * the copy compiled here cannot drift from the shell's.
 */

import { closeWorkspaceWizard, openWorkspaceWizard } from './wizard';

( window as unknown as {
	openStationWorkspaceWizard?: {
		openWorkspaceWizard: typeof openWorkspaceWizard;
		closeWorkspaceWizard: typeof closeWorkspaceWizard;
	};
} ).openStationWorkspaceWizard = { openWorkspaceWizard, closeWorkspaceWizard };
