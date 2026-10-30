/*!
 * ParaliProof impact module  v1.0.0  (seva-impact, 27 Oct 2026)
 *
 * computeImpact(acres, opts?) -> emissions avoided, incentive due and an
 * INDICATIVE carbon value for an area of paddy straw that was managed
 * (in-situ / ex-situ) instead of being burned in the open field.
 *
 * Drop-in: no dependencies, no network. Works as
 *   - a browser <script> (exposes window.ParaliImpact), or
 *   - a CommonJS module in Node (require('./impact.js')).
 * The canonical constants are embedded below; impact-constants.json is an
 * exact export of them (impact.test.js checks they are identical).
 *
 * Method (IPCC 2006 Vol.4 Eq. 2.27, Tier 1/2 hybrid):
 *   DM_burned (t) = area_ha x straw_yield (t/ha) x dry_matter_fraction
 *                   x fraction_exposed_to_fire x combustion_factor
 *   E_x (kg)      = DM_burned (t) x EF_x (g/kg DM)          [t x g/kg = kg]
 *   CO2e_net      = E_CH4 x 27.0 + E_N2O x 273   (IPCC AR6 GWP100; biogenic
 *                   CO2 excluded, as IPCC inventories do for crop residue)
 *   CO2e_gross    = CO2e_net + E_CO2 (biogenic, shown for transparency only)
 * All results are "potential emissions avoided versus a burning baseline".
 * Multiply by opts.baselineBurnProbability (default 1) for an
 * additionality-adjusted estimate.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ParaliImpact = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONSTANTS = {
    version: '1.0.0',
    date: '2026-10-27',
    status: 'Prototype constants. Values marked to_verify must be checked before any claim is certified.',
    units: {
      straw_yield: 't straw per ha (as reported by source; treated as air-dry)',
      emission_factor: 'g per kg dry matter burned (equivalently kg per t DM)',
      outputs: 'kg unless stated'
    },
    ha_per_acre: 0.40468564224,
    residue: {
      straw_yield_t_per_ha: {
        low: 5.5, central: 6.5, high: 8.0,
        sources: ['PB_NGT_2024', 'NAAS_2017', 'PAU_PUSA44'],
        note: 'Central = Punjab Govt planning basis for non-basmati paddy (6.5 t/ha). Low = Punjab basis for basmati (5.5 t/ha). High = lower end of NAAS 8-10 t/ha for combine-harvested fields; also ~= 6.5 x 1.15-1.20 for Pusa-44, which PAU says carries 15-20% more straw than PAU varieties. PR-126 is said to carry less straw (Punjab Govt) but no t/ha figure was found.',
        to_verify: true
      },
      dry_matter_fraction: {
        low: 0.86, central: 0.86, high: 0.86,
        sources: ['JAIN_2014', 'TERI_2021'],
        note: 'Rice-residue dry-matter fraction 0.86 (Jain et al. 2014, as tabulated in TERI 2021 Table 24).'
      },
      fraction_exposed_to_fire: {
        low: 0.8, central: 0.9, high: 1.0,
        sources: ['ASSUMPTION'],
        note: 'Share of the straw left on a burned field that is actually reached by fire (unburned wet patches, edges, removed straw). Team assumption; calibrate with Sentinel-2 burned-area fraction on known burned fields.',
        to_verify: true
      },
      combustion_factor: {
        low: 0.80, central: 0.80, high: 0.89,
        sources: ['IPCC_2006_V4C2', 'TERI_2021'],
        note: 'IPCC 2006 Table 2.6 rice residues Cf = 0.80; TERI 2021 Table 24 uses 0.89 for rice (after Turn et al. 1997).'
      }
    },
    // g per kg dry matter burned. Rule: central = India-measured rice value
    // (TERI 2021) where one exists, else Andreae 2019 compilation; low/high =
    // lowest/highest cited mean, or Andreae 2019 mean -/+ 1 SD where only that
    // compilation reports the species with a usable spread.
    emission_factors: {
      CO2:  { low: 1430, central: 1460, high: 1515, sources: ['ANDREAE_2019', 'NAAS_2017', 'IPCC_2006_V4C2'], note: 'Biogenic. Not counted as net climate impact under IPCC.' },
      CO:   { low: 60,   central: 79.61, high: 92, sources: ['NAAS_2017', 'TERI_2021', 'IPCC_2006_V4C2', 'ANDREAE_2019'] },
      CH4:  { low: 2.7,  central: 5.7,  high: 11.7, sources: ['IPCC_2006_V4C2', 'ANDREAE_2019'], note: 'High = Andreae 2019 mean + 1 SD (5.7 + 6.0).' },
      N2O:  { low: 0.07, central: 0.09, high: 0.13, sources: ['IPCC_2006_V4C2', 'ANDREAE_2019'], note: 'High = Andreae 2019 mean + 1 SD (0.09 + 0.04).' },
      NOx:  { low: 2.4,  central: 5.70, high: 5.70, sources: ['ANDREAE_2019', 'NAAS_2017', 'IPCC_2006_V4C2', 'TERI_2021'], note: 'Andreae value expressed as NO.' },
      SO2:  { low: 0.2,  central: 2.12, high: 2.12, sources: ['NAAS_2017', 'ANDREAE_2019', 'TERI_2021'], note: 'TERI reports SOx.' },
      NH3:  { low: 0.99, central: 0.99, high: 1.30, sources: ['ANDREAE_2019', 'TERI_2021'], note: 'TERI NH3 taken from GAINS-ASIA, not measured.' },
      PM25: { low: 8.2,  central: 9.26, high: 9.26, sources: ['ANDREAE_2019', 'OANH_2011', 'TERI_2021'], note: 'Andreae 2019 SD is +/-4.4; Oanh 2011 Thai field burns 8.3 +/- 2.7.' },
      PM10: { low: 9.4,  central: 14.60, high: 14.60, sources: ['OANH_2011', 'TERI_2021'] },
      BC:   { low: 0.14, central: 0.42, high: 0.70, sources: ['ANDREAE_2019'], note: 'Andreae 2019 mean +/- 1 SD (0.42 +/- 0.28). No India-measured rice BC factor located.', to_verify: true },
      OC:   { low: 1.3,  central: 4.9,  high: 8.5,  sources: ['ANDREAE_2019'], note: 'Andreae 2019 mean +/- 1 SD (4.9 +/- 3.6).', to_verify: true }
    },
    gwp100: {
      CO2: 1, CH4: 27.0, N2O: 273,
      sources: ['IPCC_AR6_WG1_CH7', 'GHGP_GWP_2024'],
      note: 'AR6 GWP100, CH4 non-fossil (biogenic) = 27.0, N2O = 273. BC, CO and NOx have no agreed GWP100 in inventories and are excluded from CO2e.'
    },
    incentive: {
      default_rate_inr_per_acre: 1200,
      sources: ['HR_CRM_2025', 'TRIBUNE_AMBALA_2025'],
      note: 'Haryana CRM incentive Rs 1,200/acre. Configurable; seva-research owns the scheme details.'
    },
    carbon_price_indicative: {
      label: 'INDICATIVE ONLY - no methodology currently credits avoided residue burning in India; not a price quote.',
      usd_per_tco2e: { low: 3.5, central: 10, high: 14.8 },
      inr_per_usd: 85,
      sources: ['SPGLOBAL_BEE_2024', 'MSCI_2025_SECONDARY'],
      note: 'Central = BEE official expectation of ~$10/credit for Indian CCCs (S&P Global, Nov 2024). Low/high = MSCI 2025 low/high-quality agricultural-soil credit prices as quoted second-hand. INR/USD 85 is a placeholder.',
      to_verify: true
    },
    sources: {
      PB_NGT_2024: { citation: 'Govt of Punjab (2024). Status report in NGT OA No. 632 of 2023, dated 2 Sep 2024: paddy straw generation basis 6.5 t/ha non-basmati, 5.5 t/ha basmati; 31.54 lakh ha paddy, 19.52 Mt straw (2024 est.).', url: 'https://www.greentribunal.gov.in/sites/default/files/news_updates/Status%20Report%20by%20State%20of%20Punjab%20in%20OA%20No.%20632%20of%202023%20(In%20re%20News%20Item%20published%20in%20The%20Hindu%20dated%2006.10.2023%20titled%20as%20Pollution%20take%20a%20front%20seat.pdf' },
      NAAS_2017: { citation: 'NAAS (2017). Innovative Viable Solution to Rice Residue Burning in Rice-Wheat Cropping System through Concurrent Use of Super SMS-fitted Combines and Turbo Happy Seeder. Policy Brief No. 2. National Academy of Agricultural Sciences, New Delhi.', url: 'https://naas.org.in/Policy%20Briefs/Policy%20Brief%202%20-%20Crop%20Burning.pdf' },
      PAU_PUSA44: { citation: 'PAU Vice-Chancellor quoted: Pusa-44 produces 15-20% more stubble than PAU varieties (secondary reports).', url: 'https://www.pmfias.com/pusa-44-pusa-2090/' },
      JAIN_2014: { citation: 'Jain N, Bhatia A, Pathak H (2014). Emission of air pollutants from crop residue burning in India. Aerosol and Air Quality Research 14: 422-430. doi:10.4209/aaqr.2013.01.0031', url: 'https://aaqr.org/articles/aaqr-13-01-oa-0031' },
      TERI_2021: { citation: 'TERI (2021). Development of Spatially Resolved Air Pollution Emission Inventory of India, Ch. 8 Open burning of agricultural residues, Tables 24 and 26 (rice EFs, kg/Mg).', url: 'https://www.teriin.org/sites/default/files/files/ap-Chapter8.pdf' },
      IPCC_2006_V4C2: { citation: 'IPCC (2006). Guidelines for National GHG Inventories, Vol. 4 Ch. 2, Tables 2.4, 2.5, 2.6 (unchanged in the 2019 Refinement).', url: 'https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/4_Volume4/V4_02_Ch2_Generic.pdf' },
      ANDREAE_2019: { citation: 'Andreae MO (2019). Emission of trace gases and aerosols from biomass burning - an updated assessment. Atmos. Chem. Phys. 19: 8523-8546, Table 1, Agricultural residues (open).', url: 'https://doi.org/10.5194/acp-19-8523-2019' },
      OANH_2011: { citation: 'Oanh NTK et al. (2011). Characterization of particulate matter emission from open burning of rice straw. Atmos. Environ. 45: 493-502 (Thai field burns), as summarised in an ICAR review.', url: 'https://epubs.icar.org.in/index.php/IJAgS/article/download/84879/34903/349167' },
      IPCC_AR6_WG1_CH7: { citation: 'Forster P et al. (2021). Ch. 7, IPCC AR6 WG1, Table 7.15 (GWP100).', url: 'https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-7/' },
      GHGP_GWP_2024: { citation: 'GHG Protocol (Aug 2024). Global Warming Potential Values (AR6: CH4 non-fossil 27.0, fossil 29.8, N2O 273).', url: 'https://ghgprotocol.org/sites/default/files/2024-08/Global-Warming-Potential-Values%20%28August%202024%29.pdf' },
      HR_CRM_2025: { citation: 'The Week / PTI (3 Jul 2025). Haryana roadmap: Rs 1,200/acre under CRM scheme; 41.37 lakh acres paddy; 85.50 lakh t straw expected.', url: 'https://www.theweek.in/wire-updates/national/2025/07/03/des72-hr-pollution.html' },
      TRIBUNE_AMBALA_2025: { citation: 'The Tribune (20 Nov 2025). No stubble burnt in 2.45 L acres; Ambala farmers seek incentives (Rs 1,200/acre; 67,730 acres verified).', url: 'https://www.tribuneindia.com/news/haryana/no-stubble-burnt-in-2-45-l-acres-ambala-farmers-seek-incentives' },
      SPGLOBAL_BEE_2024: { citation: 'S&P Global Commodity Insights (1 Nov 2024). Industry sees initial carbon credits priced around $10/mtCO2e in India (BEE director quoted).', url: 'https://www.spglobal.com/commodityinsights/en/market-insights/latest-news/energy-transition/110124-industry-sees-initial-carbon-credits-priced-around-10mtco2e-in-india' },
      MSCI_2025_SECONDARY: { citation: 'MSCI 2025 survey as quoted by a secondary guide: ~$14.80/t (A-AAA) vs ~$3.50/t (CCC-B) agricultural soil credits. Primary not accessed.', url: 'https://solartechonline.com/blog/soil-carbon-credits-guide/' },
      ASSUMPTION: { citation: 'seva-impact team assumption, to be calibrated from field/satellite data.', url: null }
    }
  };

  var LEVELS = ['low', 'central', 'high'];

  function round(x, dp) {
    var f = Math.pow(10, dp);
    return Math.round(x * f) / f;
  }

  // t dry matter burned per hectare for a given level
  function dmBurnedPerHa(level) {
    var r = CONSTANTS.residue;
    return r.straw_yield_t_per_ha[level] * r.dry_matter_fraction[level] *
           r.fraction_exposed_to_fire[level] * r.combustion_factor[level];
  }

  function emissionsKg(dmT, level) {
    var ef = CONSTANTS.emission_factors, out = {};
    Object.keys(ef).forEach(function (k) { out[k] = dmT * ef[k][level]; }); // t x g/kg = kg
    return out;
  }

  function co2eNetKg(e) {
    var g = CONSTANTS.gwp100;
    return e.CH4 * g.CH4 + e.N2O * g.N2O;
  }

  /**
   * @param {number} acres  area verified as managed (not burned), > = 0
   * @param {object} [opts]
   * @param {number} [opts.incentiveRate=1200]          INR per acre
   * @param {number} [opts.baselineBurnProbability=1]   0..1, share of these acres that would have been burned
   * @param {number} [opts.inrPerUsd]                   override FX for indicative carbon value
   * @param {number} [opts.deductionKgCo2ePerAcre=0]    project emissions to subtract (diesel, residue N2O) for a conservative net
   * @returns {object}
   */
  function computeImpact(acres, opts) {
    opts = opts || {};
    if (typeof acres !== 'number' || !isFinite(acres) || acres < 0) {
      throw new TypeError('computeImpact: acres must be a finite number >= 0');
    }
    var rate = opts.incentiveRate != null ? opts.incentiveRate : CONSTANTS.incentive.default_rate_inr_per_acre;
    var p = opts.baselineBurnProbability != null ? opts.baselineBurnProbability : 1;
    if (!(p >= 0 && p <= 1)) throw new RangeError('baselineBurnProbability must be in [0,1]');
    var fx = opts.inrPerUsd != null ? opts.inrPerUsd : CONSTANTS.carbon_price_indicative.inr_per_usd;
    var ded = opts.deductionKgCo2ePerAcre || 0;

    var ha = acres * CONSTANTS.ha_per_acre;
    var res = {};
    LEVELS.forEach(function (lv) {
      var dm = ha * dmBurnedPerHa(lv) * p;
      var e = emissionsKg(dm, lv);
      var net = Math.max(0, co2eNetKg(e) - ded * acres * p);
      res[lv] = { dm_t: dm, e: e, net: net, gross: net + e.CO2 };
    });

    var c = res.central, price = CONSTANTS.carbon_price_indicative.usd_per_tco2e;
    function pollutant(k, dp) {
      return { low: round(res.low.e[k], dp), central: round(c.e[k], dp), high: round(res.high.e[k], dp) };
    }

    return {
      method_version: CONSTANTS.version,
      acres: acres,
      hectares: round(ha, 4),
      baseline_burn_probability: p,
      straw_t: round(ha * CONSTANTS.residue.straw_yield_t_per_ha.central, 3),
      straw_t_range: {
        low: round(ha * CONSTANTS.residue.straw_yield_t_per_ha.low, 3),
        high: round(ha * CONSTANTS.residue.straw_yield_t_per_ha.high, 3)
      },
      dry_matter_not_burned_t: { low: round(res.low.dm_t, 3), central: round(c.dm_t, 3), high: round(res.high.dm_t, 3) },
      // IPCC-consistent net climate impact (CH4 + N2O only, AR6 GWP100)
      co2e_kg_low: round(res.low.net, 1),
      co2e_kg_central: round(c.net, 1),
      co2e_kg_high: round(res.high.net, 1),
      // including biogenic CO2 (for transparency; not creditable)
      co2e_incl_biogenic_kg: { low: round(res.low.gross, 0), central: round(c.gross, 0), high: round(res.high.gross, 0) },
      co2_biogenic_kg: pollutant('CO2', 0),
      pm25_kg: round(c.e.PM25, 2),
      pm10_kg: round(c.e.PM10, 2),
      co_kg: round(c.e.CO, 2),
      bc_kg: round(c.e.BC, 3),
      ranges: {
        pm25_kg: pollutant('PM25', 2), pm10_kg: pollutant('PM10', 2), co_kg: pollutant('CO', 2),
        bc_kg: pollutant('BC', 3), oc_kg: pollutant('OC', 2), nox_kg: pollutant('NOx', 2),
        so2_kg: pollutant('SO2', 2), nh3_kg: pollutant('NH3', 2), ch4_kg: pollutant('CH4', 3), n2o_kg: pollutant('N2O', 4)
      },
      incentive_rate_inr_per_acre: rate,
      incentive_inr: round(acres * rate, 2),
      carbon_value_inr_indicative: {
        label: CONSTANTS.carbon_price_indicative.label,
        low: round(res.low.net / 1000 * price.low * fx, 0),
        central: round(c.net / 1000 * price.central * fx, 0),
        high: round(res.high.net / 1000 * price.high * fx, 0),
        assumptions: { usd_per_tco2e: price, inr_per_usd: fx, basis: 'co2e net (CH4+N2O) only' }
      },
      notes: [
        'Potential emissions avoided versus burning the same straw in the open field.',
        'co2e_kg_* excludes biogenic CO2 (IPCC convention); co2e_incl_biogenic_kg is shown for transparency only.',
        'Low/central/high combine low/central/high residue and emission-factor assumptions; they are scenario bounds, not statistical confidence intervals.',
        'Indicative carbon value is NOT a credit: no approved CCTS or voluntary methodology currently issues credits for avoided residue burning alone.'
      ],
      sources: Object.keys(CONSTANTS.sources).map(function (k) {
        return { id: k, citation: CONSTANTS.sources[k].citation, url: CONSTANTS.sources[k].url };
      })
    };
  }

  /** Compact object for the certificate's optional `impact` section. */
  function certificateImpact(acres, opts) {
    var r = computeImpact(acres, opts);
    return {
      method: 'paraliproof-impact/' + r.method_version,
      acres: r.acres,
      straw_t: r.straw_t,
      co2e_kg: { low: r.co2e_kg_low, central: r.co2e_kg_central, high: r.co2e_kg_high },
      pm25_kg: r.pm25_kg,
      pm10_kg: r.pm10_kg,
      co_kg: r.co_kg,
      bc_kg: r.bc_kg,
      incentive_inr: r.incentive_inr,
      basis: 'IPCC 2006 Eq 2.27; AR6 GWP100; biogenic CO2 excluded; vs. burning baseline'
    };
  }

  return { computeImpact: computeImpact, certificateImpact: certificateImpact, CONSTANTS: CONSTANTS, dmBurnedPerHa: dmBurnedPerHa };
});
