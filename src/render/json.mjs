export function renderJson(receipt) {
	return `${JSON.stringify(receipt, null, 2)}\n`;
}
