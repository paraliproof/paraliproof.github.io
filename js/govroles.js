// govroles.js — the government role table (DATA, not code). NO DOM CODE HERE.
//
// A Haryana default, from docs/policy/field-identity-and-payment.md Q9 and trust-model §10.1. A signed
// state profile (D8) can later replace the names, the order and the powers without touching the core.
// Level ids are fixed; display names, tabs and powers come from this table.
//
// Powers (checked in js/gov.js before anything is signed, and used by the views to show actions):
//   scan        verify certificates and slips          visit        file a signed field-visit report
//   decide      decide a claim with a reason code      enrol        enrol a phone (first signature → "pending")
//   countersign second signature on an enrolment      audit        see the random audit sample
//   seed        commit the season's audit seed         dashboard    district / state figures
//   batch       build the DLEC batch from ready claims  dlec         approve / return claims in a batch, sign minutes
//   demo        add the clearly labelled demo district

export const LEVEL_IDS = ['village', 'block', 'sdao', 'district', 'dlec', 'state'];

export const DEFAULT_ROLE_TABLE = Object.freeze({
  id: 'HR-DEFAULT',
  note: 'Haryana default (policy research Q9). Names vary by state; a signed state profile can rename them.',
  levels: [
    { id: 'village', name: { en: 'Village nodal officer', hi: 'ग्राम नोडल अधिकारी', pa: 'ਪਿੰਡ ਨੋਡਲ ਅਧਿਕਾਰੀ' },
      duty: { en: 'Visits claimed fields and files a signed visit report; scans certificates and slips', hi: 'दावे वाले खेतों का दौरा और हस्ताक्षरित दौरा रिपोर्ट; प्रमाणपत्र और स्लिप स्कैन', pa: 'ਦਾਅਵੇ ਵਾਲੇ ਖੇਤਾਂ ਦਾ ਦੌਰਾ ਅਤੇ ਦਸਤਖ਼ਤੀ ਦੌਰਾ ਰਿਪੋਰਟ; ਸਰਟੀਫਿਕੇਟ ਅਤੇ ਸਲਿੱਪ ਸਕੈਨ' },
      powers: ['scan', 'visit'], tabs: ['visits', 'verify', 'log'] },
    { id: 'block', name: { en: 'ADO / AEO (block)', hi: 'ADO / AEO (ब्लॉक)', pa: 'ADO / AEO (ਬਲਾਕ)' },
      duty: { en: 'Registers phones, works the claim queue, decides each claim with a reason', hi: 'फ़ोन पंजीकरण, दावा कतार, हर दावे पर कारण सहित फ़ैसला', pa: 'ਫ਼ੋਨ ਰਜਿਸਟਰ ਕਰਨਾ, ਦਾਅਵਾ ਕਤਾਰ, ਹਰ ਦਾਅਵੇ ਉੱਤੇ ਕਾਰਨ ਸਮੇਤ ਫ਼ੈਸਲਾ' },
      powers: ['scan', 'decide', 'enrol', 'audit'], tabs: ['queue', 'audit', 'verify', 'dash', 'phones'] },
    { id: 'sdao', name: { en: 'SDAO (sub-division)', hi: 'SDAO (उप-मंडल)', pa: 'SDAO (ਉਪ-ਮੰਡਲ)' },
      duty: { en: 'Countersigns new phones; reviews returned and disputed cases', hi: 'नए फ़ोन पर दूसरा हस्ताक्षर; लौटाए और विवादित मामले', pa: 'ਨਵੇਂ ਫ਼ੋਨ ਉੱਤੇ ਦੂਜਾ ਦਸਤਖ਼ਤ; ਵਾਪਸ ਕੀਤੇ ਅਤੇ ਵਿਵਾਦਿਤ ਮਾਮਲੇ' },
      powers: ['scan', 'countersign', 'decide'], tabs: ['approvals', 'queue', 'log'] },
    { id: 'district', name: { en: 'DDA (district)', hi: 'DDA (ज़िला)', pa: 'DDA (ਜ਼ਿਲ੍ਹਾ)' },
      duty: { en: 'District dashboard; builds the committee batch; sets the random check for the season', hi: 'ज़िला डैशबोर्ड; समिति बैच बनाना; मौसम की यादृच्छिक जाँच तय करना', pa: 'ਜ਼ਿਲ੍ਹਾ ਡੈਸ਼ਬੋਰਡ; ਕਮੇਟੀ ਬੈਚ ਬਣਾਉਣਾ; ਮੌਸਮ ਦੀ ਬੇਤਰਤੀਬ ਜਾਂਚ ਤੈਅ ਕਰਨਾ' },
      powers: ['scan', 'decide', 'audit', 'seed', 'dashboard', 'batch', 'demo'], tabs: ['district', 'batch', 'queue', 'audit'] },
    { id: 'dlec', name: { en: 'DLEC member', hi: 'DLEC सदस्य', pa: 'DLEC ਮੈਂਬਰ' },
      duty: { en: 'Reviews the batch with its evidence, approves or returns, signs the minutes', hi: 'सबूत सहित बैच की समीक्षा, स्वीकृति या वापसी, कार्यवृत्त पर हस्ताक्षर', pa: 'ਸਬੂਤ ਸਮੇਤ ਬੈਚ ਦੀ ਸਮੀਖਿਆ, ਮਨਜ਼ੂਰੀ ਜਾਂ ਵਾਪਸੀ, ਕਾਰਵਾਈ ਉੱਤੇ ਦਸਤਖ਼ਤ' },
      powers: ['dlec'], tabs: ['dlec', 'log'] },
    { id: 'state', name: { en: 'State CRM cell', hi: 'राज्य CRM सेल', pa: 'ਰਾਜ CRM ਸੈੱਲ' },
      duty: { en: 'State dashboard, reports and the signed log (read-only)', hi: 'राज्य डैशबोर्ड, रिपोर्ट और हस्ताक्षरित लॉग (सिर्फ़ देखना)', pa: 'ਰਾਜ ਡੈਸ਼ਬੋਰਡ, ਰਿਪੋਰਟਾਂ ਅਤੇ ਦਸਤਖ਼ਤੀ ਲੌਗ (ਸਿਰਫ਼ ਦੇਖਣਾ)' },
      powers: ['dashboard', 'demo'], tabs: ['state', 'log'] },
  ],
});

let table = DEFAULT_ROLE_TABLE;
/** Replace the role table (a verified state profile, Phase 4). Unknown level ids are ignored. */
export function setRoleTable(t) {
  if (!t || !Array.isArray(t.levels)) { table = DEFAULT_ROLE_TABLE; return; }
  const levels = t.levels.filter((l) => LEVEL_IDS.includes(l?.id));
  table = levels.length ? { ...t, levels } : DEFAULT_ROLE_TABLE;
}
export const roleTable = () => table;
export const levelOf = (settings) => (table.levels.some((l) => l.id === settings?.govLevel) ? settings.govLevel : null);
export const levelInfo = (id) => table.levels.find((l) => l.id === id) || null;
export const levelName = (id, lang = 'en') => { const l = levelInfo(id); return l ? (l.name[lang] || l.name.en) : id; };
export const hasPower = (level, power) => !!levelInfo(level)?.powers?.includes(power);
