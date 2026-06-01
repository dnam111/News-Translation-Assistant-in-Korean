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
  Zap
} from 'lucide-react';
import { translateNews, saveCorrection, TranslationSection, fetchAllLearnedPatterns, deleteLearnedPattern, LearnedPatternItem } from './services/translationService';
import { cn } from './lib/utils';

type Section = 'general' | 'briefing' | 'learning';

export default function App() {
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

  const [learnedPatterns, setLearnedPatterns] = useState<LearnedPatternItem[]>([]);
  const [isLoadingPatterns, setIsLoadingPatterns] = useState(false);

  const loadPatterns = async () => {
    setIsLoadingPatterns(true);
    try {
      const data = await fetchAllLearnedPatterns();
      setLearnedPatterns(data);
    } catch (err) {
      console.error("Failed to load learned patterns:", err);
    } finally {
      setIsLoadingPatterns(false);
    }
  };

  useEffect(() => {
    if (activeSection === 'learning') {
      loadPatterns();
    } else if (activeSection === 'general') {
      setSourceName('인터넷신화사');
    } else if (activeSection === 'briefing') {
      setSourceName('중국외교부');
    }
  }, [activeSection]);

  const handleTranslate = async (section: TranslationSection) => {
    if (!chineseText.trim()) return;
    
    setIsTranslating(true);
    setError(null);
    try {
      const result = await translateNews(chineseText, section, sourceName, publisherName, nationName);
      setTranslatedText(result);
      
      setSourceForCorrection(chineseText);
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
      await saveCorrection(
        sourceForCorrection.trim(),
        aiForCorrection.trim() || sourceForCorrection.trim(),
        correctionText.trim(),
        activeSection === 'briefing' ? TranslationSection.BRIEFING : TranslationSection.GENERAL
      );
      
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
      await deleteLearnedPattern(id);
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
        "px-4 py-1.5 rounded-md text-sm font-medium transition-all relative flex items-center gap-2",
        activeSection === section 
          ? "bg-[#2D3139] text-white" 
          : "text-slate-400 hover:text-white"
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
      {activeSection === section && (
        <motion.div 
          layoutId="tabGlow"
          className="absolute inset-0 bg-blue-500/5 rounded-md -z-10"
        />
      )}
    </button>
  );

  return (
    <div className="h-screen bg-[#0F1115] text-[#E2E8F0] font-sans flex flex-col overflow-hidden selection:bg-blue-500/30">
      {/* Header */}
      <header className="h-16 border-b border-[#2D3139] bg-[#16191F] flex items-center justify-between px-6 shrink-0 z-50">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-4">
            <div className="h-8 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center gap-1.5 font-bold text-white shadow-lg shadow-blue-500/20 px-3 font-sans select-none">
              <span className="text-xs font-semibold text-blue-100">中</span>
              <span className="text-[10px] text-blue-200/80">➔</span>
              <span className="text-xs font-bold text-white">한</span>
            </div>
            <h1 className="text-lg font-semibold tracking-tight hidden lg:block">
              News Translation Engine
            </h1>
          </div>

          {activeSection !== 'learning' && (
            <div className="hidden md:flex items-center gap-4 bg-[#0F1115] px-4 py-1.5 rounded-lg border border-[#2D3139]">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">Source</span>
                <input 
                  type="text" 
                  value={sourceName}
                  onChange={(e) => setSourceName(e.target.value)}
                  className="bg-transparent border-none p-0 text-xs focus:ring-0 text-slate-300 w-24 h-5"
                  placeholder="Source..."
                />
              </div>
              <div className="w-px h-3 bg-[#2D3139]"></div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">Nation</span>
                <input 
                  type="text" 
                  value={nationName}
                  onChange={(e) => setNationName(e.target.value)}
                  className="bg-transparent border-none p-0 text-xs focus:ring-0 text-slate-300 w-24 h-5"
                  placeholder="Nation..."
                />
              </div>
              <div className="w-px h-3 bg-[#2D3139]"></div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-bold uppercase whitespace-nowrap">Publisher</span>
                <input 
                  type="text" 
                  value={publisherName}
                  onChange={(e) => setPublisherName(e.target.value)}
                  className="bg-transparent border-none p-0 text-xs focus:ring-0 text-slate-300 w-24 h-5"
                  placeholder="Publisher..."
                />
              </div>
            </div>
          )}
        </div>

        <nav className="flex gap-1 bg-[#0F1115] p-1 rounded-lg border border-[#2D3139]">
          <NavItem section="general" label="GENERAL" icon={FileText} />
          <NavItem section="briefing" label="BRIEFING" icon={Mic2} />
          <NavItem section="learning" label="LEARNING" icon={GraduationCap} />
        </nav>

        <div className="flex items-center gap-6">
          <div className="w-10 h-10 rounded-full bg-[#2D3139] border border-blue-500/30 flex items-center justify-center overflow-hidden">
             <Settings2 className="w-5 h-5 text-slate-400" />
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
                <div className="flex-1 grid grid-cols-2 gap-px bg-[#2D3139] overflow-hidden">
                  {/* Source Input */}
                  <div className="bg-[#0F1115] flex flex-col p-8 overflow-hidden group">
                    <div className="flex items-center justify-between mb-6 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                        <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">Source: Chinese (Standard)</span>
                      </div>
                      <button 
                        onClick={() => setChineseText('')}
                        className="text-[10px] font-bold text-slate-600 hover:text-red-400 transition-all uppercase flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3 h-3" /> Clear
                      </button>
                    </div>
                    <div className="flex-1 relative">
                       <textarea
                        value={chineseText}
                        onChange={(e) => setChineseText(e.target.value)}
                        placeholder="Type here..."
                        className="w-full h-full bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-blue-500/50 resize-none text-xl leading-relaxed text-slate-300 placeholder:text-slate-800 font-serif caret-blue-500"
                      />
                      <button
                        disabled={!chineseText || isTranslating}
                        onClick={() => handleTranslate(activeSection === 'general' ? TranslationSection.GENERAL : TranslationSection.BRIEFING)}
                        className={cn(
                          "absolute bottom-0 right-0 px-10 py-4 bg-blue-600 text-white rounded-full font-bold text-sm shadow-xl transition-all flex items-center gap-2",
                          (!chineseText || isTranslating) ? "opacity-20 cursor-not-allowed scale-95" : "shadow-blue-900/40 hover:scale-105 active:scale-95"
                        )}
                      >
                        {isTranslating ? "Translating..." : "Execute Translation"} <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Translation Output */}
                  <div className="bg-[#12151B] flex flex-col p-8 overflow-hidden">
                    <div className="flex items-center justify-between mb-6 shrink-0">
                      <div className="flex items-center gap-2 h-4">
                      </div>
                      <button 
                         onClick={() => copyToClipboard(translatedText, 'output')}
                         disabled={!translatedText}
                         className="text-[10px] font-bold text-slate-600 hover:text-white transition-all uppercase flex items-center gap-1.5 disabled:opacity-30"
                      >
                        {copyStatus['output'] ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copyStatus['output'] ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto custom-scroll" onCopy={handleCopy}>
                      {isTranslating ? (
                        <div className="h-full flex flex-col items-center justify-center gap-4">
                          <div className="w-24 h-1 bg-[#1C2028] rounded-full overflow-hidden">
                            <motion.div 
                              className="h-full bg-blue-500"
                              initial={{ x: "-100%" }}
                              animate={{ x: "100%" }}
                              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-slate-600 uppercase tracking-widest">Neural Engine Processing...</span>
                        </div>
                      ) : translatedText ? (
                        <div className="space-y-8 pb-12">
                          {/* Formal News Style Presentation */}
                          <div className="font-news-agency whitespace-pre-wrap text-slate-200 text-lg leading-[1.8]" onCopy={handleCopy}>
                             {translatedText}
                          </div>
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-800 gap-4">
                          <Languages className="w-16 h-16 stroke-1 opacity-20" />
                          <p className="text-xs font-bold uppercase tracking-widest opacity-30">Waiting for source input</p>
                        </div>
                      )}

                      {error && (
                         <div className="p-4 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs flex items-center gap-2">
                           <AlertCircle className="w-4 h-4" /> {error}
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
                className="flex-1 overflow-y-auto p-12 custom-scroll bg-[#0F1115]"
              >
                <div className="max-w-4xl mx-auto space-y-12">
                   <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-3xl font-bold tracking-tight">Learning Center</h2>
                        <p className="text-slate-500 mt-2">Submit translation corrections to train the future Yonhap News style model and refine vocabulary mappings.</p>
                      </div>
                   </div>

                   <AnimatePresence>
                     {learningSuccess && (
                       <motion.div 
                         initial={{ opacity: 0, y: -10 }}
                         animate={{ opacity: 1, y: 0 }}
                         exit={{ opacity: 0, y: -10 }}
                         className="p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex gap-3 shadow-lg shadow-emerald-950/20"
                       >
                         <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" />
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
                         className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex gap-3 shadow-lg shadow-red-950/20"
                       >
                         <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                         <div className="whitespace-pre-line leading-relaxed">
                           {learningError}
                         </div>
                       </motion.div>
                     )}
                   </AnimatePresence>

                   <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="bg-[#16191F] border border-[#2D3139] rounded-2xl p-8 space-y-6">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                           <FileText className="w-4 h-4 text-blue-500" /> 1. Original Chinese Text
                        </h3>
                        <textarea 
                          value={sourceForCorrection}
                          onChange={(e) => setSourceForCorrection(e.target.value)}
                          disabled={saveStatus === 'saving'}
                          placeholder="Type or paste the original Chinese text here..."
                          className="w-full h-80 bg-[#0F1115] border border-[#2D3139] rounded-xl p-6 text-sm text-slate-300 focus:outline-none focus:border-blue-500 leading-relaxed font-news-agency resize-none disabled:opacity-50"
                        />
                     </div>

                     <div className="bg-[#16191F] border border-[#2D3139] rounded-2xl p-8 space-y-6">
                        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                           <GraduationCap className="w-4 h-4 text-emerald-500" /> 2. User-Corrected Korean Translation
                        </h3>
                        <textarea 
                          value={correctionText}
                          onChange={(e) => setCorrectionText(e.target.value)}
                          disabled={saveStatus === 'saving'}
                          placeholder="Type or paste your corrected Korean translation here..."
                          className="w-full h-80 bg-[#0F1115] border border-[#2D3139] rounded-xl p-6 text-sm text-slate-300 focus:outline-none focus:border-blue-500 leading-relaxed font-news-agency resize-none disabled:opacity-50"
                        />
                        <button 
                          disabled={saveStatus === 'saving' || !correctionText.trim() || !sourceForCorrection.trim()}
                          onClick={handleSaveCorrection}
                          className="w-full py-4 bg-blue-600 text-white rounded-xl font-bold text-sm shadow-xl shadow-blue-500/40 hover:bg-blue-500 transition-all flex items-center justify-center gap-3 disabled:opacity-20"
                        >
                          <Save className="w-4 h-4" /> {saveStatus === 'saving' ? 'Extracting & Generating Patterns...' : saveStatus === 'complete' ? 'Learning Completed' : 'Save Translation Correction'}
                        </button>
                     </div>
                   </div>

                   {/* Knowledge Base Explorer Section */}
                   <div className="pt-12 border-t border-[#2D3139] space-y-8">
                     <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                       <div>
                         <h3 className="text-xl font-bold tracking-tight flex items-center gap-2 text-slate-100">
                           <Terminal className="w-5 h-5 text-blue-500" /> Active Knowledge Base & Memory
                         </h3>
                         <p className="text-xs text-slate-500 mt-1">View or manage extracted cognitive patterns and specialized terminologies injected dynamically into translation prompts.</p>
                       </div>
                       <button 
                         onClick={loadPatterns}
                         className="px-4 py-2 border border-[#2D3139] hover:bg-[#16191F] text-xs font-bold rounded-lg text-slate-300 transition-all flex items-center gap-2 shrink-0 self-start sm:self-center"
                       >
                         Refresh Database
                       </button>
                     </div>

                     {isLoadingPatterns ? (
                       <div className="py-12 flex flex-col items-center justify-center gap-3 bg-[#111318] border border-[#2D3139] rounded-2xl">
                         <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                         <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">Querying Firestore Database...</p>
                       </div>
                     ) : learnedPatterns.length === 0 ? (
                       <div className="py-12 flex flex-col items-center justify-center gap-3 bg-[#111318] border border-[#2D3139] rounded-2xl text-center">
                         <GraduationCap className="w-12 h-12 text-slate-700 stroke-1" />
                         <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">No custom rules learned yet</p>
                         <p className="text-xs text-slate-600 max-w-sm mt-1">Submit your first translation correction above, and the engine will extract structured learnings here.</p>
                       </div>
                     ) : (
                       <div className="space-y-6">
                         {learnedPatterns.map((pattern, index) => (
                           <div key={pattern.id} className="bg-[#16191F] border border-[#2D3139] rounded-2xl p-6 relative group overflow-hidden animate-fadeIn">
                             {/* Background subtle number badge */}
                             <div className="absolute top-4 right-4 text-slate-800/40 font-mono text-2xl font-black select-none pointer-events-none group-hover:scale-110 transition-transform">
                               #{index + 1}
                             </div>

                             <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10">
                               {/* Left Side: Original Examples */}
                               <div className="lg:col-span-7 space-y-4">
                                 <div>
                                   <span className="text-[9px] font-bold text-blue-500 uppercase tracking-widest">Source Chinese Example</span>
                                   <p className="text-sm font-serif text-slate-300 mt-1 bg-[#0F1115] p-3 rounded-lg border border-[#20242D] leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap">{pattern.chineseText}</p>
                                 </div>
                                 <div>
                                   <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest">User Corrected Translation</span>
                                   <p className="text-sm font-serif text-slate-300 mt-1 bg-[#0F1115] p-3 rounded-lg border border-[#20242D] leading-relaxed max-h-24 overflow-y-auto whitespace-pre-wrap">{pattern.koreanText}</p>
                                 </div>
                               </div>

                               {/* Right Side: Extracted Semantics */}
                               <div className="lg:col-span-5 space-y-4">
                                 {/* Terminologies */}
                                 {pattern.terminology && Object.keys(pattern.terminology).length > 0 && (
                                   <div>
                                     <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-2">Learned Vocabulary Mappings</span>
                                     <div className="flex flex-wrap gap-2">
                                       {Object.entries(pattern.terminology).map(([zh, ko]) => (
                                         <div key={zh} className="flex items-center gap-1.5 bg-blue-500/5 border border-blue-500/20 px-2.5 py-1 rounded text-xs select-all">
                                           <span className="font-serif text-slate-400">{zh}</span>
                                           <ChevronRight className="w-2.5 h-2.5 text-slate-600" />
                                           <span className="font-bold text-blue-400">{ko}</span>
                                         </div>
                                       ))}
                                     </div>
                                   </div>
                                 )}

                                 {/* Rules */}
                                 {pattern.transformationRules && pattern.transformationRules.length > 0 && (
                                   <div>
                                     <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Transformation & Formatting Rules</span>
                                     <ul className="space-y-1.5 text-xs text-slate-400 bg-[#0F1115] p-4 rounded-lg border border-[#20242D]">
                                       {pattern.transformationRules.map((rule, rIdx) => (
                                         <li key={rIdx} className="flex gap-2 leading-relaxed">
                                           <span className="text-blue-500 shrink-0">•</span>
                                           <span>{rule}</span>
                                         </li>
                                       ))}
                                     </ul>
                                   </div>
                                 )}
                                 
                                 {/* Delete Button */}
                                 <div className="flex items-center justify-between pt-2 border-t border-[#20242D]/65 mt-2">
                                   <span className="text-[10px] text-slate-600 font-mono">
                                     {pattern.createdAt?.seconds ? new Date(pattern.createdAt.seconds * 1000).toLocaleString() : 'Recently created'}
                                   </span>
                                   <button
                                     onClick={() => handleDeletePattern(pattern.id)}
                                     className="text-xs text-red-500/70 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 px-3 py-1.5 rounded transition-all flex items-center gap-1.5"
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

      {/* Footer Status Bar */}
      <footer className="h-8 bg-[#0F1115] border-t border-[#2D3139] px-6 flex items-center justify-between shrink-0 font-mono">
        <div className="flex gap-8">
           <span className="flex items-center gap-2 text-[10px] text-slate-600 uppercase tracking-tighter">
             <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-pulse"></span>
             Engine: Operational
           </span>
           <span className="text-[10px] text-slate-700 uppercase tracking-tighter hidden md:block">
             Yonhap Glossary: Active (32,410 definitions)
           </span>
        </div>
        <div className="text-[10px] text-slate-700 uppercase tracking-tighter">
          Time Offset: CN/KST (+01:00)
        </div>
      </footer>
    </div>
  );
}
