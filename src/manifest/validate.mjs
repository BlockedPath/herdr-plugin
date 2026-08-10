import { ManifestError } from "./parse.mjs";

const ALL_PLATFORMS = Object.freeze(["linux", "macos", "windows"]);
const PLATFORM_SET = new Set(ALL_PLATFORMS);
const PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const LOCAL_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;
const TOP_LEVEL_FIELDS = new Set([
	"id",
	"name",
	"version",
	"min_herdr_version",
	"description",
	"platforms",
	"build",
	"startup",
	"actions",
	"events",
	"panes",
	"link_handlers",
]);

const DECLARATION_FIELDS = Object.freeze({
	build: new Set(["command", "platforms"]),
	startup: new Set(["command", "platforms"]),
	actions: new Set(["id", "title", "contexts", "command", "platforms"]),
	events: new Set(["on", "command", "platforms"]),
	panes: new Set([
		"id",
		"title",
		"placement",
		"width",
		"height",
		"command",
		"platforms",
	]),
	link_handlers: new Set(["id", "title", "pattern", "action", "platforms"]),
});

export function validateManifest(document) {
	if (!isRecord(document)) {
		throw new ManifestError("manifest-shape", "manifest root must be a table");
	}
	const issues = [];
	for (const key of Object.keys(document)) {
		if (!TOP_LEVEL_FIELDS.has(key)) {
			issues.push(
				issue("unknown-field", key, `unknown top-level field: ${key}`),
			);
		}
	}

	const id = requiredString(document.id, "id", 128);
	if (!PLUGIN_ID.test(id))
		throw new ManifestError(
			"manifest-id",
			"plugin id contains invalid characters",
		);
	const name = requiredString(document.name, "name", 256);
	const version = requiredString(document.version, "version", 64);
	const minHerdrVersion = requiredString(
		document.min_herdr_version,
		"min_herdr_version",
		64,
	);
	const description = optionalString(document.description, "description");
	const platforms = normalizePlatforms(document.platforms, "platforms", issues);
	if (document.platforms === undefined) {
		issues.push(
			issue(
				"platforms-missing",
				"platforms",
				"plugin platforms are not declared",
				false,
			),
		);
	}

	const declarations = [];
	appendCommandDeclarations(
		document,
		"build",
		"build",
		platforms,
		declarations,
		issues,
	);
	appendCommandDeclarations(
		document,
		"startup",
		"startup",
		platforms,
		declarations,
		issues,
	);
	appendActions(document, platforms, declarations, issues);
	appendEvents(document, platforms, declarations, issues);
	appendPanes(document, platforms, declarations, issues);
	appendLinkHandlers(document, platforms, declarations, issues);
	validateUniqueIds(declarations);

	return Object.freeze({
		manifest: Object.freeze({
			id,
			name,
			version,
			minHerdrVersion,
			description,
			platforms,
			declarations: Object.freeze(declarations),
		}),
		issues: Object.freeze(issues),
		complete: !issues.some((entry) => entry.affectsCompleteness),
	});
}

function appendCommandDeclarations(
	document,
	field,
	kind,
	inherited,
	target,
	issues,
) {
	for (const [index, item] of section(document, field)) {
		checkFields(item, field, index, issues);
		target.push(
			declaration({
				kind,
				index,
				command: command(item.command, `${field}[${index}].command`),
				effectivePlatforms: normalizePlatforms(
					item.platforms,
					`${field}[${index}].platforms`,
					issues,
					inherited,
				),
			}),
		);
	}
}

function appendActions(document, inherited, target, issues) {
	for (const [index, item] of section(document, "actions")) {
		checkFields(item, "actions", index, issues);
		target.push(
			declaration({
				kind: "action",
				index,
				id: localId(item.id, `actions[${index}].id`),
				title: requiredString(item.title, `actions[${index}].title`),
				contexts: stringArray(
					item.contexts,
					`actions[${index}].contexts`,
					true,
				),
				command: command(item.command, `actions[${index}].command`),
				effectivePlatforms: normalizePlatforms(
					item.platforms,
					`actions[${index}].platforms`,
					issues,
					inherited,
				),
			}),
		);
	}
}

function appendEvents(document, inherited, target, issues) {
	for (const [index, item] of section(document, "events")) {
		checkFields(item, "events", index, issues);
		target.push(
			declaration({
				kind: "event",
				index,
				on: requiredString(item.on, `events[${index}].on`),
				command: command(item.command, `events[${index}].command`),
				effectivePlatforms: normalizePlatforms(
					item.platforms,
					`events[${index}].platforms`,
					issues,
					inherited,
				),
			}),
		);
	}
}

function appendPanes(document, inherited, target, issues) {
	for (const [index, item] of section(document, "panes")) {
		checkFields(item, "panes", index, issues);
		const placement =
			item.placement === undefined
				? "overlay"
				: requiredString(item.placement, `panes[${index}].placement`);
		if (!["overlay", "popup", "split", "tab", "zoomed"].includes(placement)) {
			throw new ManifestError(
				"manifest-pane",
				`panes[${index}].placement is invalid`,
			);
		}
		target.push(
			declaration({
				kind: "pane",
				index,
				id: localId(item.id, `panes[${index}].id`),
				title: requiredString(item.title, `panes[${index}].title`),
				placement,
				width: scalarOrNull(item.width, `panes[${index}].width`),
				height: scalarOrNull(item.height, `panes[${index}].height`),
				command: command(item.command, `panes[${index}].command`),
				effectivePlatforms: normalizePlatforms(
					item.platforms,
					`panes[${index}].platforms`,
					issues,
					inherited,
				),
			}),
		);
	}
}

function appendLinkHandlers(document, inherited, target, issues) {
	for (const [index, item] of section(document, "link_handlers")) {
		checkFields(item, "link_handlers", index, issues);
		target.push(
			declaration({
				kind: "link-handler",
				index,
				id: localId(item.id, `link_handlers[${index}].id`),
				title: requiredString(item.title, `link_handlers[${index}].title`),
				pattern: requiredString(
					item.pattern,
					`link_handlers[${index}].pattern`,
				),
				action: localId(item.action, `link_handlers[${index}].action`),
				effectivePlatforms: normalizePlatforms(
					item.platforms,
					`link_handlers[${index}].platforms`,
					issues,
					inherited,
				),
			}),
		);
	}
}

function section(document, field) {
	const value = document[field];
	if (value === undefined) return [];
	if (!Array.isArray(value))
		throw new ManifestError(
			"manifest-section",
			`${field} must be an array of tables`,
		);
	return value.map((item, index) => {
		if (!isRecord(item))
			throw new ManifestError(
				"manifest-section",
				`${field}[${index}] must be a table`,
			);
		return [index, item];
	});
}

function normalizePlatforms(value, path, issues, inherited = ALL_PLATFORMS) {
	if (value === undefined) return Object.freeze([...inherited]);
	const values = stringArray(value, path, false);
	if (
		values.length === 0 ||
		values.some((platform) => !PLATFORM_SET.has(platform))
	) {
		throw new ManifestError(
			"manifest-platform",
			`${path} contains an unsupported platform`,
		);
	}
	const unique = ALL_PLATFORMS.filter((platform) => values.includes(platform));
	if (unique.length !== values.length) {
		issues.push(
			issue(
				"duplicate-platform",
				path,
				`${path} contains duplicate platforms`,
				false,
			),
		);
	}
	return Object.freeze(unique);
}

function command(value, path) {
	const values = stringArray(value, path, false);
	if (
		values.length === 0 ||
		values.length > 512 ||
		values.some((part) => part.includes("\0") || part.length > 65_536)
	) {
		throw new ManifestError(
			"manifest-command",
			`${path} must contain 1..512 bounded argv strings without NUL bytes`,
		);
	}
	return Object.freeze(values);
}

function checkFields(item, sectionName, index, issues) {
	const allowed = DECLARATION_FIELDS[sectionName];
	for (const key of Object.keys(item)) {
		if (!allowed.has(key)) {
			const path = `${sectionName}[${index}].${key}`;
			issues.push(
				issue("unknown-field", path, `unknown entrypoint field: ${path}`),
			);
		}
	}
}

function validateUniqueIds(declarations) {
	for (const kind of ["action", "pane", "link-handler"]) {
		const seen = new Set();
		for (const item of declarations.filter((entry) => entry.kind === kind)) {
			if (seen.has(item.id))
				throw new ManifestError(
					"duplicate-id",
					`duplicate ${kind} id: ${item.id}`,
				);
			seen.add(item.id);
		}
	}
}

function declaration(value) {
	return Object.freeze(value);
}

function issue(code, path, message, affectsCompleteness = true) {
	return Object.freeze({ code, path, message, affectsCompleteness });
}

function requiredString(value, path, maxLength = 2048) {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > maxLength
	) {
		throw new ManifestError(
			"manifest-field",
			`${path} must be a non-empty string of at most ${maxLength} characters`,
		);
	}
	return value;
}

function optionalString(value, path) {
	if (value === undefined) return null;
	return requiredString(value, path);
}

function localId(value, path) {
	const id = requiredString(value, path, 128);
	if (!LOCAL_ID.test(id))
		throw new ManifestError(
			"manifest-id",
			`${path} contains invalid characters`,
		);
	return id;
}

function stringArray(value, path, optional) {
	if (value === undefined && optional) return Object.freeze([]);
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string")
	) {
		throw new ManifestError(
			"manifest-field",
			`${path} must be an array of strings`,
		);
	}
	return Object.freeze([...value]);
}

function scalarOrNull(value, path) {
	if (value === undefined) return null;
	if (typeof value !== "string" && typeof value !== "number") {
		throw new ManifestError(
			"manifest-field",
			`${path} must be a string or number`,
		);
	}
	return value;
}

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
