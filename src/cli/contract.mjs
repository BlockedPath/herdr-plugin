import { PACKAGE_NAME, VERSION } from "../meta.mjs";

export const EXIT = Object.freeze({
	OK: 0,
	USAGE: 2,
	INCOMPLETE: 3,
	POLICY: 4,
	RECEIPT_INVALID: 5,
});

export const HELP = `Herdr X-Ray explains a plugin's pre-install execution surface.

Usage:
  ${PACKAGE_NAME} audit <source> [options]
  ${PACKAGE_NAME} audit-installed <plugin-id> [options]
  ${PACKAGE_NAME} compare <plugin-id> <source> [options]
  ${PACKAGE_NAME} marketplace-collisions [options]
  ${PACKAGE_NAME} receipt verify <path>
  ${PACKAGE_NAME} version
  ${PACKAGE_NAME} help

Common options:
  --ref <ref>
  --format terminal|json|markdown
  --output <path>
  --offline
  --marketplace-check auto|on|off
  --redaction strict|standard
  --fail-on-severity low|medium|high
  --fail-on-unknown
  --require-complete
  --max-files <n>
  --max-total-bytes <n>
  --max-file-bytes <n>
  --max-depth <n>
  --timeout-ms <n>
  --no-color
  --help

X-Ray never executes the plugin it audits and never claims that a plugin is safe.
`;

export const VERSION_TEXT = `${PACKAGE_NAME} ${VERSION}\n`;
