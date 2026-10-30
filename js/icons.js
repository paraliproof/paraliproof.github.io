// icons.js — icon set (Lucide conventions: 24 px grid, 1.5 px round strokes, currentColor).
// Generated from ui/js/icons.js (owner: seva-frontend); edit there and regenerate.
// Use icon(name) for inline SVG, or injectSprite() once and <svg class="pp-icon"><use href="#i-NAME"/></svg>.
export const PATHS = {
  "tractor":"<path d=\"M4.5 12.5V4.5h6.2l1.3 7\"/><path d=\"M12 11.5h6.8a1.2 1.2 0 0 1 1.2 1.2v3.3\"/><path d=\"M15.5 11.5V8\"/><circle cx=\"7.5\" cy=\"16.5\" r=\"4\"/><circle cx=\"7.5\" cy=\"16.5\" r=\"1.2\"/><circle cx=\"18\" cy=\"18\" r=\"2.5\"/><path d=\"M11.5 16.5h4\"/>",
  "implement":"<path d=\"M6.5 8 8 3.5h8L17.5 8\"/><path d=\"M3 8h18\"/><path d=\"M6 8v8l-1.5 2.5M10 8v8l-1.5 2.5M14 8v8l-1.5 2.5M18 8v8l-1.5 2.5\"/><path d=\"M12 3.5V2\"/>",
  "field":"<path d=\"M4.5 19.5 3 6.5 19 4l2 14.5z\"/><path d=\"M7.5 16.5 16.5 7M10.5 18 19 10M5.5 12.5 11.5 6.5\"/>",
  "walk":"<path d=\"M8.4 3.2c1.6 0 2.4 1.6 2.4 3.6S9.8 10.4 8.4 10.4 6 9 6 6.9s.8-3.7 2.4-3.7z\"/><path d=\"M6.5 13.2h3.8l-.3 2.3a1.6 1.6 0 0 1-3.2 0z\"/><path d=\"M15.6 7.6c1.6 0 2.4 1.6 2.4 3.6s-1 3.6-2.4 3.6-2.4-1.4-2.4-3.5.8-3.7 2.4-3.7z\"/><path d=\"M13.7 17.6h3.8l-.3 2.3a1.6 1.6 0 0 1-3.2 0z\"/>",
  "corners":"<path d=\"M5 19 4 6l15-2 1 14z\" stroke-dasharray=\"2.5 3\"/><circle cx=\"4\" cy=\"6\" r=\"2\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"19\" cy=\"4\" r=\"2\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"20\" cy=\"18\" r=\"2\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"5\" cy=\"19\" r=\"2\" fill=\"currentColor\" stroke=\"none\"/>",
  "working":"<path d=\"M4 4.5h16\"/><path d=\"M7 4.5v8.5M12 4.5v8.5M17 4.5v8.5\"/><path d=\"M2 16.5c2.5-1.8 4.5 1.8 7 0s4.5 1.8 7 0 4.5 1.8 6 0\"/><path d=\"M2 20.5c2.5-1.8 4.5 1.8 7 0s4.5 1.8 7 0 4.5 1.8 6 0\"/>",
  "transit":"<path d=\"M7.5 21 10.5 3M16.5 21 13.5 3\"/><path d=\"M12 18v2.5M12 12v2.5M12 6.5v2\" stroke-width=\"2.4\"/>",
  "idle":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M9.8 8.8v6.4M14.2 8.8v6.4\"/>",
  "vibration":"<rect x=\"8\" y=\"3.5\" width=\"8\" height=\"17\" rx=\"2\"/><path d=\"M11 17h2\"/><path d=\"M4.5 8.5v7M1.8 10.5v3M19.5 8.5v7M22.2 10.5v3\"/>",
  "gps":"<circle cx=\"12\" cy=\"12\" r=\"6.5\"/><circle cx=\"12\" cy=\"12\" r=\"2\"/><path d=\"M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3\"/>",
  "pin":"<path d=\"M12 21.2s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z\"/><circle cx=\"12\" cy=\"10.2\" r=\"2.4\"/>",
  "satellite":"<g transform=\"rotate(-45 12 12)\"><rect x=\"9.5\" y=\"8.5\" width=\"5\" height=\"7\" rx=\"1\"/><rect x=\"2\" y=\"10\" width=\"5.5\" height=\"4\" rx=\".6\"/><rect x=\"16.5\" y=\"10\" width=\"5.5\" height=\"4\" rx=\".6\"/><path d=\"M7.5 12h2M14.5 12h2M12 15.5v2.5\"/></g><path d=\"M14.6 21.3a5.5 5.5 0 0 0 6.7-6.7M14.4 18.2a2.6 2.6 0 0 0 3.8-3.8\"/>",
  "map":"<path d=\"M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z\"/><path d=\"M9 4.5v13M15 6.5v13\"/>",
  "signal":"<path d=\"M5 19.5v-3M9.7 19.5v-6.5M14.3 19.5V9.5M19 19.5V5.5\"/>",
  "battery":"<rect x=\"2.5\" y=\"7\" width=\"17\" height=\"10\" rx=\"2.5\"/><path d=\"M22 10.5v3\"/><path d=\"M6 10v4M9 10v4M12 10v4\"/>",
  "battery-low":"<rect x=\"2.5\" y=\"7\" width=\"17\" height=\"10\" rx=\"2.5\"/><path d=\"M22 10.5v3\"/><path d=\"M6 10v4\"/>",
  "wifi":"<path d=\"M2.5 9.5a14 14 0 0 1 19 0M5.8 13a9 9 0 0 1 12.4 0M9.2 16.4a4 4 0 0 1 5.6 0\"/><circle cx=\"12\" cy=\"19.6\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/>",
  "offline":"<path d=\"M2.5 9.5a14 14 0 0 1 5.2-3.3M11 5.6a14 14 0 0 1 10.5 3.9M5.8 13a9 9 0 0 1 3.4-2.1M15.4 11.1a9 9 0 0 1 2.8 1.9M9.2 16.4a4 4 0 0 1 5.6 0\"/><circle cx=\"12\" cy=\"19.6\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M3.5 3.5l17 17\"/>",
  "flame":"<path d=\"M12 21c-3.9 0-7-2.8-7-6.6 0-3.2 2.2-5.3 3.6-7 .3 1.9 1.4 3 2.6 3.5C11 7.5 12.7 4.8 15 3c-.3 3 1 4.8 2.4 6.6 1 1.3 1.6 2.9 1.6 4.8C19 18.2 15.9 21 12 21z\"/><path d=\"M12 21c-1.7 0-3-1.2-3-2.9 0-1.5 1.2-2.6 2.2-3.6.2 1 .8 1.6 1.6 1.8.6-.9 1.2-1.6 1.2-2.6 1 1.1 1 2.5 1 3.6C15 19.6 13.8 21 12 21z\"/>",
  "shield":"<path d=\"M12 2.8 19.5 5.6v5.9c0 4.6-3.2 8.4-7.5 9.7-4.3-1.3-7.5-5.1-7.5-9.7V5.6z\"/><path d=\"m8.6 12.1 2.4 2.4 4.4-4.6\"/>",
  "shield-x":"<path d=\"M12 2.8 19.5 5.6v5.9c0 4.6-3.2 8.4-7.5 9.7-4.3-1.3-7.5-5.1-7.5-9.7V5.6z\"/><path d=\"m9.4 9.4 5.2 5.2M14.6 9.4l-5.2 5.2\"/>",
  "lock":"<rect x=\"4.5\" y=\"10.5\" width=\"15\" height=\"10.5\" rx=\"2.5\"/><path d=\"M8 10.5V7.5a4 4 0 0 1 8 0v3\"/><path d=\"M12 14.6v2.4\"/>",
  "certificate":"<path d=\"M13.5 20.5H6A1.5 1.5 0 0 1 4.5 19V4.5A1.5 1.5 0 0 1 6 3h9.5L19 6.5V9\"/><path d=\"M8 8h6.5M8 11.5h4\"/><circle cx=\"17\" cy=\"14.3\" r=\"3.3\"/><path d=\"m15.2 17.1-.8 4.1 2.6-1.4 2.6 1.4-.8-4.1\"/>",
  "qr":"<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"1.5\"/><path d=\"M6.5 6.5h.01M17.5 6.5h.01M6.5 17.5h.01\"/><path d=\"M14 14h3v3M21 14v.01M14 21h.01M17.5 21H21v-3.5\"/>",
  "hash":"<path d=\"M9.5 4 7.8 20M16.2 4l-1.7 16M4.5 9h16M3.8 15h16\"/>",
  "scan":"<path d=\"M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5\"/><path d=\"M4 12h16\"/>",
  "check":"<path d=\"m5 12.5 4.5 4.5L19 7.5\"/>",
  "cross":"<path d=\"m6.5 6.5 11 11M17.5 6.5l-11 11\"/>",
  "warning":"<path d=\"M10.3 4.6a2 2 0 0 1 3.4 0l7.4 12.9a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z\"/><path d=\"M12 9.5v4.5\"/><circle cx=\"12\" cy=\"17.2\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/>",
  "info":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 11v5.5\"/><circle cx=\"12\" cy=\"7.8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/>",
  "question":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M9.6 9.4a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6\"/><circle cx=\"12\" cy=\"16.8\" r=\"1.1\" fill=\"currentColor\" stroke=\"none\"/>",
  "leaf":"<path d=\"M20 4c-9 0-15 4.5-15 11.5 0 1.6.4 3 1 4.5 1.5.6 2.9 1 4.5 1C17.5 21 20 13 20 4z\"/><path d=\"M4 20.5 14 10.5\"/>",
  "co2":"<path d=\"M20 4c-9 0-15 4.5-15 11.5 0 1.6.4 3 1 4.5 1.5.6 2.9 1 4.5 1C17.5 21 20 13 20 4z\"/><path d=\"M4 20.5 14 10.5\"/><path d=\"M14 15.5h3.2\" />",
  "rupee":"<path d=\"M6.5 4h11M6.5 8.5h11\"/><path d=\"M6.5 4H10a4.5 4.5 0 0 1 0 9H6.5l8 7.5\"/>",
  "wind":"<path d=\"M3 8.5h11a2.8 2.8 0 1 0-2.8-2.8M3 12.5h15.5a2.8 2.8 0 1 1-2.8 2.8M3 16.5h7\"/>",
  "share":"<circle cx=\"18\" cy=\"5.5\" r=\"2.5\"/><circle cx=\"6\" cy=\"12\" r=\"2.5\"/><circle cx=\"18\" cy=\"18.5\" r=\"2.5\"/><path d=\"m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1\"/>",
  "download":"<path d=\"M12 3.5v11.5M7 10.5l5 5 5-5\"/><path d=\"M4.5 20h15\"/>",
  "speaker":"<path d=\"M4 9.3h3.4L12 5.4v13.2l-4.6-3.9H4z\"/><path d=\"M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.4a8 8 0 0 1 0 11.2\"/>",
  "play":"<path d=\"M7 4.8v14.4a1 1 0 0 0 1.5.86l11.6-7.2a1 1 0 0 0 0-1.72L8.5 3.94A1 1 0 0 0 7 4.8z\"/>",
  "stop":"<rect x=\"5\" y=\"5\" width=\"14\" height=\"14\" rx=\"2\"/>",
  "circle-check":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m8.5 12.2 2.4 2.4 4.6-4.8\"/>",
  "circle-x":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"m15 9-6 6M9 9l6 6\"/>",
  "circle-alert":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><path d=\"M12 7.5v5.5\"/><circle cx=\"12\" cy=\"16.3\" r=\".9\" fill=\"currentColor\" stroke=\"none\"/>",
  "circle-dot":"<circle cx=\"12\" cy=\"12\" r=\"10\"/><circle cx=\"12\" cy=\"12\" r=\"1.6\" fill=\"currentColor\" stroke=\"none\"/>",
  "plus":"<path d=\"M12 5v14M5 12h14\"/>",
  "minus":"<path d=\"M5 12h14\"/>",
  "undo":"<path d=\"M9 7.5 4.5 12 9 16.5\"/><path d=\"M4.5 12h10a5 5 0 0 1 0 10H12\"/>",
  "refresh":"<path d=\"M20 12a8 8 0 1 1-2.3-5.6\"/><path d=\"M20 4.5V9h-4.5\"/>",
  "flag":"<path d=\"M5.5 21V3.5\"/><path d=\"M5.5 4h11.5l-2.4 4 2.4 4H5.5\"/>",
  "search":"<circle cx=\"10.8\" cy=\"10.8\" r=\"6.5\"/><path d=\"m16 16 4.5 4.5\"/>",
  "filter":"<path d=\"M4 6h16M7 12h10M10 18h4\"/>",
  "moon":"<path d=\"M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z\"/>",
  "sun":"<circle cx=\"12\" cy=\"12\" r=\"4\"/><path d=\"M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4\"/>",
  "chevron-right":"<path d=\"m9.5 5.5 6.5 6.5-6.5 6.5\"/>",
  "chevron-down":"<path d=\"m5.5 9.5 6.5 6.5 6.5-6.5\"/>",
  "arrow-left":"<path d=\"M19.5 12h-15M10.5 6l-6 6 6 6\"/>",
  "arrow-up-right":"<path d=\"M7 17 17 7M8.5 7H17v8.5\"/>",
  "more":"<circle cx=\"5.5\" cy=\"12\" r=\"1.5\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"12\" cy=\"12\" r=\"1.5\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"18.5\" cy=\"12\" r=\"1.5\" fill=\"currentColor\" stroke=\"none\"/>",
  "home":"<path d=\"M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15V15H9v5.5H5.5A1.5 1.5 0 0 1 4 19z\"/>",
  "record":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><circle cx=\"12\" cy=\"12\" r=\"3.5\"/>",
  "list":"<path d=\"M9 6h11M9 12h11M9 18h11\"/><circle cx=\"4.6\" cy=\"6\" r=\"1.3\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"4.6\" cy=\"12\" r=\"1.3\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"4.6\" cy=\"18\" r=\"1.3\" fill=\"currentColor\" stroke=\"none\"/>",
  "grid":"<rect x=\"3.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1.8\"/><rect x=\"13.5\" y=\"3.5\" width=\"7\" height=\"7\" rx=\"1.8\"/><rect x=\"3.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1.8\"/><rect x=\"13.5\" y=\"13.5\" width=\"7\" height=\"7\" rx=\"1.8\"/>",
  "settings":"<path d=\"M4 7h9M17 7h3M4 17h3M11 17h9\"/><circle cx=\"15\" cy=\"7\" r=\"2.2\"/><circle cx=\"9\" cy=\"17\" r=\"2.2\"/>",
  "language":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3 12h18\"/><path d=\"M12 3c2.6 2.4 3.9 5.4 3.9 9S14.6 18.6 12 21c-2.6-2.4-3.9-5.4-3.9-9S9.4 5.4 12 3z\"/>",
  "user":"<circle cx=\"12\" cy=\"8\" r=\"3.8\"/><path d=\"M4.5 20.5c1-3.8 4-6 7.5-6s6.5 2.2 7.5 6\"/>",
  "clock":"<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7.5V12l3 2\"/>",
  "calendar":"<rect x=\"3.5\" y=\"5\" width=\"17\" height=\"15.5\" rx=\"2.5\"/><path d=\"M3.5 10h17M8 3v4M16 3v4\"/>",
  "speed":"<path d=\"M4.2 17.5a8.5 8.5 0 1 1 15.6 0\"/><path d=\"m12 13 4-4.5\"/><circle cx=\"12\" cy=\"13.5\" r=\"1.4\" fill=\"currentColor\" stroke=\"none\"/>",
  "phone":"<rect x=\"6.5\" y=\"2.5\" width=\"11\" height=\"19\" rx=\"2.5\"/><path d=\"M10.5 18.5h3\"/>",
  "device":"<rect x=\"6.5\" y=\"2.5\" width=\"11\" height=\"19\" rx=\"2.5\"/><path d=\"M10.5 18.5h3\"/><path d=\"m9.5 10.5 2 2 3.5-3.5\"/>",
  "eye":"<path d=\"M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
  "layers":"<path d=\"M12 3.5 21 8.5l-9 5-9-5z\"/><path d=\"m3 12.5 9 5 9-5M3 16.5l9 5 9-5\"/>",
  "sparkle":"<path d=\"M12 3.5c.5 4.5 3.5 7.5 8 8-4.5.5-7.5 3.5-8 8-.5-4.5-3.5-7.5-8-8 4.5-.5 7.5-3.5 8-8z\"/>"
};

export function icon(name, cls = "pp-icon") {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name] || ""}</svg>`;
}

export function injectSprite() {
  if (document.getElementById("pp-icon-sprite")) return;
  const d = document.createElement("div");
  d.id = "pp-icon-sprite";
  d.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true">${Object.entries(PATHS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${v}</symbol>`).join("")}</svg>`;
  document.body.prepend(d);
}

/** Names used by the views. */
export const ICONS = {
  working: icon("working"), transit: icon("transit"), idle: icon("idle"), tractor: icon("tractor"), field: icon("field"),
  cert: icon("certificate"), check: icon("circle-check"), cross: icon("circle-x"), shield: icon("shield"), warn: icon("warning"),
  satellite: icon("satellite"), leaf: icon("leaf"), qr: icon("qr"), pin: icon("pin"), walk: icon("walk"), gps: icon("gps"),
  lock: icon("lock"), clock: icon("clock"), info: icon("info"), flame: icon("flame"), alert: icon("circle-alert"), question: icon("question"),
};
