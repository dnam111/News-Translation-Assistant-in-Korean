import { GoogleGenAI } from "@google/genai";
import { collection, addDoc, query, getDocs, orderBy, limit, serverTimestamp, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
const MODEL_NAME = "gemini-3.1-flash-lite";

export enum RussianTranslationSection {
  GENERAL = 'general'
}

export interface RussianTranslationResult {
  translatedText: string;
  sourceText: string;
  section: RussianTranslationSection;
  validationWarnings: string[];
}

export interface RussianLearnedPatternItem {
  id: string;
  russianText: string;
  koreanText: string;
  section?: RussianTranslationSection | string;
  terminology: Record<string, string>;
  transformationRules: string[];
  createdAt?: any;
}

const SYSTEM_INSTRUCTIONS_RU_TO_KO = `
당신은 러시아어 뉴스 기사를 한국 군사·외교 전문매체 스타일로 번역하는 전문 번역기입니다.
아래의 매뉴얼 및 사용자 추가 규칙을 100% 엄격하게 준수하여 결과를 출력하십시오.

==================================================
[러시아·우크라이나 군사·외교 기사 번역 매뉴얼 & 추가 규정]
==================================================

1. 기본 원칙
- 목표: 한국 군사·외교 전문매체 스타일의 객관적이고 정확한 번역 기사 작성.
- 원문의 의미와 주요 사실을 누락 없이 능동형 중심 문장으로 번역.

2. 제목 및 헤더 간격 규칙 (STRICT)
- 제목 형식: 원문 제목을 직역/충실하게 반영하여 간결하게 작성하되 반드시 ". "로 시작.
  * 예시: . 러시아 외무장관, "나토(NATO), 러시아 억제하기 위한 새로운 전선으로 북극 활용"
- 간격 엄수: 제목 첫 줄 바로 다음 줄에 메타데이터 헤더를 작성하십시오. (제목과 메타데이터 사이에 빈 줄/공백 절대 금지!)

3. 기사 헤더 및 배포처 규칙 (STRICT)
- 헤더 형식: [ 국가. 매체. M. D. HH:MM(M. D. HH:MM) ]
  * 예시: [ 러시아. Tass. 6. 20. 14:43(6. 20. 20:43) ]
- 헤더 바로 다음 줄에 기자명/배포처(예: 상병 조희주) 작성.
- 기자명/배포처 줄과 본문 첫 단락 사이에만 정확히 1줄의 빈 줄을 삽입하십시오.

4. 인물 표기 규칙 (STRICT)
- 최초 등장 시: 한국어 이름(영어 로마자명) 국적 직책
  * 예시: 세르게이 라브로프(Sergey Lavrov) 러시아 외무장관, 드미트리 페스코프(Dmitry Peskov) 러시아 크렘린궁 대변인
- 주요 인물 지정 직책 (반드시 준수):
  * 드미트리 페스코프(Dmitry Peskov) → 직책: "러시아 크렘린궁 대변인" (2회 이상 재등장 시: "페스코프 대변인")
- 2회 이상 재등장 시: 성(Surname) + 직책
  * 예시: 라브로프 외무장관, 푸틴 대통령, 젤렌스키 대통령, 페스코프 대변인

5. 인용문 및 전달동사 규칙 (STRICT)
- 본문의 모든 전달 표현(밝혔다, 전했다, 설명했다, 덧붙였다, 언급했다, 강조했다, 끝마쳤다 등)은 예외 없이 따옴표(“...”)로 둘러싸인 인용구와 직접 결합되어야 합니다.
  * 형식: “내용.”라고 밝혔다. / “내용.”라고 전했다.
- 피동/수동형 표현("되었다", "진행되었다", "개최되었다" 등) 절대 금지. 능동형만 사용.
- 발언 주체를 문두에 배치: [인물/기관]은 "[주어]는 ~~다."라고 밝혔다/전했다/덧붙였다/강조했다/설명했다/언급했다/끝마쳤다.
- 규정 20(인용문 병합 규정)을 항상 함께 준수하십시오. 한 단락 안에서 같은 화자의 발언을 인용부호를 여러 번 열고 닫으며 쪼개지 마십시오.

6. 단락 연결 순서 (고정 체계)
본문의 단락 첫 시작어와 인용문 맺음 어미는 아래의 순서를 준수하십시오.
  * 1번째 단락: [인물/주어]은/는 “...”라고 밝혔다. (1단락 시작 시 접속어 사용 금지)
  * 2번째 단락: 이어, [인물/주어]은/는 “...”라고 전했다.
  * 3번째 단락: 나아가, [인물/주어]은/는 “...”라고 설명했다.
  * 4번째 단락: 더불어, [인물/주어]은/는 “...”라고 덧붙였다.
  * 5번째 단락: 또한, [인물/주어]은/는 “...”라고 언급했다.
  * 마지막 단락(이전 단락이 존재하는 기사의 최종 단락): 아울러, [인물/기사]은/는 “...”라고 끝마쳤다.
- 위 접속어(이어, 나아가, 더불어, 또한, 아울러)는 오직 "단락과 단락 사이"에서만 사용합니다. 한 단락 내부에서 인용문과 인용문을 잇기 위해 "라고 언급하며,", "라고 밝히며," 와 같은 연결형을 사용해 인용부호를 재차 열고 닫는 것은 금지합니다 (규정 20 참고).

7. 단락 구조 및 결합 규칙
- 한 단락 내 관련 내용 2~4개를 하나의 인용문으로 묶어서 구성 (A했으며, B했다. 또한, C했다.).
- 원문 정보가 허용하는 한 단락당 최소 3문장 이상 구조를 지킬 것.
- 단, 규정 17(인용 범위 한정), 18(원문 충실 번역·단락 수 일치), 20(인용문 병합)이 항상 우선합니다. 즉, 원문에 없는 문장을 새로 만들어 분량을 채우거나, 단락 수를 임의로 늘리거나 줄이지 마십시오.

8. 군사 용어 및 국명 규칙
- БПЛА / дрон → 무인항공기
- ВСУ → 우크라군
- ВС РФ → 러시아군
- спецоперация → 특수군사작전(SVO)
- Украина / украинский → 우크라 (아래 규정 21 참고. "우크라이나"라는 전체 표기는 절대 사용하지 말 것)
- 수도명(모스크바 등)을 국명 대신 사용하는 것을 금지하며 반드시 "러시아", "미국" 등 국명 표기.
- 날짜는 'YY. M. D일 또는 'YY. M. D~D일 형태로 작성.

9. 접속어 및 날짜 뒤 가운뎃점(ㆍ) 금지
- 본문 단락에서 접속어(이어, 나아가, 더불어, 또한, 아울러, 한편, 다만 등) 및 날짜 뒤에 가운뎃점(ㆍ)을 절대 사용하지 마십시오. 반드시 반점(,)을 사용하십시오.

10. 전투/파괴/격퇴 기사 문장 구조 (STRICT)
- 일반 파괴/격퇴/격추 기사 틀:
  [누가] - [어디에서] - [무엇으로(무기)] - [누구의] - [무엇을(무기·표적)] - 파괴/격퇴/격추했다.
- 방공(요격) 기사 틀 (아래 요소 전부 필수, 특히 방공무기체계 동원 여부는 반드시 명시):
  [누가] - [어디서] - 방공무기체계 동원(필수 기재) - [누구의] - [무엇을] - [몇 개] - 격추했다.
  * "방공무기체계를 동원하여"와 같은 표현을 생략하지 말 것.

11. 시차 변환 규칙 (STRICT)
- 러시아와 우크라는 시차가 동일하며, 한국(KST)이 두 국가보다 6시간 빠릅니다.
- 헤더의 괄호 안 시각은 원문 현지 시각에 정확히 +6시간을 더한 KST로 표기합니다.
  * 예) 원문 현지 시각이 8. 31. 20:25 → KST 표기는 9. 1. 02:25 (날짜가 자정을 넘어가면 날짜(M. D.)도 함께 변경할 것).
- 원문에 시각이 명시되지 않은 경우 임의로 생성하지 말고 확인 가능한 범위에서만 표기.

12. 행정구역·지명 표기 규칙 (STRICT)
- '주(州)', '시(市)' 한자 표기를 반드시 사용합니다.
- 최초 등장 시: [국가명] [지명]州 소재 [읍/면/마을명] 마을 형태로 전체 표기.
  * 예) 러시아 쿠르스크州 소재 ((지명)) 마을
- 이후 동일 지명이 재등장할 경우, 이미 언급한 국가명+州 부분은 생략하고 마을/시 이름만 사용 가능.
- 인물 표기도 동일한 최초/재등장 원칙(규정 4)을 따릅니다.
- 기사 제목에서는 州만 표기하고, 하위 시/마을명은 생략할 수 있습니다.

13. 무기 표기 틀 (STRICT)
- 형식: [생산국가] - [시리즈 넘버] - [무기명] - [무기 종류]
  * 예) 러시아제 이스칸데르-M 탄도미사일, 미국제 M142 하이마스(HIMARS) 다연장로켓시스템

14. 부대 표기 틀 (STRICT)
- 형식: [국가](산하) - [상급부대](예하) - [하급부대](소속) - [병과/부대유형]
  * 예) 러시아(국가) 남부집단군(산하) 제1 여단(예하) 포병부대(소속)

15. 회담 기사 전용 틀 (STRICT)
- 1번째 단락: [인물A] 및 [인물B]는 회담을 실시했으며, 상기 회담을 통해 [주제]에 대해 논의했다.
- 2번째 단락부터: 상기 회담을 통해 [세부내용]에 대해 논의했다. (규정 6의 접속어·전달동사 순서와 함께 적용)

16. 제목 작성 규칙 (STRICT)
제목은 아래 3요소를 순서대로 반영하여 작성합니다:
  1) 누가 행동을 주도했는가
  2) 누구와 무엇을 했는가 (대부분 회담)
  3) 말줄임표(…) 이후, 어떤 내용의 회담/사안을 다루었는가를 요약
- 제목에도 규정 21(우크라이나 → 우크라)을 동일하게 적용합니다.
- 제목 국가명 한자 약어 표기 규칙 (STRICT): 제목에서 '미국', '중국', '한국', '일본', '북한'이 등장할 경우 반드시 한자 한 글자 약어(미국→美, 중국→中, 한국→韩, 일본→日, 북한→北)로 변경하여 작성하십시오. (본문에는 약어를 사용하지 마십시오.)

17. 인용 범위 한정 규정 (STRICT — CRITICAL)
- 인용부호(“...”) 안에는 인물이 실제로 발언한 내용(발언의 취지를 옮긴 것)만 넣어야 합니다.
- 사건이 열린 장소, 행사명, 날짜, "~에 참석하여", "~을 계기로", "~에서 개최된" 등 기자가 서술하는 배경 정보(내레이션)는 발언 내용이 아니므로 인용부호 밖에 별도의 문장/구로 작성하거나, 인용문 앞의 서술절로 배치해야 합니다.
- 즉, 인물이 어떤 자리에서 발언했다는 정황 설명과, 그 자리에서 실제로 한 말은 반드시 분리하십시오.
  * 잘못된 예 (금지): 이어, 푸틴 대통령은 “러시아 극동 블라디보스토크에서 개최된 동방경제포럼(EEF) 본회의에 참석하여 이와 같은 견해를 피력했다.”라고 전했다.
    (→ 장소·행사 정보가 발언 내용인 것처럼 인용부호 안에 잘못 포함됨)
  * 올바른 예: 푸틴 대통령은 러시아 극동 블라디보스토크에서 개최된 동방경제포럼(EEF) 본회의에 참석하여 이와 같은 견해를 피력했다.
    (→ 장소·행사 정보는 인용부호 없이 순수 서술문으로 작성, 실제 발언 취지가 있다면 별도의 인용구로 분리)
- 원문에 실제 발언(따옴표로 인용된 원문 발언 또는 간접화법으로 명확히 전달되는 발언)이 없는 문장은 인용부호나 전달동사(라고 밝혔다/전했다 등)를 붙이지 말고 일반 서술문으로 번역하십시오.

18. 원문 충실 번역 원칙 (STRICT — CRITICAL)
- 원문에 없는 내용을 추가하거나, 원문의 세부 정보를 임의로 삭제/생략하지 마십시오. 요약(summary)이 아닌 전문(全文) 번역입니다.
- "요약:" 문구나 불릿 형태의 요약 섹션을 절대 추가하지 마십시오.
- 단락 수 일치 규정 (절대 위반 금지): 번역문의 단락 수는 원문(본문)의 단락 수와 정확히, 1:1로 동일해야 합니다.
  * 원문에서 서로 다른 단락(빈 줄로 구분됨)으로 되어 있는 두 개 이상의 단락을 절대로 하나의 번역 단락으로 병합하지 마십시오.
  * 반대로 원문의 한 단락을 여러 개의 번역 단락으로 임의로 쪼개지도 마십시오.
  * 원문이 N개의 단락으로 구성되어 있다면, 번역문 본문도 반드시 N개의 단락(빈 줄로 구분된 N개의 블록)으로 출력하십시오. 이는 다른 모든 스타일 규정(규정 6, 7 포함)보다 우선하는 최상위 제약입니다.
- 원문의 문장이 사실을 서술하는 문장인지, 발언을 전달하는 문장인지 구분하여 규정 17을 준수한 채로 그대로 옮기십시오.

19. (예비 — 사용 안 함)

20. 인용문 병합 규정 (STRICT — CRITICAL)
- 한 단락 안에서 동일 화자가 여러 문장을 발언한 경우, 인용부호를 여러 번 열고 닫지 말고 하나의 인용부호 안에 모든 발언을 마침표(.)로 구분하여 병합한 뒤, 문단 맨 끝에서 전달동사(라고 밝혔다/전했다/강조했다 등)를 단 한 번만 사용하십시오.
- "라고 언급하며,", "라고 밝히며," 등으로 인용문을 중간에 끊고 새 인용부호를 여는 방식은 금지합니다.
  * 잘못된 예 (금지):
    푸틴 대통령은 “민간 선박을 나포하고 타격하며 민간 항공기에 대한 공격 위협을 가하는 행위를 외면하는 자들, 즉 우크라이나의 서방 동맹국들은 국제 테러의 공범이 된다.”라고 언급하며, “이러한 상황을 다르게 해석할 방법은 없다.”라고 강조했다.
  * 올바른 예:
    푸틴 대통령은 "민간 선박을 나포하고 타격하며, 민간 항공기에 대한 공격 위협을 가한 행위를 외면하는 자들, 즉 우크라의 서방 동맹국은 국제 테러의 공범이 된다. 상기 상황을 다르게 해석할 방법은 없다."라고 강조했다.
- 한 단락에는 정확히 한 쌍의 여는/닫는 인용부호(“...”)와 하나의 전달동사만 존재해야 합니다 (여러 화자의 발언을 각각 다른 단락에서 인용하는 것은 예외이며 규정 6을 따릅니다).

21. 우크라이나 표기 금지 규정 (STRICT — CRITICAL, ZERO TOLERANCE)
- "우크라이나"라는 전체 표기는 제목과 본문을 포함한 모든 위치에서 절대 사용하지 마십시오.
- 반드시 축약형 "우크라"만 사용하십시오 (예: 우크라, 우크라군, 우크라 정부, 우크라 대통령).
- 고유명사의 일부(예: 인명, 기관 정식 명칭에 불가피하게 포함된 경우)라도 가능한 한 "우크라"로 축약하여 표기하십시오.
`;

const GENERAL_NEWS_INSTRUCTIONS = `
## 번역 실행 지침:
- 원문 뉴스 내용을 바탕으로 지정된 인물 표기법, 간격 규칙, 인용문 형식(규정 17, 20 엄수), 무기·부대·지명 표기 틀, 회담 기사 틀, 시차 변환 규칙, 우크라이나 축약 표기(규정 21)를 정확히 준수하여 한국 군사전문지 스타일로 출력하십시오.
- 원문 내용을 요약하거나 임의로 추가/삭제하지 말고, 단락 수를 원문과 정확히 1:1로 동일하게 유지하십시오 (규정 18). 단락 병합/분할은 절대 금지입니다.
- 아래 예시 출력은 형식(포맷) 참고용이며, 내용을 그대로 복사하지 말고 형식만 준수하십시오.
`;

// Few-shot style references (structure/format only — content must come from the actual source text supplied per request).
const EXAMPLE_OUTPUTS_RU_TO_KO = `
### EXAMPLE OUTPUT 1 (회담 기사 틀 참고용):
. 러시아 대통령, 카자흐스탄 대통령과 상하이협력기구(SCO) 정상회의 계기 회담 실시…국제ㆍ역내 현안ㆍ공동 프로젝트 논의
[ 러시아. TASS. 8. 31. 20:25(9. 1. 02:25) ]
상병 조희주

러시아 『TASS』 국영 통신사는 “블라디미르 푸틴 러시아 대통령은 상하이협력기구(SCO) 정상회의를 계기로 카심-조마르트 토카예프 카자흐스탄 대통령과 회담을 실시했으며, 해당 회담을 통해 카자흐스탄 총선에서 국민이 토카예프 대통령의 정책 노선을 지지한 것을 축하했다.”라고 밝혔다.

이어, 해당 통신사는 “토카예프 대통령은 해당 회담을 통해 카자흐인과 러시아인은 역사적으로 정치ㆍ종교적 이유로 갈등한 적이 없었다고 강조했다.”라고 전했다.

나아가, 해당 통신사는 “양국 정상은 국제 및 지역 현안에 대해서도 의견을 교환했다.”라고 설명했다.

아울러, 해당 통신사는 “양국 정상은 무역ㆍ경제 및 투자 협력을 강화할 전망과 상호 관심 분야에서 공동 프로젝트를 추진하는 방안을 논의했다.”라고 끝마쳤다.

### EXAMPLE OUTPUT 2 (인용문/서술문 분리 참고용 — 규정 17):
. 러시아 대통령, 인도 총리와의 회담 통해 우크라 내 특별군사작전 진행 상황 설명
[ 러시아. TASS. 8. 31. 18:37(9. 1. 00:37) ]
상병 조희주

드미트리 페스코프 러시아 크렘린궁 대변인은 “블라디미르 푸틴 러시아 대통령은 나렌드라 모디 인도 총리와의 회담을 통해 모디 총리에게 러시아의 우크라 내 특별군사작전 진행 상황에 대해 설명했다.”라고 밝혔다.

이어, 페스코프 대변인은 “모디 인도 총리는 상하이협력기구(SCO) 정상회의를 통해 우크라 사태를 언급했으며, 모든 현안을 조속히 평화적으로 해결할 것을 촉구했다.”라고 전했다.

### 인용 범위(규정 17) 대조 예시 — 실제 발언 vs 배경 서술 분리:
잘못된 예 (금지): 이어, 푸틴 대통령은 “러시아 극동 블라디보스토크에서 개최된 동방경제포럼(EEF) 본회의에 참석하여 이와 같은 견해를 피력했다.”라고 전했다.
올바른 예: 푸틴 대통령은 러시아 극동 블라디보스토크에서 개최된 동방경제포럼(EEF) 본회의에 참석하여 이와 같은 견해를 피력했다.

### 인용문 병합(규정 20) 대조 예시 — 인용부호를 여러 번 열고 닫지 말 것:
잘못된 예 (금지): 푸틴 대통령은 “민간 선박을 나포하고 타격하며 민간 항공기에 대한 공격 위협을 가하는 행위를 외면하는 자들, 즉 우크라의 서방 동맹국들은 국제 테러의 공범이 된다.”라고 언급하며, “이러한 상황을 다르게 해석할 방법은 없다.”라고 강조했다.
올바른 예: 푸틴 대통령은 "민간 선박을 나포하고 타격하며, 민간 항공기에 대한 공격 위협을 가한 행위를 외면하는 자들, 즉 우크라의 서방 동맹국은 국제 테러의 공범이 된다. 상기 상황을 다르게 해석할 방법은 없다."라고 강조했다.
`;

async function getRussianLearnedPatterns(): Promise<string> {
  try {
    const patterns = await fetchAllRussianLearnedPatterns();
    if (patterns.length === 0) return "";

    let patternInstructions = "\n### LEARNED TRANSLATION PATTERNS & TERMINOLOGIES:\n";
    patterns.forEach((p, idx) => {
      patternInstructions += `Pattern #${idx + 1}:\n`;
      patternInstructions += `- Russian Source Text: "${p.russianText}"\n`;
      patternInstructions += `- Korean Corrected Translation: "${p.koreanText}"\n`;
      if (p.terminology && Object.keys(p.terminology).length > 0) {
        patternInstructions += `- Preferred Terminology Mappings:\n`;
        Object.entries(p.terminology).forEach(([ru, ko]) => {
          patternInstructions += `  * "${ru}" -> "${ko}"\n`;
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
    console.error("Error fetching Russian learned patterns:", error);
    return "";
  }
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
 * Enforces 규정 21: "우크라이나" (full form) is banned everywhere — title and body.
 * Applied as a deterministic code-level pass so the ban holds even if the model slips.
 * Handles common inflected/compound forms (우크라이나군, 우크라이나의, 우크라이나에서, etc.)
 * by collapsing the "이나" portion while preserving whatever follows.
 */
function enforceUkraineAbbreviation(text: string): string {
  if (!text) return "";
  return text.replace(/우크라이나/g, "우크라");
}

/**
 * Enforces Title Country Hanja Abbreviations:
 * In the title line (line 1, or first line starting with .), converts:
 * 미국 -> 美, 중국 -> 中, 북한 -> 北, 한국 -> 韩, 일본 -> 日
 */
function enforceTitleCountryAbbreviations(text: string): string {
  if (!text) return "";
  const lines = text.split("\n");
  let titleIdx = lines.findIndex(l => l.trim().startsWith("."));
  if (titleIdx === -1) {
    titleIdx = 0;
  }
  if (lines[titleIdx] && !lines[titleIdx].trim().startsWith("[")) {
    lines[titleIdx] = lines[titleIdx]
      .replace(/미국/g, "美")
      .replace(/중국/g, "中")
      .replace(/북한/g, "北")
      .replace(/한국/g, "韩")
      .replace(/일본/g, "日");
  }
  return lines.join("\n");
}

/**
 * Counts "paragraphs" in a raw block of text by splitting on blank lines
 * and dropping any resulting empty segments. Used both on the source text
 * and on the translated body to enforce the strict 1:1 paragraph-mapping rule (규정 18).
 */
function countParagraphs(block: string): number {
  if (!block) return 0;
  return block
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0).length;
}

/**
 * Extracts just the article body from a fully-formatted translation
 * (i.e. everything after the title / header / publisher-name lines and
 * the single blank line that separates them from paragraph 1).
 */
function extractTranslatedBody(translated: string): string {
  const lines = translated.split('\n');
  const blankLineIndex = lines.findIndex(l => l.trim() === '');
  if (blankLineIndex === -1) {
    // No clear blank-line separator found; fall back to whole text.
    return translated;
  }
  return lines.slice(blankLineIndex + 1).join('\n');
}

/**
 * Detects 규정 20 violations: a quote closed and immediately re-opened within the
 * same paragraph via a mid-quote connector like "라고 언급하며," instead of being
 * merged into a single quotation with one trailing verb.
 */
function detectSplitQuotations(translatedBody: string): boolean {
  const paragraphs = translatedBody.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const splitPattern = /”\s*(?:이)?라고\s*(?:언급|말|밝히|전하|설명|강조|덧붙이)(?:며|면서)\s*,?\s*“/;
  return paragraphs.some(p => splitPattern.test(p));
}

function postProcessTranslation(text: string): string {
  if (!text) return "";
  let processed = removeMiddleDotAfterDatesAndTransitions(text);
  processed = enforceUkraineAbbreviation(processed);
  processed = enforceTitleCountryAbbreviations(processed);
  return processed;
}

// Non-blocking structural sanity check. Logs warnings only — never throws or alters output —
// so it can be used during testing/QA without risking breaking production translations.
function validateOutputFormat(sourceText: string, translated: string): string[] {
  const warnings: string[] = [];
  if (!translated) return warnings;

  const lines = translated.split("\n");

  if (!lines[0] || !lines[0].trim().startsWith(".")) {
    warnings.push("제목이 '. '로 시작하지 않습니다 (규정 2 위반 가능).");
  }

  const headerLine = lines.find(l => /^\s*\[.*\]\s*$/.test(l));
  if (!headerLine) {
    warnings.push("헤더 [ 국가. 매체. M. D. HH:MM(M. D. HH:MM) ] 형식을 찾을 수 없습니다 (규정 3 위반 가능).");
  } else if (!/\(\s*\d{1,2}\.\s*\d{1,2}\.\s*\d{1,2}:\d{2}\s*\)/.test(headerLine)) {
    warnings.push("헤더에 KST 변환 시각(괄호)이 없습니다 (규정 11 위반 가능).");
  }

  if (/[가-힣]+(되었다|진행되었다|개최되었다)/.test(translated)) {
    warnings.push("피동형 표현이 감지되었습니다 (규정 5 위반 가능).");
  }

  if (/(이어|나아가|더불어|또한|아울러|한편|다만)\s*ㆍ/.test(translated) || /\d{1,2}일\s*ㆍ/.test(translated)) {
    warnings.push("접속어/날짜 뒤 가운뎃점(ㆍ)이 감지되었습니다 (규정 9 위반 가능).");
  }

  const openQuotes = (translated.match(/“/g) || []).length;
  const closeQuotes = (translated.match(/”/g) || []).length;
  if (openQuotes !== closeQuotes) {
    warnings.push(`인용부호 개수가 맞지 않습니다 (여는 따옴표: ${openQuotes}, 닫는 따옴표: ${closeQuotes}) (규정 5/17 위반 가능).`);
  }

  if (/요약\s*[:：]/.test(translated)) {
    warnings.push("'요약:' 섹션이 감지되었습니다 (규정 18 위반 — 요약 금지).");
  }

  if (/우크라이나/.test(translated)) {
    warnings.push("'우크라이나' 전체 표기가 감지되었습니다 (규정 21 위반 — '우크라'로 축약 필요). 코드 후처리에서 자동 치환됩니다.");
  }

  const sourceParagraphCount = countParagraphs(sourceText);
  const translatedBody = extractTranslatedBody(translated);
  const translatedParagraphCount = countParagraphs(translatedBody);
  if (sourceParagraphCount > 0 && sourceParagraphCount !== translatedParagraphCount) {
    warnings.push(
      `단락 수 불일치: 원문 ${sourceParagraphCount}단락 vs 번역문 ${translatedParagraphCount}단락 (규정 18 위반 — 단락 병합/분할 금지).`
    );
  }

  if (detectSplitQuotations(translatedBody)) {
    warnings.push("한 단락 내 인용부호가 중간에 닫혔다가 재차 열린 패턴이 감지되었습니다 (규정 20 위반 — 인용문 병합 필요).");
  }

  return warnings;
}

export async function translateRussianNews(
  text: string,
  section: RussianTranslationSection,
  sourceName: string = "Tass",
  publisherName: string = "상병 조희주",
  nation: string = "러시아"
): Promise<RussianTranslationResult> {
  const learnedPatterns = await getRussianLearnedPatterns();

  const dynamicSystemInstruction = SYSTEM_INSTRUCTIONS_RU_TO_KO + GENERAL_NEWS_INSTRUCTIONS + EXAMPLE_OUTPUTS_RU_TO_KO;

  const sourceParagraphCount = countParagraphs(text);

  const prompt = `
### TRANSLATION METADATA:
1. Nation (국가): ${nation}
2. Source (매체): ${sourceName}
3. Publisher Name (기자명/배포처): ${publisherName && publisherName.trim() ? publisherName.trim() : '상병 조희주'}

### Output Format Reminder:
- Line 1: . [원문 반영 제목] (규정 16의 제목 3요소 순서 준수, "우크라이나" 대신 "우크라" 사용, 제목 내 미국/중국/북한/한국/일본은 한자 약어 美/中/北/韩/日 사용)
- Line 2 (바로 다음줄): [ ${nation}. ${sourceName}. M. D. HH:MM(M. D. HH:MM) ] ← 괄호 안은 원문 시각 +6시간(KST) (규정 11)
- Line 3 (바로 다음줄): ${publisherName && publisherName.trim() ? publisherName.trim() : '상병 조희주'}
- Line 4: (공백 1줄)
- Line 5부터: 본문 시작 (전투/파괴/격추 기사는 규정 10 문장틀, 회담 기사는 규정 15 문단틀 적용)

### CRITICAL — 제목 국가명 한자 약어 (규정 16):
- 제목에 미국, 중국, 북한, 한국, 일본이 등장할 경우 반드시 한자 약어(美, 中, 北, 韩, 日)로 표기하십시오. 본문에는 사용하지 마십시오.

### CRITICAL — 단락 수 절대 일치 (규정 18):
- 아래 원문은 총 ${sourceParagraphCount}개의 단락(빈 줄로 구분됨)으로 구성되어 있습니다.
- 번역문 본문(제목/헤더/배포처 줄 제외)도 정확히 ${sourceParagraphCount}개의 단락으로 작성하십시오.
- 절대로 두 개 이상의 원문 단락을 하나로 병합하거나, 한 단락을 여러 개로 쪼개지 마십시오.

### CRITICAL — 인용 범위 (규정 17):
- 실제 발언 내용만 인용부호(“...”) 안에 넣으십시오. 장소ㆍ행사명ㆍ날짜 등 배경 서술 정보는 인용부호 밖에 일반 서술문으로 작성하십시오.

### CRITICAL — 인용문 병합 (규정 20):
- 한 단락 안에서 동일 화자의 발언은 인용부호를 한 번만 열고 닫으십시오. "라고 언급하며," 등으로 인용부호를 중간에 닫았다가 다시 여는 것을 금지합니다. 여러 문장은 마침표로 구분해 하나의 인용부호 안에 병합하고, 단락 끝에 전달동사를 한 번만 사용하십시오.

### CRITICAL — 우크라이나 표기 (규정 21):
- "우크라이나"라는 전체 표기를 제목/본문 어디에도 사용하지 말고, 반드시 "우크라"로만 표기하십시오.

### Original Russian Source text to translate:
${text}

${learnedPatterns}
`;

  try {
    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
      config: {
        systemInstruction: dynamicSystemInstruction,
        temperature: 0.1,
        topP: 0.3,
        topK: 20
      }
    });

    const rawTranslated = response.text || "Russian-to-Korean translation failed.";
    const translated = postProcessTranslation(rawTranslated);

    const warnings = validateOutputFormat(text, translated);
    if (warnings.length > 0) {
      console.warn("[translateRussianNews] Format warnings:", warnings);
    }

    return {
      translatedText: translated,
      sourceText: text,
      section,
      validationWarnings: warnings
    };
  } catch (error) {
    console.error("Russian translation error:", error);
    throw error;
  }
}

export async function saveRussianCorrection(
  sourceText: string,
  aiTranslatedText: string,
  userCorrectedText: string,
  section: RussianTranslationSection
): Promise<any> {
  try {
    await addDoc(collection(db, 'corrections_ru'), {
      sourceText,
      aiTranslatedText,
      userCorrectedText,
      section,
      createdAt: serverTimestamp()
    });

    const prompt = `
You are an expert Russian-to-Korean military/diplomatic translation pattern analyzer.
Analyze the original Russian text and user-corrected Korean text to extract terminology mappings and structural rules.

### INPUT DATA
1. Original Russian Text:
"${sourceText}"

2. User-Corrected Korean Translation:
"${userCorrectedText}"

### OUTPUT FORMAT
Output ONLY raw JSON:
{
  "terminology": {
    "russian_word": "korean_word"
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
      russianText: sourceText,
      koreanText: userCorrectedText,
      section,
      terminology: result.terminology || {},
      transformationRules: result.transformationRules || [],
      createdAt: serverTimestamp()
    };

    await addDoc(collection(db, 'learned_patterns_ru'), patternDoc);

    return patternDoc;
  } catch (error) {
    console.error("Error saving Russian correction:", error);
    throw error;
  }
}

export async function fetchAllRussianLearnedPatterns(): Promise<RussianLearnedPatternItem[]> {
  try {
    const patternsRef = collection(db, 'learned_patterns_ru');
    const q = query(patternsRef, orderBy('createdAt', 'desc'), limit(50));
    const snapshot = await getDocs(q);

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as RussianLearnedPatternItem[];
  } catch (error) {
    console.error("Error fetching all Russian learned patterns:", error);
    return [];
  }
}

export async function deleteRussianLearnedPattern(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'learned_patterns_ru', id));
  } catch (error) {
    console.error("Error deleting Russian learned pattern:", error);
    throw error;
  }
}