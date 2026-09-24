/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Languages, 
  FileText, 
  Mic2, 
  GraduationCap, 
  ChevronRight, 
  Copy, 
  Check, 
  AlertCircle,
  Clock,
  Save,
  Trash2,
  Settings2,
  Terminal,
  ShieldCheck,
  Zap,
  User,
  LogOut,
  Palette,
  Sparkles,
  Globe,
  Menu,
  X,
  ChevronDown
} from 'lucide-react';
import { onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { auth } from './lib/firebase';
import { AuthScreen } from './components/AuthScreen';
import { translateNews, saveCorrection, TranslationSection, fetchAllLearnedPatterns, deleteLearnedPattern, LearnedPatternItem } from './services/translationService';
import {
  translateEnglishNews,
  saveEnglishCorrection,
  EnglishTranslationSection,
  fetchAllEnglishLearnedPatterns,
  deleteEnglishLearnedPattern,
} from './services/englishTranslationService';
import {
  translateRussianNews,
  saveRussianCorrection,
  RussianTranslationSection,
  fetchAllRussianLearnedPatterns,
  deleteRussianLearnedPattern,
} from './services/russianTranslationService';
import { cn } from './lib/utils';

type Section = 'general' | 'learning';

export type ThemeId = 'white' | 'navy-white' | 'ivory' | 'dark';

interface ThemeDef {
  id: ThemeId;
  name: string;
  subtitle: string;
  dotColor: string;
  bgMain: string;
  bgHeader: string;
  bgCard: string;
  bgSource: string;
  bgOutput: string;
  borderColor: string;
  dividerColor: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textPlaceholder: string;
  navBg: string;
  navActiveBg: string;
  navActiveText: string;
  navInactiveText: string;
  metaBg: string;
  metaBorder: string;
  metaText: string;
  primaryBtn: string;
  textareaBg: string;
  footerBg: string;
  footerText: string;
}

const THEMES: Record<ThemeId, ThemeDef> = {
  'white': {
    id: 'white',
    name: 'Yonhap Pure White',
    subtitle: '연합 정론 클래식 (순백)',
    dotColor: 'bg-blue-600',
    bgMain: 'bg-slate-100/80',
    bgHeader: 'bg-white border-b border-slate-200 text-slate-900 shadow-xs',
    bgCard: 'bg-white border border-slate-200/90 shadow-xs',
    bgSource: 'bg-slate-50/70',
    bgOutput: 'bg-white',
    borderColor: 'border-slate-200',
    dividerColor: 'bg-slate-200',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-600',
    textMuted: 'text-slate-400',
    textPlaceholder: 'placeholder:text-slate-400',
    navBg: 'bg-slate-100 border border-slate-200/80',
    navActiveBg: 'bg-white text-blue-700 shadow-xs border border-slate-200/90',
    navActiveText: 'text-blue-700 font-bold',
    navInactiveText: 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50',
    metaBg: 'bg-slate-50',
    metaBorder: 'border-slate-200',
    metaText: 'text-slate-800',
    primaryBtn: 'bg-blue-700 hover:bg-blue-800 text-white shadow-md shadow-blue-700/20',
    textareaBg: 'bg-white border-slate-200 text-slate-800 focus:border-blue-600',
    footerBg: 'bg-white border-t border-slate-200 text-slate-600',
    footerText: 'text-slate-600',
  },
  'navy-white': {
    id: 'navy-white',
    name: 'Executive Navy & White',
    subtitle: '프리미엄 네이비 & 화이트',
    dotColor: 'bg-indigo-600',
    bgMain: 'bg-slate-100',
    bgHeader: 'bg-slate-900 border-b border-slate-800 text-white shadow-md',
    bgCard: 'bg-white border border-slate-200 shadow-xs',
    bgSource: 'bg-slate-50',
    bgOutput: 'bg-white',
    borderColor: 'border-slate-200',
    dividerColor: 'bg-slate-200',
    textPrimary: 'text-slate-900',
    textSecondary: 'text-slate-600',
    textMuted: 'text-slate-400',
    textPlaceholder: 'placeholder:text-slate-400',
    navBg: 'bg-slate-800 border border-slate-700',
    navActiveBg: 'bg-indigo-600 text-white shadow-xs',
    navActiveText: 'text-white font-bold',
    navInactiveText: 'text-slate-300 hover:text-white hover:bg-slate-700/60',
    metaBg: 'bg-white',
    metaBorder: 'border-slate-200',
    metaText: 'text-slate-800',
    primaryBtn: 'bg-indigo-700 hover:bg-indigo-800 text-white shadow-md shadow-indigo-700/20',
    textareaBg: 'bg-white border-slate-200 text-slate-800 focus:border-indigo-600',
    footerBg: 'bg-slate-900 border-t border-slate-800 text-slate-400',
    footerText: 'text-slate-400',
  },
  'ivory': {
    id: 'ivory',
    name: 'Warm Cream Ivory',
    subtitle: '아늑한 크림 아이보리',
    dotColor: 'bg-amber-600',
    bgMain: 'bg-[#FAF6EE]',
    bgHeader: 'bg-[#F4EFE3] border-b border-[#E6DFC8] text-[#1C1917] shadow-xs',
    bgCard: 'bg-[#FFFDF9] border border-[#E6DFC8] shadow-xs',
    bgSource: 'bg-[#F7F2E6]',
    bgOutput: 'bg-[#FFFDF9]',
    borderColor: 'border-[#E6DFC8]',
    dividerColor: 'bg-[#E6DFC8]',
    textPrimary: 'text-[#1C1917]',
    textSecondary: 'text-[#57534E]',
    textMuted: 'text-[#A8A29E]',
    textPlaceholder: 'placeholder:text-[#A8A29E]',
    navBg: 'bg-[#EFE7D8] border border-[#DFD6C2]',
    navActiveBg: 'bg-[#FFFDF9] text-amber-900 shadow-xs border border-[#DFD6C2]',
    navActiveText: 'text-amber-900 font-bold',
    navInactiveText: 'text-[#57534E] hover:text-[#1C1917] hover:bg-[#E7DFCFAF]',
    metaBg: 'bg-[#F7F2E6]',
    metaBorder: 'border-[#E6DFC8]',
    metaText: 'text-[#1C1917]',
    primaryBtn: 'bg-amber-800 hover:bg-amber-900 text-white shadow-md shadow-amber-800/20',
    textareaBg: 'bg-[#FFFDF9] border-[#E6DFC8] text-[#1C1917] focus:border-amber-700',
    footerBg: 'bg-[#F4EFE3] border-t border-[#E6DFC8] text-[#57534E]',
    footerText: 'text-[#57534E]',
  },
  'dark': {
    id: 'dark',
    name: 'Classic Slate Dark',
    subtitle: '슬레이트 다크 모드',
    dotColor: 'bg-blue-500',
    bgMain: 'bg-[#0F1115]',
    bgHeader: 'bg-[#16191F] border-b border-[#2D3139] text-[#E2E8F0] shadow-md',
    bgCard: 'bg-[#16191F] border border-[#2D3139]',
    bgSource: 'bg-[#0F1115]',
    bgOutput: 'bg-[#12151B]',
    borderColor: 'border-[#2D3139]',
    dividerColor: 'bg-[#2D3139]',
    textPrimary: 'text-[#E2E8F0]',
    textSecondary: 'text-slate-400',
    textMuted: 'text-slate-500',
    textPlaceholder: 'placeholder:text-slate-700',
    navBg: 'bg-[#0F1115] border border-[#2D3139]',
    navActiveBg: 'bg-[#2D3139] text-white shadow-xs',
    navActiveText: 'text-white font-bold',
    navInactiveText: 'text-slate-400 hover:text-white hover:bg-[#20242D]',
    metaBg: 'bg-[#0F1115]',
    metaBorder: 'border-[#2D3139]',
    metaText: 'text-slate-200',
    primaryBtn: 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-900/30',
    textareaBg: 'bg-[#0F1115] border-[#2D3139] text-slate-300 focus:border-blue-500',
    footerBg: 'bg-[#0B0D11] border-t border-[#252932] text-slate-500',
    footerText: 'text-slate-500',
  }
};

export default function App() {
  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const [guestUser, setGuestUser] = useState<{ email: string } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [translationMode, setTranslationMode] = useState<'zh-ko' | 'en-ko' | 'ru-ko'>('zh-ko');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  // Theme state: defaults to 'white' (Yonhap Pure White)
  const [themeId, setThemeId] = useState<ThemeId>('white');
  const [isThemeDropdownOpen, setIsThemeDropdownOpen] = useState(false);
  const currentTheme = THEMES[themeId];
  
  const [activeSection, setActiveSection] = useState<Section>('general');
  const [sourceName, setSourceName] = useState('인터넷신화사');
  const [publisherName, setPublisherName] = useState('');
  const [nationName, setNationName] = useState('중국');
  const [chineseText, setChineseText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [correctionText, setCorrectionText] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copyStatus, setCopyStatus] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [learningHistory, setLearningHistory] = useState<string[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'complete'>('idle');

  // For Section 3 Correction Flow
  const [sourceForCorrection, setSourceForCorrection] = useState('');
  const [aiForCorrection, setAiForCorrection] = useState('');
  const [learningSuccess, setLearningSuccess] = useState<string | null>(null);
  const [learningError, setLearningError] = useState<string | null>(null);

  const [learnedPatterns, setLearnedPatterns] = useState<any[]>([]);
  const [isLoadingPatterns, setIsLoadingPatterns] = useState(false);
  const [learningTargetSection, setLearningTargetSection] = useState<'general'>('general');

  const loadPatterns = async () => {
    setIsLoadingPatterns(true);
    try {
      if (translationMode === 'zh-ko') {
        const data = await fetchAllLearnedPatterns();
        setLearnedPatterns(data);
      } else if (translationMode === 'en-ko') {
        const data = await fetchAllEnglishLearnedPatterns();
        setLearnedPatterns(data);
      } else {
        const data = await fetchAllRussianLearnedPatterns();
        setLearnedPatterns(data);
      }
    } catch (err) {
      console.error("Failed to load learned patterns:", err);
    } finally {
      setIsLoadingPatterns(false);
    }
  };

  // Auth state observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (activeSection === 'learning') {
      loadPatterns();
    } else if (activeSection === 'general') {
      setLearningTargetSection('general');
      if (translationMode === 'zh-ko') {
        setSourceName('인터넷신화사');
      } else if (translationMode === 'en-ko') {
        setSourceName('Reuters');
      } else {
        setSourceName('Tass');
      }
    }
  }, [activeSection, translationMode]);

  const handleModeChange = (mode: 'zh-ko' | 'en-ko' | 'ru-ko') => {
    setTranslationMode(mode);
    setChineseText('');
    setTranslatedText('');
    setError(null);
    setIsDropdownOpen(false);
    setIsDrawerOpen(false);
    
    if (mode === 'en-ko') {
      setSourceName('Reuters');
      setNationName('영국');
    } else if (mode === 'ru-ko') {
      setSourceName('Tass');
      setNationName('러시아');
    } else {
      setSourceName('인터넷신화사');
      setNationName('중국');
    }
  };

  const handleTranslate = async (section: TranslationSection) => {
    // Automatically delete trailing blank spaces/newlines after the last paragraph
    const trimmedSource = chineseText.trimEnd();
    if (trimmedSource !== chineseText) {
      setChineseText(trimmedSource);
    }

    // 1. Validate inputs
    if (!sourceName.trim() || !nationName.trim() || !publisherName.trim()) {
      setError('Please fill in Source, Nation, and Publisher fields.');
      return;
    }
    
    // 2. Validate article content (needs to have title, published time, and paragraph)
    const lines = trimmedSource.split('\n').filter(line => line.trim().length > 0);
    if (lines.length < 3) {
      setError('Article must contain at least a title, published time, and a paragraph.');
      return;
    }

    if (!trimmedSource) return;
    
    setIsTranslating(true);
    setError(null);
    try {
      let result = '';
      if (translationMode === 'zh-ko') {
        result = await translateNews(trimmedSource, section, sourceName, publisherName, nationName);
      } else if (translationMode === 'en-ko') {
        result = await translateEnglishNews(trimmedSource, EnglishTranslationSection.GENERAL, sourceName, publisherName, nationName);
      } else {
        const ruRes = await translateRussianNews(trimmedSource, RussianTranslationSection.GENERAL, sourceName, publisherName, nationName);
        result = typeof ruRes === 'string' ? ruRes : ruRes.translatedText;
      }
      setTranslatedText(result);
      
      setSourceForCorrection(trimmedSource);
      setAiForCorrection(result);
      setCorrectionText(result);
    } catch (err) {
      setError('Translation failed. Please check your connection or API key.');
      console.error(err);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSaveCorrection = async () => {
    console.log("Learning Save clicked. Source:", sourceForCorrection, "Correction:", correctionText);
    setLearningSuccess(null);
    setLearningError(null);

    if (!sourceForCorrection.trim() || !correctionText.trim()) {
      setLearningError("Unable to process learning data.\nPlease verify that both fields contain valid content.");
      return;
    }

    setSaveStatus('saving');
    try {
      if (translationMode === 'zh-ko') {
        await saveCorrection(
          sourceForCorrection.trim(),
          aiForCorrection.trim() || sourceForCorrection.trim(),
          correctionText.trim(),
          TranslationSection.GENERAL
        );
      } else if (translationMode === 'en-ko') {
        await saveEnglishCorrection(
          sourceForCorrection.trim(),
          aiForCorrection.trim() || sourceForCorrection.trim(),
          correctionText.trim(),
          EnglishTranslationSection.GENERAL
        );
      } else {
        await saveRussianCorrection(
          sourceForCorrection.trim(),
          aiForCorrection.trim() || sourceForCorrection.trim(),
          correctionText.trim(),
          RussianTranslationSection.GENERAL
        );
      }
      
      setSaveStatus('complete');
      setLearningSuccess("Learning completed successfully.\nTranslation patterns and terminology have been added to the knowledge base.");
      
      setCorrectionText('');
      setSourceForCorrection('');
      setAiForCorrection('');
      loadPatterns();
      
      setTimeout(() => {
        setSaveStatus('idle');
      }, 5000);
    } catch (err) {
      console.error("Save correction failed:", err);
      setLearningError("Unable to process learning data.\nPlease verify that both fields contain valid content.");
      setSaveStatus('idle');
    }
  };

  const handleDeletePattern = async (id: string) => {
    try {
      if (translationMode === 'zh-ko') {
        await deleteLearnedPattern(id);
      } else if (translationMode === 'en-ko') {
        await deleteEnglishLearnedPattern(id);
      } else {
        await deleteRussianLearnedPattern(id);
      }
      setLearnedPatterns(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      console.error("Failed to delete learned pattern:", err);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    // Force plain text copy to prevent any rich HTML formatting/styles (like dark backgrounds)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      // Fallback for environment constraints where clipboard API might be limited
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
      } catch (err) {
        console.error("Fallback copy failed: ", err);
      }
      document.body.removeChild(textArea);
    }
    setCopyStatus(prev => ({ ...prev, [id]: true }));
    setTimeout(() => {
      setCopyStatus(prev => ({ ...prev, [id]: false }));
    }, 2000);
  };

  const handleCopy = (e: React.ClipboardEvent) => {
    // Intercept default selection copying and force it to be unstyled, plain text
    const selection = window.getSelection();
    if (selection) {
      const selectedText = selection.toString();
      if (selectedText) {
        e.preventDefault();
        e.clipboardData.setData('text/plain', selectedText);
      }
    }
  };

  const NavItem = ({ section, label, icon: Icon }: { section: Section, label: string, icon: any }) => (
    <button
      onClick={() => setActiveSection(section)}
      className={cn(
        "px-6 py-1.5 rounded-lg text-xs font-bold tracking-wider transition-all relative flex items-center gap-2 cursor-pointer select-none",
        activeSection === section 
          ? currentTheme.navActiveBg
          : currentTheme.navInactiveText
      )}
    >
      <Icon className="w-4 h-4" />
      <span>{label}</span>
      {activeSection === section && (
        <motion.div 
          layoutId="tabGlow"
          className="absolute inset-0 bg-blue-500/10 rounded-lg -z-10"
        />
      )}
    </button>
  );

  const activeUserEmail = currentUser?.email || guestUser?.email;

  const handleLogout = async () => {
    setGuestUser(null);
    if (currentUser) {
      await signOut(auth);
    }
  };

  if (authLoading) {
    return (
      <div className={cn("h-screen flex flex-col items-center justify-center font-sans", currentTheme.bgMain, currentTheme.textPrimary)}>
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className={cn("text-xs font-medium", currentTheme.textSecondary)}>인증 정보를 확인 중입니다...</p>
      </div>
    );
  }

  if (!currentUser && !guestUser) {
    return (
      <AuthScreen />
    );
  }

  return (
    <div className={cn("h-screen font-sans flex flex-col overflow-hidden selection:bg-blue-500/20 transition-colors duration-200", currentTheme.bgMain, currentTheme.textPrimary)}>
      {/* Left Slide-out Language Drawer */}
      <AnimatePresence>
        {isDrawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDrawerOpen(false)}
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-[100] cursor-pointer"
            />

            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 26, stiffness: 280 }}
              className={cn(
                "fixed top-0 left-0 bottom-0 w-80 sm:w-88 shadow-2xl z-[101] flex flex-col border-r transition-colors duration-200",
                themeId === 'dark' ? "bg-[#181B20] border-[#2B303B] text-slate-100" : "bg-white border-slate-200 text-slate-900"
              )}
            >
              <div className="p-5 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold tracking-tight">번역 언어 선택</h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Select Translation Engine</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsDrawerOpen(false)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 flex flex-col gap-3 flex-1 overflow-y-auto">
                <div className="px-1 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  사용 가능한 번역 언어 (Available Engines)
                </div>

                {/* Chinese Choice */}
                <button
                  type="button"
                  onClick={() => handleModeChange('zh-ko')}
                  className={cn(
                    "w-full p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between group",
                    translationMode === 'zh-ko'
                      ? "bg-blue-50/90 dark:bg-blue-950/40 border-blue-500 text-blue-900 dark:text-blue-100 shadow-xs ring-1 ring-blue-500/30 font-bold"
                      : "bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/80 hover:border-blue-300 dark:hover:border-blue-700"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-blue-600 text-white font-bold flex items-center justify-center text-xs shadow-xs shrink-0 font-mono">
                      CN
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">중국어 ➔ 한국어</span>
                      {translationMode === 'zh-ko' && (
                        <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.2 rounded font-bold">선택됨</span>
                      )}
                    </div>
                  </div>
                  <Check className={cn("w-4 h-4 transition-opacity", translationMode === 'zh-ko' ? "text-blue-600 opacity-100" : "opacity-0 group-hover:opacity-30")} />
                </button>

                {/* English Choice */}
                <button
                  type="button"
                  onClick={() => handleModeChange('en-ko')}
                  className={cn(
                    "w-full p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between group",
                    translationMode === 'en-ko'
                      ? "bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-500 text-emerald-900 dark:text-emerald-100 shadow-xs ring-1 ring-emerald-500/30 font-bold"
                      : "bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/80 hover:border-emerald-300 dark:hover:border-emerald-700"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center text-xs shadow-xs shrink-0 font-mono">
                      EN
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">영어 ➔ 한국어</span>
                      {translationMode === 'en-ko' && (
                        <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.2 rounded font-bold">선택됨</span>
                      )}
                    </div>
                  </div>
                  <Check className={cn("w-4 h-4 transition-opacity", translationMode === 'en-ko' ? "text-emerald-600 opacity-100" : "opacity-0 group-hover:opacity-30")} />
                </button>

                {/* Russian Choice */}
                <button
                  type="button"
                  onClick={() => handleModeChange('ru-ko')}
                  className={cn(
                    "w-full p-3.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between group",
                    translationMode === 'ru-ko'
                      ? "bg-rose-50/90 dark:bg-rose-950/40 border-rose-500 text-rose-900 dark:text-rose-100 shadow-xs ring-1 ring-rose-500/30 font-bold"
                      : "bg-slate-50/70 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/80 hover:border-rose-300 dark:hover:border-rose-700"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-rose-600 text-white font-bold flex items-center justify-center text-xs shadow-xs shrink-0 font-mono">
                      RU
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">러시아어 ➔ 한국어</span>
                      {translationMode === 'ru-ko' && (
                        <span className="text-[10px] bg-rose-600 text-white px-1.5 py-0.2 rounded font-bold">선택됨</span>
                      )}
                    </div>
                  </div>
                  <Check className={cn("w-4 h-4 transition-opacity", translationMode === 'ru-ko' ? "text-rose-600 opacity-100" : "opacity-0 group-hover:opacity-30")} />
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className={cn("py-3 px-6 flex flex-col gap-3 shrink-0 z-50", currentTheme.bgHeader)}>
        {/* Top Row: Logo/Title (Left) + Nav Tabs (Center) + User Profile (Right) */}
        <div className="grid grid-cols-3 items-center w-full">
          {/* Left Column: Brand Logo & Title */}
          <div className="flex items-center gap-3 justify-self-start">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center font-black text-xs shadow-xs font-mono shrink-0">
              NTAK
            </div>
            <h1 className="text-base font-bold tracking-tight hidden lg:block font-serif whitespace-nowrap">
              News Translation Assistant in Korean(NTAK)
            </h1>
          </div>

          {/* Middle Column: Nav Tabs */}
          <nav className={cn("flex items-center gap-1.5 p-1 rounded-xl justify-self-center border border-slate-200/80 dark:border-slate-700/80", currentTheme.navBg)}>
            <NavItem section="general" label="GENERAL" icon={FileText} />
            <NavItem section="learning" label="LEARNING" icon={GraduationCap} />
          </nav>

          {/* Right Column: User Profile & Logout */}
          <div className="flex items-center gap-2 justify-self-end">
            <div className={cn("hidden xl:flex items-center gap-2 px-3 h-9 rounded-xl text-xs font-mono shadow-2xs border", currentTheme.metaBg, currentTheme.metaBorder)}>
              <User className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span className={cn("truncate max-w-[140px]", currentTheme.textSecondary)} title={activeUserEmail || ''}>
                {activeUserEmail}
              </span>
            </div>
            <button
              onClick={handleLogout}
              title="로그아웃"
              className={cn(
                "px-3 h-9 rounded-xl text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200/80 hover:border-red-200 transition-all flex items-center gap-2 text-xs font-semibold cursor-pointer shadow-2xs bg-white",
                themeId === 'dark' && "bg-[#2D3139] text-slate-300 border-slate-700 hover:bg-red-950/40 hover:text-red-400 hover:border-red-800"
              )}
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden md:inline">로그아웃</span>
            </button>
          </div>
        </div>

        {/* Sub Row: Language Transition Button (Left) + Metadata inputs (Center) + Model indicator (Right) */}
        <div className="flex items-center justify-between w-full pt-1">
          {/* Left Column: Language Switcher Trigger Button below Logo */}
          <div className="justify-self-start">
            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow-2xs cursor-pointer select-none group",
                translationMode === 'zh-ko'
                  ? "bg-blue-50 border-blue-200 text-blue-900 hover:bg-blue-100/80 hover:border-blue-300"
                  : translationMode === 'en-ko'
                  ? "bg-emerald-50 border-emerald-200 text-emerald-900 hover:bg-emerald-100/80 hover:border-emerald-300"
                  : "bg-rose-50 border-rose-200 text-rose-900 hover:bg-rose-100/80 hover:border-rose-300"
              )}
              title="언어 엔진 변경 (메뉴 열기)"
            >
              <Menu className="w-4 h-4 text-slate-500 group-hover:text-slate-800 transition-colors shrink-0" />
              <div className="flex items-center gap-1.5 font-mono">
                <span className={cn(
                  "px-2 py-0.5 rounded-md text-[11px] font-bold text-white shadow-2xs",
                  translationMode === 'zh-ko' ? "bg-blue-600" : translationMode === 'en-ko' ? "bg-emerald-600" : "bg-rose-600"
                )}>
                  {translationMode === 'zh-ko' ? 'CN ➔ 한' : translationMode === 'en-ko' ? 'EN ➔ 한' : 'RU ➔ 한'}
                </span>
                <span className="font-sans text-xs font-bold text-slate-800 dark:text-slate-200">
                  {translationMode === 'zh-ko' ? '중국어' : translationMode === 'en-ko' ? '영어' : '러시아어'}
                </span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 transition-transform group-hover:translate-y-0.5" />
            </button>
          </div>

          {/* Center Column: Source, Nation, Publisher metadata inputs */}
          {activeSection !== 'learning' ? (
            <div className="flex-1 flex justify-center px-4">
              <div className={cn("flex items-center gap-6 px-5 py-2 rounded-xl border shadow-2xs", currentTheme.metaBg, currentTheme.metaBorder)}>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider whitespace-nowrap text-slate-400">Source</span>
                  <input 
                    type="text" 
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    className={cn("bg-transparent border-none p-0 text-sm font-semibold focus:ring-0 w-28 h-6", currentTheme.textPrimary)}
                    placeholder="Source..."
                  />
                </div>
                <div className={cn("w-px h-4", currentTheme.dividerColor)}></div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider whitespace-nowrap text-slate-400">Nation</span>
                  <input 
                    type="text" 
                    value={nationName}
                    onChange={(e) => setNationName(e.target.value)}
                    className={cn("bg-transparent border-none p-0 text-sm font-semibold focus:ring-0 w-28 h-6", currentTheme.textPrimary)}
                    placeholder="Nation..."
                  />
                </div>
                <div className={cn("w-px h-4", currentTheme.dividerColor)}></div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs font-bold uppercase tracking-wider whitespace-nowrap text-slate-400">Publisher</span>
                  <input 
                    type="text" 
                    value={publisherName}
                    onChange={(e) => setPublisherName(e.target.value)}
                    className={cn("bg-transparent border-none p-0 text-sm font-semibold focus:ring-0 w-28 h-6", currentTheme.textPrimary)}
                    placeholder="Publisher..."
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1" />
          )}

          {/* Right Column: Model indicator */}
          <div className={cn(
            "flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[10px] sm:text-[11px] font-bold font-mono tracking-tight shadow-2xs shrink-0",
            themeId === 'dark'
              ? "bg-blue-950/50 border-blue-800/80 text-blue-300"
              : "bg-blue-50/90 border-blue-200/90 text-blue-700"
          )}>
            <Zap className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>Model: gemini-3.1-flash-lite</span>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex flex-1 overflow-hidden">
        {/* Translation Viewport */}
        <div className="flex-1 flex flex-col relative">
          <AnimatePresence mode="wait">
            {activeSection !== 'learning' ? (
              <motion.div 
                key="translation-grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex-1 overflow-hidden flex flex-col"
              >
                <div className="flex-1 grid grid-cols-2 overflow-hidden relative">
                  {/* Source Input */}
                  <div className={cn("flex flex-col p-8 overflow-hidden group border-r-2 border-slate-300/90 dark:border-slate-700/80 shadow-2xs", currentTheme.bgSource)}>
                    <div className="flex items-center justify-between mb-6 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        <span className={cn("text-xs font-bold uppercase tracking-wider", currentTheme.textSecondary)}>
                          Source: {translationMode === 'zh-ko' ? 'Chinese (Standard)' : translationMode === 'en-ko' ? 'English (Standard)' : 'Russian (Standard)'}
                        </span>
                      </div>
                      <button 
                        onClick={() => {
                          setChineseText('');
                          setTranslatedText('');
                        }}
                        className="text-xs font-bold text-slate-400 hover:text-red-500 transition-all uppercase flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Clear
                      </button>
                    </div>
                    <div className="flex-1 relative">
                      <textarea
                        value={chineseText}
                        onChange={(e) => setChineseText(e.target.value)}
                        onPaste={(e) => {
                          const pastedText = e.clipboardData.getData('text');
                          if (pastedText) {
                            e.preventDefault();
                            const target = e.target as HTMLTextAreaElement;
                            const start = target.selectionStart;
                            const end = target.selectionEnd;
                            const textBefore = chineseText.substring(0, start);
                            const textAfter = chineseText.substring(end);
                            const newText = (textBefore + pastedText + textAfter).trimEnd();
                            setChineseText(newText);
                          }
                        }}
                        placeholder={translationMode === 'zh-ko' ? "중국어 기사를 입력하세요..." : translationMode === 'en-ko' ? "Enter English news article..." : "Enter Russian news article..."}
                        className={cn("w-full h-full bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none text-xl leading-relaxed font-serif caret-blue-600", currentTheme.textPrimary, currentTheme.placeholderText)}
                      />
                      <button
                        disabled={!chineseText || isTranslating}
                        onClick={() => handleTranslate(TranslationSection.GENERAL)}
                        className={cn(
                          "absolute bottom-2 right-2 px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-full font-bold text-xs tracking-wider uppercase shadow-md transition-all flex items-center gap-2 cursor-pointer active:scale-95",
                          (!chineseText || isTranslating) ? "opacity-25 cursor-not-allowed scale-95" : "hover:shadow-blue-500/25"
                        )}
                      >
                        {isTranslating ? "Translating..." : "Execute Translation"} <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Translation Output */}
                  <div className={cn("flex flex-col p-8 overflow-hidden border-l border-slate-300/90 dark:border-slate-700/80", currentTheme.bgOutput)}>
                    <div className="flex items-center justify-between mb-6 shrink-0">
                      <div className="flex items-center gap-2 h-4">
                        <span className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5 text-blue-600" /> Korean Output
                        </span>
                      </div>
                      <button 
                         onClick={() => copyToClipboard(translatedText, 'output')}
                         disabled={!translatedText}
                         className={cn("text-xs font-bold transition-all uppercase flex items-center gap-1.5 disabled:opacity-30 cursor-pointer", currentTheme.textSecondary)}
                      >
                        {copyStatus['output'] ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        {copyStatus['output'] ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto custom-scroll" onCopy={handleCopy}>
                      {isTranslating ? (
                        <div className="h-full flex flex-col items-center justify-center gap-4">
                          <div className={cn("w-32 h-1.5 rounded-full overflow-hidden", themeId === 'dark' ? "bg-slate-800" : "bg-slate-200")}>
                            <motion.div 
                              className="h-full bg-blue-600"
                              initial={{ x: "-100%" }}
                              animate={{ x: "100%" }}
                              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                            />
                          </div>
                          <span className={cn("text-xs font-mono uppercase tracking-widest font-semibold", currentTheme.textSecondary)}>
                            Neural Engine Processing...
                          </span>
                        </div>
                      ) : translatedText ? (
                        <div className="space-y-8 pb-12">
                          {/* Formal News Style Presentation */}
                          <div className={cn("font-news-agency whitespace-pre-wrap text-lg leading-[1.8]", currentTheme.textPrimary)} onCopy={handleCopy}>
                             {translatedText}
                          </div>
                        </div>
                      ) : (
                        <div className={cn("h-full flex flex-col items-center justify-center gap-4", currentTheme.textSecondary)}>
                          <Languages className="w-16 h-16 stroke-1 opacity-20" />
                          <p className="text-xs font-bold uppercase tracking-widest opacity-40">Waiting for source input</p>
                        </div>
                      )}

                      {error && (
                         <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-600 text-xs flex items-center gap-2 mt-4 font-medium">
                           <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                         </div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="learning-center"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.02 }}
                className={cn("flex-1 overflow-y-auto p-10 custom-scroll", currentTheme.bgMain)}
              >
                <div className="max-w-4xl mx-auto space-y-10">
                   <div className="flex items-center justify-between">
                      <div>
                        <h2 className={cn("text-2xl font-bold tracking-tight font-serif", currentTheme.textPrimary)}>Learning Center</h2>
                        <p className={cn("text-xs mt-1 font-medium", currentTheme.textSecondary)}>Submit translation corrections to train the future Yonhap News style model and refine vocabulary mappings.</p>
                      </div>
                   </div>

                   <AnimatePresence>
                     {learningSuccess && (
                       <motion.div 
                         initial={{ opacity: 0, y: -10 }}
                         animate={{ opacity: 1, y: 0 }}
                         exit={{ opacity: 0, y: -10 }}
                         className="p-5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs font-medium flex gap-3 shadow-xs"
                       >
                         <ShieldCheck className="w-5 h-5 shrink-0 text-emerald-600" />
                         <div className="whitespace-pre-line leading-relaxed">
                           {learningSuccess}
                         </div>
                       </motion.div>
                     )}

                     {learningError && (
                       <motion.div 
                         initial={{ opacity: 0, y: -10 }}
                         animate={{ opacity: 1, y: 0 }}
                         exit={{ opacity: 0, y: -10 }}
                         className="p-5 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs font-medium flex gap-3 shadow-xs"
                       >
                         <AlertCircle className="w-5 h-5 shrink-0 text-red-600" />
                         <div className="whitespace-pre-line leading-relaxed">
                           {learningError}
                         </div>
                       </motion.div>
                     )}
                   </AnimatePresence>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                     <div className={cn("border rounded-2xl p-6 space-y-4 shadow-xs", currentTheme.bgCard, currentTheme.borderColor)}>
                        <h3 className={cn("text-xs font-bold uppercase tracking-widest flex items-center gap-2", currentTheme.textSecondary)}>
                           <FileText className="w-4 h-4 text-blue-600" /> 1. Original {translationMode === 'zh-ko' ? 'Chinese' : translationMode === 'en-ko' ? 'English' : 'Russian'} Text
                        </h3>
                        <textarea 
                          value={sourceForCorrection}
                          onChange={(e) => setSourceForCorrection(e.target.value)}
                          disabled={saveStatus === 'saving'}
                          placeholder={translationMode === 'zh-ko' ? "Type or paste the original Chinese text here..." : translationMode === 'en-ko' ? "Type or paste the original English text here..." : "Type or paste the original Russian text here..."}
                          className={cn("w-full h-72 border rounded-xl p-4 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed font-news-agency resize-none disabled:opacity-50", currentTheme.inputBg, currentTheme.borderColor, currentTheme.textPrimary, currentTheme.placeholderText)}
                        />
                     </div>

                     <div className={cn("border rounded-2xl p-6 space-y-4 shadow-xs flex flex-col justify-between", currentTheme.bgCard, currentTheme.borderColor)}>
                        <div className="space-y-4">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <h3 className={cn("text-xs font-bold uppercase tracking-widest flex items-center gap-2", currentTheme.textSecondary)}>
                               <GraduationCap className="w-4 h-4 text-emerald-600" /> 2. User-Corrected Korean Translation
                            </h3>
                          </div>
                          <textarea 
                            value={correctionText}
                            onChange={(e) => setCorrectionText(e.target.value)}
                            disabled={saveStatus === 'saving'}
                            placeholder="Type or paste your corrected Korean translation here..."
                            className={cn("w-full h-72 border rounded-xl p-4 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 leading-relaxed font-news-agency resize-none disabled:opacity-50", currentTheme.inputBg, currentTheme.borderColor, currentTheme.textPrimary, currentTheme.placeholderText)}
                          />
                        </div>
                        <button 
                          disabled={saveStatus === 'saving' || !correctionText.trim() || !sourceForCorrection.trim()}
                          onClick={handleSaveCorrection}
                          className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-xs tracking-wider uppercase shadow-md transition-all flex items-center justify-center gap-2 disabled:opacity-25 cursor-pointer active:scale-98"
                        >
                          <Save className="w-4 h-4" /> {saveStatus === 'saving' ? 'Extracting & Generating Patterns...' : saveStatus === 'complete' ? 'Learning Completed' : 'Save Translation Correction'}
                        </button>
                     </div>
                   </div>

                   {/* Knowledge Base Explorer Section */}
                   <div className={cn("pt-10 border-t space-y-6", currentTheme.borderColor)}>
                     <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                       <div>
                         <h3 className={cn("text-lg font-bold tracking-tight flex items-center gap-2 font-serif", currentTheme.textPrimary)}>
                           <Terminal className="w-4 h-4 text-blue-600" /> Active Knowledge Base & Memory
                         </h3>
                         <p className={cn("text-xs mt-1", currentTheme.textSecondary)}>View or manage extracted cognitive patterns and specialized terminologies injected dynamically into translation prompts.</p>
                       </div>
                       <button 
                         onClick={loadPatterns}
                         className={cn("px-4 py-2 border hover:border-blue-500/50 text-xs font-bold rounded-xl transition-all flex items-center gap-2 shrink-0 cursor-pointer shadow-2xs", currentTheme.bgCard, currentTheme.borderColor, currentTheme.textPrimary)}
                       >
                         Refresh Database
                       </button>
                     </div>

                     {isLoadingPatterns ? (
                       <div className={cn("py-12 flex flex-col items-center justify-center gap-3 border rounded-2xl", currentTheme.bgCard, currentTheme.borderColor)}>
                         <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                         <p className={cn("text-xs font-mono uppercase tracking-widest font-semibold", currentTheme.textSecondary)}>Querying Firestore Database...</p>
                       </div>
                     ) : learnedPatterns.length === 0 ? (
                       <div className={cn("py-12 flex flex-col items-center justify-center gap-3 border rounded-2xl text-center", currentTheme.bgCard, currentTheme.borderColor)}>
                         <GraduationCap className="w-10 h-10 text-slate-400 stroke-1" />
                         <p className={cn("text-xs font-bold uppercase tracking-wider", currentTheme.textPrimary)}>No custom rules learned yet</p>
                         <p className={cn("text-xs max-w-sm mt-1", currentTheme.textSecondary)}>Submit your first translation correction above, and the engine will extract structured learnings here.</p>
                       </div>
                     ) : (
                       <div className="space-y-4">
                         {learnedPatterns.map((pattern, index) => (
                           <div key={pattern.id} className={cn("border rounded-2xl p-6 relative group overflow-hidden transition-all shadow-2xs", currentTheme.bgCard, currentTheme.borderColor)}>
                             {/* Header Bar with Translation Section Mark */}
                             <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-200/80 dark:border-slate-800">
                               <div className="flex items-center gap-2">
                                 {translationMode === 'zh-ko' ? (
                                   pattern.section === 'briefing' ? (
                                     <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-900 dark:bg-purple-950/80 dark:text-purple-300 dark:border-purple-800/80 border border-purple-300 shadow-2xs">
                                       <span className="w-2 h-2 rounded-full bg-purple-600 animate-pulse"></span>
                                       브리핑 번역 (Briefing Translation)
                                     </span>
                                   ) : (
                                     <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-900 dark:bg-blue-950/80 dark:text-blue-300 dark:border-blue-800/80 border border-blue-300 shadow-2xs">
                                       <span className="w-2 h-2 rounded-full bg-blue-600"></span>
                                       일반 번역 (General Translation)
                                     </span>
                                   )
                                 ) : (
                                   <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700 shadow-2xs">
                                     <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                     학습 규칙 (Learned Rule)
                                   </span>
                                 )}
                               </div>
                               <span className="text-slate-400 font-mono text-xs font-extrabold select-none">
                                 #{index + 1}
                               </span>
                             </div>

                             <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
                               {/* Left Side: Original Examples */}
                               <div className="lg:col-span-7 space-y-3">
                                 <div>
                                   <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Source {translationMode === 'zh-ko' ? 'Chinese' : translationMode === 'en-ko' ? 'English' : 'Russian'} Example</span>
                                   <p className={cn("text-xs font-serif mt-1 p-3 rounded-lg border leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap", currentTheme.inputBg, currentTheme.borderColor, currentTheme.textPrimary)}>{pattern.chineseText || pattern.englishText || pattern.russianText}</p>
                                 </div>
                                 <div>
                                   <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">User Corrected Translation</span>
                                   <p className={cn("text-xs font-serif mt-1 p-3 rounded-lg border leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap", currentTheme.inputBg, currentTheme.borderColor, currentTheme.textPrimary)}>{pattern.koreanText}</p>
                                 </div>
                               </div>

                               {/* Right Side: Extracted Semantics */}
                               <div className="lg:col-span-5 space-y-3">
                                 {/* Terminologies */}
                                 {pattern.terminology && Object.keys(pattern.terminology).length > 0 && (
                                   <div>
                                     <span className={cn("text-[10px] font-bold uppercase tracking-widest block mb-1.5", currentTheme.textSecondary)}>Learned Vocabulary Mappings</span>
                                     <div className="flex flex-wrap gap-1.5">
                                       {Object.entries(pattern.terminology).map(([zh, ko]) => (
                                         <div key={zh} className="flex items-center gap-1.5 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-md text-xs select-all">
                                           <span className="font-serif text-slate-700">{zh}</span>
                                           <ChevronRight className="w-3 h-3 text-blue-400" />
                                           <span className="font-bold text-blue-800">{ko}</span>
                                         </div>
                                       ))}
                                     </div>
                                   </div>
                                 )}

                                 {/* Rules */}
                                 {pattern.transformationRules && pattern.transformationRules.length > 0 && (
                                   <div>
                                     <span className={cn("text-[10px] font-bold uppercase tracking-widest block mb-1.5", currentTheme.textSecondary)}>Transformation Rules</span>
                                     <ul className={cn("space-y-1 text-xs p-3 rounded-lg border", currentTheme.inputBg, currentTheme.borderColor, currentTheme.textSecondary)}>
                                       {pattern.transformationRules.map((rule, rIdx) => (
                                         <li key={rIdx} className="flex gap-2 leading-relaxed">
                                           <span className="text-blue-600 shrink-0">•</span>
                                           <span>{rule}</span>
                                         </li>
                                       ))}
                                     </ul>
                                   </div>
                                 )}
                                 
                                 {/* Delete Button */}
                                 <div className={cn("flex items-center justify-between pt-2 border-t mt-2", currentTheme.borderColor)}>
                                   <span className={cn("text-[10px] font-mono", currentTheme.textSecondary)}>
                                     {pattern.createdAt?.seconds ? new Date(pattern.createdAt.seconds * 1000).toLocaleString() : 'Recently created'}
                                   </span>
                                   <button
                                     onClick={() => handleDeletePattern(pattern.id)}
                                     className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2.5 py-1 rounded transition-all flex items-center gap-1 cursor-pointer font-medium"
                                   >
                                     <Trash2 className="w-3.5 h-3.5" /> Prune Memory
                                   </button>
                                 </div>
                               </div>
                             </div>
                           </div>
                         ))}
                       </div>
                     )}
                   </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>


    </div>
  );
}
