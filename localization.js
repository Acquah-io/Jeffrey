// localization.js
// Utility to generate a localization map for Discord command descriptions.

const ALL_LOCALES = [
  'en-US','en-GB','bg','zh-CN','zh-TW','hr','cs','da','nl','fi','fr','de','el','hi','hu','id','it','ja','ko','lt','no','pl','pt-BR','ro','ru','es-ES','es-419','sv-SE','th','tr','uk','vi'
];

function makeLoc(text) {
  const o = {};
  for (const code of ALL_LOCALES) {
    if (code === 'en-US') continue; // default already en-US
    o[code] = text;
  }
  return o;
}

module.exports = { makeLoc, ALL_LOCALES };

