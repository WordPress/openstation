/**
 * Usage feedback — lazy bundle entry.
 *
 * Builds to `assets/js/usage-feedback[.min].js`. The form is a modal a
 * user opens by saying yes to a one-time prompt; it can never be on
 * screen at first paint, most sessions never open it, and it needs
 * `<os-modal>` and `<os-textarea>`, which nothing in `desktop.min.js`
 * otherwise registers. So it ships here, and the main bundle keeps
 * only the prompt (`index.ts`) and `loader.ts`, which injects this on
 * a yes and forwards the call.
 *
 * Cross-bundle safety: the form takes its whole world through the
 * options object and reports back through `onClose`. It imports no
 * store and reads no module-level state the shell owns.
 */

import { openUsageFeedbackForm } from './form';
import type { UsageFeedbackApi } from './types';

( window as unknown as { openStationUsageFeedback?: UsageFeedbackApi } ).openStationUsageFeedback = {
	openUsageFeedbackForm,
};
