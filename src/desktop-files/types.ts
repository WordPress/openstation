export interface DesktopFileShape {

	type: string;

	ref: string;

	title: string;

	icon: string;

	previewUrl: string;

	exists: boolean;

	[ key: string ]: unknown;
}

export interface DesktopFileTypeServerEntry {
	id: string;
	label: string;
	sort: number;
	scriptUrl: string;
	scriptHandle: string;
	scriptBefore: string[];
	scriptAfter: string[];
	scriptL10n: Record< string, string >;
	scriptTranslations: string;
}
