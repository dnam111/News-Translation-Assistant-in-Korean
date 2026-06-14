import { GoogleGenAI } from "@google/genai";
import { collection, addDoc, query, getDocs, orderBy, limit, serverTimestamp, deleteDoc, doc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });

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
  terminology: Record<string, string>;
  transformationRules: string[];
  createdAt?: any;
}

const SYSTEM_INSTRUCTIONS_EN_TO_KO = `
You are a professional Yonhap News-style translator specializing in translating English news articles into Korean.
You must translate the entire English article accurately, objectively, and without omitting any content.

## BROAD STYLISTIC PRINCIPLES
- Do NOT use honorific ending styles (like "~했습니다", "~습니까").
- You MUST use the objective, plain declarative news style ending strictly in "~했다" or "~밝혔다" or "~전했다".
- Keep the number of paragraphs in the translation exactly equal to the number of paragraphs in the source text.
- Use clean, standard, idiomatic Korean media terminology.
`;

const GENERAL_NEWS_INSTRUCTIONS = `
## GENERAL NEWS TRANSLATION RULES (ENG ➔ KO):

### Headline Rules (제목)
- Prepended Dot: ALWAYS start the headline with a dot and a space: ". (Headline)"
- Structure: (Subject/Organization), main content.
- Use a comma (,) as a topic marker instead of subject particles where appropriate.

### Body Translation Rules (본문)
- Initial Date Stamp: Every translation article must begin with the date at the very start of the first sentence. Format: 'YY. M. D일,
- Translate and localize English idioms and terminology into formal Korean news press phrasing.
- Ensure proper name notation (first mention: name with English in parentheses, subsequent mention: just name).
`;

async function getEnglishLearnedPatterns(): Promise<string> {
  try {
    const patterns = await fetchAllEnglishLearnedPatterns();
    if (patterns.length === 0) return "";
    
    let patternInstructions = "\n### LEARNED TRANSLATION PATTERNS & TERMINOLOGIES:\n";
    patterns.forEach((p, idx) => {
      patternInstructions += `Pattern #${idx + 1}:\n`;
      patternInstructions += `- English Source Text: "${p.englishText}"\n`;
      patternInstructions += `- Korean Corrected Translation: "${p.koreanText}"\n`;
      if (p.terminology && Object.keys(p.terminology).length > 0) {
        patternInstructions += `- Preferred Terminology Mappings:\n`;
        Object.entries(p.terminology).forEach(([en, ko]) => {
          patternInstructions += `  * "${en}" -> "${ko}"\n`;
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
    console.error("Error fetching english learned patterns:", error);
    return "";
  }
}

export async function translateEnglishNews(
  text: string,
  section: EnglishTranslationSection,
  sourceName: string = "Reuters",
  publisherName: string = "",
  nation: string = "United States"
): Promise<string> {
  const learnedPatterns = await getEnglishLearnedPatterns();
  
  let dynamicSystemInstruction = SYSTEM_INSTRUCTIONS_EN_TO_KO + GENERAL_NEWS_INSTRUCTIONS;

  // Substitute brackets
  dynamicSystemInstruction = dynamicSystemInstruction
    .replace(/\(Nation\)/g, nation)
    .replace(/\{Nation\}/g, nation)
    .replace(/\(Source\)/g, sourceName)
    .replace(/\{Source\}/g, sourceName);

  if (publisherName && publisherName.trim()) {
    dynamicSystemInstruction = dynamicSystemInstruction
      .replace(/\(Publisher Name\)/g, publisherName.trim());
  } else {
    dynamicSystemInstruction = dynamicSystemInstruction
      .replace(/\(Publisher Name\)\n?/g, "");
  }

  const prompt = `
### TRANSLATION METADATA:
1. Nation (국가): ${nation}
2. Source (매체): ${sourceName}
3. Publisher Name (기자명/배포처): ${publisherName && publisherName.trim() ? publisherName.trim() : '(none - completely omit the (Publisher Name) line from output)'}

### Destination Section Style:
- Section: General News (English to Korean)

### Output Formatting Instructions:
- Ensure that the bracketed metadata line strictly uses: "[ ${nation}. ${sourceName}. (Month in original). (Day in original). (Time in original) ]"
- If a Publisher Name is provided ("${publisherName && publisherName.trim() ? publisherName.trim() : ''}"), place it directly on its own line immediately below the bracketed metadata line. If it is empty/none, omit that line completely and begin the translated body text.

### Original English Source text to translate:
${text}

${learnedPatterns}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: dynamicSystemInstruction,
        temperature: 0.1,
        topP: 0.4,
        topK: 20
      }
    });

    return response.text || "English-to-Korean translation failed.";
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
    // Save to corrections_en collection
    await addDoc(collection(db, 'corrections_en'), {
      sourceText,
      aiTranslatedText,
      userCorrectedText,
      section,
      createdAt: serverTimestamp()
    });

    const prompt = `
You are an expert English-to-Korean translation pattern analyzer for a news agency.
Your task is to analyze the original English text and the user-corrected Korean translation to detect terminology mappings, stylistic preferences, and alignment patterns.

### INPUT DATA
1. Original English Text:
"${sourceText}"

2. User-Corrected Korean Translation:
"${userCorrectedText}"

### WORKFLOW RULES
- Analyze alignment between the English and user-corrected Korean text.
- Detect terminology, stylistic, and structural mappings.
- Generate structured translation rules.

### OUTPUT FORMAT
You MUST return ONLY a JSON object with the following structure. Do not output any introducing remarks, wrapping explanations, or markdown boxes. Output raw JSON.

Structure:
{
  "terminology": {
    "english_words": "korean_corrected_translation"
  },
  "transformationRules": [
    "Specific rule describing vocabulary conventions, sentence transformations, or grammatical structures learned from this correction"
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

    const patternDoc = {
      englishText: sourceText,
      koreanText: userCorrectedText,
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
    await deleteDoc(doc(db, 'learned_patterns_en', id));
  } catch (error) {
    console.error("Error deleting english learned pattern:", error);
    throw error;
  }
}
