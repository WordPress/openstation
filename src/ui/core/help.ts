import type { TemplateResult } from './html';

export type OsHelpStatus = 'stable' | 'experimental' | 'planned';

export interface OsHelpProp {
	name: string;
	type?: string;
	default?: string;
	description?: string;
}

export interface OsHelpSlot {

	name: string;
	description?: string;
}

export interface OsHelpPart {
	name: string;
	description?: string;
}

export interface OsHelpCssProp {
	name: string;
	description?: string;
	default?: string;
}

export interface OsHelpEvent {
	name: string;
	description?: string;

	detail?: string;
}

export interface OsHelp {

	title?: string;

	summary?: string;

	status?: OsHelpStatus;
	props?: readonly OsHelpProp[];
	slots?: readonly OsHelpSlot[];
	parts?: readonly OsHelpPart[];
	cssProps?: readonly OsHelpCssProp[];
	events?: readonly OsHelpEvent[];

	example?: TemplateResult;

	exampleInit?: ( root: HTMLElement ) => void;
}
