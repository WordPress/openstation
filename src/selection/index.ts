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

export interface SelectionApi {

	active: typeof activeSelection;

	resolveCommonActions: typeof resolveCommonActions;

	createModel: typeof createSelectionModel;
}

export const selectionApi: SelectionApi = {
	active: activeSelection,
	resolveCommonActions,
	createModel: createSelectionModel,
};
