/**
 * Desktop Mode — AI Assistant lazy-bundle entry.
 *
 * Compiled by Vite (target `ai-assistant`) into
 * `assets/js/ai-assistant[.min].js`. The bundle is injected on
 * demand by the main-bundle {@link AiAssistantStub} the first time
 * the user opens the assistant — so its weight is excluded from
 * the first-paint critical path.
 *
 * The bundle's only job is to publish a factory on
 * `window.desktopModeCreateAiAssistant`. The stub awaits the load
 * event and calls the factory with the same constructor config the
 * stub captured at boot time.
 */

import { AiAssistant } from './impl';
import type { AiAssistantFactory } from './types';

const factory: AiAssistantFactory = ( config ) => new AiAssistant( config );

// The IIFE wrapper's `name` (`desktopModeAiAssistant`) provides a
// secondary handle if anyone wants to reach the module via the IIFE
// return value, but the contract is the global below.
( window as Window & { desktopModeCreateAiAssistant?: AiAssistantFactory } ).desktopModeCreateAiAssistant =
	factory;
