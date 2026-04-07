// voi-theme.js  —  drop-in Observable Plot theme
// Inspired by Voi Berlin dashboard · works light + dark

// const dark = window.matchMedia("(prefers-color-scheme: dark)"
const dark = true;

export const voiTheme = {
	style: {
		background: dark ? "#2d292a" : "#ffffff",
		color: dark ? "#c8c6c0" : "#3d3d3a",
		fontFamily: "system-ui, sans-serif",
		fontSize: "11px",
	},

	marginTop: 12,
	marginRight: 20,
	marginBottom: 36,
	marginLeft: 44,

	x: {
		tickColor: dark ? "#333330" : "#d4d2cb",
		labelColor: dark ? "#888884" : "#73726c",
		label: null,
		tickSize: 4,
		tickPadding: 6,
	},
	y: {
		tickColor: dark ? "#333330" : "#d4d2cb",
		labelColor: dark ? "#888884" : "#73726c",
		label: null,
		tickSize: 4,
		tickPadding: 6,
		grid: true,
		tickFormat: d => d % 1 === 0 ? String(d) : d.toFixed(1),
	},

	color: {
		range: dark
			? ["#e8533a", "#7ab0d4", "#d4a84b", "#4caf6e", "#888884"]
			: ["#c43e26", "#2e7db5", "#b07a1c", "#2e8b57", "#73726c"],
	},
}

// Individual color tokens for explicit use
export const voiColors = {
	series1: dark ? "#e8533a" : "#c43e26",  // primary · red-coral
	series2: dark ? "#7ab0d4" : "#2e7db5",  // secondary · steel blue
	series3: dark ? "#d4a84b" : "#b07a1c",  // tertiary · amber
	series4: dark ? "#4caf6e" : "#2e8b57",  // quaternary · green

	seriesPrev: dark ? "rgba(232,83,58,0.4)" : "rgba(196,62,38,0.4)",
	areaFill: dark ? "rgba(212,168,75,0.12)" : "rgba(176,122,28,0.12)",

	pos: dark ? "#4caf6e" : "#2e8b57",
	neg: dark ? "#e05c5c" : "#b83232",
	warn: dark ? "#f0b340" : "#b07a1c",
	info: dark ? "#5b9bd5" : "#185fa5",

	grid: dark ? "#333330" : "#e4e2db",
	tick: dark ? "#888884" : "#73726c",
	text: dark ? "#c8c6c0" : "#3d3d3a",
	textMuted: dark ? "#666662" : "#9a9890",
}
