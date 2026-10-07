export interface UnfocusEffectDef {

	id: string;

	label: string;

	description?: string;

	className?: string;

	apply?: ( el: HTMLElement ) => void;

	clear?: ( el: HTMLElement ) => void;

	owner?: string;
}
