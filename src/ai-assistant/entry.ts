import { AiAssistant } from './impl';
import type { AiAssistantFactory } from './types';

const factory: AiAssistantFactory = ( config ) => new AiAssistant( config );

( window as Window & { openStationCreateAiAssistant?: AiAssistantFactory } ).openStationCreateAiAssistant =
	factory;
