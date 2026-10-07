export interface AutoOpenInputs {
	fromPortal: boolean;
	fromPortalIntent?: boolean;
	hasSession: boolean;
	defaultEnabled: boolean;
	isNativeDefault: boolean;
}

export function shouldAutoOpenCurrentPage( inputs: AutoOpenInputs ): boolean {
	const suppress =
		inputs.fromPortal &&
		! inputs.fromPortalIntent &&
		( inputs.hasSession || ! inputs.defaultEnabled || inputs.isNativeDefault );
	return ! suppress;
}
