import { collection, addDoc, query, getDocs, orderBy, limit, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { callServerGemini } from './geminiClient';

export enum Type {
  TYPE_UNSPECIFIED = "TYPE_UNSPECIFIED",
  STRING = "STRING",
  NUMBER = "NUMBER",
  INTEGER = "INTEGER",
  BOOLEAN = "BOOLEAN",
  ARRAY = "ARRAY",
  OBJECT = "OBJECT",
  NULL = "NULL",
}
export type Schema = any;

const MODEL_NAME = "gemini-3.1-flash-lite";

export enum EnglishTranslationSection {
  GENERAL = 'general'
}

export interface EnglishTranslationResult {
  translatedText: string;
  sourceText: string;
  section: EnglishTranslationSection;
}

export interface EnglishLearnedPatternItem {
  id: string;
  englishText: string;
  koreanText: string;
  section?: EnglishTranslationSection | string;
  terminology: Record<string, string>;
  transformationRules: string[];
  createdAt?: any;
}

// ---------------------------------------------------------------------------
// 1. DETERMINISTIC CODE-BASED RULES (Zero Token Usage & 100% Enforcement)
// ---------------------------------------------------------------------------
//
// IMPORTANT: JavaScript's `\b` word-boundary assertion only fires at a
// transition between a "word character" ([A-Za-z0-9_]) and a non-word
// character. Hangul syllables are NOT word characters, so `\b건드리는\b`
// style patterns almost never match real Korean sentences (both sides of
// the boundary are "non-word", so there's no transition at all). That bug
// silently killed most of the pure-Korean substitutions below. Fix: drop
// `\b` for any pattern that starts/ends in Hangul, and only keep it where
// the pattern starts/ends in a genuine Latin/digit character (BBC, UN,
// S-300, F-15, etc.), where it works correctly.
//
// ORDERING MATTERS: more specific multi-word terms (e.g. "UN안전보장이사회",
// "인민해방군 로켓군") must be listed BEFORE the shorter generic term they
// contain (e.g. "UN", "인민해방군"), otherwise the generic rule fires first
// and corrupts the text before the specific rule ever gets a chance to match.

// Rules that should fire on EVERY occurrence, every time (pure word/style
// substitutions — not tied to "first mention" journalism conventions).
const STYLE_SUBSTITUTIONS: [RegExp, string][] = [
  [/회동/g, "회담"],
  [/되었(다|으며|고|던)/g, "됐$1"],
  // "이는" is an extremely common token/substring in Korean (높이는, 먹이는,
  // 차이는, 지어지는...). A bare global replace would corrupt those words.
  // Use Hangul-aware lookaround so it only matches the standalone word.
  [/(?<![가-힣])이는(?![가-힣])/g, "상기 조치는"],
  [/인프라/g, "기반시설"],
  [/시스템/g, "체계"],
  [/드론/g, "무인기"],
  [/우크라이나/g, "우크라"],
  [/프로젝트/g, "사업"],
  [/정부/g, "당국"],
  [/트럼프 행정부/g, "트럼프 대통령 행정부"],
];

// Rules for named entities/orgs/weapons/outlets that carry a parenthetical
// gloss on FIRST mention only. On subsequent mentions the gloss is dropped
// and only the bare term is kept — mirroring the same "1st vs 2nd+ mention"
// convention already enforced for people/companies/cities/sources below.
// Tuple: [matchPattern, firstMentionReplacement, repeatMentionReplacement?]
// (repeatMentionReplacement omitted => leave the matched text unchanged).
const FIRST_MENTION_GLOSSARY: [RegExp, string, string?][] = [
  [/코로나19(?!\(Covid-19\))/g, "코로나19(Covid-19)"],
  [/인공지능(?!\(AI)/g, "인공지능(AI, Artificial Intelligence)"],
  [/탈레반(?!\(Taliban\))/g, "이슬람 무장조직 탈레반(Taliban)"],
  [/하마스(?!\(Hamas\))/g, "팔레스타인 무장정파 하마스(Hamas)"],
  [/가자지구(?!\(Gaza)/g, "이스라엘-팔레스타인 분쟁지역 가자지구(Gaza Strip)"],
  [/펜타곤(?!\(Pentagon\))/g, "미국 국방부(Pentagon)"],
  [/백악관(?!\(White House\))/g, "미국 백악관(White House)"],

  // Compound/specific org terms are listed BEFORE their generic root so
  // that (thanks to the placeholder protection in applySubstitutionList)
  // the specific rule claims the text first and the generic rule below
  // never gets a chance to re-match it.
  [/UN안전보장이사회(?!\()/g, "UN안전보장이사회(UNSC, UN Security Council: 안보리)", "UNSC"],
  [/\bUN\b(?!안전보장이사회)/g, "국제연합(UN, United Nations)"],
  [/\bEU\b(?!\()/g, "유럽연합(EU, European Union)"],
  [/\bEC\b(?!\()/g, "EU 산하 유럽집행위원회(EC, European Commission)"],
  [/\bEP\b(?!\()/g, "EU 산하 유럽의회(EP, European Parliament)"],
  [/\bG7\b(?!\()/g, "주요7개국(G7, Group of Seven)"],
  [/일본 육상자위대(?!\()/g, "일본 육상자위대(JGSDF, Japan Ground Self-Defense Force)"],
  [/인민해방군 로켓군(?!\()/g, "중국인민해방군 로켓군(PLARF, People's Liberation Army Rocket Force)"],
  [/인민해방군(?!\s*로켓군|\()/g, "중국인민해방군(PLA, People's Liberation Army)"],
  [/\bCCTV\b(?!\()/g, "중국 국영 방송사(CCTV, China Central Television)"],

  // --- media outlets ---
  [/\bBBC\b(?!\()/g, "영국 방송사 BBC"],
  [/블룸버그(?!\()/g, "미국 통신사 블룸버그(Bloomberg L.P.)"],
  [/폴리티코(?!\()/g, "영국 정치전문일간지(Politico)"],
  [/신화통신(?!\()/g, "중국 관영 통신사 신화통신(Xinhua News Agency)"],
  [/요미우리(?!\s*신문\()/g, "일본 일간지 요미우리 신문(Yomiuri)"],
  [/\bSCMP\b(?!\()/g, "대만 영어 일간지 SCMP(South China Morning Post)"],

  // --- weapons / platforms ---
  [/패트리엇|패트리어트/g, "MIM-104 패트리어트 중장거리 SAM"],
  [/\bS-300\b(?!\s*중장거리)/g, "S-300 중장거리 SAM"],
  [/무인전투기(?!\()/g, "무인전투기(UCAV, Unmanned Combat Aerial Vehicle)"],
  [/지대공미사일(?!\()/g, "지대공미사일(SAM, Surface-to-Air Missile)"],
  [/대륙간탄도미사일(?!\()/g, "대륙간탄도미사일(ICBM, InterContinental Ballistic Missile)"],
  [/잠수함발사탄도미사일(?!\()/g, "잠수함발사탄도미사일(SLBM, Submarine-Launched Ballistic Missile)"],
  [/다탄두각개목표설정재돌입체(?!\()/g, "다탄두각개목표설정재돌입체(MIRV, Multiple Independently Targetable Reentry Vehicle)"],
  [/\bF-15\b(?!\s*다목적)/g, "F-15 다목적 전폭기"],
  [/\bH-6\b(?!\s*폭격기)/g, "H-6 폭격기"],
  [/\bJL-1\b(?!\s*ICBM)/g, "JL-1 ICBM"],
  [/\bJL-3\b(?!\s*SLBM)/g, "JL-3 SLBM"],
  [/\btype094\b(?!\s*핵잠수함)/g, "type094 핵잠수함"],
  [/\btype096\b(?!\s*핵잠수함)/g, "type096 핵잠수함"],
  [/\bDF-61\b(?!\s*ICBM)/g, "DF-61 ICBM"],
  [/\bDF-31\b(?!\s*ICBM)/g, "DF-31 ICBM"],
  [/\bDF-5\b(?!\s*ICBM)/g, "DF-5 ICBM"],
  [/\bDF-41\b(?!\s*ICBM)/g, "DF-41 ICBM"],
  [/\bGJ-11\b(?!\s*UCAV)/g, "GJ-11 UCAV"],
  [/\bJ-10\b(?!\s*다목적)/g, "J-10 다목적 전투기"],
  [/\bHQ-22\b(?!\s*SAM)/g, "HQ-22 SAM"],
  [/\bHQ-17\b(?!\s*단거리)/g, "HQ-17 단거리 SAM"],
  [/12식(?!\(Type12\))/g, "12식(Type12)"],

  // --- defense manufacturers (typos in the source style-guide corrected) ---
  [/이란항공기제조산업공사(?!\()/g, "이란항공기제조산업공사(HESA, Iran Aircraft Manufacturing Industries Corporation)"],
  [/시안항공기국제공사(?!\()/g, "시안항공기국제공사(XAC, Xi'an Aircraft Industry Group)"],
  [/홍두항공산업그룹(?!\()/g, "홍두항공산업그룹(Hongdu Aviation Industry Group)"],
  [/난징여명그룹(?!\()/g, "난징여명그룹(Nanjing Dawn Group)"],
  [/보하이조선중공업(?!\()/g, "보하이조선중공업(BSHIC, Bohai Shipbuilding Heavy Industry Company)"],
  [/중앙항공기계(?!\()/g, "중앙항공기계(Capital Astronautics Machinery)"],
  [/중국우주과학공업집단(?!\()/g, "중국우주과학공업집단(CASIC, China Aerospace Science and Industry Corporation)"],
  [/중국항천과기집단(?!\()/g, "중국항천과기집단(CASC, China Aerospace Science and Technology Corporation)"],
  [/중국발사체기술연구원(?!\()/g, "중국발사체기술연구원(CALT, China Academy of Launch Vehicle Technology)"],
  [/충두항공기공업그룹(?!\()/g, "충두항공기공업그룹(CAIG, Chengdu Aircraft Industries Group)"],
];

const HEADLINE_HANJA_MAP: Record<string, string> = {
  "미국": "美",
  "중국": "中",
  "대한민국": "韩",
  "한국": "韩",
  "남한": "韩",
  "일본": "日",
  "북한": "北"
};

// Non-final (connective/suspended) verb endings used to rewrite a quoted
// headline main point so it does NOT read as a closed ~다. sentence.
// Checked in order — first match wins.
const HEADLINE_NON_FINAL_ENDINGS: [RegExp, string][] = [
  [/않았다$/, "않아"],
  [/않는다$/, "않아"],
  [/했다$/, "해"],
  [/한다$/, "해"],
  [/있다$/, "있어"],
  [/없다$/, "없어"],
  [/이다$/, "이라"],
];

// Allowed reporting verbs, in rotation order. "말했다" is banned and is
// always the trigger for rewriting, but per the style guide the *other*
// verbs must also be alternated rather than defaulting to the same one
// every time. Per house style: 밝혔다/전했다/덧붙였다/언급했다/강조했다.
const REPORTING_VERBS = ["밝혔다", "전했다", "덧붙였다", "언급했다", "강조했다"];

/**
 * Rewrites every reporting-verb clause ("라고 말했다/밝혔다/전했다/...") so that:
 * - "라고 말했다" (banned) is always replaced.
 * - Verbs are rotated across the document instead of collapsing to a
 *   single repeated verb, AND two consecutive quotes never use the same
 *   verb even when both are otherwise "valid" (e.g. 밝혔다 then 밝혔다 again).
 */
function normalizeReportingVerbs(text: string): string {
  let lastVerb = "";
  const pattern = /라고\s+(말했다|밝혔다|전했다|덧붙였다|강조했다|보도했다|설명했다|언급했다)/g;

  return text.replace(pattern, (match, verb) => {
    let chosen = verb;
    if (chosen === "말했다" || chosen === lastVerb) {
      // Pick the next verb in rotation that isn't the same as the last one used.
      const startIdx = REPORTING_VERBS.indexOf(lastVerb);
      for (let i = 1; i <= REPORTING_VERBS.length; i++) {
        const candidate = REPORTING_VERBS[(startIdx + i + REPORTING_VERBS.length) % REPORTING_VERBS.length];
        if (candidate !== lastVerb) {
          chosen = candidate;
          break;
        }
      }
    }
    lastVerb = chosen;
    return `라고 ${chosen}`;
  });
}

/**
 * Strips zero padding from date components in translated text.
 * Example: '26. 09. 01일 -> '26. 9. 1일
 */
function removeZeroPaddingFromDates(text: string): string {
  return text.replace(/'(\d{2})\.\s*0?(\d{1,2})\.\s*0?(\d{1,2})일/g, "'$1. $2. $3일")
             .replace(/'(\d{2})\.\s*0?(\d{1,2})월/g, "'$1. $2월");
}

// Korean day-of-week tokens. Per [STRUCTURE RULES] #2: "Always omit the day
// of the week, even if it is mentioned in the source text." Strips the
// token and any immediately-surrounding parentheses/spaces/commas it was
// wrapped in, then collapses any resulting double space.
const DAY_OF_WEEK_PATTERN = /\s*[(（]?\s*(월|화|수|목|금|토|일)요일\s*[)）]?\s*,?\s*/g;

function removeDayOfWeek(paragraphs: string[]): string[] {
  return paragraphs.map((paragraph) =>
    paragraph.replace(DAY_OF_WEEK_PATTERN, " ").replace(/[ \t]{2,}/g, " ").trim()
  );
}

const TRANSITION_WORDS_LIST = ["또한", "이어", "나아가", "아울러", "더불어", "이와 관련", "한편", "다만", "그러나", "그리고", "그러면서", "이에", "이와 함께", "당시", "당일"];

/**
 * [WORD SUBSTITUTION RULES]: "Comma (,) → ㆍ"
 * Applied to body paragraphs ONLY (never the headline or metadata line,
 * which have their own fixed punctuation conventions) and NEVER to a comma
 * that is a thousands-separator inside a number, nor after transition words
 * (또한, 이어, 나아가, 아울러, 더불어, 이와 관련, 한편, 다만 등) or dates ('26. 9. 2일 등).
 */
function replaceListCommasWithDot(paragraphs: string[]): string[] {
  return paragraphs.map((paragraph) => {
    return paragraph.replace(/(?<!\d),(?!\d)/g, (match, offset, fullStr) => {
      const precedingStr = fullStr.substring(0, offset).trimEnd();
      // Do NOT convert comma to ㆍ if it follows a date (e.g. '26. 9. 2일, or 25일, or 9월 2일,)
      if (/('?\d{2}\.\s*\d{1,2}\.\s*\d{1,2}일|\d{1,2}월\s*\d{1,2}일|\d{1,2}일)$/.test(precedingStr)) {
        return ",";
      }
      // Do NOT convert comma to ㆍ if it follows a transition word or clause ending like 며
      const endsWithTransition = TRANSITION_WORDS_LIST.some(word => precedingStr.endsWith(word));
      if (endsWithTransition || /며$/.test(precedingStr)) {
        return ",";
      }
      return "ㆍ";
    });
  });
}

/**
 * [WORD SUBSTITUTION RULES]: "XX국 주Y대사 → YY 주재 XX국 대사"
 * e.g. "미국 주일대사" (a US ambassador, stationed in Japan) becomes
 * "일본 주재 미국 대사". This is a heuristic, not a full parser: it only
 * resolves the small set of common single-syllable country abbreviations
 * below. Any abbreviation not in this map is left as-is (safer than
 * guessing wrong) rather than silently mistranslating it.
 */
const COUNTRY_ABBREV_TO_FULL: Record<string, string> = {
  "한": "한국",
  "중": "중국",
  "일": "일본",
  "미": "미국",
  "러": "러시아",
  "영": "영국",
  "독": "독일",
  "프": "프랑스",
  "북": "북한",
  "인": "인도",
};

function processAmbassadorPhrasing(paragraphs: string[]): string[] {
  const pattern = /([가-힣]{2,6}국)\s*주\s*([가-힣]{1,3})\s*대사/g;
  return paragraphs.map((paragraph) =>
    paragraph.replace(pattern, (match, sourceCountry, hostAbbrev) => {
      const hostFull = COUNTRY_ABBREV_TO_FULL[hostAbbrev];
      if (!hostFull) return match; // Unknown abbreviation — leave untouched rather than guess.
      return `${hostFull} 주재 ${sourceCountry} 대사`;
    })
  );
}

/**
 * Programmatically fixes quotation sentence endings:
 * Converts incomplete nominal endings before closing quotes (e.g. 예정., 방침., 계획., 전망.) into complete sentences with '이다.'
 * Example: "서명할 예정."라고 밝혔다 -> "서명할 예정이다."라고 밝혔다
 */
function processQuotationSentences(paragraphs: string[]): string[] {
  const incompleteNominalPattern = /(예정|방침|계획|전망|목표|입장|방안|분석|판단|주장|전언)(\.|\s*\.)(?="\s*라고)/g;

  return paragraphs.map((paragraph) => {
    // 1. Fix noun ending to complete verb ending inside quotation marks
    let fixed = paragraph.replace(incompleteNominalPattern, "$1이다.");

    // 2. Ensure period precedes closing quote if omitted inside reporting quotes
    fixed = fixed.replace(/([^.\s])(?="\s*라고\s*(밝혔다|전했다|보도했다|덧붙였다|강조했다|설명했다|언급했다))/g, "$1.");

    return fixed;
  });
}

const QUOTE_TRIGGER_VERBS = "밝혔다|전했다|덧붙였다|강조했다|보도했다|설명했다|언급했다|말했다";

function enforceDirectQuotes(paragraphs: string[]): string[] {
  const pattern = new RegExp(
    `([^"\\n.!?]*?)(은|는)([^"\\n]*?)다고\\s*(${QUOTE_TRIGGER_VERBS})`,
    "g"
  );
  return paragraphs.map((paragraph) =>
    paragraph.replace(pattern, (match, prefix, particle, quoteContent, verb) => {
      const content = quoteContent.trim();
      if (!content) return match;
      return `${prefix}${particle} "${content}다."라고 ${verb}`;
    })
  );
}

// --- Helpers shared by the quote-fixing functions below ---

function hasFinalConsonant(char: string): boolean {
  const code = char.charCodeAt(0);
  if (code < 0xAC00 || code > 0xD7A3) return false;
  return (code - 0xAC00) % 28 !== 0;
}

const LEADING_SUBJECT_PATTERN = /^([가-힣]{1,10})(이|가)(?=\s|$)/;

const QUOTE_BLOCK_PATTERN = new RegExp(
  `"([^"]+)"(\\s*라고\\s*(?:${QUOTE_TRIGGER_VERBS}))`,
  "g"
);

// Indirect-speech-only verbs: these NEVER trigger a direct quote and must
// never appear inside quotation marks.
const INDIRECT_ONLY_VERBS = "인정했다|시인했다|시사했다|평가했다|지적했다|분석했다|판단했다";

/**
 * Safety net: splits a merged block where an indirect clause (인정했다 etc.)
 * got dragged inside a direct quote meant for a separate, later statement
 * attributed to a real reporting verb.
 * "...는 "...인정했다. 또한, 그는 "...무인기이 특별한 과제를...."라고 덧붙였다.
 *   -> "...는 ...인정했다. 또한, ...는 "우크라 무인기는 특별한 과제를...."라고 덧붙였다.
 */
function splitIndirectFromDirectQuote(paragraphs: string[]): string[] {
  const pattern = new RegExp(
    `([가-힣A-Za-z0-9]+)(은|는)?\\s*"([^"]*?다고\\s*(?:${INDIRECT_ONLY_VERBS}))\\.\\s*(?:또한,?\\s*)?(?:그는\\s*)?([^"]+)"\\s*라고\\s*(${QUOTE_TRIGGER_VERBS})`,
    "g"
  );
  return paragraphs.map((paragraph) =>
    paragraph.replace(pattern, (match, subject, _p, indirectClause, remainder, verb) => {
      const marker = hasFinalConsonant(subject[subject.length - 1]) ? "은" : "는";
      const remainderTrimmed = remainder.trim().replace(LEADING_SUBJECT_PATTERN, (m: string, noun: string) => {
        const m2 = hasFinalConsonant(noun[noun.length - 1]) ? "은" : "는";
        return `${noun}${m2}`;
      });
      return `${subject}${marker} ${indirectClause}. 또한, ${subject}${marker} "${remainderTrimmed}"라고 ${verb}`;
    })
  );
}

/**
 * Safety net for the "merge same-speaker remarks into one quote" rule: if
 * the model still produces two consecutive separate quote+verb pairs for
 * the SAME speaker, fold the second quote into the first as one continuous
 * quote joined by a formal connector, keeping only the final verb.
 * 철수 장관은 "A."라고 밝혔다. 철수 장관은 "B."라고 전했다.
 *   -> 철수 장관은 "A. 이어 B."라고 전했다.
 */
function mergeSameSpeakerQuotes(paragraphs: string[]): string[] {
  const pattern = new RegExp(
    `([가-힣]{2,10}(?:\\s[가-힣]{2,10})?)(은|는)\\s*"([^"]+)"\\s*라고\\s*(?:${QUOTE_TRIGGER_VERBS})\\.?\\s*\\1(은|는)\\s*"([^"]+)"\\s*라고\\s*(${QUOTE_TRIGGER_VERBS})`,
    "g"
  );
  return paragraphs.map((paragraph) =>
    paragraph.replace(pattern, (match, speaker, _m1, quoteA, m2, quoteB, verb) => {
      return `${speaker}${m2} "${quoteA.trim()} 이어 ${quoteB.trim()}"라고 ${verb}`;
    })
  );
}

/**
 * Inside every direct quote, the quote's own leading main-clause subject
 * must use 은/는, never 이/가 (embedded relative-clause subjects deeper in
 * the quote are untouched — only the first word of the quote is rewritten).
 * "러시아가 ...승리하고 있다." -> "러시아는 ...승리하고 있다."
 */
function enforceQuoteTopicMarker(paragraphs: string[]): string[] {
  return paragraphs.map((paragraph) =>
    paragraph.replace(QUOTE_BLOCK_PATTERN, (match, quoteContent, tail) => {
      const fixedContent = quoteContent.replace(LEADING_SUBJECT_PATTERN, (m: string, noun: string) => {
        const marker = hasFinalConsonant(noun[noun.length - 1]) ? "은" : "는";
        return `${noun}${marker}`;
      });
      return `"${fixedContent}"${tail}`;
    })
  );
}

/**
 * [CONNECTIVE RULES]: every sentence other than a paragraph's lead sentence
 * must open with one of the listed connectors, and the choice must not
 * repeat back-to-back. This is a safety net for when the model repeats the
 * same opener twice in a row — it rotates to the next connector instead.
 *
 * QUOTE-SAFETY: sentences are split on punctuation that occurs OUTSIDE any
 * quotation marks (using a "balanced quotes ahead" lookahead), so a period
 * inside a direct quote's content never causes a false sentence boundary,
 * and this function never rewrites text that is itself inside quotes.
 */
const CONNECTIVE_OPENERS = ["이와 관련", "나아가", "아울러", "또한", "이어", "더불어"];
const CONNECTIVE_OPENER_PATTERN = new RegExp(`^(${CONNECTIVE_OPENERS.join("|")})`);
const SENTENCE_SPLIT_OUTSIDE_QUOTES = /(?<=[.!?])\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/;

function normalizeConnectiveOpeners(paragraphs: string[]): string[] {
  let lastOpener = "";
  return paragraphs.map((paragraph) => {
    const sentences = paragraph.split(SENTENCE_SPLIT_OUTSIDE_QUOTES);
    const rewritten = sentences.map((sentence) => {
      const trimmed = sentence.trimStart();
      const match = trimmed.match(CONNECTIVE_OPENER_PATTERN);
      if (!match) {
        lastOpener = "";
        return sentence;
      }
      let opener = match[1];
      if (opener === lastOpener) {
        const startIdx = CONNECTIVE_OPENERS.indexOf(opener);
        for (let i = 1; i <= CONNECTIVE_OPENERS.length; i++) {
          const candidate = CONNECTIVE_OPENERS[(startIdx + i) % CONNECTIVE_OPENERS.length];
          if (candidate !== lastOpener) {
            opener = candidate;
            break;
          }
        }
        sentence = sentence.replace(match[1], opener);
      }
      lastOpener = opener;
      return sentence;
    });
    return rewritten.join(" ");
  });
}

/**
 * [NAMING RULES] #1 — Person naming:
 * 1st mention: 한국어 풀 이름(영어 풀 이름) 국적 직책
 * 2nd+ mention: 성(surname) only + 직책 — NOT the full name.
 *
 * FIX vs. previous version: the Korean-name capture group now allows up to
 * three space-separated Hangul words (e.g. "블라디미르 푸틴"), where the old
 * pattern only captured a single unspaced token immediately before "(" and
 * silently dropped any given name that preceded it. Surname is taken as the
 * LAST space-separated token of the captured full name.
 */
function processPersonNameRules(paragraphs: string[]): string[] {
  const personPattern = /(?<![가-힣])([가-힣]{2,10}(?:\s[가-힣]{2,10}){0,2})\(([A-Za-z][A-Za-z.\-\s]{1,40})\)\s+([가-힣]{2,8})\s+([가-힣]{2,12})/g;

  interface PersonInfo {
    fullKrName: string;
    surname: string;
    enName: string;
    nationality: string;
    title: string;
  }

  const seenPersons = new Map<string, PersonInfo>();

  // Pass 1: Replace parenthetical occurrences. First occurrence is retained as full format; second and subsequent occurrences are converted to surname + title.
  let updatedParagraphs = paragraphs.map((paragraph) => {
    return paragraph.replace(personPattern, (match, krName, enName, nationality, title) => {
      const trimmedKrName = krName.trim();
      const trimmedEnName = enName.trim();
      const trimmedNationality = nationality.trim();
      const trimmedTitle = title.trim();

      const uniqueKey = `${trimmedKrName}_${trimmedEnName}`;
      const nameTokens = trimmedKrName.split(/\s+/);
      const surname = nameTokens[nameTokens.length - 1];

      if (!seenPersons.has(uniqueKey)) {
        seenPersons.set(uniqueKey, {
          fullKrName: trimmedKrName,
          surname,
          enName: trimmedEnName,
          nationality: trimmedNationality,
          title: trimmedTitle,
        });
        return `${trimmedKrName}(${trimmedEnName}) ${trimmedNationality} ${trimmedTitle}`;
      } else {
        return `${surname} ${trimmedTitle}`;
      }
    });
  });

  // Pass 2: If model outputs subsequent mentions as "조 바이든 미국 대통령" or "조 바이든 대통령" (without parenthetical English name), convert them to "바이든 대통령".
  seenPersons.forEach(({ fullKrName, surname, nationality, title }) => {
    if (fullKrName !== surname) {
      updatedParagraphs = updatedParagraphs.map((paragraph) => {
        const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const patternWithNat = new RegExp(`(?<![가-힣])${escapeRegExp(fullKrName)}\\s+(?:${escapeRegExp(nationality)}\\s+)?${escapeRegExp(title)}`, 'g');

        return paragraph.replace(patternWithNat, () => `${surname} ${title}`);
      });
    }
  });

  return updatedParagraphs;
}

/**
 * [NAMING RULES] #3 — Company naming:
 * 1st mention: 국적 회사설명 한국어 이름(영어 이름) (e.g., 미국 언론사 블룸버그 통신(Bloomberg))
 * 2nd+ mention: 한국어 이름 ONLY — nationality and company-type descriptor are
 * dropped on repeat mentions (previously they were incorrectly kept).
 */
function processCompanyNameRules(paragraphs: string[]): string[] {
  const companyPattern = /(?<![가-힣])([가-힣]{2,6})\s+([가-힣]{2,8})\s+([가-힣]{2,12})\(([A-Za-z0-9][A-Za-z0-9\s.,&'\-]{1,50})\)/g;
  const seenCompanies = new Set<string>();

  return paragraphs.map((paragraph) => {
    return paragraph.replace(companyPattern, (match, nationality, desc, krName, enName) => {
      const trimmedNat = nationality.trim();
      const trimmedDesc = desc.trim();
      const trimmedKrName = krName.trim();
      const trimmedEnName = enName.trim();

      const uniqueKey = `${trimmedKrName}_${trimmedEnName}`;

      if (!seenCompanies.has(uniqueKey)) {
        seenCompanies.add(uniqueKey);
        return `${trimmedNat} ${trimmedDesc} ${trimmedKrName}(${trimmedEnName})`;
      } else {
        return trimmedKrName;
      }
    });
  });
}

/**
 * [NAMING RULES] #2 — Generic (ad-hoc) organization naming, for
 * organizations NOT already covered by FIRST_MENTION_GLOSSARY:
 * 1st mention: 한국어 이름(영문 약칭, 영문 전체 이름)
 * 2nd+ mention: 영문 약칭 ONLY.
 * Pattern requires an ALL-CAPS acronym followed by a comma and a longer
 * English expansion inside the parentheses, distinguishing it from the
 * person pattern (single English full name, no comma) and the company
 * pattern (nationality + descriptor prefix).
 */
function processOrganizationNameRules(paragraphs: string[]): string[] {
  const orgPattern = /(?<![가-힣])([가-힣]{2,20})\(([A-Z]{2,10}),\s*([A-Za-z][A-Za-z0-9\s.,&'\-]{2,80})\)/g;
  const seenOrgs = new Set<string>();

  return paragraphs.map((paragraph) => {
    return paragraph.replace(orgPattern, (match, krName, acronym, fullEn) => {
      const trimmedKrName = krName.trim();
      const trimmedAcronym = acronym.trim();
      const trimmedFullEn = fullEn.trim();

      const uniqueKey = `${trimmedKrName}_${trimmedAcronym}`;

      if (!seenOrgs.has(uniqueKey)) {
        seenOrgs.add(uniqueKey);
        return `${trimmedKrName}(${trimmedAcronym}, ${trimmedFullEn})`;
      } else {
        return trimmedAcronym;
      }
    });
  });
}

/**
 * Programmatically enforces City Naming Rules across paragraphs:
 * 1st Mention (Capital): 나라 수도 한국어 이름(영어 이름)+행정구역단위 (e.g., 미국 수도 워싱턴(Washington) D.C.)
 * 1st Mention (Non-Capital): 나라 한국어 이름(영어 이름)+행정구역단위 (e.g., 미국 캘리포니아(California)州)
 * 2nd+ Mention: 나라 한국어 이름+행정구역단위
 * Division suffix accepts both the Hangul forms (주/성/현/시/마을) required by
 * the current style guide and the legacy Hanja forms (市/州/區) for
 * backward compatibility with older content.
 */
function processCityNameRules(paragraphs: string[]): string[] {
  const cityPattern = /(?<![가-힣])([가-힣]{2,6})\s+(수도\s+)?([가-힣]{2,10})\(([A-Za-z0-9][A-Za-z0-9\s.,&'\-]{1,40})\)((?:주|성|현|시|마을|市|州|區)?(?:\s?[A-Za-z.]{1,4})?)/g;
  const seenCities = new Set<string>();
 
  return paragraphs.map((paragraph) => {
    return paragraph.replace(cityPattern, (match, country, isCapital, krCity, enCity, division) => {
      const trimmedCountry = country.trim();
      const capitalPrefix = isCapital ? "수도 " : "";
      const trimmedKrCity = krCity.trim();
      const trimmedEnCity = enCity.trim();
      const trimmedDivision = (division || "").trim();
 
      const uniqueKey = `${trimmedCountry}_${trimmedKrCity}_${trimmedEnCity}`;
 
      if (!seenCities.has(uniqueKey)) {
        seenCities.add(uniqueKey);
        return `${trimmedCountry} ${capitalPrefix}${trimmedKrCity}(${trimmedEnCity})${trimmedDivision}`;
      } else {
        return `${trimmedCountry} ${trimmedKrCity}${trimmedDivision}`;
      }
    });
  });
}
// Capital cities commonly used metonymically in English wire copy to mean
// "that country's government/authorities" rather than the literal city
// (e.g. "Beijing has ramped up pressure...", "Washington announced...").
// Mapped to the nation whose government they stand in for.
const CAPITAL_METONYM_MAP: Record<string, string> = {
  "베이징": "중국",
  "워싱턴": "미국",
  "런던": "영국",
  "도쿄": "일본",
  "모스크바": "러시아",
  "평양": "북한",
  "서울": "한국",
  "테헤란": "이란",
  "파리": "프랑스",
  "베를린": "독일",
  "카이로": "이집트",
  "뉴델리": "인도",
};
 
/**
 * Rewrites a metonymic capital-city subject (e.g. "중국 수도 베이징(Beijing)는
 * ...", from "Beijing has ramped up military pressure...") as "중국 당국는
 * ..." instead of the literal city-naming expansion, since the source is
 * referring to the government, not the place.
 *
 * HEURISTIC, not a parser: it only fires when the capital-city name is
 * immediately followed by a topic/subject particle (은/는) — the marker of
 * a sentence's grammatical subject/topic — which is the telltale sign of
 * metonymic "the government" usage. Literal locative usage ("베이징에서
 * 열린 회담", "베이징을 방문했다") keeps a different particle (에서/을/에/으로)
 * and is left untouched. Handles both the first-mention expanded form
 * (국가 수도 도시(영문)) and the bare repeat-mention form (국가 도시) that
 * processCityNameRules would otherwise have produced.
 */
function resolveCapitalMetonyms(paragraphs: string[]): string[] {
  return paragraphs.map((paragraph) => {
    let fixed = paragraph;
    for (const [city, nation] of Object.entries(CAPITAL_METONYM_MAP)) {
      // First-mention expanded form: "국가 수도 도시(영문)[단위]?"
      const expandedPattern = new RegExp(
        `${nation}\\s*수도\\s*${city}\\([A-Za-z][A-Za-z0-9\\s.,&'\\-]*\\)(?:주|성|현|시|마을|市|州|區)?\\s*(은|는)`,
        "g"
      );
      fixed = fixed.replace(expandedPattern, `${nation} 당국$1`);
 
      // Bare repeat-mention form: "국가 도시[단위]?"
      const barePattern = new RegExp(
        `(?<![가-힣])${nation}\\s*${city}(?:주|성|현|시|마을|市|州|區)?\\s*(은|는)`,
        "g"
      );
      fixed = fixed.replace(barePattern, `${nation} 당국$1`);
    }
    return fixed;
  });
}
/**
 * Programmatically enforces Anonymous Source / Official Naming Rules across paragraphs:
 * 1st Mention: ~topic에 능통한 소식통 #개/명/곳 (e.g., 대북 정책에 능통한 소식통 2명)
 * 2nd+ Mention: 소식통 #개/명/곳 (e.g., 소식통 2명)
 */
function processAnonymousSourceRules(paragraphs: string[]): string[] {
  const sourcePattern = /([가-힣a-zA-Z0-9\s]{2,30}에\s+능통한)\s+(소식통|관계자)\s+(\d+|[한두세네몇])\s*(개|명|곳|인)/g;
  const seenSources = new Set<string>();

  return paragraphs.map((paragraph) => {
    return paragraph.replace(sourcePattern, (match, topicPrefix, sourceType, count, classifier) => {
      const trimmedTopic = topicPrefix.trim();
      const trimmedType = sourceType.trim();
      const trimmedCount = count.trim();
      const trimmedClassifier = classifier.trim();

      const uniqueKey = `${trimmedTopic}_${trimmedType}_${trimmedCount}${trimmedClassifier}`;

      if (!seenSources.has(uniqueKey)) {
        seenSources.add(uniqueKey);
        return `${trimmedTopic} ${trimmedType} ${trimmedCount}${trimmedClassifier}`;
      } else {
        return `${trimmedType} ${trimmedCount}${trimmedClassifier}`;
      }
    });
  });
}

/**
 * Applies a list of [pattern, replacement] substitutions to `text`, protecting
 * every match behind a placeholder token the instant it's produced.
 *
 * IMPORTANT: rules are applied sequentially, and an earlier rule's inserted
 * text can accidentally satisfy a *later* rule's pattern (e.g. expanding
 * "UN안전보장이사회" inserts a bare "UN" inside its own parenthetical gloss,
 * which a later generic "UN" rule would then re-match and corrupt).
 * Reordering rules only fixes specific known collisions, not the general
 * problem — placeholder protection prevents ALL such cross-contamination
 * regardless of rule order. Placeholders are restored once every rule in
 * the list has run.
 *
 * `pickReplacement(pattern, defaultReplacement, occurrenceIndex)` lets
 * callers vary the replacement by occurrence (used for first-mention-only
 * glossing below); it defaults to always using `defaultReplacement`.
 */
function applySubstitutionList<T extends [RegExp, string, ...any[]]>(
  text: string,
  list: T[],
  pickReplacement?: (entry: T, occurrenceIndex: number) => string
): string {
  let cleaned = text;
  const placeholders: string[] = [];

  for (const entry of list) {
    const [pattern, defaultReplacement] = entry;
    let occurrenceIndex = 0;
    cleaned = cleaned.replace(pattern, (...args) => {
      const match = args[0] as string;
      const replacement = pickReplacement ? pickReplacement(entry, occurrenceIndex) : defaultReplacement;
      occurrenceIndex++;
      // Resolve $1/$2-style backreferences against this specific match only.
      const singlePattern = new RegExp(pattern.source, pattern.flags.replace('g', ''));
      const substituted = match.replace(singlePattern, replacement);
      const token = `\u0000${placeholders.length}\u0000`;
      placeholders.push(substituted);
      return token;
    });
  }

  // Restore protected substitutions now that no more rules will run.
  return cleaned.replace(/\u0000(\d+)\u0000/g, (_, i) => placeholders[Number(i)]);
}

function removeMiddleDotAfterDatesAndTransitions(text: string): string {
  if (!text) return "";
  // 1. Convert ㆍ after dates (e.g. '26. 5. 25일ㆍ, 25일ㆍ, 5월 2일ㆍ) to comma ,
  let cleaned = text.replace(/('?\d{2}\.\s*\d{1,2}\.\s*\d{1,2}일|\d{1,2}월\s*\d{1,2}일|\d{1,2}일)\s*ㆍ/g, "$1,");

  // 2. Convert ㆍ after transition words/connectors (e.g., 또한ㆍ, 이어ㆍ, 한편ㆍ, 다만ㆍ) to comma ,
  const transitionWords = ["또한", "이어", "나아가", "아울러", "더불어", "이와 관련", "한편", "다만", "그러나", "그리고", "그러면서", "이에", "이와 함께", "당시", "당일"];
  const transitionRegex = new RegExp(`(?<=^|\\s)(${transitionWords.join("|")})\\s*ㆍ`, "g");
  cleaned = cleaned.replace(transitionRegex, "$1,");

  // 3. Convert ㆍ after ~며 (e.g., 했으며ㆍ) to comma ,
  cleaned = cleaned.replace(/([가-힣]+며)\s*ㆍ/g, "$1,");

  return cleaned;
}

/**
 * Clean up translated text using local deterministic rules.
 */
function applyCodeRules(text: string): string {
  let cleaned = text;

  // Always-on style/word substitutions.
  cleaned = applySubstitutionList(cleaned, STYLE_SUBSTITUTIONS);

  // First-mention-only glosses: gloss the 1st occurrence of each term,
  // fall back to the bare term (or an explicit short form) after that —
  // same "1st vs 2nd+ mention" convention already used for names/companies/
  // cities/sources elsewhere in this file.
  cleaned = applySubstitutionList(
    cleaned,
    FIRST_MENTION_GLOSSARY,
    (entry, occurrenceIndex) => {
      const [, firstMentionReplacement, repeatMentionReplacement] = entry;
      if (occurrenceIndex === 0) return firstMentionReplacement;
      // No explicit repeat form given => leave the matched text unchanged.
      return repeatMentionReplacement ?? "$&";
    }
  );

  // Replace banned verb "라고 말했다" and rotate reporting verbs for variety
  cleaned = normalizeReportingVerbs(cleaned);

  // Strip zero padding from month/day numbers
  cleaned = removeZeroPaddingFromDates(cleaned);

  // Remove any middle dots that erroneously follow dates or transition words
  cleaned = removeMiddleDotAfterDatesAndTransitions(cleaned);

  // Strict enforcement: Strip any semicolons ';' from final output
  cleaned = cleaned.replace(/;/g, "");

  return cleaned;
}

/**
 * Format headline strictly:
 * - Plain (non-quoted) headline: starting period, comma separator, ~다 style intact.
 * - Quoted headline (reports a speaker's own words): main point is rewritten
 *   to a non-final connective ending (해/않아/이라, never ~다.) and wrapped
 *   in quotation marks, per house style — never a closed ~다. sentence.
 * Mandatory Hanja replacements (美/中/韩/日/北) always applied last.
 */
function formatHeadline(subject: string, mainPoint: string, isQuoted: boolean = false): string {
  let point = mainPoint.trim().replace(/\.$/, "");

  if (isQuoted) {
    for (const [pattern, replacement] of HEADLINE_NON_FINAL_ENDINGS) {
      if (pattern.test(point)) {
        point = point.replace(pattern, replacement);
        break;
      }
    }
    if (!point.startsWith('"')) point = `"${point}"`;
  }

  let formattedHeadline = `. ${subject}, ${point}`;

  // Longer country names ("대한민국") must be checked before the shorter
  // ones they could otherwise be partially clobbered by; the object above
  // is already ordered longest-first for this reason — do not reorder it.
  Object.entries(HEADLINE_HANJA_MAP).forEach(([kr, hanja]) => {
    formattedHeadline = formattedHeadline.replace(new RegExp(kr, 'g'), hanja);
  });

  return formattedHeadline;
}

/**
 * Programmatically constructs the Metadata string with single-digit month/day (NO ZERO PADDING):
 * Format: [ Nation. SourceName. M. D. HH:MM(M. D. HH:MM in KST) ]
 * NOTE: `nation` is a free-form string, so callers may pass a composite
 * value such as "한국(우크라)" (reporting nation + topic-country qualifier,
 * per [HEADER FORMAT RULES] example "[ 한국(우크라). 블룸버그. ... ]") and it
 * will be inserted verbatim — no special-casing needed here.
 */
const NATION_KST_OFFSET_OVERRIDES: Record<string, number> = {
  "영국": 8,
};
function formatMetadata(
  nation: string,
  sourceName: string,
  isoTimeStr: string,
  utcOffsetHours: number = 0
): string {
  if (!isoTimeStr) {
    const now = new Date();
    const mm = String(now.getMonth() + 1);
    const dd = String(now.getDate());
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    return `[ ${nation}. ${sourceName}. ${mm}. ${dd}. ${hh}:${min}(${mm}. ${dd}. ${hh}:${min}) ]`;
  }

  const localDate = new Date(isoTimeStr);
  if (isNaN(localDate.getTime())) {
    return `[ ${nation}. ${sourceName}. ${isoTimeStr} ]`;
  }

  const localMM = String(localDate.getMonth() + 1);
  const localDD = String(localDate.getDate());
  const localHH = String(localDate.getHours()).padStart(2, '0');
  const localMin = String(localDate.getMinutes()).padStart(2, '0');

  const kstAddHours = NATION_KST_OFFSET_OVERRIDES[nation] ?? 9;
  const utcTimestamp = localDate.getTime() - (utcOffsetHours * 3600 * 1000);
  const kstDate = new Date(utcTimestamp + (kstAddHours * 3600 * 1000));
  const kstMM = String(kstDate.getMonth() + 1);
  const kstDD = String(kstDate.getDate());
  const kstHH = String(kstDate.getHours()).padStart(2, '0');
  const kstMin = String(kstDate.getMinutes()).padStart(2, '0');

  return `[ ${nation}. ${sourceName}. ${localMM}. ${localDD}. ${localHH}:${localMin}(${kstMM}. ${kstDD}. ${kstHH}:${kstMin}) ]`;
}

// ---------------------------------------------------------------------------
// 2. SCHEMAS AND SYSTEM INSTRUCTIONS
// ---------------------------------------------------------------------------

const translationOutputSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    headlineSubject: {
      type: Type.STRING,
      description: "Headline subject/organization in Korean without articles (e.g., '미국 국방부')",
    },
    headlineMainPoint: {
      type: Type.STRING,
      description: "Headline main action/decision in Korean",
    },
    headlineIsQuoted: {
      type: Type.BOOLEAN,
      description: "True if headlineMainPoint directly quotes the speaker's words. Must then use a non-final verb ending (e.g. 않아, not 않는다) and be wrapped in quotation marks — never a full ~다. sentence.",
    },
    eventTimeIso: {
      type: Type.STRING,
      description: "ISO-8601 timestamp (YYYY-MM-DDTHH:mm:ss) of the reported news event in local time",
    },
    bodyParagraphs: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Translated news content split by paragraphs",
    },
  },
  required: ["headlineSubject", "headlineMainPoint", "bodyParagraphs"],
};

// NOTE: this was previously a lossy condensation of the full style guide
// ("뚝딱" rules). It has since been reconciled line-by-line against the full
// [STRUCTURE RULES] / [QUOTATION RULES] / [CONNECTIVE RULES] /
// [WORD SUBSTITUTION RULES] / [NAMING RULES] / [NUMBERS AND TIME RULES] /
// [HEADER FORMAT RULES] style guide, in the same condensed style as the
// rest of this block.
const CONDENSED_SYSTEM_INSTRUCTIONS = `
You are an expert Yonhap News diplomatic/military translator converting English news to official Korean news agency format.

### CRITICAL TARGET LANGUAGE MANDATE
- The target output language MUST ALWAYS BE IN KOREAN (한국어). Never output Russian (Русский), English, or any other language in any part of the translation.

### GOOGLE SEARCH GROUNDING FOR PERSON NAMES
- You MUST use Google Search to look up and verify the official standard Korean name spelling and full English name for every person mentioned in the source text.
- Do not guess or output phonetic approximations if a standard Korean news translation exists.

### ABSOLUTE SOURCE ATTRIBUTION CONSTRAINTS
- DO NOT insert lead-ins, source attribution tags, or news agency prefixes (e.g., "영국 언론사 로이터 통신은...", "로이터 통신에 따르면...") at the beginning of body paragraphs unless explicitly stated in the source text.
- Metadata (Nation/Source) is handled programmatically outside your body translation. Focus solely on translating the provided source content.

### SENTENCE STRUCTURE ORDER
- Whenever the corresponding elements exist in the source, order each sentence as: 시간(Time) → 주체(Subject) → 장소(Location) → 수단(Means) → 서술어(Predicate).
- If an element (time, location, means) is not present in the source, omit it entirely. Never infer or invent it.
- Sentences must be grammatically complete — no fragments.
- Use short, clear particles — do not stack or over-elaborate particles where a single simple one is grammatically sufficient.

### ACTIVE VOICE REQUIREMENT
- Write every sentence in active voice with an explicit, concrete actor (a government, official, organization, etc.) as the grammatical subject — never an abstract noun like "사항" or "문제" acting as the subject.
- The subject must be explicitly performing the action of striving for or achieving the stated result — do not let the result appear to happen on its own.
- Avoid passive endings such as "-된다"/"-되었다" unless there is truly no way to express the sentence otherwise.

### SENTENCE SPLITTING
- If the source sentence has multiple clauses or is excessively long, split it into two or more shorter Korean sentences.
- Each resulting sentence must stay grammatically complete and keep the formal register.
- The first sentence should carry the main action/decision; the following sentence(s) should carry background, reason, or result.
- Link split sentences with formal connectors such as "하나", "이에", "또한", "한편" — never colloquial connectors like "그리고" or "하지만".

### CONNECTIVE OPENERS (MANDATORY)
- Every sentence other than a paragraph's lead/opening sentence MUST begin with one of: "이와 관련", "나아가", "아울러", "또한", "이어", "더불어". This is not optional where a non-lead sentence exists.
- Vary which connector you use — never repeat the same one on two consecutive sentences.
- Use "한편" specifically to introduce background or contextual information that shifts away from the main narrative thread, to clearly separate it from the preceding section.

### FORECAST / PLAN VERB SELECTION
- When expressing possibility or an upcoming action, choose based on the nuance in the source:
  - "전망이다" — an expected outcome or forecast (not yet decided by any actor).
  - "방침이다" — a formal policy decision or direction that has been set.
  - "예정이다" — a definite, scheduled plan or event.
  - "계획이다" — an intended course of action that may still be provisional.

### PERSON NAMING CONVENTIONS
1. FIRST MENTION OF ANY PERSON: [한국어 풀 이름]([영어 풀 이름]) [국적] [직책]
   - You MUST use Google Search to verify the accurate Korean and English names.
   - Example: 조 바이든(Joe Biden) 미국 대통령
   - Example: 키어 스타머(Keir Starmer) 영국 총리
   - Example: 앤터니 블링컨(Antony Blinken) 미국 국무장관
2. SECOND AND SUBSEQUENT MENTIONS: [성(surname)만] [직책] — do NOT repeat the full given name + surname, English name, or nationality.
   - Example: 바이든 대통령 (not "조 바이든 대통령", not "조 바이든 미국 대통령")
   - Example: 스타머 총리 (not "키어 스타머 총리")
   - Example: 블링컨 국무장관 (not "앤터니 블링컨 국무장관")

### COMPANY NAMING CONVENTIONS
1. FIRST MENTION OF ANY COMPANY (When present in source text): [국적] [회사 설명] [한국어 이름]([영어 이름])
   Example: 미국 언론사 블룸버그 통신(Bloomberg)
2. SECOND AND SUBSEQUENT MENTIONS OF A COMPANY: [한국어 이름] ONLY — drop the nationality and company-type descriptor.
   Example: 블룸버그 통신 (not "미국 언론사 블룸버그 통신")

### ORGANIZATION NAMING CONVENTIONS
1. FIRST MENTION OF AN INTERNATIONAL ORGANIZATION (UN, EU, NATO-type bodies): [한국어 이름]([영문 약칭], [영문 전체 이름])
2. SECOND AND SUBSEQUENT MENTIONS OF AN ORGANIZATION: use the [영문 약칭] alone (e.g., UN, EU) — do not repeat the Korean full name.

### CITY / LOCATION NAMING CONVENTIONS
1. FIRST MENTION OF A CAPITAL CITY: [나라] 수도 [한국어 이름]([영어 이름])[행정구역 단위(주/성/현/시/마을 등)]
   Example: 미국 수도 워싱턴(Washington)시
2. FIRST MENTION OF A NON-CAPITAL CITY/STATE: [나라] [한국어 이름]([영어 이름])[행정구역 단위]
   Example: 미국 캘리포니아(California)주
3. SECOND AND SUBSEQUENT MENTIONS: [나라] [한국어 이름][행정구역 단위]
4. Full location strings, when a place is described in detail rather than just named, follow: 국가 + 국가 내 상대적 위치 + 행정구역(영문병기)주/성/현 + 도시명(영문병기)시 + 마을명(영문병기)마을. Never invent a location element that isn't in the source.
5. METONYM EXCEPTION: when a capital city name is used as shorthand for "that country's government" rather than as a literal place — i.e. it is the grammatical subject performing a political/diplomatic/military action (ramped up pressure, announced, warned, rejected, imposed sanctions, etc.) rather than a location something happened "in" or "at" — do NOT use the city-naming convention at all. Translate it as [나라] 당국 instead.
   WRONG: 중국 수도 베이징(Beijing)은 군사·정치적 압박을 강화해왔다.
   RIGHT: 중국 당국은 군사·정치적 압박을 강화해왔다.
   The city-naming convention (rule 1 above) still applies when the same capital is used literally (e.g. "a summit was held in Beijing" -> 베이징에서 정상회담이 열렸다).

### ANONYMOUS SOURCE / OFFICIAL NAMING CONVENTIONS
1. FIRST MENTION: [관련 주제]에 능통한 [소식통/관계자] [수량][단위(개/명/곳/등)]
   Example: 대북 정책에 능통한 소식통 2명
2. SECOND AND SUBSEQUENT MENTIONS: [소식통/관계자] [수량][단위]
   Example: 소식통 2명

### DIPLOMATIC TITLE RULE
- "XX국 주Y대사" (an ambassador FROM country XX, stationed IN country Y) must be rewritten as "Y 주재 XX국 대사" (e.g., "미국 주일대사" -> "일본 주재 미국 대사").

### MANDATORY QUOTATION AND ATTRIBUTION RULES
1. CONVERT EVERY REPORTED STATEMENT INTO A DIRECT QUOTE. Never paraphrase or summarize what a speaker said — if the source
   attributes words, opinions, or claims to a named speaker, render the FULL content as a direct quotation. Indirect/reported
   speech (bare "-다고 밝혔다" with no quotation marks) is NEVER acceptable.
2. STANDARD FORMAT: [발화주체](영문표기병기) [직책]은/는 "[내용]."이라고 밝혔다/전했다/덧붙였다/언급했다/강조했다.
   Example: 앤터니 블링컨(Antony Blinken) 미국 국무장관은 "협상은 계속될 것이다."라고 밝혔다.
3. AFTER FIRST MENTION: drop the English parenthetical AND use surname only — "블링컨 국무장관은 "...".라고 전했다."
4. VERB ROTATION: use ONLY 밝혔다/전했다/덧붙였다/언급했다/강조했다. NEVER use 라고 말했다. Alternate the verb every time —
   never repeat the same reporting verb twice in a row anywhere in the piece.
5. INTERVIEW FORMAT: [발화주체](영문표기병기, 최초 언급 시만) [직책]은/는 [매체명]와의 인터뷰를 통해 "[내용]."이라고 밝혔다/전했다/덧붙였다/언급했다/강조했다.
   Drop the English parenthetical and use surname only after first mention, same as rule 3.
6. MERGE MULTIPLE REMARKS: if the same speaker makes more than one related remark in the source (even across sentences),
   combine them into ONE continuous direct quote inside a SINGLE pair of quotation marks, joined internally with formal
   connectors such as "이어", "또한", "덧붙여". Do not split one speaker's related remarks into separate quote+verb pairs
   unless the source clearly marks them as separate, distinct statements made at different times.
7. LOCATION/TIME CONTEXT: if the source states where or when the remark was made, insert that contextual phrase
   immediately BEFORE the quotation mark opens (not after), e.g.:
   ...국무장관은 [장소/시점]에서 열린 기자회견에서 "...".라고 밝혔다.
   Do not invent a location/time that is not in the source.
8. QUOTE CONTENT ITSELF must be concise, formal Korean, a complete grammatical sentence ending in a full verb/copula
   (e.g., "예정이다.", never "예정."), with exactly ONE explicit main-clause subject marked 은/는. The period goes
   BEFORE the closing quote mark (."라고).

### HEADLINE QUOTE RULE
- If the headline reports what a person said, phrase the headline main point as a non-final connective clause
  (해/않아/이라, never a closed ~다. sentence) and wrap it in quotation marks.
  Example: 미국 대통령, "경제 성장을 이끌고 일자리를 창출해야"

### DATE & TIME STRUCTURAL SCHEMES (NO ZERO PADDING)
- DO NOT ADD 0 TO SINGLE-DIGIT MONTHS OR DAYS (e.g., '26. 9. 1일, NEVER '26. 09. 01일).
- Relative/ambiguous dates MUST include the numeric year prefix ("late July" -> '26. 7월 말; "mid-August" -> '26. 8월 중순).
- When a specific clock time is given, use: 'YY. M. D일 HH:MM경(역주: [Nation] 현지시각).
- ALWAYS omit the day of the week, even if the source explicitly states it (e.g. "Tuesday", "화요일") — do not translate or retain it anywhere.
- Structures: Year only 'YY년 · Month only 'YY. M월 · Date 'YY. M. D일 · Specific time 'YY. M. D일 HH:MM경(역주: [Nation] 현지시각).

### NUMBERS AND CURRENCY
- Order: Name + number + unit. Use comma separators for thousands (e.g., 1,000) — these thousands-separator commas are the ONE exception to the comma→ㆍ rule below and must remain literal commas.
- Never use relative phrasing like "n years ago" — always give the absolute year.
- When a currency amount appears, give both the original figure and an approximate KRW equivalent in parentheses with "역주:" (e.g., USD 1,000(역주: 한화 약 1,400,000원)).

### HEADLINE HANJA RULE
- Whenever US (미국), China (중국), South Korea (한국/대한민국), Japan (일본), or North Korea (북한) appear in the headline, convert them into Hanja (美, 中, 韩, 日, 北).

### HEADER FORMAT
- Format: [ 국가. 매체. M. D. HH:MM(M. D. HH:MM) ] — the second time in parentheses is Korean Standard Time.
- The nation field may itself carry a parenthetical qualifier when relevant (e.g. "한국(우크라)" for a Korea-desk report about Ukraine) — pass it through exactly as given, do not strip it.

### ABSOLUTE FORMATTING CONSTRAINTS
- PROHIBITION OF SEMICOLONS: STRICTLY FORBIDDEN from using semicolons (;).
- Prefer 은/는 over 이/가 and 및 over 와/과 where it reads more like an official document, without breaking grammatical correctness.
- Prefer "ㆍ" over a literal comma (,) when separating list items in running text — EXCEPT thousands-separator commas inside numbers (e.g. "1,000"), which must stay literal commas.
- ABSOLUTE INFORMATION INTEGRITY: Translate ONLY content present in source text. No added lead-ins.
`;

const correctionAnalysisSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    terminology: {
      type: Type.OBJECT,
      description: "Key-value pair of English term to Korean term mapping",
    },
    transformationRules: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "List of specific transformation rules learned",
    },
  },
  required: ["terminology", "transformationRules"],
};

// ---------------------------------------------------------------------------
// 3. MAIN TRANSLATION & PATTERN FUNCTIONS
// ---------------------------------------------------------------------------

async function getEnglishLearnedPatterns(): Promise<string> {
  try {
    const patterns = await fetchAllEnglishLearnedPatterns();
    if (patterns.length === 0) return "";

    let patternInstructions = "\n### LEARNED TRANSLATION PATTERNS:\n";
    patterns.forEach((p, idx) => {
      patternInstructions += `[Pattern #${idx + 1}]\nSource: "${p.englishText}" -> Target: "${p.koreanText}"\n`;
      if (p.terminology && Object.keys(p.terminology).length > 0) {
        patternInstructions += `Terms: ${JSON.stringify(p.terminology)}\n`;
      }
      if (p.transformationRules && p.transformationRules.length > 0) {
        patternInstructions += `Rules: ${p.transformationRules.join(", ")}\n`;
      }
    });

    return patternInstructions;
  } catch (error) {
    console.error("Error fetching english learned patterns:", error);
    return "";
  }
}

export async function translateEnglishNews(
  text: string,
  section: EnglishTranslationSection,
  sourceName: string = "Reuters",
  publisherName: string = "",
  nation: string = "영국",
  utcOffsetHours: number = 0
): Promise<string> {
  const learnedPatterns = await getEnglishLearnedPatterns();

  const prompt = `
TASK:
1. Translate English news into Korean news style. OUTPUT TARGET LANGUAGE MUST ALWAYS BE KOREAN (한국어). Never output Russian or any other language.
1b. HEADLINE QUOTE RULE: if headlineMainPoint reports what a person said, set headlineIsQuoted=true and phrase it as a non-final clause (해/않아/이라, never 다.) — quotes and ending are applied in code. Example: 미국 대통령, "경제 성장을 이끌고 일자리를 창출해야"
2. ABSOLUTE RULE: DO NOT add "${nation} ${sourceName}" or lead-in phrases like "${sourceName}은" at the start of the body text if it is NOT present in the source text below.
3. SENTENCE ORDER: Time → Subject → Location → Means → Predicate, omitting any element not present in the source. Never infer missing elements. Use short, clear particles.
4. ACTIVE VOICE: every sentence needs an explicit actor as its subject, explicitly performing the action of achieving the result; avoid "-된다"/"-되었다" passive constructions unless unavoidable.
5. If a source sentence is long or multi-clause, split it into 2+ Korean sentences linked with formal connectors ("하나", "이에", "또한", "한편") — never "그리고"/"하지만".
6. EVERY sentence other than a paragraph's lead sentence MUST open with a connector from: 이와 관련 / 나아가 / 아울러 / 또한 / 이어 / 더불어 — never repeating the same one twice in a row. Use 한편 specifically for background shifts.
7. Choose 전망이다(forecast) / 방침이다(policy decision) / 예정이다(scheduled) / 계획이다(intended plan) based on the nuance of the source, not interchangeably.
8. PERSON STRUCTURE RULES (MANDATORY USE OF GOOGLE SEARCH):
   - You MUST use Google Search to verify the official Korean spelling and full English name for every person.
   - 1st mention: 한국어 풀 이름(영어 풀 이름) 국적 직책 (e.g., 조 바이든(Joe Biden) 미국 대통령, 키어 스타머(Keir Starmer) 영국 총리, 앤터니 블링컨(Antony Blinken) 미국 국무장관)
   - 2nd+ mentions: 성(surname)만 + 직책 (e.g., 바이든 대통령, 스타머 총리, 블링컨 국무장관 — NOT the full name + surname or nationality)
9. COMPANY STRUCTURE RULES (only if present in source text):
   - 1st mention: 국적 회사 설명 한국어 이름(영어 이름) (e.g., 미국 언론사 블룸버그 통신(Bloomberg))
   - 2nd+ mentions: 한국어 이름 ONLY (e.g., 블룸버그 통신 — drop nationality and description)
   - For international organizations (UN/EU-type), 2nd+ mentions use the English acronym alone, not the Korean name.
10. CITY STRUCTURE RULES:
    - 1st mention (Capital): 나라 수도 한국어 이름(영어 이름)+행정구역단위(주/성/현/시/마을)
    - 1st mention (Non-Capital): 나라 한국어 이름(영어 이름)+행정구역단위
    - 2nd+ mentions: 나라 한국어 이름+행정구역단위
11. ANONYMOUS SOURCE / OFFICIAL RULES:
    - 1st mention: [주제]에 능통한 [소식통/관계자] [수량][단위]
    - 2nd+ mentions: [소식통/관계자] [수량][단위]
12. AMBASSADOR PHRASING: "XX국 주Y대사" -> "Y 주재 XX국 대사" (e.g., "미국 주일대사" -> "일본 주재 미국 대사").
13. EVERY statement attributed to a named speaker MUST be a full direct quote in double quotes — never paraphrased/summarized. Use only 밝혔다/전했다/덧붙였다/언급했다/강조했다, alternating every time (never twice in a row), never "라고 말했다".
14. If a speaker makes multiple related remarks, merge them into ONE quote joined internally with 이어/또한/덧붙여 — do not produce multiple separate quote+verb pairs for the same speaker's related statements.
15. For interviews, use: 화자(영문, 최초 언급 시만) 직책은/는 [매체]와의 인터뷰를 통해 "..."라고 밝혔다/전했다/덧붙였다/언급했다/강조했다.
16. If the source gives a location/time for the remark, place that context immediately before the quote opens, not after.
17. QUOTE ENDINGS: sentences inside double quotes MUST be complete (e.g., "...예정이다.", NEVER "...예정.").
18. Enforce date structures ('26. 9. 1일, or '26. 9. 1일 HH:MM경 with a specific time) with NO zero padding. ALWAYS omit the day of the week even if the source states it. Use absolute years, never "n years ago". Use comma separators for numbers ≥1,000, and show KRW equivalents for foreign currency amounts.
19. Return JSON matching the schema.

SOURCE TEXT:
${text}

${learnedPatterns}
`;

  try {
    const response = await callServerGemini({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction: CONDENSED_SYSTEM_INSTRUCTIONS.replace(/\[Nation\]/g, nation),
        temperature: 0.0,
        topP: 0.2,
        tools: [{ googleSearch: {} }],
        responseMimeType: "application/json",
        responseSchema: translationOutputSchema,
      }
    });

    const result = JSON.parse(response.text || "{}");

    // 1. Headline line
    const headline = formatHeadline(
      result.headlineSubject || "",
      result.headlineMainPoint || "",
      !!result.headlineIsQuoted
    );

    // 2. Metadata line
    const metadataLine = formatMetadata(nation, sourceName, result.eventTimeIso || "", utcOffsetHours);

    // 3. Document structure assembly
    const headerBlock: string[] = [headline, metadataLine];

    if (publisherName && publisherName.trim()) {
      headerBlock.push(publisherName.trim());
    }

    let processedParagraphs: string[] = Array.isArray(result.bodyParagraphs) ? result.bodyParagraphs : [];

    // --- Quotation-rule enforcement (order matters: split/merge before topic-marker fix) ---
    // Catch bare indirect speech ("...다고 밝혔다") and convert it into a
    // properly quoted direct quote BEFORE the nominal-ending cleanup below.
    processedParagraphs = enforceDirectQuotes(processedParagraphs);
    // Split a merged block where an indirect clause (인정했다 etc.) got
    // dragged inside a direct quote meant for a separate, later statement.
    processedParagraphs = splitIndirectFromDirectQuote(processedParagraphs);
    // Fold two consecutive same-speaker quote+verb pairs into one merged quote.
    processedParagraphs = mergeSameSpeakerQuotes(processedParagraphs);
    // Enforce 은/는 (not 이/가) on the quote's own leading subject.
    processedParagraphs = enforceQuoteTopicMarker(processedParagraphs);
    // Process Quotation Sentences (Ensures complete predicate endings inside quotes)
    processedParagraphs = processQuotationSentences(processedParagraphs);

    // --- Naming-rule enforcement ---
    // Diplomatic ambassador phrasing rewrite ("XX국 주Y대사" -> "Y 주재 XX국 대사").
    processedParagraphs = processAmbassadorPhrasing(processedParagraphs);
    // Process Person Structure (1st mention vs 2nd+ mention enforcement; 2nd+ = surname only)
    processedParagraphs = processPersonNameRules(processedParagraphs);
    // Process Company Structure (1st mention vs 2nd+ mention enforcement; 2nd+ = Korean name only)
    processedParagraphs = processCompanyNameRules(processedParagraphs);
    // Process generic/ad-hoc Organization Structure (not covered by the fixed glossary)
    processedParagraphs = processOrganizationNameRules(processedParagraphs);
    // Process City Structure (1st mention vs 2nd+ mention enforcement)
    processedParagraphs = processCityNameRules(processedParagraphs);
    // Rewrite any metonymic capital-city subject ("Beijing has...") as
    // "[Nation] 당국" instead of the literal city-naming expansion.
    processedParagraphs = resolveCapitalMetonyms(processedParagraphs);
    // Process Anonymous Source Structure (1st mention vs 2nd+ mention enforcement)
    processedParagraphs = processAnonymousSourceRules(processedParagraphs);

    // --- Style / connective / punctuation enforcement (quote-safe) ---
    // Rotate connective openers so the same one never repeats back-to-back;
    // never rewrites text inside quotation marks.
    processedParagraphs = normalizeConnectiveOpeners(processedParagraphs);
    // Replace list-separator commas with "ㆍ", preserving numeric thousands separators.
    processedParagraphs = replaceListCommasWithDot(processedParagraphs);
    // Always omit the day of the week, even if present in the source.
    processedParagraphs = removeDayOfWeek(processedParagraphs);

    const bodyText = processedParagraphs.length > 0 ? processedParagraphs.join('\n\n') : "";

    const fullDocument = bodyText
      ? `${headerBlock.join('\n')}\n\n${bodyText}`
      : headerBlock.join('\n');

    // 4. Post-process using deterministic substitution rules
    return applyCodeRules(fullDocument);
  } catch (error) {
    console.error("English translation error:", error);
    throw error;
  }
}

export async function saveEnglishCorrection(
  sourceText: string,
  aiTranslatedText: string,
  userCorrectedText: string,
  section: EnglishTranslationSection
): Promise<any> {
  try {
    await addDoc(collection(db, 'corrections_en'), {
      sourceText,
      aiTranslatedText,
      userCorrectedText,
      section,
      createdAt: serverTimestamp()
    });

    const prompt = `
Analyze the original English text and user-corrected Korean translation to extract terminology mappings and transformation rules.

Original English: "${sourceText}"
User Corrected Korean: "${userCorrectedText}"
`;

    const response = await callServerGemini({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: correctionAnalysisSchema,
      }
    });

    const result = JSON.parse(response.text || "{}");

    const patternDoc = {
      englishText: sourceText,
      koreanText: userCorrectedText,
      section,
      terminology: result.terminology || {},
      transformationRules: result.transformationRules || [],
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'learned_patterns_en'), patternDoc);

    return patternDoc;
  } catch (error) {
    console.error("Error saving english correction:", error);
    throw error;
  }
}

export async function fetchAllEnglishLearnedPatterns(): Promise<EnglishLearnedPatternItem[]> {
  try {
    const patternsRef = collection(db, 'learned_patterns_en');
    const q = query(patternsRef, orderBy('createdAt', 'desc'), limit(50));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as EnglishLearnedPatternItem[];
  } catch (error) {
    console.error("Error fetching all English learned patterns:", error);
    return [];
  }
}

export async function deleteEnglishLearnedPattern(id: string): Promise<void> {
  try {
    // BUG FIX: `doc` here is the imported Firestore `doc()` function, not an
    // object with a `.db` property — `doc.db` was always `undefined`, so
    // this threw on every call. It just needs the imported `db` instance.
    await deleteDoc(doc(db, 'learned_patterns_en', id));
  } catch (error) {
    console.error("Error deleting english learned pattern:", error);
    throw error;
  }
}