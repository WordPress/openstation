import { showUsageFeedbackPrompt } from './prompt';
import type { UsageFeedbackApi } from './types';

( window as unknown as { openStationUsageFeedback?: UsageFeedbackApi } ).openStationUsageFeedback = {
	showUsageFeedbackPrompt,
};
