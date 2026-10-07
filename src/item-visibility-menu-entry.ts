import { openItemVisibilityMenu } from './item-visibility-menu';

( window as unknown as {
	openStationItemVisibilityMenu?: {
		openItemVisibilityMenu: typeof openItemVisibilityMenu;
	};
} ).openStationItemVisibilityMenu = { openItemVisibilityMenu };
