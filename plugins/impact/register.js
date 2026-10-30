// plugins/impact/register.js — switches on the impact module from docs/impact/ (seva-impact).
// impact.js here is an UNMODIFIED copy of docs/impact/impact.js (UMD; sets self.ParaliImpact).
//
// Result goes into the certificate's optional ext.impact section. The CO2e value is an
// INDICATIVE estimate of emissions avoided versus burning (CH4 + N2O, AR6 GWP100, biogenic
// CO2 excluded) — it is NOT a carbon credit and the certificate does not earn credits.

import './impact.js';
import { registerImpactCalculator } from '../../js/plugins.js';

const I = globalThis.ParaliImpact;

/** Compact impact section for `acres` (rounded to 2 dp, like the certificate) at `rate` ₹/acre. */
export function impactFor(acres, rate = 1200) {
  const a = Math.round(acres * 100) / 100;
  return { ...I.certificateImpact(a, { incentiveRate: rate }), indicative: true };
}

if (I) registerImpactCalculator((ctx) => impactFor(ctx.coverage.workedAcres, ctx.rate));
