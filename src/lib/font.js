/**
 * Unicode text styling. Powers `.fancy` and the styled bot name in the menu
 * header (which uses the "sans" style, matching the supplied template).
 */

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";

/** Build a style from Mathematical Alphanumeric Symbols code-point bases. */
function mathStyle(upperBase, lowerBase, digitBase, holes = {}) {
  const map = {};
  for (let i = 0; i < 26; i++) {
    map[UPPER[i]] = String.fromCodePoint(upperBase + i);
    map[LOWER[i]] = String.fromCodePoint(lowerBase + i);
  }
  if (digitBase) {
    for (let i = 0; i < 10; i++) map[DIGITS[i]] = String.fromCodePoint(digitBase + i);
  }
  // Several math ranges have reserved gaps where the glyph lives in the BMP.
  Object.assign(map, holes);
  return map;
}

/** Build a style from a literal string of 26 (or 26+26+10) glyphs. */
function listStyle(upper, lower, digits) {
  const map = {};
  const U = [...upper], L = [...lower], D = digits ? [...digits] : null;
  for (let i = 0; i < 26; i++) {
    if (U[i]) map[UPPER[i]] = U[i];
    if (L[i]) map[LOWER[i]] = L[i];
  }
  if (D) for (let i = 0; i < 10; i++) if (D[i]) map[DIGITS[i]] = D[i];
  return map;
}

const STYLES = {
  bold: mathStyle(0x1d400, 0x1d41a, 0x1d7ce),
  italic: mathStyle(0x1d434, 0x1d44e, null, { h: "ℎ" }),
  bolditalic: mathStyle(0x1d468, 0x1d482),
  script: mathStyle(0x1d49c, 0x1d4b6, null, {
    B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ",
    L: "ℒ", M: "ℳ", R: "ℛ",
    e: "ℯ", g: "ℊ", o: "ℴ",
  }),
  boldscript: mathStyle(0x1d4d0, 0x1d4ea),
  fraktur: mathStyle(0x1d504, 0x1d51e, null, {
    C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ",
  }),
  boldfraktur: mathStyle(0x1d56c, 0x1d586),
  doublestruck: mathStyle(0x1d538, 0x1d552, 0x1d7d8, {
    C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ",
    Q: "ℚ", R: "ℝ", Z: "ℤ",
  }),
  sans: mathStyle(0x1d5a0, 0x1d5ba, 0x1d7e2),
  sansbold: mathStyle(0x1d5d4, 0x1d5ee, 0x1d7ec),
  sansitalic: mathStyle(0x1d608, 0x1d622),
  sansbolditalic: mathStyle(0x1d63c, 0x1d656),
  mono: mathStyle(0x1d670, 0x1d68a, 0x1d7f6),

  circled: mathStyle(0x24b6, 0x24d0, null, { 0: "⓪" }),
  squared: listStyle(
    "🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉",
    "🄰🄱🄲🄳🄴🄵🄶🄷🄸🄹🄺🄻🄼🄽🄾🄿🅀🅁🅂🅃🅄🅅🅆🅇🅈🅉"
  ),
  bubble: listStyle(
    "🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩",
    "🅐🅑🅒🅓🅔🅕🅖🅗🅘🅙🅚🅛🅜🅝🅞🅟🅠🅡🅢🅣🅤🅥🅦🅧🅨🅩"
  ),
  fullwidth: mathStyle(0xff21, 0xff41, 0xff10),
  smallcaps: listStyle(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘqʀsᴛᴜᴠᴡxʏᴢ"
  ),
  superscript: listStyle(
    "ᴬᴮᶜᴰᴱᶠᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾQᴿˢᵀᵁⱽᵂˣʸᶻ",
    "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖqʳˢᵗᵘᵛʷˣʸᶻ",
    "⁰¹²³⁴⁵⁶⁷⁸⁹"
  ),
  upsidedown: listStyle(
    "∀qƆpƎℲƃHIſʞ˥WNOԀQɹS┴∩ΛMX⅄Z",
    "ɐqɔpǝɟƃɥıɾʞlɯuodbɹsʇnʌʍxʎz",
    "0ƖᄅƐㄣϛ9ㄥ86"
  ),
};

/** Apply a named style. Unmapped characters (spaces, punctuation) pass through. */
function apply(text, style = "sans") {
  const map = STYLES[style];
  if (!map) return text;
  let out = "";
  for (const ch of String(text)) out += map[ch] || ch;
  if (style === "upsidedown") out = [...out].reverse().join("");
  return out;
}

const names = () => Object.keys(STYLES);

module.exports = { apply, names, STYLES };
