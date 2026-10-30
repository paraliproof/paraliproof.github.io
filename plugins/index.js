// plugins/index.js — the ONE place where team modules are switched on.
//
// Other members deliver drop-in modules (they never edit app/js). Each is copied
// into app/plugins/<name>/ and enabled here. Contracts: js/plugins.js, js/classifier.js.
// Remember to add new files to SHELL_FILES in sw.js so they work offline.

import './ml/register.js';         // ml/   → gradient-boosted stumps activity model (default; threshold = fallback)
import './impact/register.js';     // docs/impact/ → emissions avoided + incentive (ext.impact)
import './sat/register.js';        // sat/  → precomputed Sentinel-2 / FIRMS results (ext.satellite)
