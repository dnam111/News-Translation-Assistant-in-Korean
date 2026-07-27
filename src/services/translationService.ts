import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { collection, addDoc, query, getDocs, orderBy, limit, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

export enum TranslationSection {
  GENERAL = 'general',
  BRIEFING = 'briefing'
}

export interface TranslationResult {
  translatedText: string;
  sourceText: string;
  section: TranslationSection;
}

const SYSTEM_INSTRUCTIONS_BASE = `
You are a professional Yonhap News-style translator specializing in translating Chinese news articles into Korean.
You must translate the entire Chinese article without summarizing or omitting any content.
Paragraph Mapping: The number of paragraphs in the output MUST exactly match the number of paragraphs in the source text.

## ABSOLUTELY NO '측', '들', '방중', OR '이번' IN ANY TRANSLATED SECTION (ZERO TOLERANCE VOID-WORDS BANNED)
- You are STRICTLY PROHIBITED from using the Korean character '측' (e.g., '중국측', '미국측', '상대측', '양측', '우리측'), the plural helper particle '들' (e.g., '기자들', '양국들', '사람들', '기업들', '그들'), the word '방중' (or any words containing '방중', such as '방중단', '방중일정', etc.), or the word '이번' (or any words containing '이번') anywhere in any translated section of the output under any circumstances.
- This absolute ban applies globally to all output sections including headlines, titles, body content, questions (질문:), spokesperson comments (대변인:), and briefs/bullet lists (요약:).
- '측' mapping: You MUST replace '측' entirely with the explicit name of the entity, title, or standard words (e.g., replace '중국측' with '중국', '미국측' with '미국', '양측' with '양국', '상대측' with '상대방', '대리측' with '대리인' etc. This is a zero-tolerance prohibition!).
- '들' mapping: You MUST omit or rephrase any instances of '들' entirely by using singular forms or alternative phrasing (e.g. refer to '기자', '양국', '사람', '기업', etc. directly instead of '기자들', '양국들', '사람들', '기업들'). The character '들' is strictly prohibited from appearing anywhere in the translation!
- '방중' mapping (CRITICAL PROHIBITION): You are STRICTLY PROHIBITED from translating any Chinese terms for visiting China (e.g. 访华, 访问中国, 访中, 访, etc.) or visiting a country as '방중' or similar characters.
  * You MUST ALWAYS map and translate visiting-China terms strictly to '중국 방문' when appearing in the body text (본문), questions (질문:), or spokesperson comments (대변인:).
  * You MUST ALWAYS map and translate visiting-China terms strictly to '中 방문' when appearing in the title/headline or concise summaries/bullet points (요약:).
- '이번' mapping: You are STRICTLY PROHIBITED from translating Chinese deictic/pointing words (e.g. 这次, 这一, 本次, 该, etc.) into '이번' or using the word '이번' anywhere in any part of the translation (including headlines, body, questions, spokesperson comments, and summaries). You MUST ALWAYS use '상기' instead.
- '덧붙였다' mapping: Strictly prohibited. Never use '덧붙였다'.
- Exception: The specific glossary string for "4대 주장", which contains "양측", is permitted to keep that '측' because the user explicitly requested that exact literal translation style, but nowhere else. The words "들", "방중", and "이번" remain strictly prohibited absolutely everywhere.

## FIRST-OCCURRENCE VS. SUBSEQUENT-OCCURRENCE EXPANSION RULE
Whenever the following specified key terms appear in the source text, their very first translated occurrence in the output text MUST include the full descriptive text and parenthesis explanation. Any subsequent occurrences of that same term in the text MUST be translated using ONLY the brief form (either abbreviation or the term without parenthesis):

1. 安理会 / 安全보장이사회 (안전보장이사회):
   - First Occurrence: '국제연합 안전보장이사회(UNSC, United Nations Security Council)'
   - Subsequent Occurrences: 'UNSC'
2. 互利共赢 (호혜공영):
   - First Occurrence: '호혜공영(互利共赢, 국가 혹은 지역이 협력을 통해 위협ㆍ도전에 대응하고 이익을 추구함으로써 모두의 발전을 이루는 것)'
   - Subsequent Occurrences: '호혜공영'
3. 四点主张 (4대 주장):
   - First Occurrence: '4대 주장(四点主张, 팔레스타인의 독립적인 건국과 팔레스타인-이스라엘 양측의 평화로운 공존을 유지해야 한다, 팔레스타인-이스라엘 間 대화만이 유일한 해결법이다,)'
   - Subsequent Occurrences: '4대 주장'

## STRICT PROHIBITION of Honorific Endings & Style Ends
- Do NOT use honorific sentences ending in "~했습니다", "~체", "~습니까", "~습니다" or similar honorific verb styles.
- You MUST use the objective, plain declarative news style ending strictly in "~했다", "~했다.", or "~했다/밝혔다/전했다".

## MANDATORY CONSTRAINT VERIFICATION (CRITICAL STEP)
Before outputting your final translation, you MUST perform a sentence-by-sentence check against ALL "Sentence Rules" listed below.
If a sentence violates any rule, you MUST split it or rephrase it until it complies.
Failure to follow these rules is a critical failure.

## Nation / Source / Publisher placeholders
Every request's user turn will contain a "TRANSLATION METADATA" block giving the real Nation, Source, and Publisher Name (or stating there is none) for that request. Wherever this instruction set or the Output Structure below shows "(Nation)", "(Source)", or "(Publisher Name)", you MUST substitute the actual values from that block. If Publisher Name is stated as none/empty, omit that line entirely from your output.

## Output Structure
The output must strictly follow this structure:
. (translated article title)
[ (Nation). (Source). (Month in original text). (Day in original text). (HH:MM in original text)((Month). (Day). (HH+1:MM)) ]
(Publisher Name)
(translated article body)
`;

const GENERAL_NEWS_INSTRUCTIONS = `
## GENERAL NEWS TRANSLATION RULES (제목 및 본문 규정):

### Headline Rules (제목)
- Prepended Dot: ALWAYS start the headline with a dot and a space: ". (Headline)"
- Structure: (Subject/Organization), main content.
- Naming in Headline: If a person appears, write ONLY nationality/nation and position/title. DO NOT write the person’s name in the title. For example, if the headline should refer to 시진핑 중국 국가주석, the title MUST be written as "中 국가주석" instead of "中 시진핑 주석". Ensure NO names whatsoever appear in the title.
- Particles: Do NOT use "은", "는", "을", "를" in the title.
- Punctuation: Use a comma (,) as a topic marker.
- Quotation marks (“ ”): Use only if the title contains a direct statement.
- Country Abbreviations (Title ONLY) - STRICT RULE:
  * When United States, China, South Korea, Japan, and North Korea appear in the title, they MUST be translated/written using single-character Hanja abbreviations (美, 中, 韩, 日, 北) (e.g., "대중국" MUST become "대중" or "대中", "미국 국가" MUST become "美 국가" in the title). This is a mandatory translation rule!
  * absolutely any other country not listed above (e.g., Russia, France, Germany, etc.) MUST be written in its full Korean name (e.g. 러시아, 프랑스, 독일).
  * This rule of using Chinese characters for country abbreviations applies EXCLUSIVELY to the title.
- Terminology: Use "회동" instead of "회담 실시" in titles. But if it's "전화 회담", use "전화 회담 실시" in titles. 
- Official Title (STRICT REQUIREMENT): Pick EXACTLY ONE representative occupation for any individual. ABSOLUTELY PROHIBITED: using the word "겸" (AND) anywhere in the translation, combining multiple titles/occupations, or "겸직". Even if multiple occupations, dual roles, or joint titles are mentioned in the original paragraph, the translation MUST strictly contain only a single occupation/title for that person. Discard any secondary or other occupations entirely. MANDATORY STRATEGY: Verify with Google Search. IF the individual has multiple occupations, YOU MUST PRIORITIZE the role related to "외교" (e.g., 외교장관, 외무장관, 외교부장) over any other occupation (e.g., over "총리", "부총리"). If no "외교" role exists, pick the single most representative/relevant one for the context. Violating this rule or including the word "겸" is a CRITICAL ERROR.

### Body Translation Rules (본문)
0. The number of paragraphs in the original text must equal to the number of paragraphs in the translated output.
1. Article Metadata & Time Constraints:
   - Initial Date Stamp: Every translation article must begin with the date at the very start of the first sentence. Format: 'YY. M. D일, (e.g., '26. 5. 25일,).
   - Relative Time Translation: Literal translations like "올해" or "오늘" are strictly prohibited. You must dynamically calculate and write the specific numbers based on the source context:
     * 今年 -> Specific numeric year (e.g., '26년).
     * 今天 -> Specific numeric date in metadata format (e.g., '26. 7. 27일).
   - Time of Day: If a text mentions morning, lunch, or afternoon, append local time notation immediately after. Format: 오후(현지시각), 오전(현지시각).
   - Publisher Line: Always place the publisher information line immediately below the metadata line.
   - Contextual Deictics: Use the word "상기" to translate "this/that" within official briefing contexts.
   - Even if the original text states "当地时间", the model doesn't need to translate that into 현지시간 or 현지시각. Just ignore this word when translating.  
2. Geo-Political & Country Constraints:
   - Country Sequence Rule: When multiple countries are listed, they must strictly follow this priority sequence: 1. 한국, 2. 미국, 3. 일본, 4. 중국, 5. 기타 국가.
   - Country Grouping Pattern: When referencing multiple countries together, you must group them with a hyphen in the correct sequence order, followed by the word "양국". Example: 미국-중국 양국.
   - No Country Abbreviations: Never use single-character country abbreviations (e.g., 中) in the body text. Use full, unabbreviated country names.
   - Heads of State: Translate 两国元首 dynamically based on the exact active nations in the context. Apply the Country Sequence Rule (e.g., 미국-중국 양국 정상). Never default blindly to US-China.
   - Weapon Naming: "Country + missile name (English) + missile type + 미사일" (e.g., 미국 AGM-158 JASSM 순항 미사일).
   - Company Naming: "Country + 『company name (English)』 + 社" (e.g., 미국 『록히드마틴(Lockheed Martin)』社).
   - Regulation Formatting: Treat 『』 for regulations, ordinances, treaties, and media entities.
3. Individual Naming & Title Structures:
   - Official Title (Strict Single-Role Limit): You must pick exactly one representative occupation per individual. 
     * Prohibited: Combining multiple titles, mentioning dual roles (겸직), or using the connective word "겸" anywhere in the translation. Discard secondary occupations completely.
     * Priority Rule: If an individual holds multiple roles, prioritize the foreign affairs role (e.g., 외교장관, 외무장관, 외교부장) over any executive roles (e.g., 총리, 부총리). Use Search to verify if ambiguous.
   - Naming Presentation Flow:
     * First Mention: 이름(원어명) 국적 직책 (e.g., 푸충(傅聪) UN 주재 중국 대사). Use Chinese Hanja characters in the parenthesis for individuals from South Korea, North Korea, Japan, China, Taiwan, and Hong Kong (e.g. 푸충(傅聪) UN 주재 중국 대사).
     * For individuals/people from any OTHER countries than China, Japan, South Korea, Taiwan, Hong Kong, and North Korea, you MUST put the English name inside the parentheses. Example: 미국 바이든 -> 조 바이든(Joe Biden) 미국 대통령.
     * Subsequent Mentions: 이름 직책. Do not use pronouns like "그" or "그녀". Always explicitly repeat [Name] [Title].
   - Diplomatic Title Structures: For titles structured as 'Country/Org + 驻 + Rank', follow this exact syntax blueprint:
     * First Mention: [Name](원어명) [Country/Org]주재 [Rank] (e.g., 푸충(傅聪) 국제연합(UN, United Nations) 주재 중국 대사).
     * Subsequent Mentions: [Name] 대사.
4. Absolute Sentence-Level Grammar Rules:
   - Subject & Particle Law: Every single sentence must start with a subject or noun phrase. The subject must immediately be followed by the particle '은' or '는'. Exactly one '은' or '는' is permitted per sentence.
   - Conjunction & Sequence Clauses:
     * When connecting text using sequence clauses, '~고' must appear first, followed subsequently by '~며,'.
     * The marker '~며,' cannot stand alone if '~고' is missing from that sentence sequence. If this structure is broken, split the text into two distinct sentences.
     * Whenever '며' (or '며,') appears as a conjunction/connective ending in the translation, it MUST always be immediately followed by a comma (e.g. "~며,").
     * You are STRICTLY prohibited from placing a comma after '고' in all conjunction clauses. It MUST always be written as "~고" without any trailing comma (e.g. do NOT write "~고,").
   - Strict Vocabulary Bans: Under no circumstances use the word '측', the Korean character '들', the word '방중', or the word '이번' anywhere in any translation (including headlines, body, and summaries) under any circumstances. This is an absolute, zero-tolerance global ban! (Rules and mappings for these are fully specified above and are not repeated here.)
5. Quotations & Spoken Content Formula:
   - Direct Speech Validation: Use quotation marks (" ") only for direct speech. If no one is speaking, quotation marks are strictly banned.
   - Quote Merging: If an individual speaks multiple consecutive sentences in the source text, merge them into a single continuous string inside one set of quotation marks.
   - Main Paragraph Formula: Any paragraph representing spoken content must strictly obey this structural blueprint:
     * Formula: [Name] [Occupation]은/는 [Optional Context Actions]. "[Complete Sentence 1 with Subject]. [Complete Sentence 2 with Subject]."[Attribution Verb]
     * All introductory context clauses or action descriptions must live outside the quotation marks. Every single sentence inside the quotes must start with a subject/noun followed by its own 은/는 particle. If a subject is missing from the original source quote, you must infer it from context to ensure the Korean quote contains a subject.
   - Attribution Rotation & Punctuation: Always place a period inside the quote before closing it: "~~."라고. End the paragraph with exactly one closing attribution verb. You must alternate strictly between "라고 밝혔다." and "라고 전했다." for each consecutive paragraph.
   - There must be only one quotation mark (" ") per paragraph if there is direct speech. Prohibit multiple use of quotation marks within one paragraph. Exactly one '은' or '는' is permitted per sentence inside the quotation mark. 
6. Discourse & Subject Transitions:
   - Repeated Subject Cycling Rule: When multiple consecutive paragraphs share the exact same subject, use the transition words "또한," and "아울러," at the beginning of paragraphs using this exact loop:
     * Paragraph 1 (New Subject): No transition word. ([Subject]은/는...)
     * Paragraph 2 (Same Subject): 또한, [Subject]은/는...
     * Paragraph 3 (Same Subject): 아울러, [Subject]은/는...
     * Paragraph 4+ (Same Subject): Reset loop back to 또한, [Subject]은/는... and continue the cycle.
     * Reset Trigger: Reset this entire looping logic back to Paragraph 1 the moment the subject changes.
7. Terminology & Glossary Overrides:
   - Meeting Terminology: In headlines, use "회동". In the body text, always use "회담을 실시했다."
   - Location Format: 
     * For cities from China, Japan, South Korea, Taiwan, Hong Kong, and North Korea, format as Country + City(Hanja)市 (e.g., 중국 상하이(上海)市).
     * For cities from any OTHER countries than China, Japan, South Korea, Taiwan, Hong Kong, and North Korea, you MUST put the English name inside the parentheses. Example: 미국 뉴욕(New York)市, 프랑스 파리(Paris)市.
   - Glossary Integration: A "Relevant Glossary Matches" list will be supplied in the user turn, containing only the glossary entries relevant to the current source text (drawn from the full glossary this app maintains). If a word matches an entry there, use the target Korean phrase and append any parenthetical contextual description exactly as given.
     * Example: ‘하나의 중국(一个中国，중국 대륙과 홍콩, 마카오, 대만은 나뉠 수 없는 하나이고 따라서 합법적인 중국의 정부는 오직 하나라는 원칙. 출처: 중국외교부)’ 원칙
   - Dynamic Matching: If a translated Korean phrase appears on the left side of a supplied glossary entry, replace it immediately with the preferred phrase on the right side of that entry.
`;

/* ----------------------------------------------------------------------------
 * FULL TERMINOLOGY GLOSSARY
 * ----------------------------------------------------------------------------
 * This is the exact same glossary that used to be embedded directly inside
 * GENERAL_NEWS_INSTRUCTIONS. Paste your full, unmodified glossary block here
 * (everything that was under "## Terminology Glossary (STRICT MAPPING)"),
 * one "- 중국어/기존항목 : 한국어" entry per line, exactly as you already have
 * it today. Nothing about the entries themselves needs to change - only their
 * location moved, so they can be filtered per-request instead of being sent
 * in full on every single call. getRelevantGlossary() below parses this with
 * a simple line-based "- key : value" format, and also understands "/" as
 * separating alternate source terms on the key side (e.g. "欧盟 / 欧洲联盟").
 * ------------------------------------------------------------------------- */
const FULL_GLOSSARY_TEXT = `
- 동의: 합의
- 칭찬하다/감사의 뜻을 표하다 : 높게 표하는 바이다/높게 평가하다
- 회담 진행 : 회담을 실시했다 (제목: 회동)
- 一带一路 : 일대일로(一帶一路, 중국-중앙아시아-유럽을 연결하는 육상ㆍ해상 실크로드. 출처: 연합뉴스)
- 六个任何 : '6개 임의(六个任何, 어떤 개인·조직·정당·시기·형식·국토에 관한 대만독립도 허용하지 않겠다는 의미)'
- 六点意见/胡六点 : '6가지 의견(六点意见, 하나의 중국 견지, 경제협력 추진, 중화민족 문화 선양, 인적교류 확대, 국가주권 수호, 적대상태 종결)'
- 东北振兴 : 동북진흥(东北振兴, 동북3省(지린省·랴오닝省·헤이룽장省)의 낙후현상을 극복하고 노후화한 공업기지를 혁신하여 중국의 새로운 경제성장의 견인차로 육성한다는 전략)
- 南水北调 : 남수북조(南水北调, 중국 남부 지역의 풍부한 담수 자원을 물이 부족한 북부 지역으로 끌어오는 중국의 수자원 확보정책사업)
- 鲁班工坊 :루반공방(지방정부인 톈진(天津）市와 톈진 지역의 직업교육기관이 일대일로 지역의 현지 교육기관과 협력해 설립한 직업교육센터)
- 两院 : 양원(两院, 중국과학원과 중국공정원의 통칭)
- 中国外交部驻港公署 ：중국 외교부 홍콩 주재 특파원 공서
- 两岸两会 : 양안 양회(해협양안교류기금회와 해협양안관계협회)
- 中华全国青年联合会 : 중화전국청년연합회(전국청련, 中华全国青年联合会)
- 中国工会 : 중화전국총공회(中华全国总工会, 중국공회, 1922년 설립된 중국 노동자 연합)
- 亚洲基础设施投资银行(亞投行) : 아시아 인프라 투자은행(AIIB, Asian Infrastructure Investment Bank)
- 国际货币基金 : 국제통화기금(IMF, International Monetary Fund)
- 联合国安理会 : 국제연합 안전보장이사회(UNSC, United Nations Security Council)
- 世界贸易组织：세계무역기구(WTO, World Trade Organization)
- 东南亚国家联盟(东盟) : 동남아시아국가연합(ASEAN, Association of South-East Asian Nations)
- 东盟人道主义援助中心 : 인도주의 재난지원 ASEAN 조정센터(AHA 센터, ASEAN Coordinating Centre for Humanitarian Assistance on disaster management)
- 经济合作与发展组织 : 경제협력개발기구(OECD, Organization for Economic Cooperation and Development) 
- 北大西洋公约组织 : 북대서양 조약 기구(NATO, North Atlantic Treaty Organization)
- 国际海洋法法庭 : 국제해양법재판소(ITLOS, International Tribunal for the Law of the Sea)
- 东非政府间发展组织 : 동아프리카 정부간개발기구(IGAD, The Intergovernmental Authority on Development) =伊加特
- 常设仲裁法院 : 상설중재재판소(PCA, Permanent Court of Arbitration)
- 核供应国集团 : 원자력공급국그룹(NSG, Nuclear Suppliers Group)
- 国际移民组织 : 국제이주기구(IOM, International Organization for Migration)
- 俄罗斯国家原子能公司 : 러시아국영원자력공사(ROSATOM, Russian Atomic Energy State Corporation)
- 海牙国际法院 : 국제사법재판소(ICJ, International Court of Justice)
- 各国议会联盟 : 국제의회연맹(IPU, Inter-Parliamentary Union)
- 一中全会 ： 중국 공산당 중앙위원회 제1차 전체회의
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
- 守望相助 : 수망상조(守望相助, 어려울 때 서로 협조하며 대응한다)
- 严正交涉 : 강력한 반대의 뜻을 표하다 (외교용어)
- 与邻为善 : 우린위선(与邻为善, 이웃 국가와 함께 선을 행하다)
- 以邻为伴 : 이린위반(以邻为伴, 이웃 국가와 동반자 관계를 이루다)
- 阿巴中美四方协调组 : 아프간과 파키스탄, 중국 그리고 미국이 참여한 ‘4자조정그룹(QCG, The Quadrilateral Coordination Group)’
- 金砖五国 : 브릭스(BRICS, 브라질ㆍ러시아ㆍ인도ㆍ중국ㆍ남아프리카공화국 신흥경제 5개국)
- 新开发银行 : 신개발은행(NDB, 브라질ㆍ러시아ㆍ인도ㆍ중국ㆍ남아프리카공화국 등 신흥경제 5대국으로 구성된 브릭스(BRICS)가 2016년 설립하려는 금융기구)
- 南亚区域合作联盟 : 남아시아지역협력연합(SAARC, South Asian Association for Regional Cooperation)
- 亚太经合组织 : 아시아태평양경제협력체(APEC, Asia Pacific Economic Cooperation)
- 上海合作组织 : 상하이협력기구(SCO, Shanghai Cooperation Organization)
- 欧洲经济组织 : 유라시아경제연합(EEU, Eurasian Economic Union)
- 欧亚经济联盟 : 유라시아경제연합(EEU, Eurasian Economic Union)
- 南南合作 : 남남협력(South-South cooperation, 개발도상국 사이에 이루어지는 국제적 협력)
- 拉美和加勒比国家共同体 ：라틴아메리카-카리브해 국가공동체(CELAC, Community of Latin American and Caribbean States)
- 世界领袖联盟 : 글로벌 리더 연합(Global Leaders Alliance)
- 澜湄国家 : 란창강(澜沧江)-메콩강(Mekong R.) 국가(캄보디아ㆍ중국ㆍ라오스ㆍ미얀마ㆍ태국ㆍ베트남)
- 中俄科技创新年 : 중국-러시아 과학기술 혁신의 해(中俄科技创新年, 2019년 6월 시진핑 국가주석과 푸틴 대통령은 2020ㆍ2021년을 중국-러시아 과학기술 혁신의 해로 지정함)
- 经济走廊 : 경제회랑(중국정부가 일대일로(一带一路) 연선국가들과 중국을 철도 도로 송유관 등으로 연결하려는 구상)
- 中巴经济走廊： 중국-파키스탄 경제회랑(CPEC, China-Pakistan Economic Corridor)
- 2030年可持续发展议程 : 2030 지속가능발전의제(The 2030 Agenda for Sustainable Development)
- 中国－东盟自由贸易协定 : 중국-ASEAN 자유무역협정(CAFTA, China-ASEAN Free Trade Agreement)
- 跨太平洋伙伴关系协定 : 환태평양경제동반자협정(TPP, Trans-Pacific Partnership)
- 中俄睦邻友好合作条约 : 중국-러시아 선린우호협력조약(中俄睦邻友好合作条约)
- 中美三个联合公报 : 미국-중국 양국 간 3개의 공동성명(中美三个联合公报, 1972년 미중 공동성명, 1979년 미중 공동성명, 1982년 미중 공동성명. 출처: 중국외교부)
- 中日四个政治文件 : 중국-일본 양국 間 4개 정치문건(1972년의 중일연합성명, 1978년의 중일평화우호조약, 1998년의 중일연합선언, ’08년의 전략적 호혜관계의 전면적 추진을 위한 중국-일본 양국의 연합성명(中日关于全面推进战略互惠关系的联合声明))
- 中日和平友好条约: 중국-일본 평화우호조약(中日和平友好条约)
- 互联网和数字经济路线图: APEC의 ‘인터넷디지털경제 로드맵(AIDER, APEC Internet and Digital Economy Roadmap)
- 互联互通总体规划2025 : 마스터플랜(MPAC, Master Plan on ASEAN Connectivity, 《互联互通总体规划2025》)
- 中日关系四点原则共识 :  중국-일본 양국 間 4개 원칙(중국-일본 양국 間 4개 정치문건의 정신과 원칙 준수, 역사를 직시하고 미래를 바라보는 정신의 견지, 댜오위다오(钓鱼岛) 분쟁 등 동중국해 분쟁 해결체계 도입, 다자, 양자연락채널을 통해 대화 진행 및 정치적 상호신뢰 강화)
- 南海各方行为宣言 : 남중국해 분쟁당사국 행동선언(DOC, Declaration on the Conduct of Parties in the South Chinese Sea)
- 海上意外相遇规则 : 해상에서의 우발적 충돌을 막기 위한 행동강령(CUES, Code for Unplanned Encounters at Sea)
- 四好精神(中-越) : 4호정신(四好精神, 영원히 좋은 이웃, 좋은 친구, 좋은 동지, 좋은 동반자로 남자는 정신)
- 海上意外相遇规则 : 해상에서의 돌발적 조우 규칙(海上意外相遇规则)
- 南海行为准则 : 남중국해행동준칙(COC, Code of Conduct in the South China Sea)
- 澜沧江－湄公河合作会议 :  ‘란창(澜沧)강-메콩(湄公)강’ 협력회의
- 巴黎气候会议 : 파리기후협정(Paris Climate Change Accord, 2020년 이후 적용할 새로운 기후협약으로 1997년 채택한 교토의정서를 대체하는 것이다)
- 区域全面经济伙伴关系 : 역내포괄적경제동반자협정(RCEP, Regional Comprehensive Economic Partnership)
- 联合国世界粮食计划署 : 세계식량계획(WFP, World Food Programme)
- 不扩散核武器条约 : 핵확산금지조약(NPT, Nuclear nonproliferation treaty)
- 数字经济伙伴关系协定 : 디지털 경제 동반자 협정(DEPA, Digital Economy Partnership Agreement)
- 香会 : 아시아안보회의(샹그릴라 대화)
- 两会 : 양회(兩會, 전국인민대표대회와 전국인민정치협상회의. 출처: 연합뉴스)
- 中国共产党第二十次全国代表大会 : 중국 공산당 제20차 전국대표대회(中国共产党第二十次全国代表大会, 이하 20차 당 대회)
- 清迈倡议多边化 : 치앙마이 이니셔티브(CMIM, 외환위기 발생 방지하기 위한 ASEAN+한중일 間 역내 자금지원제도)
- 联组会议 : 연조회의(联组会议, 형식은 전체회의와 동일하나 안건에 대한 표결과 결정이 없이 주요 문제에 대해 한 단계 심화된 심의를 실시하는 회의)
- 四个高级别对话: '4개의 고위급 대화(중국-미국 양국 間 외교안보, 경제, 인문교류, 법 집행 및 네트워크 안보 등 분야 內 대화)'
- 亚欧外长会议: 아시아유럽정상회의(ASEM, Asia Europe Meeting) 외교장관회의
- 东南亚国家联盟 外长会议 : ASEAN 외교장관 회의
- 东盟国防部长扩大会议 : 아세안 확대 국방장관회의(ADMM-Plus, ASEAN Defence Ministers’ Meeting Plus)
- 东盟地区论坛 : 동남아시아국가연합 지역안보포럼(ARF, ASEAN Regional Forum)
- 东亚峰会 : 동아시아 정상회의 (EAS, East Asia Summit)
- 世界经济论坛 : 다보스포럼(DavosForum, 매년 스위스의 다보스에서 개최되는 '세계경제포럼' 연차총회의 통칭)
- 亚欧会议 : 아시아유럽정상회의(ASEM, Asia-Europe Meeting)
- 东北亚合作对话会 : 동북아시아협력대화(NEACD, Northeast Asia Cooperation Dialogue)
- 中非合作论坛 : 중국-아프리카 협력포럼(FOCAC, Forum on China-Africa Cooperation)
- 中国－葡语国家经贸合作论坛 : 중국-포르투갈어 사용국 공동체 경제ㆍ무역 협력포럼(The Forum for Economic and Trade Co-operation between China and Portuguese-speaking Countries)
- 博鰲论坛 : 보아오포럼(BFA, Boao Forum for Asia, 매년 4월 중국 하이난(海南)省 충하이(瓊海)市의 보아오(博鰲) 지역에서 개최되는 아시아 지역경제 포럼)
- 十六字方针(中-越) : '16자 방침(十六字方针, 중국-베트남 관계 방침으로 장기안정(长期稳定), 면향미래(面向未来), 선린우호(睦邻友好), 전면협력(全面合作))'  --- *면향미래보다는 미래지향이 낫지 않을까 싶습니다(2현준)
- 泛黄海经济技术交流会议 : ‘한국-중국-일본 환황해경제기술교류회의(泛黄海经济技术交流会议)’
- 中国-阿拉伯国家合作论坛: 중국-아랍국가 협력포럼(CASCF, China-Arab States Cooperation Forum)
- 亚洲相互协作与信任措施会议（亚信） : 아시아 교류 및 신뢰구축회의(CICA, Conference on Interaction and Confidence Building Measures in Asia)
- 美联储 : 미국 연방준비제도이사회(FRB, Federal Reserve Board)
- 联合国海洋法公约 : 유엔해양법협약(UNCLOS, UN Convention On the Law of the Sea)
- 상하이 정신(上海精神, 상호 신뢰, 호혜, 평등, 협상, 다양한 문명 존중, 공동 발전 추구. 출처: 시진핑외교사상 및 신시대중국외교)
- 联合国大会/联大: 유엔총회(UNGA, United Nations General Assembly)
- 依法治国 : 의법치국(依法治國, 법에 의한 국가통치)
- 稳中求进 : 온중구진(稳中求进, 안정속의 진보추구)
- 修身律己 : 수신율기(修身律己, 자신을 수양하고 단속하다)
- 党风廉政 : 당풍염정(黨風廉政, 당의 기풍과 청렴한 정치)
- 失职追责 : 직무유기에 대한 지속적인 문책을 시행
- 求同存异: 구동존이(求同存异, 각자 다른 의견은 보류하고 공동이익을 추구하는 것)
- 知事识人 : 지사식인(知事识人, 업무, 인사에 대한 연구를 결합하여 합리적인 간부 운용을 추진하는 방식)
- 韬光养晦 : 도검양회(韬光养晦, 재능을 감추고 드러내지 않으며, 때를 기다린다. 1980년대 중국의 대외 정책)
- 两个维护 : 2개 수호(两个维护, 시진핑 국가주석과 당중앙의 핵심적 지위를 결연히 수호하고 당중앙의 권위와 집중 통일 지도를 결연히 수호함)
- 两个责任 : 2개 책임(两个责任, 당위원회는 주체 책임을 지고 기율위윈회는 감독의 책임을 진다)
- 两个决议 : 2개 결의(两个决议, 여러 역사 문제에 대한 결의, 건국 이래 여러 중국 공산당 역사 문제에 대한 결의)
- 两个结合 : 2개 결합(两个结合, 마르크스주의의 기본 원리를 중국의 구체적 현실 및 중국의 전통 문화와 결합)
- 三个维护 : 3대수호(三个维护, 중국 공산당 중앙위원회의 권위, 중국 공산당의 핵심 권력, 중국 중앙군사위원회 주석책임제에 대한 수호)
- 三医联动 : 삼의연동(三醫聯動, 병원과 의료보험 그리고 의약 개혁의 연동)
- 三个代表: 3개 대표론(三个代表, 중국 공산당이 선진 생산력과 선진 문화, 광대한 인민의 근본 이익을 대표해야 한다는 정책 이념) 
- 四个意识 : 4개 의식(四个意识, 정치ㆍ대국ㆍ핵심ㆍ모범의식)
- 四个全面 : 4개 전면(四个全面, 전면적인 샤오캉사회 건설과 개혁 심화, 법치국가 실현, 당의 기율 확립)
- 四个自信 : 4개 자신(四个自信, 중국 특색 사회주의에 대한 자신, 이론적 자신, 제도적 자신, 문화적 자신)
- 四个伟大 : 4개 위대(四个伟大, 위대한 꿈, 위대한 사업, 위대한 프로젝트, 위대한 투쟁)
- 四個合格 : 4개 합격(四個合格, 정치적 합격, 기율적 합격, 품행의 합격, 역할 및 성과의 합격)
- 四种形态 : 4대 행태(四种形态, 당내관계의 정상화ㆍ대다수의 경미한 처벌ㆍ소수의 엄중 처벌ㆍ극소수의 기율위반으로 인한 입건조사)
- 四个共同 : 4개 공동(四个共同, 정치적 상호신뢰 공동 촉진, 안보 및 안정 공동 수호, 번영 및 발전 공동 도모, 국제적 도의 공동 담당)
- 四个应该 : 4개 응당(四个应该, 단결협력, 수망상조, 일심협력, 포용수용)
- 四铁 : 4철(四铁, 중국 중앙군사위원회 기관이 가져야 하는 강철과 같은 신앙, 신념, 기율, 책임)
- 四不 : 사불(四不, 약속은 변치 않고 선의는 변치 않으며, 압력에 굴복하지 않고 대결의 구 노선을 걷지 않는다)
- 四不一没有 : 사불일몰유(四不一没有, 독립의 선언ㆍ국호의 변경ㆍ양국론 입헌의 추진ㆍ국민투표를 통한 상황 변화 추진을 하지 않으며, 국가통일 강령 및 국가통일회의 폐지는 없음)
- 四有 : 4유(四有, 이상ㆍ도덕ㆍ문화ㆍ기율)
- 五通 : 5통(五通, 정책소통ㆍ시설연동ㆍ무역활성화ㆍ자금융통ㆍ민심상통)
- 五位一体 : 오위일체(五位一体, 경제ㆍ정치ㆍ문화ㆍ사회ㆍ생태문명 건설)
- 五大家园: 5대 고향(五大家园, 평화로운 고향, 안정적인 고향, 번영하는 고향, 아름다움 고향, 우호적인 고향)
- 五大发展理念 : 5대 발전이념(五大发展理念, 혁신, 협조, 녹색, 개방, 공유)
- 六保 : 6대 보장(六保, 취업 보장, 민생 보장, 시장 주체 보장, 식량 에너지 안전 보장, 산업사슬 공급사슬 안정 보장, 기층 조직 업무 이행 보장)
- 六稳 : 6개 안정(六稳, 안정적 취업, 금융, 대외무역, 외자유치, 투자, 예측 실현)
- 七大风险 : 7대 리스크(七大风险, 정치, 이데올로기, 경제, 과학기술, 사회, 외부 환경, 당의 건설 등 7가지 분야에서의 위기)
- 7个带头 : 7대 인솔(7个带头, 4대의식 강화 인솔, 시진핑 신시대 중국 특색 사회주의 사상 및 제19차 당대회 정신 관철 인솔, 보고요청 제도 이행 인솔, 민주집중제 관철ㆍ집행 인솔, 중국 공산당 중앙위원회 정책 안배에 대한 관철 인솔, 조사ㆍ연구 및 당풍 개선 인솔, 청렴ㆍ자율성 유지 인솔)
- 双轨并进 : 쌍궤병진(双轨并进, 한반도 비핵화 프로세스와 북·미 평화협정체제 협상을 병행 추진하는 것)
- 分阶段、同步走 : 단계적 동시 접근
- 双中断(双暂停) : 쌍중단(双中断, 북한의 핵·미사일 개발 활동과 대규모 한·미 연합훈련을 동시에 중단하는 것) 을 위한 8개의 규정)
- 一个中国 : ‘하나의 중국(一个中国，중국 대륙과 홍콩, 마카오, 대만은 나뉠 수 없는 하나이고 따라서 합법적인 중국의 정부는 오직 하나라는 원칙. 출처: 중국외교부)’ 원칙
- 八点主张/江八点 : '8가지 주장(八点主张, 하나의 중국 견지, 대만과 타국의 정부 차원의 교류 금지, 양안 평화통일 담판 진행, 평화통일 노력, 양안 경제 교류 및 협력 발전, 중화문화 공동발전, 대만인의 생활방식 존중, 대만 지도자의 중국 방문 환영)'
- 六个任何 : '6개 임의(六个任何, 어떤 개인·조직·정당·시기·형식·국토에 관한 대만독립도 허용하지 않겠다는 의미)'
- 六点意见/胡六点 : '6가지 의견(六点意见, 하나의 중국 견지, 경제협력 추진, 중화민족 문화 선양, 인적교류 확대, 국가주권 수호, 적대상태 종결)'
- 告台湾同胞书 : '대만 동포에게 고하는 글(告臺灣同胞書, 1979년 1월 1일 중국 전국인민대표대회 상무위원회 선언문)'
- 习五条 : '시진핑의 5가지 조항(习五条, 시진핑 국가주석이 '19년도 대만 동포에게 고하는 글 발표 40주년 기념 연설에서 제의한 5가지 조항)'
- 九二共识 : 92공식(九二共識, 1992년 ‘하나의 중국’을 인정하되 각자 명칭을 사용하기로 한 합의)
- 4대 주장(四点主张, 팔레스타인의 독립적인 건국과 팔레스타인-이스라엘 양측의 평화로운 공존을 유지해야 한다, 팔레스타인-이스라엘 間 대화만이 유일한 해결법이다,)
- 新南向政策 : 신남향정책(新南向政策, 대만이 중국에 대한 경제 의존도를 줄이고자 동남아와의 교류를 확대하는 정책)
- 新南向國家 : 신남향국가(新南向國家, 대만 신남향정책의 대상국인 오스트레일리아, 뉴질랜드, 싱가포르, 말레이시아, 필리핀, 베트남, 태국, 미얀마, 라오스, 인도네시아, 브루나이, 인도, 방글라데시, 파키스탄, 스리랑카, 네팔, 부탄 등 국가들을 지칭함)
- 一边一国 : 일변일국(一边一国, 중국과 대만은 하나의 국가가 아니라는 주장)
- 遮羞布 : 치부를 가리는 천쪼가리
- 一国两制  : 일국양제(一國兩制, ‘한 국가 두 체제’라는 뜻으로, 중국이 하나의 국가 안에 자본주의와 사회주의 체제를 모두 인정한다는 방식)
- 小三通 : 소삼통(小三通, 중국 푸젠省과 대만 푸젠省 間 비지니스·항공노선·우편 연결 프로젝트)
- 海協會 : 해협양안관계협회(海峡两岸关系协会)
- 海基會 : 해협교류기금회(海峽交流基金會)
- 臺企聯 : 전국대만동포투자기업친목회(全国台湾同胞投资企业联谊会)
- 囯台辦 : 중국 국무원 대만사무판공실
- 臺商民營企業 : 대만기업민영은행(臺商民營企業)
- 國民待遇 : 중국 국민과 같은 대우
- 同等優先，適當放寬 : '동등한 대우가 우선이며, 적당히 완화한다.(同等優先，適當放寬)'
- 比照外資，適當放寬 ：'해외 자본을 참고하고, 적당히 완화한다.(比照外資，適當放寬)'
- 臺商投資企業聯合會 : '대만투자기업연합회(臺商投資企業聯合會)'
- 臺盟 : '대만민주자치동맹(臺灣民主自治同盟, 이하 대만동맹)'
- 連胡會 : '롄잔-후진타오 회담(롄잔 前 대만 副총통과 후진타오 前 중국 국가주석의 회담)'
- 法理臺獨 ：'법리적 대만 독립(法理臺獨)'
- 軟性臺獨 ：'연성 대만독립(軟性臺獨)'
- 全国台联 ：'중화전국대만동포친목회(中华全国臺湾同胞联谊会， 이하 대만 친목회)'
- 切香腸式臺獨 : '단계적인 대만 독립(窃香肠式台独)
- 隐性台独 : '음성 대만독립(隐性台独)'
- 區別待遇，分化瓦解，擴大多速，鼓勵少數 ：'차별대우·분열와해·다수확대·소수고립(區別待遇，分化瓦解，擴大多速，鼓勵少數)'
- 老兵返鄉探親 ：'노병반향탐친(老兵返鄉探親, 양안의 이산가족상봉)'
- 海峽論壇 : 해협 포럼
- 引進來 : 인진라이(引進來, 중국으로 유인하다)
- 四個堅持 :‘4대 견지(四個堅持, 자유 민주주의 헌법질서, 양안 간 상호 비(非)예속, 주권 침해 금지, 대만 인민의 자주적인 미래 결정)
- 医院船 : 병원선
- 导航卫星 ： 항법위성
- 有效载荷: 페이로드(payload)
- 综合补给船/综合补给舰 : 군수지원함
- 从严治军 : 종엄치군(从严治军, 엄격한 중국 인민해방군 관리)
- 依法治军 : 의법치군(依法治军, 법으로 중국 인민해방군을 관리)
- 硬实力 : 하드파워(Hard Power, 군사력, 경제력 따위를 앞세워 상대방의 행동을 바꾸게 하거나 저지할 수 있는 힘)
- 模块化 : 모듈화(modularization, 임무 수행을 위한 장비의 구성품을 세트화시킴으로써 전투 현장에서 즉각 정비가 가능하도록 지원하는 것)
- 战区主战 : 전구주전(战区主战, 전구는 훈련과 작전임무를 주로 수행)
- 军种主建 : 군종주건(军种主建, 군종은 해당 군종의 각종 보장 및 장비 공급을 담당)
- 新时代备战打仗能力 : 신시대전비전투능력(新时代备战打仗能力)
- 灰色地帶衝突 : 회색지대 침략 전술(정규군이 아닌 민병대나 민간을 활용해 도발하는 전술을 의미)
- 四国机制 : '4국체제(四国机制, 중국, 아프가니스탄, 파키스탄, 타지키스탄 4개국 군대 間 對테러 협력 메커니즘)'
- 两弹一星 : 양탄일성(两弹一星, 원폭ㆍ대륙간탄도미사일ㆍ인공위성을 함께 일컬음)
- 三股势力 : 삼고세력(三股势力, 극단적 종교집단세력ㆍ민족분열세력ㆍ국제테러세력을 뜻함)
- 工农红军 : 공농홍군(工农红军, 중국의 제2차 국공내전 당시 중국 공산당이 이끌던 군대)
- 战斗值班任务 : 전투 대기 임무
- 两个确立: 2개 확립(两个确立, 시진핑 국가주석의 당 핵심 지위 확립 및 시진핑 신시대 중국 특색 사회주의 사상의 지도적 지위 확립)
- 六个更: ‘6가지 보다(六个更, 보다 높은 정치적 상호 신뢰, 보다 실질적인 안보 협력, 보다 심도 있는 실질적 협력, 보다 강력한 여론 기반, 보다 긴밀한 다자간 조정 및 협력, 보다 나은 갈등 및 이견 해결)’
- 全面与进步跨太平洋伙伴关系协定 : 포괄적ㆍ점진적 환태평양경제동반자협정(CPTPP, Comprehensive and Progressive Agreement for Trans-Pacific Partnership)
- 全球发展倡议: ‘글로벌 발전 이니셔티브(GDI, Global Development Initiative)’ㆍ‘글로벌 안보 이니셔티브(GSI, Global Security Initiative)’ㆍ‘글로벌 문명 이니셔티브(GCI, Global Civilization Initiative)’ㆍ '글로벌 거버넌스 이니셔티브(GGI, Global Governance Initiative)
- 中俄关于相互通报发射弹道导弹和航天运载火箭的协定 : 중국-러시아 탄도 미사일 및 우주 로켓 발사 통보에 관한 합의
- 三农 : 삼농(三农, 농업ㆍ농촌ㆍ농민)
- 普惠金融 : 인클루시브 금융(Inclusive Finance, 영세기업, 농민, 도시저소득층, 빈곤계층, 장애인 및 노인 등 특수계층을 대상으로 하는 금융 서비스)
- 五眼联盟 : 파이브 아이즈(Five Eyes)
- 四边机制 : 쿼드(Quad, 미국ㆍ일본ㆍ호주ㆍ인도 4개국 안보 협의체)
- 三边安全伙伴关系 : 오커스(AUKUS, 미국ㆍ영국ㆍ호주 안보 동맹)
- 全方位战略伙伴关系/全面战略伙伴关系: 전면적인 전략적 동반자 관계
- 中华人民共和国成立: 중화인민공화국 수립
- 双重标准: 이중잣대
- 政治互信: 정치적 상호 신뢰
- 互补: 상호보완적
- 多边机制: 다자간 플랫폼
- 和平与安全: 평화ㆍ안보
- 切实: 착실
- 深入战略沟通: 심도 있는 전략적 소통
- 广泛共识: 광범위한 공동 인식
- 深厚民意基础: 두터운 민의를 기반으로 한다
- 落实: 착실히 이행
- 命运共同体: 양국 운명공동체
- 领土完整: 영토 완전성
- 取得积极进展: 긍정적 진전을 이뤘다.
- 一系列: 일련의
- 保护主义: 보호주의
- 高度赞赏: 높이 평가
- 矛盾: 갈등
- 密切: 긴밀
- 对话合作机制: 대화 협력 메커니즘
- 重启: 재개
- 尽快: 조속히
- 以巴冲突: 이스라엘-하마스 전쟁
- 兩岸: 양안(兩岸, 중국과 대만)
- 第十五届中国国际航空航天博览会新闻发布会: 제15회 중국국제에어쇼 기자회견
- 美军印太总部/美國印太司令部: 인도태평양사령부(USINDOPACOM, United States Indo-Pacific Command)
- 欧盟: 유럽연합(EU, European Union)
- 中國海警局: 중국 해양경찰국
- 二十国集团: 주요 20개국(G20, Group of 20)
- 全球南方国家: 글로벌 사우스(Global South, 남반구나 북반구의 저위도에 위치한 아시아, 아프리카, 남아메리카 등의 개발도상국을 통칭하여 일컫는 말. 출처: 연합뉴스)
- 联合国全球反恐战略: 유엔 세계 대테러전략(UNGCTS, United Nations Global Counter-Terrorism Strategy)
- 中科院（國家中山科學研究院）：대만 국가중산과학연구원(NCSIST, National Chung-Shan Institute of Science & Technology)
- 第三届“一带一路”国际合作高峰论坛: 제3회 일대일로 국제협력 정상포럼
- 长臂管辖: 확대 관할(일국의 법률 적용 범위를 나라 밖까지 확대하는 것)
- 蓝色伙伴关系: 블루 파트너십(Blue Partnership, 제1차 유엔해양총회(UNOC, United Nations Ocean Conference)에서 중국 대표단이 지속 가능한 해양 거버넌스를 위한 국가 및 다자 기구의 공동 행동을 촉구하기 위해 제시한 이니셔티브)
- 孔子学院: 공자학원(孔子学院, 중국 정부가 중국어 교육 및 중국의 사상과 문화를 전파ㆍ홍보하여 중국의 소프트파워 영향력을 강화할 목적으로 세계 각지에 설립한 기관)
- 칭찬하다/감사의 뜻을 표하다 -> 높게 표하는 바이다/ 높게 평가하다
- 회담 진행 -> 회담 실시 (제목에서는 회동)
- 고도로 주의 -> 매우 우려
- 인민 -> 국민 (대만일 경우 주민)
- 소원 -> 염원/개인적 바람
- 지역 -> 역내
- 올라가다 -> 격상
- 국방부 장관 ->국방장관
- 외교부 부장 -> 외교부장
- 지속적으로-> 지속해서 
- 견지 -> 지지
- 이번 -> 상기
- 문제 -> 사안
- 어려움 -> 난관
- 나아가며 -> 전진하며
- 끊임없이 -> 지속해서 
- 모든 부정적인 것 -> 우려를 표하다
- 통화 진행 -> 전화 회담 실시 
- 무시 -> 왜곡
- 파트너 -> 동반자
- 도약 -> 격상
- ~한다(informal 하게) -> ~한 바이다
- 하고싶다 -> 희망한다 
- ~에 불구하고 -> 막론하고 
- ~것이다 -> ~예정이다 
- 새로운 -> 신형
- 큰 -> 보다 높은 수준의 
- 마지막 -> 최종 
- ~때문 -> ~에 비롯함
- 다른 국가 -> 타국
- ~에 위치 -> 소재
- 고통 -> 난제
- 개방 -> 재개
- 보호 -> 수호 
- 하였고 -> 했고

`;

interface GlossaryEntry {
  keys: string[];       // alternate source-side match strings (already lowercased where relevant)
  raw: string;           // the original full line, sent to the model as-is
}

let parsedGlossaryCache: GlossaryEntry[] | null = null;

function getParsedGlossary(): GlossaryEntry[] {
  if (parsedGlossaryCache) return parsedGlossaryCache;

  const entries: GlossaryEntry[] = [];
  const lines = FULL_GLOSSARY_TEXT.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('-')) continue;
    const body = trimmed.replace(/^-+\s*/, '');
    const colonIdx = body.indexOf(':');
    if (colonIdx === -1) continue;
    const keyPart = body.slice(0, colonIdx).trim();
    // Support "termA / termB" style alternate keys.
    const keys = keyPart.split('/').map(k => k.trim()).filter(Boolean);
    if (keys.length === 0) continue;
    entries.push({ keys, raw: trimmed });
  }

  parsedGlossaryCache = entries;
  return entries;
}

/**
 * Returns only the glossary lines relevant to this specific source text,
 * formatted the same way the full glossary used to be, so the model sees an
 * identically-structured (just much shorter) list.
 */
function getRelevantGlossary(sourceText: string): string {
  const entries = getParsedGlossary();
  const matches = entries.filter(entry =>
    entry.keys.some(key => key.length > 0 && sourceText.includes(key))
  );

  if (matches.length === 0) return '(No specific glossary entries matched this text - rely on the general translation rules above.)';

  return matches.map(m => m.raw).join('\n');
}

const BRIEFING_INSTRUCTIONS = `
## Section 2: News Briefing
- All of the rules mentioned above for both General News Headline (제목) and Body (본문) apply strictly in this section as well (including official title single-role limitation, subject and particle law, repeated subject cycling rules, city/location notation with Hanja, and glossary terms).
- CRITICAL BRIEFING VOCABULARY REMINDERS (ZERO TOLERANCE BANS):
  * You are ABSOLUTELY PROHIBITED from using the word '방중' (or '방중단', '방중기간', etc.) in any part of the news briefing.
    - Title/Headline: MUST use '중국 방문' as '中 방문' (e.g., '中 인사, 中 방문 관련' instead of '방중').
    - 질문 section: MUST translate any visitor/visit Chinese terms strictly to '중국 방문'.
    - 대변인 section: MUST translate visitor/visit Chinese terms strictly to '중국 방문'.
    - 요약 section: MUST translate any visitor/visit Chinese terms strictly to '중국 방문' as well.
      Specifically:
      - 본문 (질문 and 대변인): MUST use "중국 방문".
      - 요약 and Title/Headline: MUST use "中 방문".
  * You are ABSOLUTELY PROHIBITED from using '이번' anywhere (including titles, questions, spokesperson comments, or summaries). You MUST always translate the corresponding pointing terms to '상기'.
  * You are ABSOLUTELY PROHIBITED from using the character '측' (e.g. '양측' -> '양국' or other specific entities) or '들' (no plural particle '들' at all!) in any part of the briefing.
- Country Abbreviations (Title ONLY):
  * Only United States (美), South Korea (韩), China (중국 in body/본문 but 中 in title/headline/summary), Japan (日), and North Korea (北) are permitted to be written in single Chinese characters in the heading.
  * If countries of China, United States, South Korea, Japan, and North Korea appear in the title, you MUST use their Hanja/Chinese character abbreviations (중국, 미국, 한국, 일본, 북한을 각각 中, 美, 韩, 日, 北으로 축약). For example, "대중국" MUST become "대중" or "대중" -> "대中" in the title.
  * Absolutely any other country not listed above (e.g., Russia, France, Germany, etc.) MUST be written in its full Korean name (e.g. 러시아, 프랑스, 독일).
  * This rule of using Chinese characters for country abbreviations applies EXCLUSIVELY to the title and 요약 sections.
- Apply briefing translation structure (Q&A style).
- Maintain formal briefing tone (1st person, spokesperson).
  * CRITICAL: In the "대변인:" translation section, the spokesperson is acting as China, so the active subject representing their stance/action MUST be "중국".
  * Whenever the original Chinese spokesperson uses first-person plural words such as "우리는" (we), "저희는", or other ambiguous/omitted subjects, you MUST translate or replace them using "중국" or other specific countries based on the context (e.g., "우리는 ~할 준비가 되었다" -> "중국은 ~할 준비를 마쳤다").
- Use "상기" for "this/that/current" in briefing contexts.
- Title: Use '회동' for meeting headlines.
- Body: Use '회담을 실시했다.' for meetings in body text.
- Country Order: Strictly follow this sequence: 1. 한국, 2. 미국, 3. 일본, 4. 중국.
- Person Naming Rule: First mention: "NAME(Chinese_Name or English_Name) Nationality Occupation". Use Chinese Hanja characters for South Korea, North Korea, Japan, China, Taiwan, and Hong Kong (e.g. 푸충(傅聪) UN 주재 중국 대사), and use English characters for all other nationalities (e.g. 존 설리번(John Sullivan) 미국 부장관). Subsequent mentions MUST be: "NAME Occupation".
- Attribution Rule (Main Paragraph Formula): Every main paragraph representing spoken content MUST strictly follow this formula:
  Formula: [Name] [Occupation]은/는 [Optional Contextual Action(s). ]"[Complete Sentence 1 with Subject(은/는)] [Complete Sentence 2 with Subject(은/는)]."라고 밝혔다 or 라고 전했다.
  Combine all consecutive sentences spoken by the same person into one paragraph/block. End this block with ONE attribution: "라고 밝혔다." or "라고 전했다." Rotate between "밝혔다" and "전했다". NEVER use "덧붙였다".
- No Quotation Mark is required in this section. Act like you are the 대변인 and speak in first person perspective. 
- When writing the title, you should use the contents from the "질문:" section and write the main point of the question asked before "입장 표명". 
- When writing the title, it should be 관형사절을 가진 문장. This means if there is a subject, the title should be formatted as "~~verb한 subject".
- For the "질문:" part, the number of sentences written in the original text must equal exactly to the number of sentences translated in "질문:". Do not split or merge sentences.
  * OMIT REPORTER AFFILIATION (기자 소속): For every briefing question in the source text, there may be reporter affiliation / news agency mentioned (e.g., '로이터 기자', 'CCTV 기자', '신화사 기자', '路透社记者', '新华社记者', etc.). The translation MUST fully ignore them and completely omit any reporter affiliation/news agency from the "질문:" section. Just state "질문: (contextual question)?" without reference to who asked it.
  * IGNORE REPORTER'S SOURCE BEFORE ":": The basic structure of the question in the original Chinese text is "Reporter's Source: Question". For the "질문:" section in translation, you MUST translate only the content occurring AFTER the ":" colon, completely ignoring and omitting any Reporter's Source or prefix before the ":" (including the colon itself).
  * FULL AND COMPLETE QUESTION TRANSLATION (STRICT): For the "질문:" section, you MUST fully, completely, and literally translate all information, nuances, contexts, and meanings that appear after the ":" colon mark. Do NOT reduce, summarize, or abbreviate any content in the 질문 section. Every detail must be translated. You MUST strictly structure this translated question using either:
    1. "중국은 [전체 질문 번역 내용]에 대해 어떻게 평가하는가?"
    2. "중국은 [전체 질문 번역 내용]에 대해 추가 설명을 할 수 있는가?"
    Example: If the text is "중국은 이란이 요청을 보냈는지에 대해 추가 설명을 할 수 있는가?", it must fully feature the details of the question without omitting anything.

### METADATA DATE/TIME EXTRACTION RULES (STRICTLY REQUIRED):
1. Extract Datetime from Source: Scan the original Chinese source text header or content to extract the exact date/time (e.g. "2026年05월25일 14:30" or "05월25일 14:30" or "2026-05-25 14:30"). Do NOT look at current reference time unless absolutely no date/time exists in the source text.
2. CST to KST Conversion (1-Hour Addition): 
   - Since original Chinese source times are almost always in Beijing Time (CST, UTC+8), you MUST convert them to Korea Standard Time (KST, UTC+9) by adding exactly 1 hour.
   - For example: Beijing Time 08:30 CST -> 09:30 KST. 14:30 CST -> 15:30 KST. 23:30 CST -> next day 00:30 KST.
3. Fallback: ONLY use the provided Reference Time if there is no date/time mentioned in the Chinese source text.
4. Output Format immediately after briefing title: '[ {Nation}. {Source}. {Month in original text}. {Day in original text}. {HH:MM in original text}({Month}. {Day}. {HH+1:MM}) ]'
   * Example: If nation is 중국, source is 인터넷신화사, and extracted CST is 10월 25일 10:24 (KST 11:24):
     [ 중국. 인터넷신화사. 10. 25. 11:24(10. 25. 12:24) ]
   * Note the periods and single spaces after Nation, Source, Month, Day. The second part's hour must be HH+1 (exactly 1 hour after the first part's HH, using the same KST day or adjusting if HH overflows).

### 요약 (Summary) Rules:
1. Source of Summary (STRICT): The content for the "요약:" section MUST come exclusively from the "대변인" section. You MUST select exactly three key sentences from the translated text of the "대변인" section, and translate them fully into the three bullet points under "요약:".
2. PERSISTENT CONTEXT & HIGH DETAIL ACCURACY (NO COMPRESSION OR OVER-SUMMARIZATION):
   * Just like the target example, the 요약 bullet points can and should be long and detailed. Do NOT aggressively condense, compress, simplify, or shorten the sentences.
   * You MUST preserve all original context, descriptive facts, and key information from the selected "대변인" sentence. The only changes should be the removal of personal names (Zero Name Policy), conversion of country abbreviations to Hanja, applying the comma topic marker, and nominalizing to standard grammatical noun/nominalized verb endings (음슴체).
3. Perspective: All bullet points of the briefing summary MUST be written from the 대변인's perspective, representing what the spokesperson has declared or replied.
4. Concise Terminal Noun Endings (음슴체): Always standardize verb endings to concise noun/nominalized forms (e.g., "~함", "~임", "~음", "~할 것임", "~할 예정임").
5. Headline Style Constraints (No names, Single-Character country abbreviations):
   - ABSOLUTELY NO individual names are permitted anywhere in the 요약 bullet points (especially in the subject or context).
   - CRITICAL Subject Rule: Whenever the subject is/represents Chinese departments or officials, you MUST change the subject strictly to "중국" or abbreviated "中" (e.g. "중국 외교부, ~할 것임" -> "중국, ~할 것임" or abbreviated: "中, ~할 것임").
   - Do NOT use any person's name. Instead, use ONLY the nation abbreviation and occupation/title of the person (e.g., instead of "왕이 외교부장", it MUST be " 中 외교부장").
   - CRITICAL Country Abbreviation Rule: The country single-character abbreviation rule that applies to the title MUST be strictly applied to 요약 as well. When these countries appear (United States, China, South Korea, Japan, and North Korea) anywhere in the bullet (including prefixes/suffixes, e.g. "대미", "대중", "중국-브라질"), you MUST write them as their single-character Hanja abbreviations (美, 中, 韩, 日, 北) (e.g., '대중국' -> '대중' -> '대中', '중국-브라질' -> '中-브라질', '미국 국가' -> '美 국가'). All other countries (e.g., 러시아, 프랑스, 브라질) MUST be written in their full Korean names and not abbreviated!
6. Topic Marker Comma (,): Just like in the title/headline, the comma (,) MUST act as "은/는" (the topic/subject marker after the main subject).
7. Omission of Non-Essential Adverbs & Particles: Non-essential or redundant contextual adverbs (e.g., "상기 방문 기간 동안") should be removed or shortened to keep the summary concise, and relative object particles (like 을/를) should be omitted before nominalized/verb ending predicates (e.g., "~을 주재할 예정이다" -> "~ 주재할 예정임.") to make the flow natural. However, do NOT simplify the key facts of the actions.
8. Text Structure: Excellent structure for each line is: "Subject, ~(translation)~음슴체" (e.g., "美, 이란의 공격 규탄함." or "中 외교부장, 브라질 외교장관과 공동으로 제5차 中-브라질 양국 외교장관급 전면적 전략 대화 주재할 예정임.").
9. Bullet Character: Prefixed with a hyphen ("- ").

### CONCRETE EXAMPLE OF "요약" FORMULATION (STRICT ADHERENCE):
- Original "대변인" sentence: "상기 방문 기간 동안 왕이(王毅) 중국 외교부장은 마우루 비에이라(Mauro Vieira) 브라질 외교장관과 공동으로 제5차 중국-브라질 외교장관급 전면적 전략 대화를 주재할 예정이다."
- Corresponding "요약" bullet point: "- 中 외교부장, 브라질 외교장관과 공동으로 제5차 中-브라질 양국 외교장관급 전면적 전략 대화 주재할 예정임."
  * Step-by-step Transformation analysis based on our rules:
    1. "상기 방문 기간 동안" -> omitted as a redundant contextual introductory adverb phrase.
    2. "왕이(王毅)" -> omitted under the strict NO NAME policy. "중국 외교부장" -> abbreviated to " 中 외교부장" (with leading space after hyphen to align nicely).
    3. Topic particle "은/는" -> replaced strictly with the topic marker comma (,).
    4. "마우루 비에이라(Mauro Vieira)" -> omitted under the strict NO NAME policy, leaving only "브라질 외교장관과".
    5. "중국-브라질" -> abbreviated to "中-브라질" (applying country single-character abbreviations for China). Note that "양측" is banned, so "양국" is used: "中-브라질 양국".
    6. "전면적 전략 대화를" -> object particle "를" is omitted to become "전면적 전략 대화".
    7. "주재할 예정이다." -> nominalized into "주재할 예정임." (음슴체).

### Briefing Output Structure:
The Output Structure MUST strictly follow this exact order: title -> Metadata -> Publisher Name -> 질문: -> 대변인 -> 요약. Do NOT write any introduction lines, extra spokesperson names, or header labels.

1. Title:
. 中--부 대변인, ~~관련 입장 표명
(Where "--부" represents the abbreviated department name in Chinese character style, e.g., . 中 외교부 대변인, ~~관련 입장 표명 or . 中 상무부 대변인, ~~관련 입장 표명. Use comma (,) and ensure no names appear, following the headline rules).

2. Metadata:
[ (Nation). (Source). (Month in original text). (Day in original text). (HH:MM in original text)((Month). (Day). (HH+1:MM)) ]

3. Publisher Name (if provided):
(Publisher Name)

4. Introduction
  'YY.MM.DD일, Korean Name(Chinese Name) ~~부 대변인은 정례브리핑을 실시했다.
Ex. '26. 7. 24일, 린젠(林剑) 중국 외교부 대변인은 정례브리핑을 실시했다. 

5. 질문:
질문: 중국은 (Specific Context)에 대해 어떻게 평가하는가? (또는) 중국은 (Specific Context)에 대해 추가 설명을 할 수 있는가? (또는 context가 없을 시 "중국은 이에 대해 어떻게 평가하는가?", "중국은 이에 대해 추가 설명을 할 수 있는가?")

6. 대변인:
대변인: ~~~

7. 요약:
요약:
- {subject}, {summary}음슴체
- {subject}, {summary}음슴체
- {subject}, {summary}음슴체
`;

interface FewShotExample {
  metadata: string;
  sourceText: string;
  output: string;
}
 
const GENERAL_EXAMPLE: FewShotExample = {
  metadata: `Nation (국가): 중국
Source (매체): 중국외교부
Publisher Name (기자명/배포처): 일병 남상현
Section: General News`,
  sourceText: `王毅同摩尔多瓦副总理兼外长波普绍伊会谈
2026-05-22 08:00
2026年5月21日，中共中央政治局委员、外交部长王毅在北京同摩尔多瓦副总理兼外长波普绍伊举行会谈。
王毅表示，中摩是友好伙伴。双方始终相互尊重、平等互利，稳健推进各领域务实合作，惠及两国人民。中方珍视中摩传统友谊，愿同摩方一道，不断夯实互信，深化互利合作，为双边关系发展注入动力，为两国人民创造福祉，为地区和平稳定作出贡献。
王毅说，中国是负责任大国，坚定不移维护联合国宪章宗旨和原则，主张国家不分大小一律平等。我们赞赏摩方在涉及中方核心利益问题上坚持正确立场，支持摩方走本国人民选择、符合本国国情的发展道路，欢迎摩方挖掘潜力，更深入参与高质量共建"一带一路"。双方要用好中国国际进口博览会等平台，扩大经贸交流；新兴领域合作，打造投资增长点；加强教育、文化、旅游、青年交流，搭建民心相通新桥梁。面对变乱交织的世界，双方要携手践行四大全球倡议，维护好广大发展中国家正当权益。
波普绍伊表示，摩尔多瓦高度重视发展对华关系，钦佩中国悠久历史文化和巨大发展成就，赞赏中国在国际事务中发挥的引领作用。摩方恪守一个中国原则，期待同中方加强互利共赢的伙伴关系，深化经贸、投资、人文和旅游等领域合作，推动摩中关系取得更大发展，更多造福两国人民。摩方愿同中方密切在联合国等多边舞台协作，共同维护多边主义，坚持国际法治，促进国际和地区和平稳定。
双方还就乌克兰危机交换意见。王毅重申中方劝和促谈立场，表示中方将继续为推动危机的政治解决发挥建设性作用。`,
  output: `. 中 외교부장, 몰도바 외교장관과 회동
[ 중국. 중국외교부. 5. 22. 08:00(5. 22. 09:00) ]
일병 남상현
 
'26. 5. 21일, 왕이(王毅) 중국 외교부장은 중국 수도 베이징(北京)市에서 미하이 포페쇼이(Mihai Popsoi) 몰도바 외교장관과 회담을 실시했다.
또한, 왕이 외교부장은 "중국ㆍ몰도바 양국은 우호적 동반자이다. 양국은 항상 상호 존중ㆍ평등ㆍ호혜를 견지하고 각 분야 내 실용적 협력을 안정적으로 추진해 양국 국민에게 혜택을 제공해 왔다. 중국은 양국 간 전통적인 우의를 소중히 여기고 몰도바와 함께 상호 신뢰를 지속해서 강화하며, 호혜적 협력을 심화하길 희망한다. 또한, 중국은 양국 관계 발전에 동력을 주입하고 양국 국민을 위한 복지를 창출하며, 역내 평화와 안정에 기여하길 희망한다."라고 밝혔다.
아울러, 왕이 외교부장은 "중국은 책임감 있는 대국으로서 변함없이 『국제연합 헌장(United Nations Charter)』의 목적과 원칙을 수호하고 국가의 규모와 상관없이 모든 국가가 평등하다는 것을 주장한다. 또한, 중국은 중국의 핵심 이익과 관련된 사안에 대해 올바른 입장을 견지하는 몰도바를 높이 평가한다. 아울러, 중국은 몰도바가 몰도바 국민이 선택한 몰도바 상황에 맞는 발전 경로를 따르는 것을 지지한다. 중국은 몰도바가 잠재력을 발휘하고 '일대일로(一帶一路, 중국-중앙아시아-유럽을 연결하는 육상ㆍ해상 실크로드. 출처: 연합뉴스)' 공동 구축에 심도 있게 참여하는 것을 환영한다. 양국은 '중국국제수입박람회(中国国际进口博览会)' 등 플랫폼을 활용해 경제 무역 교류를 확대하고 신흥 분야 내 협력을 통해 투자 성장 동력을 구축해야 한다. 또한, 양국은 교육ㆍ문화관광ㆍ청년 교류를 강화하고 양국 국민 간 소통을 위한 새로운 교량을 구축해야 한다. 아울러, 양국은 변화와 혼란이 교차하는 국제사회에서 함께 '4대 글로벌 이니셔티브(Global Initiative, 글로벌 발전 이니셔티브(GDI, Global Development Initiative)ㆍ글로벌 안보 이니셔티브(GSI, Global Security Initiative)ㆍ글로벌 문명 이니셔티브(GCI, Global Civilization Initiative)ㆍ글로벌 거버넌스 이니셔티브(GGI, Global Governance Initiative))'를 실천하고 광범위한 개발도상국의 정당한 권익을 수호해야 한다."라고 전했다.
포페쇼이 외교장관은 "몰도바는 중국과의 관계 발전을 매우 중시하고 중국의 오랜 역사와 문화, 중국의 위대한 발전 성과를 높이 평가한다. 또한, 몰도바는 국제 사안에서 중국이 발휘하는 지도력을 높이 평가한다. 아울러, 몰도바는 '하나의 중국(一个中国，중국 대륙과 홍콩, 마카오, 대만은 나뉠 수 없는 하나이고 따라서 합법적인 중국의 정부는 오직 하나라는 원칙. 출처: 중국외교부)' 원칙을 준수하고 중국과의 '호혜공영(互利共赢, 국가 혹은 지역이 협력을 통해 위협ㆍ도전에 대응하고 이익을 추구함으로써 모두의 발전을 이루는 것. 출처: 바이두백과)' 동반자 관계를 강화하길 기대한다. 몰도바는 중국과 경제ㆍ무역ㆍ투자ㆍ인문ㆍ관광 등 다양한 분야 내 협력을 심화하고 양국 관계의 중대한 발전을 추진하며, 양국 국민에게 많은 혜택을 제공하길 희망한다. 또한, 몰도바는 '국제연합(UN, United Nations)' 등 다자 무대에서 중국과 긴밀히 협력하고 함께 다자주의를 수호하길 바란다. 아울러, 몰도바는 국제법을 견지하고 국제사회와 지역의 평화와 안정을 촉진하길 희망한다."라고 밝혔다.
왕이 외교부장과 포페쇼이 외교장관은 우크라이나 위기에 대해서도 의견을 교환했다. 왕이 외교부장은 중국이 평화 회담을 촉진하는 입장을 재확인했으며, "중국은 우크라이나 위기의 정치적 해결을 추진하기 위해 계속해서 건설적인 역할을 발휘할 것이다."라고 전했다.`,
};
 
const BRIEFING_EXAMPLE: FewShotExample = {
  metadata: `Nation (국가): 중국
Source (매체): 중국외교부
Publisher Name (기자명/배포처): 일병 남상현
Section: Government Briefing`,
  sourceText: `2026年5月25日外交部发言人毛宁主持例行记者会
2026-05-25 17:30
中新社记者：据报道，5月24日，巴基斯坦俾路支省一列客运列车遭爆炸袭击，造成重大人员伤亡。"俾路支解放武装"宣称对袭击负责。巴基斯坦总理夏巴兹强烈谴责此次袭击事件，强调将坚定不移打击恐怖主义。请问中方对此有何评论？
毛宁：中方注意到有关报道，强烈谴责此次恐怖袭击事件，对遇难者表示深切哀悼，向伤者和遇难者家属致以诚挚慰问。
中方坚决反对一切形式的恐怖主义，将继续坚定支持巴基斯坦打击恐怖主义，维护社会团结稳定，保护民众安全。中方愿同巴方进一步加强反恐合作，共同维护地区和平安全稳定。`,
  output: `. 中 외교부 대변인, 폭탄 테러 공격 받은 파키스탄 여객 열차 관련 입장표명
[ 중국. 중국외교부. 5. 25. 17:30(5. 25. 18:30) ]
일병 남상현
 
'26. 5. 25일, 마오닝(毛宁) 중국 외교부 대변인은 정례브리핑을 실시했다.
질문: '26. 5. 24일, 파키스탄 발루치스탄(Balochistan)洲에서 여객 열차는 폭탄 테러 공격을 받아 많은 사상자가 발생했다. '발루치스탄해방군(BLA, Balochistan Liberation Army)'은 상기 공격의 배후를 자처했다. 셰바즈 샤리프(Shehbaz Sharif) 파키스탄 총리는 상기 공격을 강력히 규탄했고 테러와의 단호한 싸움을 강조했다. 중국은 이에 대해 어떻게 평가하는가?
대변인: 중국은 관련 보도에 주목하고 상기 테러 공격을 강력히 규탄한다. 또한, 중국은 희생자에 대해 깊은 애도를 표하며, 부상자와 희생자 가족에게 진심 어린 위로를 전한다.
또한, 중국은 모든 형태의 테러리즘에 단호히 반대한다. 아울러, 중국은 파키스탄이 테러리즘을 타격하고 사회 단결과 안정을 수호하며, 국민의 안전을 수호하는 것을 지속해서 확고히 지지할 것이다. 중국은 파키스탄과 대테러 협력을 한층 더 강화하고 함께 역내 평화ㆍ안보ㆍ안정을 수호하길 희망한다.
 
요약:
- 中, 희생자에 대해 깊은 애도 표하고 부상자ㆍ희생자 가족에게 진심 어린 위로 전함.
- 中, 모든 형태의 테러리즘에 단호히 반대함.
- 中, 파키스탄과 대테러 협력 한층 더 강화하고 함께 역내 평화ㆍ안보ㆍ안정 수호하길 희망함.`,
};
 
function getFewShotExample(section: TranslationSection): FewShotExample {
  return section === TranslationSection.GENERAL ? GENERAL_EXAMPLE : BRIEFING_EXAMPLE;
}
 
function buildFewShotUserTurn(example: FewShotExample): string {
  return `
### TRANSLATION METADATA:
${example.metadata}
 
### Relevant Glossary Matches (only entries found in the text below; apply per the Glossary Integration rule):
(example turn - glossary omitted for brevity, rely on general rules)
 
### Original Chinese Source text to translate:
${example.sourceText}
`;
}
 
/* ============================================================================
 * EXPLICIT CONTEXT CACHING
 * ----------------------------------------------------------------------------
 * Both system instructions above are now fully static per section (no more
 * per-request string substitution), so we can cache each of them once with
 * Gemini's caches API and reuse the cache handle on every subsequent call.
 * Cached input tokens are billed at a reduced rate instead of full price.
 *
 * NOTE: context caching has a minimum token-count requirement that varies by
 * model (it has changed across Gemini model generations). Verify the current
 * minimum for "gemini-3.1-flash-lite" against Google's docs - if the combined
 * system instruction text falls under that minimum, ai.caches.create() will
 * simply reject the request, in which case just skip caching and rely on
 * savings (1) and (2) above alone.
 * ==========================================================================*/

const CACHE_MODEL = "gemini-2.5-flash-lite";
const CACHE_TTL_SECONDS = 60 * 60 * 12; // 12 hours; recreate before this expires
type CacheHandle = { name: string; expiresAt: number };
const cacheHandles: Partial<Record<TranslationSection, CacheHandle>> = {};

async function getCachedSystemInstruction(section: TranslationSection): Promise<string | undefined> {
  const existing = cacheHandles[section];
  const now = Date.now();
  if (existing && existing.expiresAt > now + 5 * 60 * 1000) {
    return existing.name;
  }

  const systemInstruction = section === TranslationSection.GENERAL
    ? SYSTEM_INSTRUCTIONS_BASE + GENERAL_NEWS_INSTRUCTIONS
    : SYSTEM_INSTRUCTIONS_BASE + BRIEFING_INSTRUCTIONS;

  try {
    const cache = await ai.caches.create({
      model: CACHE_MODEL,
      config: {
        systemInstruction,
        ttl: `${CACHE_TTL_SECONDS}s`,
        displayName: `translator-${section}`,
      },
    });
    cacheHandles[section] = { name: cache.name as string, expiresAt: now + CACHE_TTL_SECONDS * 1000 };
    return cache.name as string;
  } catch (error) {
    // Caching is a cost optimization, not a correctness requirement - if it
    // fails (e.g. below the model's minimum token threshold, or a transient
    // API error), fall back to sending the system instruction uncached.
    console.warn("Context cache creation failed, falling back to uncached system instruction:", error);
    delete cacheHandles[section];
    return undefined;
  }
}

async function getLearnedPatterns(): Promise<string> {
  try {
    const patternsRef = collection(db, 'learned_patterns');
    const q = query(patternsRef, orderBy('createdAt', 'desc'), limit(15));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) return "";
    
    let patternInstructions = "\n## USER-LEARNED PATTERNS & PREFERENCES (CRITICAL HIGH PRIORITY):\n";
    patternInstructions += "The user has provided authoritative corrections. You MUST adhere strictly to these learned rules, terminology mappings, and sentence structure preferences in your translation:\n";
    
    snapshot.docs.forEach((doc, idx) => {
      const data = doc.data();
      patternInstructions += `\n[Learned Preference #${idx + 1}]\n`;
      if (data.terminology && Object.keys(data.terminology).length > 0) {
        patternInstructions += `- Terminology Mappings:\n`;
        Object.entries(data.terminology).forEach(([zh, ko]) => {
          patternInstructions += `  * Chinese: "${zh}" -> Korean: "${ko}"\n`;
        });
      }
      if (data.transformationRules && Array.isArray(data.transformationRules) && data.transformationRules.length > 0) {
        patternInstructions += `- Transformation, Formatting, Style & Structural Rules:\n`;
        data.transformationRules.forEach((rule: string) => {
          patternInstructions += `  * ${rule}\n`;
        });
      }
    });
    
    return patternInstructions;
  } catch (error) {
    console.error("Error fetching learned patterns:", error);
    return "";
  }
}

export async function translateNews(
  text: string, 
  section: TranslationSection,
  sourceName: string = "인터넷신화사",
  publisherName: string = "",
  nation: string = "중국"
): Promise<string> {
  const [learnedPatterns, cachedContentName] = await Promise.all([
    getLearnedPatterns(),
    getCachedSystemInstruction(section),
  ]);

  const relevantGlossary = getRelevantGlossary(text);
  const publisherLine = publisherName && publisherName.trim()
    ? publisherName.trim()
    : '(none - completely omit the (Publisher Name) line from output)';

  // Compact per-request prompt: metadata + the small filtered glossary +
  // source text + any learned corrections. Everything else (all the
  // structural/grammar/formatting rules) already lives in the cached system
  // instruction and does not need to be restated here.
  const prompt = `
### TRANSLATION METADATA:
Nation (국가): ${nation}
Source (매체): ${sourceName}
Publisher Name (기자명/배포처): ${publisherLine}
Section: ${section === TranslationSection.GENERAL ? 'General News' : 'Government Briefing'}

### Relevant Glossary Matches (only entries found in the text below; apply per the Glossary Integration rule):
${relevantGlossary}

### Original Chinese Source text to translate:
${text}
${learnedPatterns}
`;

  // If the system instruction wasn't (or couldn't be) cached, fall back to
  // sending it directly so translation quality is unaffected either way.
  const fallbackSystemInstruction = cachedContentName
    ? undefined
    : (section === TranslationSection.GENERAL
        ? SYSTEM_INSTRUCTIONS_BASE + GENERAL_NEWS_INSTRUCTIONS
        : SYSTEM_INSTRUCTIONS_BASE + BRIEFING_INSTRUCTIONS);

  try {
    const response = await ai.models.generateContent({
      model: CACHE_MODEL,
      contents: prompt,
      config: {
        ...(cachedContentName ? { cachedContent: cachedContentName } : {}),
        ...(fallbackSystemInstruction ? { systemInstruction: fallbackSystemInstruction } : {}),
        temperature: 0.1,
        topP: 0.4,
        topK: 20,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }
      }
    });

    return response.text || "Translation failed.";
  } catch (error) {
    console.error("Translation error:", error);
    throw error;
  }
}

export async function saveCorrection(
  sourceText: string,
  aiTranslatedText: string,
  userCorrectedText: string,
  section: TranslationSection
): Promise<any> {
  try {
    // Save raw corrections to corrections collection for audit/history
    await addDoc(collection(db, 'corrections'), {
      sourceText,
      aiTranslatedText,
      userCorrectedText,
      section,
      createdAt: serverTimestamp()
    });

    const prompt = `
You are an expert Chinese-to-Korean translation pattern analyzer for a news agency.
Your task is to analyze the original Chinese text and the user-corrected Korean translation to detect terminology mappings, stylistic preferences, and alignment patterns.

### INPUT DATA
1. Original Chinese Text:
"${sourceText}"

2. User-Corrected Korean Translation:
"${userCorrectedText}"

### WORKFLOW RULES (STEPS 3-6)
- Analyze sentence alignment between the Chinese and user-corrected Korean text.
- Detect:
  * Terminology mappings (especially diplomatic, military, or country terms)
  * Quotation structures and punctuation preferences
  * Sentence structures and grammar preferences
  * Yonhap-style news agency formatting and title formatting rules
  * Recurring translation patterns
- Extract key reusable translation knowledge.
- Generate structured translation rules.

### IMPORTANT SYSTEM RULES (MUST BE RESPECTED STRICTLY):
- Never summarize articles.
- Never modify user-corrected translations.
- Always preserve full sentence structures.
- Always prioritize user-provided translations as authoritative.
- Always maintain Yonhap-style Korean news formatting.
- Always preserve paragraph structure.
- Never hallucinate missing content.

### OUTPUT FORMAT
You MUST return ONLY a JSON object with the following structure. Do not output any introducing remarks, wrapping explanations, or markdown boxes. Output raw JSON.

Structure:
{
  "terminology": {
    "chinese_words": "korean_corrected_translation"
  },
  "transformationRules": [
    "Specific rule describing quotation styles, country/military conventions, sentence transformations, or grammatical structures learned from this correction"
  ]
}
`;

    const response = await ai.models.generateContent({
      model: CACHE_MODEL,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    });

    const responseText = response.text || "{}";
    const cleanJson = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const result = JSON.parse(cleanJson);

    // Save extracted patterns to the translation memory database (Firestore)
    const patternDoc = {
      chineseText: sourceText,
      koreanText: userCorrectedText,
      terminology: result.terminology || {},
      transformationRules: result.transformationRules || [],
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'learned_patterns'), patternDoc);
    
    console.log("Correction saved and translation patterns learned successfully:", patternDoc);
    return patternDoc;
  } catch (error) {
    console.error("Error saving correction/learning patterns:", error);
    throw error;
  }
}

export interface LearnedPatternItem {
  id: string;
  chineseText: string;
  koreanText: string;
  terminology: Record<string, string>;
  transformationRules: string[];
  createdAt?: any;
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
    console.error("Error fetching all learned patterns:", error);
    return [];
  }
}

export async function deleteLearnedPattern(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'learned_patterns', id));
  } catch (error) {
    console.error("Error deleting learned pattern:", error);
    throw error;
  }
}

/**
 * Simulates a process that analyzes corrections to find recurring patterns.
 * In a real production app, this would be a cloud function.
 */
export async function analyzeCorrections() {
  // Mock analysis result for UI feedback
  return {
    topTerms: ['경제무역', '엄정한 항의', '양국 관계'],
    lastAnalyzed: new Date().toISOString()
  };
}