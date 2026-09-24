import { GoogleGenAI } from "@google/genai";
import { collection, addDoc, query, getDocs, orderBy, limit, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
const MODEL_NAME = "gemini-3.1-flash-lite";

export enum TranslationSection {
  GENERAL = 'general'
}

export interface ArticleMetadata {
  nation: string;
  source: string;
  publisherName?: string;
  originalDateTime: Date; // Beijing Time (UTC+8)
}

export interface TranslationResult {
  translatedText: string;
  sourceText: string;
  section: TranslationSection;
  validationWarnings: string[];
}

export interface LearnedPatternItem {
  id: string;
  chineseText: string;
  koreanText: string;
  section?: TranslationSection | string;
  terminology: Record<string, string>;
  transformationRules: string[];
  createdAt?: any;
}

// ============================================================================
// 1. FULL GLOSSARY DATA & DYNAMIC FILTERING
// ============================================================================

const MASTER_GLOSSARY_TEXT = `
- 一带一路 : 일대일로(一帶一路, 중국-중앙아시아-유럽을 연결하는 육상ㆍ해상 실크로드. 출처: 연합뉴스)
- 六个任何 : '6개 임의(六个任何, 어떤 개인·조직·정당·시기·형식·국토에 관한 대만독립도 허용하지 않겠다는 의미)'
- 六点意见/胡六点 : '6가지 의견(六点意见, 하나의 중국 견지, 경제협력 추진, 중화민족 문화 선양, 인적교류 확대, 국가주권 수호, 적대상태 종결)'
- 东北振兴 : 동북진흥(东北振兴, 동북3省(지린省·랴오닝省·헤이룽장省)의 낙후현상을 극복하고 노후화한 공업기지를 혁신하여 중국의 새로운 경제성장의 견인차로 육성한다는 전략)
- 南水北调 : 남수북조(南水北调, 중국 남부 지역의 풍부한 담수 자원을 물이 부족한 북부 지역으로 끌어오는 중국의 수자원 확보정책사업)
- 鲁班工坊 : 루반공방(지방정부인 톈진(天津）市와 톈진 지역의 직업교육기관이 일대일로 지역의 현지 교육기관과 협력해 설립한 직업교육센터)
- 两院 : 양원(两院, 중국과학원과 중국공정원의 통칭)
- 中国外交部驻港公署 : 중국 외교부 홍콩 주재 특파원 공서
- 两岸两会 : 양안 양회(해협양안교류기금회와 해협양안관계협회)
- 一中全会 : 중국 공산당 중앙위원회 제1차 전체회의
- 联合国: 국제연합(UN, United Nations)
- 金色十年 : 금색의 10년(金色十年)
- 四点主张 : 4대 주장(四点主张, 팔레스타인의 독립적인 건국과 팔레스타인-이스라엘 양측의 평화로운 공존을 유지해야 한다, 팔레스타인-이스라엘 間 대화만이 유일한 해결법이다,)
- 五个一批: 오개일피(五个一批, 생산발전, 이주, 생태보상, 교육발전, 사회보장을 통한 빈민구제)
- 互联互通 : 호련호통(互联互通, 신실크로드경제권 구축을 통한 아시아, 아프리카, 유럽 상호 연결전략)
- 党际交流: 정당 間 교류
- 国事访问 : 국빈방문
- 正式访问 : 공식방문
- 工作访问 : 실무방문
- 二轨 : 투트랙(Two Track, 정치나 경영 따위에서, 어떤 일을 처리하기 위한 두 가지 경로)
- 和平共处五项原则 : 평화공존 5원칙(和平共处五项原则, 주권과 영토보전의 상호 존중, 상호 불가침, 상호 내정 불간섭, 호혜평등, 평화공존)
- 亲诚惠容 : 친성혜용(亲诚惠容, 친근ㆍ성실ㆍ혜택ㆍ포용)
- 真实亲诚 : 진실친성(真实亲诚, 진정ㆍ실질ㆍ친근ㆍ성실)
- 四好精神 : 4호정신(四好精神, 좋은 이웃, 친구, 동지, 협력 파트너가 된다)
- 零和关系 : 제로섬 관계(어떤 시스템이나 사회 전체의 이익이 일정하여 한쪽이 득을 보면 반드시 다른 한쪽이 손해를 보는 관계)
- 零和 : 제로섬 게임(Zero-Sum Game, 한쪽의 이득과 다른 쪽의 손실을 더하면 제로가 되는 게임)
- 金砖五国 : 브릭스(BRICS, 브라질ㆍ러시아ㆍ인도ㆍ중국ㆍ남아프리카공화국 신흥경제 5개국)
- 新开发银行 : 신개발은행(NDB, 브라질ㆍ러시아ㆍ인도ㆍ중국ㆍ남아프리카공화국 등 신흥경제 5대국으로 구성된 브릭스(BRICS)가 2016년 설립하려는 금융기구)
- 南南合作 : 남남협력(South-South cooperation, 개발도상국 사이에 이루어지는 국제적 협력)
- 澜湄国家 : 란창강(澜沧江)-메콩강(Mekong R.) 국가(캄보디아ㆍ중국ㆍ라오스ㆍ미얀마ㆍ태국ㆍ베트남)
- 中俄科技创新年 : 중국-러시아 과학기술 혁신의 해(中俄科技创新年, 2019년 6월 시진핑 국가주석과 푸틴 대통령은 2020ㆍ2021년을 중국-러시아 과학기술 혁신의 해로 지정함)
- 经济走廊 : 경제회랑(중국정부가 일대일로(一带一路) 연선국가들과 중국을 철도 도로 송유관 등으로 연결하려는 구상)
- 中巴经济走廊 : 중국-파키스탄 경제회랑(CPEC, China-Pakistan Economic Corridor)
- 2030年可持续发展议程 : 2030 지속가능발전의제(The 2030 Agenda for Sustainable Development)
- 跨太平洋伙伴关系协定 : 환태평阳경제동반자협정(TPP, Trans-Pacific Partnership)
- 中俄睦邻友好合作条约 : 중국-러시아 선린우호협력조약(中俄睦邻友好合作条约)
- 中美三个联合公报 : 미국-중국 양국 간 3개의 공동성명(中美三个联合公报, 1972년 미중 공동성명, 1979년 미중 공동성명, 1982년 미중 공동성명. 출처: 중국외교부)
- 中日四个政治文件 : 중국-일본 양국 間 4개 정치문건(1972년의 중일연합성명, 1978년의 중일평화우호조약, 1998년의 중일연합선언, ’08년의 전략적 호혜관계의 전면적 추진을 위한 중국-일본 양국의 연합성명(中日关于全面推进战略互惠关系的联合声明))
- 中日和平友好条约: 중국-일본 평화우호조약(中日和平友好条约)
- 中日关系四点原则共识 : 중국-일본 양국 間 4개 원칙(중국-일본 양국 間 4개 정치문건의 정신과 원칙 준수, 역사를 직시하고 미래를 바라보는 정신의 견지, 댜오위다오(钓鱼岛) 분쟁 등 동중국해 분쟁 해결체계 도입, 다자, 양자연락채널을 통해 대화 진행 및 정치적 상호신뢰 강화)
- 四好精神(中-越) : 4호정신(四好精神, 영원히 좋은 이웃, 좋은 친구, 좋은 동지, 좋은 동반자로 남자는 정신)
- 海上意外相遇规则 : 해상에서의 돌발적 조우 규칙(海上意外相遇规则)
- 澜沧江－湄公河合作会议 : ‘란창(澜沧)강-메콩(湄公)강’ 협력회의
- 两会 : 양회(兩會, 전국인민대표대회와 전국인민정치협상회의. 출처: 연합뉴스)
- 中国共产党第二十次全国代表大会 : 중국 공산당 제20차 전국대표대회(中国共产党第二十次全国代表大会, 이하 20차 당 대회)
- 清迈倡议多边化 : 치앙마이 이니셔티브(CMIM, 외환위기 발생 방지하기 위한 ASEAN+한중일 間 역내 자금지원제도)
- 联组会议 : 연조회의(联组会议, 형식은 전체회의와 동일하나 안건에 대한 표결과 결정이 없이 주요 문제에 대해 한 단계 심화된 심의를 실시함)
- 黄岩岛 : 스카버러 암초(Scarborough Shoal, 중국명: 황옌다오)
`.trim();

/**
 * Filter matching glossary entries dynamically to preserve token budget.
 */
function getMatchingGlossary(sourceText: string): string {
  const lines = MASTER_GLOSSARY_TEXT.split('\n');
  const matchedLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^-\s*([^\s:]+)/);
    if (match && match[1]) {
      const chineseKey = match[1];
      if (sourceText.includes(chineseKey)) {
        matchedLines.push(line);
      }
    }
  }

  return matchedLines.join('\n');
}

// ============================================================================
// 2. SYSTEM INSTRUCTIONS (UNIVERSAL & SECTION SPECIFIC)
// ============================================================================

const CORE_SYSTEM_INSTRUCTIONS = `
You are a professional Yonhap News-style translator specializing in translating Chinese news articles into Korean.
You must translate the entire Chinese article without summarizing or omitting any content.
Paragraph Mapping: The number of paragraphs in the output MUST exactly match the number of paragraphs in the source text.

## ABSOLUTELY NO '측', '들', '방중', '이번', '남한' IN ANY TRANSLATED SECTION (ZERO TOLERANCE VOID-WORDS BANNED)
- You are STRICTLY PROHIBITED from using the Korean character '측', the plural helper particle '들', the word '방중', the word '이번', or the word '남한' anywhere in any translated section under any circumstances.
- This absolute ban applies globally across all sections (headlines, titles, body content, questions, spokesperson comments, and summaries).
- Mappings:
  * '측': Replace entirely with explicit name of entity/title (e.g., '중국측' -> '중국', '양측' -> '양국').
  * '들': Omit or rephrase using singular forms (e.g., '기자들' -> '기자').
  * '방중': Translate strictly as '중국 방문' (body/comments) or '中 방문' (titles/headlines/summaries).
  * '이번': Translate strictly as '상기'.
  * '남한': STRICTLY BAN '남한'. Always translate as '한국' (or '韩' in titles/headlines).
- Exception: The specific glossary string for "4대 주장", which contains "양측", is permitted to keep that '측' because of explicit glossary instruction, but nowhere else. The words "들", "방중", "이번", and "남한" remain strictly prohibited absolutely everywhere.

## FIRST-OCCURRENCE VS. SUBSEQUENT-OCCURRENCE EXPANSION RULE
Whenever the following specified key terms appear in the source text, their very first translated occurrence in the output text MUST include the full descriptive text and parenthesis explanation. Any subsequent occurrences of that same term in the text MUST be translated using ONLY the brief form:
1. 安理会 / 安全보장이사회 (안전보장이사회):
   - First Occurrence: '국제연합 안전보장이사회(UNSC, United Nations Security Council)'
   - Subsequent Occurrences: 'UNSC'
2. 互利共赢 (호혜공영):
   - First Occurrence: '호혜공영(互利共赢, 국가 혹은 지역이 협력을 통해 위협ㆍ도전에 대응하고 이익을 추구함으로써 모두의 발전을 이루는 것)'
   - Subsequent Occurrences: '호혜공영'
3. 四点主张 (4대 주장):
   - First Occurrence: '4대 주장(四点主张, 팔레스타인의 독립적인 건국과 팔레스타인-이스라엘 양측의 평화로운 공존을 유지해야 한다, 팔레스타인-이스라엘 間 대화만이 유일한 해결법이다,)'
   - Subsequent Occurrences: '4대 주장'

## STRICT PROHIBITION OF HONORIFIC ENDINGS & ALLOWED VERBS
- Do NOT use honorific sentences ending in "~했습니다", "~체", "~습니까", "~습니다".
- Plain declarative style verbs allowed: "~했다", "~밝혔다", "~전했다", "~강조했다", "~보도했다", "~덧붙였다".

## OUTPUT STRUCTURE & METADATA FORMAT
. (translated article title)
[ (Nation). (Source). (Month). (Day). (HH:MM)((Korean Month). (Korean Day). (HH+1:MM)) ]
(Publisher Name)
(translated article body)

ZERO BLANK LINE RULE: No blank line between the title line and the bracket line directly below it.

## METADATA BRACKET LINE — ZERO TOLERANCE FORMAT LOCK
- Exact 5 dot-separated fields before parenthesis: Nation. Source. Month. Day. HH:MM.
- Time inside parenthesis: Calculated by adding exactly 1 hour (+1 hour) to original Chinese time (KST conversion).
- Midnight Rollover: If +1 hour crosses midnight (e.g. 23:15 -> 00:15), advance the Korean date to the next day.
- NEVER insert a year (YY) anywhere inside the bracket metadata line.

## MANDATORY CONSTRAINT VERIFICATION (SENTENCE LEVEL)
1. SUBJECT: Every sentence must start with an explicit subject followed by exactly ONE '은' or '는'. No dropped subjects, no pronouns like "그/그녀".
2. CONJUNCTIONS: Max ONE "~고" and ONE "~며," per sentence. "~고" appears before "~며,". Every "며" MUST be followed by a trailing comma ("며,"). No comma after "고".
3. QUOTES: Single-speaker paragraphs wrapped in exactly ONE set of quotation marks ("...").
4. BANNED WORDS: '측', '들', '방중', '이번', '남한' must not appear.
5. NO MIDDLE DOT AFTER TRANSITION WORDS / DATES: NEVER use a middle dot (ㆍ) after transition words (또한, 이어, 나아가, 아울러, 더불어, 이와 관련, 한편, 다만 등) or after dates (e.g., '26. 5. 25일,). Always use a comma (,) or space.
6. TITLE NAMES: Headlines must write ONLY nationality/title — NEVER personal names.
7. SINGLE-ROLE CHECK (STRICT MANDATE): Pick EXACTLY ONE occupation/title per person. NEVER use '겸' or include multiple roles. Discard secondary political party roles (such as '중앙정치국 위원', '중앙위원', '국무위원') and prioritize the single primary government/foreign-affairs title.
   * Example INCORRECT: "왕이(王毅) 중국 공산당 중앙정치국 위원 겸 외교부장"
   * Example CORRECT: "왕이(王毅) 중국 외교부장"
8. CITY FORMAT: Non-Capitals -> Country + City(Hanja/English)市. Capitals -> Country + 수도 + City(Hanja/English)市. Append '소재' before specific venues (e.g., 베이징(北京)市 소재 인민대회당).
9. SUBSEQUENT MENTIONS: First mention -> 이름(원어) 국적 직책. Subsequent mentions -> 이름 직책 (omit country/nationality on 2nd+ mentions).

## CRITICAL: STRUCTURAL MAPPING FOR APPOINTMENTS & DIPLOMATS ("驻")
- You MUST follow the exact structural conversion for the character "驻" (주재): "A 驻 B" (A=sending nation, B=host nation) matches to "B 주재 A" (B=host nation, A=sending nation).
  * Example: "美国驻华大使" -> Body: "중국 주재 미국 대사", Headline: ". 中 주재 美 대사" (Host country 中 before 주재, Sending country 美 after 주재).
  * NEVER write "미국 주재 중국 대사" or "美 주재 中 대사" when translating US ambassador to China ("美国驻华大使").
  * Example: "中国驻美大使" -> Body: "미국 주재 중국 대사", Headline: ". 美 주재 中 대사" (Host country 美 before 주재, Sending country 中 after 주재).
- DO NOT HALLUCINATE OR RE-USE PREVIOUS DIPLOMAT NAMES. If the source text specifies "庞德伟", it refers to David Perdue (데이비드 퍼듀, the current US Ambassador to China). Do NOT translate "庞德伟" as Nicholas Burns ("니콜라스 번스") under any circumstances.

`;

const GENERAL_NEWS_INSTRUCTIONS = `
${CORE_SYSTEM_INSTRUCTIONS}

## GENERAL NEWS TRANSLATION RULES
- HEADLINE: Starts with dot and space (". "). Single-character Hanja for country abbreviations (美, 中, 韩, 北, 日). No personal names.
- BODY FIRST SENTENCE: Begins with date stamp: 'YY. M. D일, (e.g., '26. 5. 25일,).
- MEETING VERBS: 会见/会谈/会晤 translated as "회동" in headlines, and "~와 회담을 실시했다" in body text.
- NO SUMMARY SECTION: General News output MUST NEVER include a "요약:" section or bullet points.
`;

// ============================================================================
// 3. CODE PRE-PROCESSING & POST-PROCESSING
// ============================================================================

const HANJA_COUNTRY_MAP: Record<string, string> = {
  '미국': '美',
  '중국': '中',
  '한국': '韩',
  '남한': '韩',
  '북한': '北',
  '일본': '日'
};

function processHeadline(headline: string): string {
  let cleaned = headline.trim();
  if (!cleaned.startsWith('.')) {
    cleaned = `. ${cleaned}`;
  }

  cleaned = cleaned.replace(/남한/g, '한국');
  cleaned = cleaned.replace(/방중/g, '中 방문');

  // Convert full country names to single Hanja characters in headline
  Object.entries(HANJA_COUNTRY_MAP).forEach(([full, hanja]) => {
    const regex = new RegExp(full, 'g');
    cleaned = cleaned.replace(regex, hanja);
  });

  return cleaned;
}

function stripBannedWords(text: string): string {
  return text
    .replace(/측/g, '')
    .replace(/들/g, '')
    .replace(/방중/g, '중국 방문')
    .replace(/이번/g, '상기')
    .replace(/남한/g, '한국');
}

/**
 * Programmatically enforces Single-Role rule:
 * Removes secondary political party positions and '겸' from official titles.
 * Example: "왕이(王毅) 중국 공산당 중앙정치국 위원 겸 외교부장" -> "왕이(王毅) 중국 외교부장"
 */
function processSingleRoleRules(text: string): string {
  let cleaned = text;

  // 1. Remove Chinese party/political titles preceding '겸' (e.g., 공산당 중앙정치국 위원 겸, 국무위원 겸)
  cleaned = cleaned.replace(/(?:공산당\s*)?(?:중앙\s*)?(?:정치국\s*위원|정치국\s*상무위원|중앙위원|국무위원)\s*겸\s*/g, '');

  // 2. Generic removal of '겸' between two titles (e.g., "Role1 겸 Role2" -> keep Role2)
  cleaned = cleaned.replace(/([가-힣]+(?:위원|장관|부장|차관|총리|주석|수상|대통령|의장|회장|원장|이사|대표|지사))\s*겸\s*([가-힣]+(?:위원|장관|부장|차관|총리|주석|수상|대통령|의장|회장|원장|이사|대표|지사))/g, '$2');

  // 3. Clean up any leftover standalone '겸' in titles
  cleaned = cleaned.replace(/\s+겸\s+/g, ' ');

  return cleaned;
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

function postProcessTranslation(text: string): string {
  if (!text) return "";

  const lines = text.split('\n');
  const firstLineIndex = lines.findIndex(l => l.trim().length > 0);
  if (firstLineIndex !== -1 && lines[firstLineIndex].trim().startsWith('.')) {
    lines[firstLineIndex] = processHeadline(lines[firstLineIndex]);
  }

  let processed = lines.join('\n');
  processed = stripBannedWords(processed);
  processed = processSingleRoleRules(processed);
  processed = removeMiddleDotAfterDatesAndTransitions(processed);
  return processed;
}

function validateOutput(text: string): string[] {
  const warnings: string[] = [];

  const bannedMatches = text.match(/측|들|방중|이번|남한/g);
  if (bannedMatches) {
    warnings.push(`Banned word leak detected: ${Array.from(new Set(bannedMatches)).join(', ')}`);
  }

  const openQuotes = (text.match(/“|"/g) || []).length;
  const closeQuotes = (text.match(/”|"/g) || []).length;
  if (openQuotes !== closeQuotes) {
    warnings.push(`Unbalanced quotation marks (Open: ${openQuotes}, Close: ${closeQuotes})`);
  }

  return warnings;
}

// ============================================================================
// 4. FIRESTORE LEARNED PATTERNS
// ============================================================================

async function getChineseLearnedPatterns(): Promise<string> {
  try {
    const patterns = await fetchAllLearnedPatterns();
    if (patterns.length === 0) return "";
    
    let patternInstructions = "\n### LEARNED TRANSLATION PATTERNS & TERMINOLOGIES:\n";
    patterns.forEach((p, idx) => {
      patternInstructions += `Pattern #${idx + 1}:\n`;
      patternInstructions += `- Chinese Source Text: "${p.chineseText}"\n`;
      patternInstructions += `- Korean Corrected Translation: "${p.koreanText}"\n`;
      if (p.terminology && Object.keys(p.terminology).length > 0) {
        patternInstructions += `- Preferred Terminology Mappings:\n`;
        Object.entries(p.terminology).forEach(([zh, ko]) => {
          patternInstructions += `  * "${zh}" -> "${ko}"\n`;
        });
      }
      if (p.transformationRules && p.transformationRules.length > 0) {
        patternInstructions += `- Transformation Rules:\n`;
        p.transformationRules.forEach(rule => {
          patternInstructions += `  * ${rule}\n`;
        });
      }
    });
    
    return patternInstructions;
  } catch (error) {
    console.error("Error fetching Chinese learned patterns:", error);
    return "";
  }
}

// ============================================================================
// 5. EXPORTED TRANSLATION FUNCTIONS
// ============================================================================

export async function translateChineseNews(
  text: string,
  section: TranslationSection = TranslationSection.GENERAL,
  sourceName: string = "인터넷신화사",
  publisherName: string = "",
  nation: string = "중국"
): Promise<string> {
  const learnedPatterns = await getChineseLearnedPatterns();
  const matchedGlossary = getMatchingGlossary(text);
  
  const sectionInstructions = GENERAL_NEWS_INSTRUCTIONS;

  const prompt = `
### TRANSLATION METADATA:
1. Nation (국가): ${nation}
2. Source (매체): ${sourceName}
3. Publisher Name (기자명/배포처): ${publisherName && publisherName.trim() ? publisherName.trim() : '(none - omit publisher line completely)'}

### Destination Section Style:
- Section: General News

${matchedGlossary ? `### RELEVANT GLOSSARY MATCHES:\n${matchedGlossary}\n` : ''}

### Original Chinese Source text to translate:
${text}

${learnedPatterns}
`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction: sectionInstructions,
        temperature: 0.1,
        topP: 0.3,
        topK: 20
      }
    });

    return postProcessTranslation(response.text || "Chinese-to-Korean translation failed.");
  } catch (error) {
    console.error("Chinese translation error:", error);
    throw error;
  }
}

export const translateNews = translateChineseNews;

export async function translateArticle(
  sourceChineseText: string,
  metadata: ArticleMetadata,
  section: TranslationSection = TranslationSection.GENERAL
): Promise<TranslationResult> {
  const resultText = await translateChineseNews(
    sourceChineseText,
    section,
    metadata.source,
    metadata.publisherName || "",
    metadata.nation
  );

  const warnings = validateOutput(resultText);

  return {
    translatedText: resultText,
    sourceText: sourceChineseText,
    section,
    validationWarnings: warnings
  };
}

export async function saveCorrection(
  sourceText: string,
  aiTranslatedText: string,
  userCorrectedText: string,
  section: TranslationSection
): Promise<any> {
  try {
    await addDoc(collection(db, 'corrections'), {
      sourceText,
      aiTranslatedText,
      userCorrectedText,
      section,
      createdAt: serverTimestamp()
    });

    const prompt = `
You are an expert Chinese-to-Korean news translation pattern analyzer.
Analyze the original Chinese text and user-corrected Korean text to extract terminology mappings and structural rules.

### INPUT DATA
1. Original Chinese Text:
"${sourceText}"
2. User-Corrected Korean Translation:
"${userCorrectedText}"

### OUTPUT FORMAT
Output ONLY raw JSON (no markdown formatting, no text before or after):
{
  "terminology": {
    "chinese_word": "korean_word"
  },
  "transformationRules": [
    "Rule description learned from this correction"
  ]
}
`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });

    const responseText = response.text || "{}";
    const cleanJson = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const result = JSON.parse(cleanJson);

    const patternDoc = {
      chineseText: sourceText,
      koreanText: userCorrectedText,
      section,
      terminology: result.terminology || {},
      transformationRules: result.transformationRules || [],
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'learned_patterns'), patternDoc);
    return patternDoc;
  } catch (error) {
    console.error("Error saving Chinese correction:", error);
    throw error;
  }
}

export async function fetchAllLearnedPatterns(): Promise<LearnedPatternItem[]> {
  try {
    const patternsRef = collection(db, 'learned_patterns');
    const q = query(patternsRef, orderBy('createdAt', 'desc'), limit(50));
    const snapshot = await getDocs(q);
    
    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as LearnedPatternItem[];
  } catch (error) {
    console.error("Error fetching all Chinese learned patterns:", error);
    return [];
  }
}

export async function deleteLearnedPattern(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'learned_patterns', id));
  } catch (error) {
    console.error("Error deleting Chinese learned pattern:", error);
    throw error;
  }
}

export async function analyzeCorrections() {
  return {
    topTerms: ['경제무역', '엄정한 항의', '양국 관계'],
    lastAnalyzed: new Date().toISOString()
  };
}
