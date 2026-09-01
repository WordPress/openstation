/**
 * Local ESLint rules for the openstation codebase.
 *
 * Wired into `.eslintrc.cjs` via `eslint-plugin-local-rules`. Add new
 * rules by exporting them from this object — the plugin exposes them
 * under the `local-rules/<key>` namespace.
 */
module.exports = {
	'os-component-registration': require('./os-component-registration.cjs'),
	'os-file-length': require('./os-file-length.cjs'),
};
