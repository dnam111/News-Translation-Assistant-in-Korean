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

## ABSOLUTELY NO '측' OR '들' IN ANY SECTION (STRICT BANNED)
- Under no circumstances are you allowed to use the Korean character '측' (e.g., '중국측', '미국측', '상대측', '양측', '우리측') or the Korean character '들' (e.g., '기자들', '양국들', '사람들', '기업들', '그들', do NOT use plural helper particle '들' at all!) in any translated section of the output, including headlines, body, questions, spokesperson comments, or summaries.
- You MUST replace '측' entirely with the explicit name of the entity or standard words (e.g., replace '중국측' with '중국', '미국측' with '미국', '양측' with '양국', '상대측' with '상대방', etc.). This is a zero-tolerance prohibition!
- You MUST omit or rephrase any instances of '들' by using singular forms or alternative phrasing (e.g. refer to '기자', '양국', '사람', '기업', etc. directly without adding '들'). This is a zero-tolerance prohibition!
- Exception: The specific glossary string for "4대 주장", which contains "양측", is permitted to keep that '측' because the user explicitly requested that exact literal translation style, but nowhere else. The character "들" remains strictly prohibited absolutely everywhere.

## STRICT PROHIBITION of Honorific Endings & Style Ends
- Do NOT use honorific sentences ending in "~했습니다", "~체", "~습니까", "~습니다" or similar honorific verb styles.
- You MUST use the objective, plain declarative news style ending strictly in "~했다", "~했다.", or "~했다/밝혔다/전했다".

## MANDATORY CONSTRAINT VERIFICATION (CRITICAL STEP)
Before outputting your final translation, you MUST perform a sentence-by-sentence check against ALL "Sentence Rules" listed below.
If a sentence violates any rule, you MUST split it or rephrase it until it complies.
Failure to follow these rules is a critical failure.

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
     * 今天 -> Specific numeric date in metadata format (e.g., '26. 5. 25일).
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
   - Company Naming: "Country + company name (English) + 社" (e.g., 미국 Lockheed Martin社).
   - Regulation Formatting: Treat 『』 for regulations, ordinances, treaties, and media entities.
3. Individual Naming & Title Structures:
   - Official Title (Strict Single-Role Limit): You must pick exactly one representative occupation per individual. 
     * Prohibited: Combining multiple titles, mentioning dual roles (겸직), or using the connective word "겸" anywhere in the translation. Discard secondary occupations completely.
     * Priority Rule: If an individual holds multiple roles, prioritize the foreign affairs role (e.g., 외교장관, 외무장관, 외교부장) over any executive roles (e.g., 총리, 부총리). Use Search to verify if ambiguous.
   - Naming Presentation Flow:
     * First Mention: 이름(원어명) 국적 직책 (e.g., 푸충(傅聪) 중국 대사). Use Chinese Hanja characters in the parenthesis for individuals from South Korea, North Korea, Japan, China, Taiwan, and Hong Kong (e.g. 푸충(傅聪) 중국 대사).
     * For individuals/people from any OTHER countries than China, Japan, South Korea, Taiwan, Hong Kong, and North Korea, you MUST put the English name inside the parentheses. Example: 미국 바이든 -> 조 바이든(Joe Biden) 미국 대통령.
     * Subsequent Mentions: 이름 직책. Do not use pronouns like "그" or "그녀". Always explicitly repeat [Name] [Title].
   - Diplomatic Title Structures: For titles structured as 'Country/Org + 驻 + Rank', follow this exact syntax blueprint:
     * First Mention: [Name](원어명) [Country/Org]주재 [Rank] (e.g., 푸충(傅聪) 국제연합(UN, United Nations) 주재 중국 대사).
     * Subsequent Mentions: [Name] 대사.
4. Absolute Sentence-Level Grammar Rules:
   - Subject & Particle Law: Every single sentence must start with a subject or noun phrase. The subject must immediately be followed by the particle '은' or '는'. Exactly one '은' or '는' is permitted per sentence.
   - Conjunction Clauses: When connecting text using sequence clauses, ~고 must appear first, followed subsequently by '~며,'. The marker '~며,' cannot stand alone if ~고 is missing from that sentence sequence. If this structure is broken, split the text into two distinct sentences.
   - Strict Vocabulary Bans: Under no circumstances use the word '측' or the Korean character '들' anywhere in any translation (including headlines, body, and summaries). Replace it with the subject's explicit name or title (e.g. replace '중국측' with '중국', '미국측' with '미국', '양측' with '양국'). Rephrase or omit '들' entirely by using singular nouns or alternative phrasing. Never use the word '덧붙였다'. (Exception: The specific 4대 주장 string containing '양측' is allowed to retain '측', but '들' is strictly prohibited everywhere).
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
   - Glossary Integration: If a word matches an entry in your provided Terminology Glossary, use the target Korean phrase and append the glossary's contextual description inside parentheses.
     * Example: ‘하나의 중국(空间, 중국 대륙과 홍콩, 마카오, 대만은 나뉠 수 없는 하나이고 따라서 합법적인 중국의 정부는 오직 하나라는 원칙)’ 원칙
   - Dynamic Matching: If a translated Korean phrase appears on the left side of your provided glossary, replace it immediately with the preferred phrase on the right side of the glossary.

## Terminology Glossary (STRICT MAPPING)
- 동의: 합의
- 칭찬하다/감사의 뜻을 표하다 : 높게 표하는 바이다/높게 평가하다
- 회담 진행 : 회담을 실시했다 (제목: 회동)
- 고도로 주의 : 매우 우려
- 인민 : 국민 (대만: 주민)
- 소원 : 염원/개인적 바람
- 지역 : 역내
- 올라가다/도약 : 격상
- 국방부 장관 : 국방장관
- 외교부 부장 : 외교부장
- 지속적으로 : 지속해서
- 끊임없이 : 지속해서
- 세계 : 국제사회 (Always map '세계' to '국제사회' in the destination translation based on context)
- 견지 : 지지
- 이번 : 상기
- 사안/문제 : 사안
- 어려움 : 난관
- 나아가며 : 전진하며
- 모든 부정적인 것 : 우려를 표하다
- 통화 진행 : 전화 회담 실시
- 무시 : 왜곡
- 파트너 : 동반자
- ~한다(informal) : ~한 바이다
- 하고싶다 : 희망한다
- ~에 불구하고 : 막론하고
- ~것이다 : ~예정이다
- 새로운 : 신형
- 큰 : 보다 높은 수준의
- 마지막 : 최종
- ~때문 : ~에 비롯함
- 다른 국가 : 타국
- 전방 : 전진
- ~에 위치 : 소재
- 생산률 감소 : 하향 조정
- 고통 : 난제
- 개방 : 재개
- 안전 : 안보
- 보호 : 수호
- 하였고 : 했고
- 이 : 상기
- 이런: 상기
- 유엔: '국제연합(UN, United Nations)' 
- 안전보장이사회: '국제연합 안전보장이사회(UNSC, Untied Nations Security Council)'
- 할수있기를 : 하길
- 共识: 공동인식
- 글로벌 사우스: ‘글로벌 사우스(Global South, 남반구나 북반구의 저위도에 위치한 아시아, 아프리카, 남아메리카의 개발도상국가)’
- 신(新)육해무역회랑 : 신(新)육해무역회랑(Land-Sea Trade Corridor)
- 十五五 : 제15차 5개년 계획
- '12ㆍ5' 규획 : '12ㆍ5' 규획(제12차 경제개발 5개년 계획, ’11∼’15년)
- 13ㆍ5 계획 : 13ㆍ5 계획(제13차 경제개발 5개년 계획, ’16∼’20년)
- 제14차 5개년 : 제14차 5개년(2021∼2025년) 계획
- 7년행동계획 : 7년행동계획(2019-2025년 중국 유전ㆍ가스전 탐사 및 생산 발전 계획)
- 혁신구동발전전략 : 혁신구동발전전략(혁신을 통한 발전 전략)
- 동북진흥 : 동북진흥(동북3省 공업기지 혁신 전략)
- 중국제조 2025 : 중국제조 2025(산업고도화 전략)
- 두 개의 백년 : 두 개의 백년(중국 공산당 창당 100주년/건국 100주년 목표)
- 첫 번째 백년 : 첫 번째 백년(공산당 창당 100주년 2021년에 전면적 샤오캉)
- 두 번째 백년 : 두 번째 백년(건국 100주년 2049년에 사회주의 현대화 국가 건설)
- 주체기능구 : 주체기능구(지역별 개발/보존 공간 계획)
- 남수북조 : 남수북조(남부 담수를 북부로 공급)
- 서부개발 : 서부개발(서부 균형발전 전략)
- 서기동수 : 서기동수(서부 천연가스를 동부로 운송)
- 당의 건설 : 당의 건설(윤리 정책 및 조직 강화)
- 삼보주 : 삼보주(현대화 발전전략)
- 루반공방 : 루반공방(직업교육센터)
- 全方位战略伙伴关系/全面战略伙伴关系 : 전면적인 전략적 동반자 관계
- 中华人民共和国成立 : 중화인민공화국 수립
- 双重标准 : 이중잣대
- 政治互信 : 정치적 상호 신뢰
- 互补 : 상호보완적
- 一贯 : 시종일관
- 多边机制 : 다자간 플랫폼
- 和平与安全 : 평화ㆍ안보
- 切实 : 착실
- 深入战略沟通 : 심도 있는 전략적 소통
- 广泛共识 : 광범위한 공동 인식
- 深厚民意基础 : 두터운 민의를 기반으로 한다
- 落实 : 착실히 이행
- 命运共同体 : 운명공동체
- 领土完整 : 영토 완전성
- 铁杆友谊 : 돈독한 관계/우의
- 取得积极进展 : 긍정적 진전을 이뤘다.
- 单方面免签 : 일방적 비자 면제 정책
- 富有成果 : 생산적인
- 一系列 : 일련의
- 自贸协定升级版谈判 : 자유무역 협정 업그레이드 협상
- 保护主义 : 보호주의
- 逆全球化 : 반세계화
- 中国共产党二十届三中全会 : 중국공산당 제20기 중앙위원회 제3차 전체회의
- 共同协调员 : 조정국의 일원
- 健康稳定发展 : 정상적ㆍ안정적 발전
- 确保 : 확고히 보장
- 高度赞赏 : 높이 평가
- 矛盾 : 갈등
- 密切 : 긴밀
- 友好年 : 우정의 해
- 对话合作机制 : 대화 협력 메커니즘
- 重启 : 재개
- 健康稳定 : 건전한
- 共同 : 함께
- 开展建设性沟通 : 건설적인 소통을 진행
- 加沙冲突 : 가자지구 역내 충돌
- 保护贸易主义 : 보호무역주의
- 把握先机 : 기회 포착
- 全力推动 : 전적으로 추진
- 协调配合 : 조율ㆍ협력
- 不断迈上新台阶 : 지속해서 새로운 단계로 격상
- 挑衅 : 도발 감행
- 不折不扣 : 영락없는
- 虚假叙事 : 허위 서사
- 敦促 : 촉구
- 死路一条 : 파멸
- 必将自食恶果 : 자업자득을 면하지 못할 것
- 台独 : 대만 독립운동(台独)
- 引火烧身 : 스스로 화를 불러 일으키는 것
- 再次 : 재차
- 通话 : 전화 회담
- 近日 : 조만간
- 主席国 : 의장국
- 发送贺电 : 축전 전달
- 传统 : 기존의 관례/관례적
- 致力/不懈努力 : 총력을 기울일 것
- 提供了有力支撐 : 기반을 다졌다
- 志同道合 : 뜻을 같이하다
- 消除 : 척결
- 打击 : 타격
- 挂钩 : 연관시키다
- 地缘政治空前紧张 : 유례없는 지정학적 긴장
- 惨无人道 : 극악무도
- 反恐 : 대테러
- 百年未有 : 전례 없는
- 此起彼伏 : 지속적으로 발생하는
- 协调作用 : 조정 역할
- 从源头上铲除 : 근절
- 赋能增效 : 동력 부여와 효율 개선
- 帮助 : 지원
- 交付 : 납품/보급
- 双赢 : 양측 모두에 유리한
- 询答 : 질의응답
- 韧性 : 복원력/회복력
- 国防厂商 : 방산업체
- 产业升级 : 산업 고도화
- 讨论热烈 : 열띤 토론
- 高科技 : 첨단
- 具备 : 보유
- 国防产业 : 방위 산업
- 注入了新动力 : 새로운 동력을 부여했다
- 最高领导人 : 최고지도자
- 本币结算 : 현지 통화 결제
- 全球治理 : 글로벌 거버넌스
- 同志加兄弟 : 동반자이자 형제
- 传统友谊 : 전통적 우의
- 胡志明陵 : 호찌민 묘소
- 敬献花圈 : 헌화
- 头等优先 : 최우선순위
- 拓展...合作 : 협력 확대
- 尽快 : 조속히
- 军事能力 : 군사적 역량
- 涉及 : 포괄하고 있다
- 发表言论 : 발언
- 避免 : 삼가야 한다
- 认知 : 인식도/인지도
- 有关方面 : 당사자
- 逐步 : 점진적
- 未来 : 향후
- 变革期 : 변혁기
- 紧跟 : 발맞춰
- 把握 : 붙잡다
- 崛起 : 부상
- 自强 : 발전
- 高质量 : 수준 높은
- 面临 : 직면
- 乌克兰危机 : 러시아-우크라이나 전쟁
- 创新 : 혁신
- 人口众多 : 방대한 인구
- 良好典范 : 모범적인 본보기
- 好伙伴 : 훌륭한 동반자
- 以巴冲突 : 이스라엘-하마스 전쟁
- 兩岸 : 양안(중국과 대만)
- 第十五届中国国际航空航天博览会新闻发布会 : 제15회 중국국제에어쇼 기자회견
- 美军印太总部/美國印太司令部 : 인도태평양사령부(USINDOPACOM)
- 欧盟 : 유럽연합(EU)
- 中國海警局 : 중국 해양경찰국
- 二十国集团 : 주요 20개국(G20)
- 联合国全球反恐战略 : 유엔 세계 대테러전략(UNGCTS)
- 第三届“一带一路”国际合作高峰论坛 : 제3회 일대일로 국제협력 정상포럼
- 长臂管辖 : 확대 관할
- 蓝色伙伴关系 : 블루 파트너십(Blue Partnership)
- 孔子学院 : 공자학원
- 倾销 : 덤핑(Dumping, 채산을 무시하고 싼 가격으로 상품을 투매하는 일)
- 反倾销 : 반덤핑
- 反补贴 : 상계관세
- 强硬两手 : 강온양면전술
- 经济转型 : 경제 패러다임 전환
- 一促两稳 : 일촉양안(一促两稳, 소비 촉진과 대외무역 및 외자 안정)
- 三服务 : 3복무(三服务, 지도자ㆍ서민ㆍ민중에 복무하다)
- 三網一化 : 삼망일화(三網一化, 고속철ㆍ고속도로ㆍ지역항공 건설 및 인프라 산업화)
- 三去一降一补 : 3거1강1보(三去一降一补, 부동산 재고 해소ㆍ과잉생산설비 해소ㆍ금융리스크 최소화ㆍ비용절감ㆍ단점보완)
- 兩廊一圈 : 양랑일권(兩廊一圈, 중국-베트남 間 협력발전 중 두 개의 경제벨트와 하나의 경제권을 뜻함)
- 四个着力 : 4개 착력(四个着力, 체제 시스템 완비, 구조 조정 추진, 혁신 창업 격려, 민생 보장 및 개선)
- 五险一金 : 오험일금(오험일금, 다섯 개의 보험(양로보험, 실업보험, 공상보험, 의료보험, 생육보험)과 한 개의 기금(주택공적금))
- 简政放权 : 간정방권(간정방권, 정부와 기업의 기구를 간소화하고 권한을 하부 기관에 이양하다)
- 国内生产总值 : 국내총생산(GDP)
- 北黄海经济带 : 북황해경제벨트
- 长江经济带 : 장강 경제벨트(长江经济带)
- 粤港澳大湾区 : 웨강아오대만구(粤港澳大湾区)
- 专属经济区 : 배타적 경제수역(EEZ)
- 硬联通 : 경연통(硬联通, 도로, 철도, 항구 등 기초 시설 연결)
- 软联通 : 연연통(软联通, 규정, 제도 표준화 연결)
- 心联通 : 심연통(心联通, 마음 연결)
- 两高行业 : 양고업계(높은 에너지 소비율과 오염도)
- 两个毫不动摇 : 두 개의 요지부동
- 供给侧结构性改革 : 공급측구성개혁
- 散乱污企业 : 산롼우기업(산업정책 미부합, 오염방지조치 미비 기업)
- 八大行动 : 팔대행동
- 五个更加注重 : 5개 추가집중사항
- 飞地经济 : 영지경제(enclave economy)
- 破七 : 포치(달러당 7위안 돌파)
- 新东北现象 : 신동북현상
- 兴边富民 : 흥변부민(변방지역 진흥 및 변방주민 부유화)
- 絲路基金 : 실크로드펀드
- 去库存、去产能、去杠杆 : 부동산 재고/과잉생산설비 해소ㆍ금융리스크 최소화
- 人民币合格境外机构投资者 : 위안화 적격외국인투자자(RQFII)
- 工业4.0 : 인더스트리 4.0
- 約談 : 웨탄(조사 및 교육)
- 大宗商品 : 대량 상품
- 集疏运 : 집소운(화물 모으고 운반)
- 最后一公里 : 라스트 킬로미터(최종 배송단계)
- 政产学研用 : 정산학연용(정부, 기업, 대학, 연구소 결합)
- 创业板 : 차스닥(중국판 나스닥)
- 实体清单 : 엔티티 리스트(블랙리스트)
- 碳达峰、碳中和 : 30 탄소피크, 60 탄소중립
- 两个确立 : 2개 확립
- 六个更 : 6가지 보다
- 科创板 : 과학혁신판(중국판 NASDAQ)
- 产业集群 : 산업 클러스터(기업과 기관 시너지 산업단지)
- 冷发射 : 콜드런치(탄도탄 냉발사체계)
- 舷号 : 선체 번호
- 中共中央军事委员会 : 중국 공산당 중앙군사위원회(中共中央军事委员会, 이하 중앙군사위)
- 232措施 : 무역확장법 232조(수입제한법)
- 301调查 : 통상법 301조 / 슈퍼 301조(불공정 무역 보복관세 근거)
- 相控阵雷达 : 페이즈드 어레이 레이더(빔 각도 변환 레이더)
- 网格 : 인터넷 대형 격자(전면 연결/유통망)
- 亚马尔液化气 : 야말(Yamal) 액화가스
- 导航电文 : 항법 메시지
- 大农业 : 대농업(농ㆍ임ㆍ목축ㆍ어업 포함)
- 接口控制文件 : 인터페이스 통제문서(ICD)
- 硬着陆 : 경착륙(급격한 경기 냉각)
- 软着陆 : 연착륙(점진적 경기 침체/성장률 하향)
- 码头 : 선착장
- 鸭式布局 : 커나드 항공기
- 分导式多弹头 : 다탄두각개유도미사일(MIRV)
- GPS : 범지구위성항법시스템(GNSS)
- 完全的、可验证的、不可逆的弃核 : 완전하고 검증가능하며 불가역적인 핵폐기(CVID)
- 非色散位移单模光纤 : 비분산형 단일모듈 광섬유
- 导弹及其技术控制制度 : 미사일기술통제체제(MTCliR)
- 水雷反制 : 기뢰대항책
- 部署水雷/布雷 : 기뢰 부설
- 港区扫雷舰 : 소형 소해정
- 射控雷达 : 사격통제 레이더
- 沉底雷 : 침저기뢰
- 漂雷 : 부유기뢰
- 上升水雷 : 부상기뢰
- 潜射自走雷 : 잠수함 자주기뢰
- 遥控雷 : 원격기뢰
- 载台 : 기뢰부설 플랫폼
- 布雷轨道 : 기뢰망
- 水雷作战 : 기뢰전
- 火箭上升水雷 : 로켓부상기뢰
- 外挂布雷舱 : 후크형 기뢰부설실
- 布雷封锁 : 기뢰 부설을 통한 봉쇄/봉쇄
- 扫雷舰 : 소해정
- 潜猎舰 : 구잠정
- 快攻潜舰 : 속공 잠수함
- 空投水雷 : 공중 투하 기뢰
- 战场 : 전선
- 验证飞行器 : 실험비행체
- 可重复使用 : 재사용 가능
- 控制信号 : 제어 신호
- 网络电磁空间 : 사이버 공간
- 梯队 sistema : 에셜론(Echelon)
- 信息欺骗 : 정보 기만
- 对抗 : 유동적 대항/대항전
- 网络基因组 : 사이버 게놈(cyber genome)
- 网络化指挥系统 : 네트워크화 지휘시스템
- 网络接管 : 네트워크 인터셉트
- 网电基因 : 사이버 유전자(Cyber gene)
- 物联网 : 사물 인터넷(IoT)
- 作战者 : 작전 수행 요원
- 蜜钥 : 비밀키(Secret Key)
- 天基信息系统 : 우주 정보 시스템
- 影响分析 : 영향력 분석
- 军用卫星 : 군사위성
- 民用卫星 : 민간위성
- 空间分辨率 : 공간 해상도(Spatial Resolution)
- 超光谱成像技术 : 초분광 영상기술
- 时间分辨率 : 시간 해상도
- 光谱分辨率 : 분광 해상도
- 侦察卫星 : 정찰위성
- 成像侦察卫星 : 영상정찰위성
- 导弹预警卫星 : 미사일탐지위성
- 电子侦察卫星 : 전자정찰위성
- (信号)屏蔽 : 차폐
- 光学成像技术 : 광학 영상기술
- 全球信息栅格 : 범세계 정보 격자(GIG)
- 谱段 : 분광대
- 转型信卫星 : 변형 통신위성
- 雷达覆盖区 : 레이더 포착범위
- 星间链路 : 위성링크
- 莫尔纹 : 모이레(Membrane Optical Imager 프로젝트)
- 天基红外系统 : 우주 적외선 시스템(SBIRS)
- 多光谱成像技术 : 다중분광영상기술
- 数字信道机 : 디지털 트랜스시버
- 先进极高频系统 : 고등극고주파 시스템(AEHF)
- 动中通 : SOTM(움직이며 통신)
- 极高频 : 극고주파(EHF)
- 特高频 : 극초단파(UHF)
- 空间定向性 : 공간 지향성
- 宽带码分多址 : 광대역 코드분활 다중접속(WCDMA)
- 误码率 : 오류율
- 载波 : 반송파
- 空间互联网通信 system : 우주 인터넷 통신 시스템
- 信息包 : 패킷(Packet)
- 星载路由器 : 위성 탑재 인터넷 공유기
- 频段 : 채널/주파수대
- 全球定位系统 GPS : 지구위치시스템
- 空间段, 地面控制段 : 우주 부분, 지상 제어 부분
- 地面段 : 지상국
- 卫星星座 : 군집 위성
- 下一代地面控制段(OCX) : 차세대 지상 제어 부분
- 授时 : 시보(Time Service)
- 顶层设计 : 톱다운 설계
- 综合电子信息系统 : 통합 전자정보처리시스템
- 武器系统 : 무기 체계
- 全球指挥控制系统 : 범세계 지휘통제체계
- 记载通信节点技术 : 전장항공 통신 노드(BACN)
- 时敏目标 : 시한성 긴급표적
- 网络中心战 : 네트워크중심전
- 多输入/多输出雷达 : 다중입출력(MIMO) 레이더
- 频谱 : 주파수 스펙트럼
- 认识计算 : 지각 컴퓨팅
- 光电探测器 : 광 검출기
- 孔径积 : 개구면
- 卫星分辨率 : 위성 해상도
- 穿透力 : 투과력
- Universal Operational Picture : 공통작전 상황도
- Cognitive Computer : 인지 컴퓨터
- Electomagnetic Spectrum : 전자 스펙트럼
- 上行链路 : 업링크
- 下行链路 : 다운링크
- 不可克隆 : 복제 불가능성
- 掠海导弹 : 시스키밍 미사일
- 二维多视角布局 : 다시각적 2차원 배열
- 脉冲数 : 펄스 수
- 多普勒分辨率 : 펄스도플러
- 多基地MIMO雷达 : 멀티 스태틱 레이더
- 宽带MIMO成像雷达 : 광대역 MIMO 영상레이다
- 空，时，能管理技术 : 공간/시간/에너지 관리 기술
- 运动平台 : 운동구현장치
- 美国国防高级研究计划局 : 미국 국방 첨단과학기술 연구소(DARPA)
- 列装 : 전력화된
- 数字有源相控阵雷达 : 디지털 능동형 위상 배열 레이더
- 前缘 : 리딩 엣지(Leading Edge)
- 后缘 : 트레일링 엣지(Trailing Edge)
- 永磁直线同步电机 : 영구자석형 동기발전기(PMSG)
- 电子战 : 전자전(Electronic Warfare)
- 综合电力系统 : 통합 전기추진시스템
- 电磁弹射器 : 전자기식 사출장치(EMALS)
- 蒸汽弹射器 : 증기식 캐터필트
- 阻拦装置 : 강제착륙장치(AAG)
- 应力 : 응력(Stress)
- 联合精确进场着舰／陆引导系统 : 합동 정밀접근 및 착륙/착선 체계(JPALS)
- 可见光传感器 : 가시광 센서
- 万向架 : 짐벌(Gimbal)
- 模块化分离式卫星 : 분리모듈우주선
- 精确制导武器 : 정밀유도병기(PGM)
- 金属丝 : 채프(Chaff)
- 进口替代补贴 : 수입 대체보조금
- 国民待遇原则/国民待遇义务 : 내국민대우의 원칙
- 普级, 军级, 特军级, 超特军级, 宇航级 : JANS급
- 亚米级 : 서브미터급
- 电子对抗 : 전자 방해(ECM)
- 战斗机挂架 : 전투기 파일런
- 一站双控 : 일참쌍공(한 지휘소에서 2대 무인기 동시 조종)
- 偵打一體 : 정찰·공격 일체화(또는 무장 탑재 무인정찰기)
- 系列 : 계열
- 在轨标校 : 온 오빗 캘리브레이션(궤도 자세 교정)
- 集團 및 集團公司 : 집단회사
- 交换节点 : 교환 노드
- 渦槳發動機 : 터보프롭 엔진
- 活塞式 : 피스톤
- 超視距打擊 : 비가시권 공격(BVR)
- 中高度長航 : 중고도 장기체공(MALE)
- 高空長航 : 고고도 장기체공(HALE)
- 反介入/區域拒止 : 반접근/지역거부(A2AD)
- 关键信息基础设施 : 핵심 정보 인프라 시설
- 环绕器 : 궤도 선회선
- 滑轨 : 레일
- 着巡组合体 : 로버(탐사차)
- 全球海洋支点 : 해양강국 비전
- 雅万高铁 : 인도네시아 자카르타-반둥 고속철도
- 春苗行动 : 춘먀오 행동(해외 거주민 백신지원)
- 全球互联互通倡议 : 세계적으로 연결된 유럽(Global Gateway)
- 南海战略态势感知 : 남중국해전략태세감지계획(SCSPI)
- 世卫组织 : 세계보건기구(WHO)
- 世卫大会 : 세계보건총회(WHA)
- 东伊运 : 동투르키스탄이슬람운동
- 全面与进步跨太平洋伙伴关系协定 : 포괄적ㆍ점진적 환태평양경제동반자협정(CPTPP)
- 全球发展倡议 : 글로벌 발전/안보/문명 이니셔티브
- 글로벌 게이트웨이 : 유럽 역외 인프라 건설투자 계획
- 反送中/修例风波 : 홍콩 반송중 운동
- 共同但有区别的责任 : 공동의 차별화된 책임(CBDR)
- 中俄关于相互通报发射弹道导弹 and 航天运载火箭의协定 : 중-러 탄도미사일/우주로켓 발사 통보 합의
- 台湾中央流行疫情指挥中心 : 대만 중앙유행전염병지휘센터(CECC)
- 三农 : 삼농(농업ㆍ농촌ㆍ농민)
- 全过程人民民主 : 전 과정 인민민주
- 普惠金融 : 인클루시브 금융(Inclusive Finance)
- 中国第13기 전국인민정치협상회의 5차 회의 : 제13기 전국정협 5차 회의
- 五眼联盟 : 파이브 아이즈(Five Eyes)
- 四边机制 : 쿼드(Quad, 4개국 안보 협의체)
- 三边安全伙伴关系 : 오커스(AUKUS, 3개국 안보 동맹)
- 《蓝色太平洋2050战略》 : 청 태평양 2050 전략
- 四个充分尊重 : 4개 존중(소수민족 다양성 존중 정책)
- 中国国务院联防联控机制 : 중국 국무원 합동방역기구
- 动态清零 : 제로 코로나
- 管理控制区域 : 관리통제구역
- 互利共赢 : 호혜공영(협력을 통한 이익 추구)
- 合作共赢 : 합작공영(협력을 통한 모두의 발전)
- 绿色转型 : 그린 트렌스포메이션(친환경 경영 전환)
- 基础加强剂 : 기초접종(Additional Dose)
- 四不一无意 : 사불일무의(中-美 관계)
- 两国方案 : 양국 방안(이스라엘-팔레스타인 분쟁)
- 八大共同行动 : 8대 공동행동
- 新兴经济体 : 신흥경제체
- 六个现代化 : 6개 현대화
- 六点共识 : 6가지 공동인식(러-우 전쟁 관련)
- 十大伙伴行动 : 10대 동반자 행동
- 建军一百年奋斗目标 : 건군 100년 분투 목표('27년 군 현대화)
- 苏杰生 : 수브라마냠 자이샨카르(Subrahmanyam Jaishankar) 인도 외교장관
- 埃蒂安法国外事顾问 : 필리프 에티엔(Philippe Etienne) 프랑스 외교보좌관
- 法国国民议会第一副议长博纳尔 : 캐롤 뷰로 보나드(Carole Bureau-Bonnard) 프랑스 국민의회 副의장
- 纳米比亚总统根哥布 : 하게 게인고브(Hage Geingob) 나미비아 대통령
- 纳米比亚开国总统努乔马 : 샘 누조마(Sam Nujoma) 前 나미비아 대통령
- 纳米比亚全国委员会主席门萨 : 마가렛 멘사 윌리엄스(Margaret Mensah-Williams) 나미비아 전국위원회(상원) 의장
- 纳米比亚国民议회의장 카贾维维 : 피터 까챠비비(Peter Katjavivi) 나미비아 국민의회(하원) 의장
- 俄罗斯联邦安全会议秘书助理韦涅季科托夫 : 알렉산드르 베네딕토프(Aleksandr Venediktov) 러시아 연방안보회의 서기 조리
- 俄罗斯联邦安全会议秘书帕特鲁舍夫 : 니콜라이 파트루셰프(Nikolai Patrushev) 러시아 국가안보회의 서기
- 荷兰外交大臣布洛克 : 스태프 블록(Stef Blok) 네덜란드 외무장관
- 阿根廷外长福列 : 호르헤 파우리(Jorge Marcelo Faurie) 아르헨티나 외무장관
- 智利外长安普埃罗 : 로베르또 암뿌에로(Roberto Ampuero) 칠레 외무장관
- 玻利维亚国外交部长费尔南多·瓦纳库尼·马马尼 : 페르남도 우아나쿠니 마마니(Fernando Huanacuni Mamani) 볼리비아 외교부 장관
- 蒙古国人民党总书记阿玛尔巴伊斯格楞 : 아마르바야쓰갈란 몽골 인민당 총비서
- 南非国际关系与合作部长西苏鲁 : 린디웨 시슬루(Lindiwe Sisulu) 남아프리카 국제관계협력부 장관
- 南非国家安全部长杜巴邀请 : 봉가니 봉고(Bongani Bongo) 남아프리카공화국 국가안보부 장관
- 摩洛哥王国最高司法权委员会主席、最高法院院长莫斯塔法·法拉斯 : 무스타파 파라스(Mustafa Fares) 모로코 최고사법권위원회 의장 兼 최고법원장
- 白俄罗斯共和国总统办公厅副主任瓦列里·米茨克维奇 : 발레리 미츠키에비치(Valery Mitskevich) 벨라루스 대통령 비서실 副주임
- 黎巴嫩경제와 무역장관 후리 : 라에드 쿠후리(Raed Khoury) 레바논 경제통상부 장관
- 党主席斯齐亚沃尼率领의 아르헨티나공화국 방안당 : 움베르토 스키아보니(Humberto Schiavoni) 아르헨티나 공화주의 제안당 대표
- 美国国务院负责国际安全与防扩散事务的助理国务卿福트 : 크리스토퍼 포드(Christopher Ford) 미국 국무부 국제안보·비확산 담당 차관보
- 阿富汗首席执行관 압둘라 : 압둘라 압둘라(Abdullah Abdullah) 아프가니스탄 최고행정관
- 世界领袖联盟主席弗赖贝加 : 비케 프레이베르가(Vaira Vīķe-Freiberga) 글로벌 리더 연합(Global Leaders Alliance) 의장
- 阿富汗国家安全委员会대변인 : 자베드 파이살(Jawed Faisal) 아프가니스탄 국가안보위원회 대변인
- 一带一路 : 일대일로(一帶一路, 중국-중앙아시아-유럽을 연결하는 육상ㆍ해상 실크로드. 출처: 연합뉴스)
- 四点主张 : 4대 주장(四点主张, 팔레스타인의 독립적인 건국과 팔레스타인-이스라엘 양측의 평화로운 공존을 유지해야 한다, 팔레스타인-이스라엘 間 대화만이 유일한 해결법이다,)
- 정칭 : 정례 회담
- 칭찬하며 : 높이 표하며
- 회동 : 제목: 회동 (본문: 회담을 실시했다)
- 장강 삼각주 : 창장삼각주
- 양안 양회 : 양안 양회
- 하나의 중국 : ‘하나의 중국(一个中国，중국 대륙과 홍콩, 마카오, 대만은 나뉠 수 없는 하나이고 따라서 합법적인 중국의 정부는 오직 하나라는 원칙. 출처: 중국외교부)’ 원칙
- 92공식 : 92공식
- 대만 해협 : 대만해협
- 환태평양 : 환태평양경제동반자협정(TPP)
- 8.17공보 : 8.17공보
- 실크로드 경제벨트 : 실크로드 경제벨트
- 양국쌍원 : 양국쌍원
- 대외안정 : 대외안정
- 청 태평양 2050 전략 : 《청 태평양 2050 전략》
- 사불일무의 : 사불일무의
- 두 국가 방안 : 두 국가 방안
- 8대 공동행동 : 8대 공동행동
- 이스라엘-하마스 전쟁 : 이스라엘-하마스 전쟁
- 러시아-우크라이나 전쟁 : 러시아-우크라이나 전쟁
- 인도태평양사령부 : 인도태평양사령부(USINDOPACOM)
- 중국 해양경찰국 : 중국 해양경찰국
- 대만 국가중산과학연구원 : 대만 국가중산과학연구원(NCSIST)
- 에셜론 : 에셜론(Echelon)
- 우주 적외선 시스템 : 우주 적외선 시스템(SBIRS)
- 합동 정밀접근 및 착륙/착선 체계 : 합동 정밀접근 및 착륙/착선 체계(JPALS)
- 블루 파트너십 : 블루 파트너십(Blue Partnership)
- 덤핑 : 덤핑(Dumping, 채산을 무시하고 싼 가격으로 상품을 투매하는 일)
`;

const BRIEFING_INSTRUCTIONS = `
## Section 2: News Briefing
- All of the rules mentioned above for both General News Headline (제목) and Body (본문) apply strictly in this section as well (including official title single-role limitation, subject and particle law, repeated subject cycling rules, city/location notation with Hanja, and glossary terms).
- Country Abbreviations (Title ONLY):
  * Only United States (美), South Korea (韩), China (中), Japan (日), and North Korea (北) are permitted to be written in single Chinese characters in the heading.
  * If countries of China, United States, South Korea, Japan, and North Korea appear in the title, you MUST use their Hanja/Chinese character abbreviations (中, 美, 韩, 日, 北). For example, "대중국" MUST become "대中" in the title.
  * Absolutely any other country not listed above (e.g., Russia, France, Germany, etc.) MUST be written in its full Korean name (e.g. 러시아, 프랑스, 독일).
  * This rule of using Chinese characters for country abbreviations applies EXCLUSIVELY to the title.
- Apply briefing translation structure (Q&A style).
- Maintain formal briefing tone (1st person, spokesperson).
  * CRITICAL: In the "대변인:" translation section, the spokesperson is acting as China, so the active subject representing their stance/action MUST be "중국".
  * Whenever the original Chinese spokesperson uses first-person plural words such as "우리는" (we), "저희는", or other ambiguous/omitted subjects, you MUST translate or replace them using "중국" or other specific countries based on the context (e.g., "우리는 ~할 준비가 되었다" -> "중국은 ~할 준비를 마쳤다").
- Use "상기" for "this/that" in briefing contexts.
- Title: Use '회동' for meeting headlines.
- Body: Use '회담을 실시했다.' for meetings in body text.
- Country Order: Strictly follow this sequence: 1. 한국, 2. 미국, 3. 일본, 4. 중국.
- Person Naming Rule: First mention: "NAME(Chinese_Name or English_Name) Nationality Occupation". Use Chinese Hanja characters for South Korea, North Korea, Japan, China, Taiwan, and Hong Kong (e.g. 푸충(傅聪) 중국 대사), and use English characters for all other nationalities (e.g. 존 설리번(John Sullivan) 미국 부장관). Subsequent mentions MUST be: "NAME Occupation".
- Direct Speech Rule: Use " " for direct speech.
- Attribution Rule (Main Paragraph Formula): Every main paragraph representing spoken content MUST strictly follow this formula:
  Formula: [Name] [Occupation]은/는 [Optional Contextual Action(s). ]"[Complete Sentence 1 with Subject(은/는)] [Complete Sentence 2 with Subject(은/는)]."라고 밝혔다 or 라고 전했다.
  Combine all consecutive sentences spoken by the same person into one paragraph/block. End this block with ONE attribution: "라고 밝혔다." or "라고 전했다." Rotate between "밝혔다" and "전했다". NEVER use "덧붙였다".
- No Quotation Mark is required in this section. Act like you are the 대변인 and speak in first person perspective. 
- When writing the title, you should use the contents from the "질문:" section and write the main point of the question asked before "입장 표명". 
- When writing the title, it should be 관형사절을 가진 문장. This means if there is a subject, the title should be formatted as "~~verb한 subject".
- For the "질문:" part, the number of sentences written in the original text must equal exactly to the number of sentences translated in "질문:". Do not split or merge sentences.
  * OMIT REPORTER AFFILIATION (기자 소속): For every briefing question in the source text, there may be reporter affiliation / news agency mentioned (e.g., '로이터 기자', 'CCTV 기자', '신화사 기자', '路透社记者', '新华社记者', etc.). The translation MUST fully ignore them and completely omit any reporter affiliation/news agency from the "질문:" section. Just state "질문: (contextual question)?" without reference to who asked it.
  * IGNORE REPORTER'S SOURCE BEFORE ":": The basic structure of the question in the original Chinese text is "Reporter's Source: Question". For the "질문:" section in translation, you MUST translate only the content occurring AFTER the ":" colon, completely ignoring and omitting any Reporter's Source or prefix before the ":" (including the colon itself).
  * You MUST strictly structure the translated question using either:
    1. "중국은 이에 대해 어떻게 평가하는가?"
    2. "중국은 이에 대해 추가 설명을 할 수 있는가?"
  * If the original question contains specific context, you MUST replace "이에 대해" with that specific context.
    - Example: "중국은 이란이 요청을 보냈는지에 대해 추가 설명을 할 수 있는가?"
    - Example: "중국은 국내 기업에 대한 미국의 제재에 대해 어떻게 평가하는가?"
- For the "요약:" part, use single-character country abbreviations (중국, 미국, 한국, 일본, 북한을 각각 中, 美, 韩, 日, 北으로 축약) in the bullet points and never mention person names. Every single summary bullet point MUST be strictly limited to a maximum of 50 characters, including spaces, punctuation and hyphens. Other countries MUST be fully translated in their full Korean names and not abbreviated.

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
1. Perspective: All bullet points of the briefing summary MUST be written from the 대변인's perspective, representing a summary of what the spokesperson has declared or replied.
2. Concise Terminal Noun Endings (음슴체): Always standardize verb endings to concise noun/nominalized forms (e.g., "~함", "~임", "~음", "~할 것임").
3. Headline Style Constraints (No names, Single-Character country abbreviations):
   - ABSOLUTELY NO individual names are permitted in the 요약 bullet points (especially in the subject).
   - CRITICAL: Whenever the subject of a summary bullet point would be "中 외교부" (or any other variations of Chinese department/ministry), you MUST change the subject strictly to "중국" or abbreviated "中" (e.g. "중국 외교부, ~할 것임" -> "중국, ~할 것임" or abbreviated: "中, ~할 것임").
   - Do NOT use any person's name in the subject. Instead, use ONLY the nation abbreviation and occupation/title of the person (e.g., instead of "왕이 외교부장", it MUST be "中 외교부장").
   - CRITICAL Country Abbreviation Rule: The country single-character abbreviation rule that applies to the title MUST be strictly applied to 요약 as well. When these countries appear (United States, China, South Korea, Japan, and North Korea) anywhere in the bullet (including prefixes/suffixes, e.g. "대미", "대중"), you MUST write them as their single-character Hanja abbreviations (美, 中, 韩, 日, 北) (e.g., '대중국' MUST become '대중' or '대중' -> '대중' -> '대中', '미국 국가' MUST become '美 국가'). All other countries (e.g., 러시아, 프랑스, 독일) MUST be fully translated in their full Korean names and not abbreviated!
   - Character Limit Constraint (CRITICAL): Every bullet point (including the hyphen and the entire line text) in the '요약:' section MUST NOT exceed 50 characters in length. Keep the summary extremely short and highly concise.
4. Topic Marker Comma (,): Just like in the title/headline, the comma (,) MUST act as "은/는" (the topic/subject marker).
5. Text Structure: Excellent structure for each line is: "Subject, ~(summary)~음슴체" (e.g., "美, 이란의 공격 규탄함." or "중국 외교부장, 국가 기업의 권익 수호할 것임." but using abbreviations: "中 외교부장, 국가 기업의 권익 수호할 것임.").
6. Bullet Character: Prefixed with a hyphen ("- ").

### Briefing Output Structure:
The Output Structure MUST strictly follow this exact order: title -> Metadata -> Publisher Name -> 질문: -> 대변인 -> 요약. Do NOT write any introduction lines, extra spokesperson names, or header labels.

1. Title:
. 中--부 대변인, ~~관련 입장 표명
(Where "--부" represents the abbreviated department name in Chinese character style, e.g., . 中 외교부 대변인, ~~관련 입장 표명 or . 中 상무부 대변인, ~~관련 입장 표명. Use comma (,) and ensure no names appear, following the headline rules).

2. Metadata:
[ (Nation). (Source). (Month in original text). (Day in original text). (HH:MM in original text)((Month). (Day). (HH+1:MM)) ]

3. Publisher Name (if provided):
(Publisher Name)

4. 질문:
질문: 중국은 (Specific Context)에 대해 어떻게 평가하는가? (또는) 중국은 (Specific Context)에 대해 추가 설명을 할 수 있는가? (또는 context가 없을 시 "중국은 이에 대해 어떻게 평가하는가?", "중국은 이에 대해 추가 설명을 할 수 있는가?")

5. 대변인:
대변인: ~~~

6. 요약:
요약:
- {subject}, {summary}음슴체
- {subject}, {summary}음슴체
- {subject}, {summary}음슴체
`;




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
  const learnedPatterns = await getLearnedPatterns();
  
  const instruction = section === TranslationSection.GENERAL 
    ? GENERAL_NEWS_INSTRUCTIONS 
    : BRIEFING_INSTRUCTIONS;

  let dynamicSystemInstruction = SYSTEM_INSTRUCTIONS_BASE + instruction;

  // Substitute (Nation) and (Source) placeholders with actual user-defined values
  dynamicSystemInstruction = dynamicSystemInstruction
    .replace(/\(Nation\)/g, nation)
    .replace(/\{Nation\}/g, nation)
    .replace(/\(Source\)/g, sourceName)
    .replace(/\{Source\}/g, sourceName);

  if (publisherName && publisherName.trim()) {
    dynamicSystemInstruction = dynamicSystemInstruction
      .replace(/\(Publisher Name\)/g, publisherName.trim());
  } else {
    // Remove (Publisher Name) placeholder and its newline entirely if no publisher name is supplied
    dynamicSystemInstruction = dynamicSystemInstruction
      .replace(/\(Publisher Name\)\n?/g, "");
  }

  const prompt = `
### TRANSLATION METADATA:
1. Nation (국가): ${nation}
2. Source (매체): ${sourceName}
3. Publisher Name (기자명/배포처): ${publisherName && publisherName.trim() ? publisherName.trim() : '(none - completely omit the (Publisher Name) line from output)'}

### Destination Section Style:
- Section: ${section === TranslationSection.GENERAL ? 'General News' : 'Government Briefing'}

### Output Formatting Instructions:
- Ensure that the bracketed metadata line strictly uses: "[ ${nation}. ${sourceName}. (Month in original). (Day in original). (CST Time in original)((Month). (Day). (KST converted time)) ]"
- For General News, if a Publisher Name is provided ("${publisherName && publisherName.trim() ? publisherName.trim() : ''}"), place it directly on its own line immediately below the bracketed metadata line. If it is empty/none, omit that line completely and begin the translated body text.
- For Government Briefing, the output structure MUST strictly follow this exact order: title -> Metadata -> Publisher Name -> 질문: -> 대변인 -> 요약. Do NOT write any introduction lines, extra spokesperson names, or header labels.
  * Title: Formatting MUST be exactly '. 中--부 대변인, ~~관련 입장 표명' (where '--부' is the abbreviated department, such as '. 中 외교부 대변인, ~~관련 입장 표명' or '. 中 상무부 대변인, ~~관련 입장 표명').
    - General news title/headline rules strictly apply to this.
    - If countries of China, United States, South Korea, Japan, and North Korea appear in the title, they MUST be written in Hanja abbreviation (中, 美, 韩, 日, 北). For example, "대중국" MUST become "대中" in the title.
  * Metadata: The bracketed date/time line.
  * Publisher Name: If a Publisher Name is provided ("${publisherName && publisherName.trim() ? publisherName.trim() : ''}"), place it directly on its own line immediately below the metadata bracket. If empty/none, omit this line entirely.
  * 질문: Restate the question.
    - CRITICAL: The number of sentences written in the original text of the question MUST be exactly equal to the number of sentences translated in the "질문:" section. Do not split, merge or omit sentences.
    - OMIT REPORTER AFFILIATION (기자 소속): For every briefing question in the source text, there may be reporter affiliation / news agency mentioned (e.g., '로이터 기자', 'CCTV 기자', '신화사 기자', '路透社记者', '新华社记者', etc.). The translation MUST fully ignore them and completely omit any reporter affiliation/news agency from the "질문:" section. Just state "질문: (contextual question)?" without reference to who asked it.
    - IGNORE REPORTER'S SOURCE BEFORE ":": The basic structure of the question in the original Chinese text is "Reporter's Source: Question". For the "질문:" section in translation, you MUST translate only the content occurring AFTER the ":" colon, completely ignoring and omitting any Reporter's Source or prefix before the ":" (including the colon itself).
    - CRITICAL STRUCTURE RULE: When translating the target question asked by the reporter, you MUST strictly format it using/choosing from:
      1. "중국은 이에 대해 어떻게 평가하는가?"
      2. "중국은 이에 대해 추가 설명을 할 수 있는가?"
    - Context Substitution: When the question refers to a specific contextual topic, you MUST replace "이에 대해" with that specific context (e.g. "중국은 이란이 요청을 보냈는지에 대해 추가 설명을 할 수 있는가?").
  * 대변인: Present the spokesperson's reply in first-person perspective, with no quotation marks.
    - Since the spokesperson acts as the representative of China, the active subject representing their actions/stances MUST be "중국".
    - First-person plural pronouns ("우리는", "저희는") or ambiguous/omitted subjects MUST be translated/replaced strictly with "중국" or other specific countries based on context.
  * 요약: The concise bullet points. 
    - CRITICAL Country Abbreviation Rule: The country single-character abbreviation rule that applies to the title MUST be strictly applied to 요약 as well. When these countries appear (United States, China, South Korea, Japan, and North Korea) anywhere in the bullet (including prefixes/suffixes, e.g. "대미", "대중"), you MUST write them as their single-character Hanja abbreviations (美, 中, 韩, 日, 北) (e.g., '대중국' MUST become '대中', '미국 국가' MUST become '美 국가'). All other countries (e.g., 러시아, 프랑스, 독일) MUST be fully translated in their full Korean names and not abbreviated!
    - LIMIT LENGTH (CRITICAL): Every summary bullet point (- {subject}, {summary}음슴체) in the '요약:' section MUST NOT exceed a maximum length of 50 characters, including the bullet hyphen and any spaces or punctuations. Keep the points extremely short and compact.
    - No person names are permitted. Use comma (,) as topic marker and 음슴체 endings.
    - CRITICAL SUBJECT RULE: Whenever the subject of a summary bullet point would be "중국 외교부" or "공동 외교 부장" or "中 외교부" (or any other variations of Chinese department/ministry), you MUST change the subject strictly to "중국" or abbreviated "중국의 한자 약어인 中" (e.g. "중국 외교부, ~할 것임" -> "중국, ~할 것임" or abbreviated: "공동 외교부, ~할 것임" -> "중국, ~할 것임" or abbreviated: "중국, ~할 것임" or "중국의 한자 약어인 中, ~할 것임" -> "중국, ~할 것임" or "中, ~할 것임").

### Original Chinese Source text to translate:
${text}

${learnedPatterns}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: dynamicSystemInstruction,
        temperature: 0.1, // Custom temperature requested by the user
        topP: 0.4,
        topK: 20,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
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
      model: "gemini-3-flash-preview",
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
