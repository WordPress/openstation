import { closeWorkspaceWizard, openWorkspaceWizard } from './wizard';

( window as unknown as {
	openStationWorkspaceWizard?: {
		openWorkspaceWizard: typeof openWorkspaceWizard;
		closeWorkspaceWizard: typeof closeWorkspaceWizard;
	};
} ).openStationWorkspaceWizard = { openWorkspaceWizard, closeWorkspaceWizard };
