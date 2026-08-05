/**
 * OpenStation — selection framework.
 *
 * Barrel + the `wp.os.selection` public surface. The three pieces:
 *
 *   - {@link createSelectionModel} — the set + anchor semantics.
 *   - {@link attachSelection} — gestures and painting on a canvas.
 *   - {@link resolveCommonActions} — what a heterogeneous selection
 *     is allowed to offer.
 *
 * Plugin authors mostly want the last one plus the
 * `os-selection-changed` document event; the first two matter when
 * you are building a tile canvas of your own.
 */

export { createSelectionModel } from './model';
export type { SelectionModel, SelectionModelOptions } from './model';
export {
	attachSelection,
	activeSelection,
	recentlyMarqueed,
} from './controller';
export type {
	SelectionControllerOptions,
	SelectionHandle,
} from './controller';
export { resolveCommonActions } from './actions';
export type { SelectionAction, SelectionActionsContext } from './actions';
export {
	openActionMenu,
	closeActionMenu,
	isActionMenuOpen,
} from './menu';
export type { ActionMenuEntry, ActionMenuOptions } from './menu';

import { activeSelection } from './controller';
import { resolveCommonActions } from './actions';
import { createSelectionModel } from './model';

/**
 * Shape installed at `wp.os.selection`.
 *
 * @public
 */
export interface SelectionApi {
	/**
	 * The most recent selection change anywhere in the shell —
	 * `{ surface, scope, keys, count }` — or null when nothing is
	 * selected. A snapshot, not a live handle.
	 */
	active: typeof activeSelection;
	/** Intersect per-item action lists into the set's common actions. */
	resolveCommonActions: typeof resolveCommonActions;
	/** Build a standalone selection model for a canvas of your own. */
	createModel: typeof createSelectionModel;
}

/** @public */
export const selectionApi: SelectionApi = {
	active: activeSelection,
	resolveCommonActions,
	createModel: createSelectionModel,
};
