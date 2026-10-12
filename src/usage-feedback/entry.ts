/**
 * Usage feedback — lazy bundle entry.
 *
 * Builds to `assets/js/usage-feedback[.min].js`: the prompt card
 * (`prompt.ts`) and the form it opens (`form.ts`). Only a user the
 * server found eligible ever fetches it, once, until they answer; for
 * everyone else the main bundle holds nothing but the gate
 * (`index.ts`) and `loader.ts`, which injects this and forwards the
 * call. The form needs `<os-modal>` and `<os-textarea>`, which nothing
 * in `desktop.min.js` otherwise registers.
 *
 * Cross-bundle safety: the prompt takes its whole world through the
 * options object and reports back through `onAnswered`. It imports no
 * store and reads no module-level state the shell owns.
 */

import { showUsageFeedbackPrompt } from './prompt';
import type { UsageFeedbackApi } from './types';

( window as unknown as { openStationUsageFeedback?: UsageFeedbackApi } ).openStationUsageFeedback = {
	showUsageFeedbackPrompt,
};
