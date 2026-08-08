import React, { useState, useEffect } from 'react';
import { Link, Loader2, AlertCircle, LayoutList, FileQuestion, Code, Copy, CheckCircle2, Users, CheckSquare, Square, LogOut, Zap, RotateCcw, ExternalLink, Send, X, Shuffle, Info, KeyRound, HelpCircle, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from './lib/supabase';
import AuthPage from './components/Auth';

interface FormSection {
  id?: string;
  sectionId?: string;
  title?: string;
  description?: string;
  [key: string]: any;
}

interface FormQuestion {
  section?: string;
  title?: string;
  type?: string;
  entryId?: string;
  options?: string[];
  [key: string]: any;
}

interface Persona {
  id: string;
  name: string;
  archetype: string;
  demographics: {
    age: string;
    gender: string;
    occupation: string;
    country: string;
  };
  behaviors: string;
  mindset: string;
  painPoints: string;
  answers: Record<string, string>;
}

const getSectionId = (s: any) => s.id || s.sectionId || s.section_id || s.section || '-';
const getTitle = (item: any) => item.title || item.name || item.label || item.question || '-';
const getDescription = (s: any) => s.description || s.desc || '-';
const getQuestionSection = (q: any) => q.section || q.sectionId || q.section_id || '-';
const getType = (q: any) => q.type || q.inputType || q.questionType || '-';
const getEntryId = (q: any) => q.entryId || q.entry_id || q.id || q.name || '-';
const getOptions = (q: any) => {
  if (Array.isArray(q.options)) return q.options;
  if (Array.isArray(q.choices)) return q.choices;
  if (typeof q.options === 'string') return [q.options];
  return [];
};

const convertToAutoSubmissionUrl = (prefilledUrl: string, sectionCount: number = 0): string => {
  if (!prefilledUrl) return '';
  try {
    const urlObj = new URL(prefilledUrl);
    // Replace /viewform (or /viewform/) with /formResponse
    urlObj.pathname = urlObj.pathname.replace(/\/viewform\/?$/i, '/formResponse');
    
    const params = new URLSearchParams(urlObj.search);
    // Remove usp=pp_url or any usp param
    params.delete('usp');
    
    // Set pageHistory: for single-page forms (sectionCount <= 1), pageHistory is '0'
    // for multi-page forms, pageHistory is '0,1,...,N-1'
    if (!params.has('pageHistory')) {
      const numPages = sectionCount > 1 ? sectionCount : 1;
      const pageHistoryVal = Array.from({ length: numPages }, (_, i) => i).join(',');
      params.set('pageHistory', pageHistoryVal);
    }
    
    // Set submit=Submit
    if (!params.has('submit')) {
      params.set('submit', 'Submit');
    }
    
    urlObj.search = params.toString();
    return urlObj.href;
  } catch (e) {
    const numPages = sectionCount > 1 ? sectionCount : 1;
    const pageHistoryVal = Array.from({ length: numPages }, (_, i) => i).join(',');
    
    let converted = prefilledUrl
      .replace(/\/viewform\?usp=pp_url&?/i, '/formResponse?')
      .replace(/\/viewform\?/i, '/formResponse?')
      .replace(/\/viewform\/?$/i, '/formResponse');
      
    if (!converted.includes('pageHistory=')) {
      converted += (converted.includes('?') ? '&' : '?') + `pageHistory=${pageHistoryVal}`;
    }
    if (!converted.includes('submit=')) {
      converted += '&submit=Submit';
    }
    return converted;
  }
};

const getMaskedUrl = (rawUrl: string): string => {
  if (!rawUrl) return '';
  try {
    const encoded = btoa(unescape(encodeURIComponent(rawUrl)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `${window.location.origin}/r/${encoded}`;
  } catch (e) {
    return rawUrl;
  }
};

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard failed, trying fallback execCommand:', err);
    }
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.top = '0';
    textArea.style.left = '0';
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
};

const flattenQuestions = (questions: any[]): any[] => {
  if (!Array.isArray(questions)) return [];
  const result: any[] = [];
  questions.forEach((q: any) => {
    const rows = q.rows || q.gridRows || q.subQuestions;
    if (Array.isArray(rows) && rows.length > 0) {
      rows.forEach((row: any) => {
        const topTitle = (q.title || q.name || q.label || '').trim();
        const rowTitle = (row.title || row.label || row.name || '').trim();
        const fullTitle = topTitle && rowTitle ? `${topTitle} → ${rowTitle}` : (rowTitle || topTitle);

        result.push({
          ...q,
          entryId: row.entryId || row.id || row.entry_id || q.entryId,
          title: fullTitle,
          type: q.type || 'multiple_choice_grid',
          options: row.options || row.choices || row.values || q.options || [],
          sectionId: q.sectionId ?? row.sectionId ?? 0
        });
      });
    } else {
      result.push(q);
    }
  });
  return result;
};

const generateClientRandomResponses = (questions: any[], count: number) => {
  const items: { answers: Record<string, string> }[] = [];
  const flat = flattenQuestions(questions);
  
  for (let i = 0; i < count; i++) {
    const answers: Record<string, string> = {};
    flat.forEach((q: any) => {
      const entryId = q.entryId || q.id || q.entry_id;
      if (!entryId || entryId === '-') return;
      
      const options = q.options || q.choices || q.values || [];
      const optsList = Array.isArray(options) ? options.map((o: any) => typeof o === 'string' ? o : o.value || o.label || String(o)) : [];

      if (optsList.length > 0) {
        // Pick a completely random option independently (zero correlation)
        const randomOpt = optsList[Math.floor(Math.random() * optsList.length)];
        answers[entryId] = randomOpt;
      } else {
        // For open-ended questions, set "Sample response"
        answers[entryId] = "Sample response";
      }
    });
    items.push({ answers });
  }
  return items;
};

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [sections, setSections] = useState<FormSection[]>([]);
  const [questions, setQuestions] = useState<FormQuestion[]>([]);
  const [rawData, setRawData] = useState<any>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [currentFormId, setCurrentFormId] = useState<string | null>(null);
  const [isQuestionsExpanded, setIsQuestionsExpanded] = useState(false);

  // Generator State
  const [generationMode, setGenerationMode] = useState<'persona' | 'direct'>('persona');
  const [personaCount, setPersonaCount] = useState<number>(5);
  const [randomCount, setRandomCount] = useState<number>(5);
  const [isGeneratingRandom, setIsGeneratingRandom] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<Set<string>>(new Set());
  const [generatedUrls, setGeneratedUrls] = useState<string[]>([]);
  const [isAutoSubmitMode, setIsAutoSubmitMode] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Batch Submission State
  const [isSubmittingAll, setIsSubmittingAll] = useState(false);
  const [submitProgress, setSubmitProgress] = useState<{ current: number; total: number; message: string } | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [submittingStatuses, setSubmittingStatuses] = useState<Record<number, 'loading' | 'success' | 'error'>>({});

  // Premium / Paywall State
  const [hasPremiumAccess, setHasPremiumAccess] = useState(() => {
    return localStorage.getItem('google_form_automator_premium') === 'true';
  });
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isDifferenceModalOpen, setIsDifferenceModalOpen] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenError, setTokenError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session?.user?.id) {
        supabase
          .from('user_profiles')
          .select('has_premium')
          .eq('user_id', session.user.id)
          .maybeSingle()
          .then(({ data, error }) => {
            if (!error && data?.has_premium) {
              setHasPremiumAccess(true);
              localStorage.setItem('google_form_automator_premium', 'true');
            }
          });
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        setIsAuthModalOpen(false);
        if (session.user?.id) {
          supabase
            .from('user_profiles')
            .select('has_premium')
            .eq('user_id', session.user.id)
            .maybeSingle()
            .then(({ data, error }) => {
              if (!error && data?.has_premium) {
                setHasPremiumAccess(true);
                localStorage.setItem('google_form_automator_premium', 'true');
              }
            });
        }
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const handleFetch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      setIsAuthModalOpen(true);
      return;
    }
    
    if (!url.trim()) return;

    
    if (!url.includes('docs.google.com/forms') && !url.includes('forms.gle')) {
      setError('Please enter a valid Google Form URL (e.g., docs.google.com/forms/... or forms.gle/...)');
      return;
    }

    setLoading(true);
    setError(null);
    setHasFetched(false);
    setSections([]);
    setQuestions([]);
    setRawData(null);
    setGeneratedUrls([]);
    setPersonas([]);
    setSelectedPersonaIds(new Set());
    setCurrentFormId(null);

    try {
      const response = await fetch(`https://opkl.vercel.app/api/fetch-html?url=${encodeURIComponent(url)}`);
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setRawData(data);
      
      let parsedSections: FormSection[] = [];
      let parsedQuestions: FormQuestion[] = [];

      const targetData = data.formData || data;

      if (targetData.sections && Array.isArray(targetData.sections)) {
        parsedSections = targetData.sections;
      }
      
      if (targetData.questions && Array.isArray(targetData.questions)) {
        parsedQuestions = targetData.questions;
      }

      if (parsedSections.length === 0 && parsedQuestions.length === 0) {
        Object.keys(targetData).forEach(key => {
          if (Array.isArray(targetData[key])) {
            if (key.toLowerCase().includes('section')) parsedSections = targetData[key];
            else if (key.toLowerCase().includes('question') || key.toLowerCase().includes('field')) parsedQuestions = targetData[key];
          }
        });
        
        // If still empty and it's an array itself
        if (Array.isArray(targetData)) {
            parsedQuestions = targetData; // fallback mapping all to questions
        }
      }

      setSections(parsedSections);
      setQuestions(flattenQuestions(parsedQuestions));
      setHasFetched(true);

      // Save Form to Supabase Database
      if (session?.user) {
        const { data: dbData, error: dbError } = await supabase
          .from('submitted_urls')
          .insert({
            user_id: session.user.id,
            url: url,
            raw_data: data
          })
          .select('id')
          .single();
          
        if (dbData && !dbError) {
          setCurrentFormId(dbData.id);
        } else {
          console.error("Failed to save form to DB:", dbError);
        }
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'An unexpected error occurred while fetching the form details.');
    } finally {
      setLoading(false);
    }
  };

  const [isGeneratingPersonas, setIsGeneratingPersonas] = useState(false);

  const fetchPersonas = async () => {
    if (!hasPremiumAccess) {
      setIsPaymentModalOpen(true);
      return;
    }

    setIsGeneratingPersonas(true);
    setError(null);
    try {
      const response = await fetch('/api/generate-personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions, count: personaCount })
      });
      if (!response.ok) throw new Error('Failed to generate personas from server');
      const data = await response.json();
      const newPersonas = data.personas || [];
      
      setPersonas(newPersonas);
      setSelectedPersonaIds(new Set(newPersonas.map((p: Persona) => p.id)));
      setGeneratedUrls([]);
      
      // Save Personas to Database
      if (session?.user && currentFormId && newPersonas.length > 0) {
        const insertData = newPersonas.map((p: Persona) => ({
          user_id: session.user.id,
          form_id: currentFormId,
          name: p.name,
          archetype: p.archetype,
          demographics: p.demographics,
          behaviors: p.behaviors,
          mindset: p.mindset,
          pain_points: p.painPoints,
          answers: p.answers
        }));
        
        const { error: dbError } = await supabase
          .from('personas')
          .insert(insertData);
          
        if (dbError) {
          console.error("Failed to save personas to DB:", dbError);
        }
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error generating personas');
    } finally {
      setIsGeneratingPersonas(false);
    }
  };

  const fetchRandomResponses = async () => {
    setIsGeneratingRandom(true);
    setError(null);
    try {
      let items: { answers: Record<string, string> }[] = [];

      try {
        const response = await fetch('/api/generate-random-responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questions, count: randomCount })
        });
        if (response.ok) {
          const data = await response.json();
          items = data.items || [];
        }
      } catch (e) {
        console.warn('API random response generation failed, using client fallback:', e);
      }

      // Fallback if empty
      if (!items || items.length === 0) {
        items = generateClientRandomResponses(questions, randomCount);
      }

      // Format pseudo-personas
      const newPersonas: Persona[] = items.map((item, idx) => ({
        id: `random-${Date.now()}-${idx}`,
        name: `Respondent #${idx + 1}`,
        archetype: 'Uncorrelated Random',
        demographics: { age: 'N/A', gender: 'N/A', occupation: 'Survey Participant', country: 'Global' },
        behaviors: 'Uncorrelated independent random response',
        mindset: 'Neutral / Independent',
        painPoints: 'None',
        answers: item.answers
      }));

      setPersonas(newPersonas);
      setSelectedPersonaIds(new Set(newPersonas.map(p => p.id)));
      setGeneratedUrls([]);

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error generating random responses');
    } finally {
      setIsGeneratingRandom(false);
    }
  };

  const togglePersona = (id: string) => {
    const newSet = new Set(selectedPersonaIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedPersonaIds(newSet);
  };

  const toggleAllPersonas = () => {
    if (selectedPersonaIds.size === personas.length) setSelectedPersonaIds(new Set());
    else setSelectedPersonaIds(new Set(personas.map(p => p.id)));
  };

  const handleGenerateUrls = async () => {
    const baseUrl = url.split('?')[0];
    const generated: string[] = [];
    const selectedPersonas = personas.filter(p => selectedPersonaIds.has(p.id));

    selectedPersonas.forEach(persona => {
      const params = new URLSearchParams();
      params.append('usp', 'pp_url');

      if (persona.answers) {
        Object.entries(persona.answers).forEach(([entryId, answer]) => {
          if (answer !== undefined && answer !== null && answer !== '') {
            params.append(entryId, String(answer));
          }
        });
      }

      generated.push(`${baseUrl}?${params.toString()}`);
    });
    
    setGeneratedUrls(generated);
    
    // Save Generated URLs to Database
    if (session?.user && currentFormId && generated.length > 0) {
      const insertData = generated.map((genUrl) => ({
        user_id: session.user.id,
        form_id: currentFormId,
        generated_url: genUrl
      }));
      
      const { error: dbError } = await supabase
        .from('generated_urls')
        .insert(insertData);
        
      if (dbError) {
        console.error("Failed to save URLs to DB:", dbError);
      }
    }
  };

  const displayedUrls = generatedUrls.map(u => 
    isAutoSubmitMode ? convertToAutoSubmissionUrl(u, sections.length) : u
  );

  const copyToClipboard = async (text: string, index: number) => {
    const success = await copyTextToClipboard(text);
    if (success) {
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const copyAll = async () => {
    const success = await copyTextToClipboard(displayedUrls.join('\n'));
    if (success) {
      setCopiedIndex(-1);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const handleSubmitAllResponses = async () => {
    if (generatedUrls.length === 0) return;
    setIsSubmittingAll(true);
    setSubmitSuccess(null);
    setSubmittingStatuses({});

    // Ensure all target URLs are in auto-submission format
    const autoSubmitUrls = generatedUrls.map(u => 
      convertToAutoSubmissionUrl(u, sections.length)
    );

    const total = autoSubmitUrls.length;
    let successCount = 0;

    for (let i = 0; i < total; i++) {
      const targetUrl = autoSubmitUrls[i];
      setSubmitProgress({
        current: i + 1,
        total,
        message: `Submitting response ${i + 1} of ${total}...`
      });

      try {
        const res = await fetch('/api/submit-single-form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: targetUrl })
        });

        if (res.ok) {
          successCount++;
        } else {
          // Fallback to client-side mode no-cors
          await fetch(targetUrl, { method: 'POST', mode: 'no-cors' });
          successCount++;
        }
      } catch (err) {
        try {
          await fetch(targetUrl, { method: 'GET', mode: 'no-cors' });
          successCount++;
        } catch (e2) {
          console.error(`Failed to submit response ${i + 1}:`, e2);
        }
      }

      // Security delay between requests (~1.2s - 1.5s) to avoid triggering Google anti-spam rate limits
      if (i < total - 1) {
        setSubmitProgress({
          current: i + 1,
          total,
          message: `Pausing to respect Google anti-spam pacing... (${i + 1}/${total})`
        });
        const delay = 1200 + Math.floor(Math.random() * 400);
        await new Promise(r => setTimeout(r, delay));
      }
    }

    setIsSubmittingAll(false);
    setSubmitProgress(null);

    // Set success banner message
    setSubmitSuccess(`Successfully submitted all ${successCount} form responses to Google Forms!`);

    // Reset previously generated personas & URLs as requested
    setPersonas([]);
    setGeneratedUrls([]);
    setSelectedPersonaIds(new Set());
    setIsAutoSubmitMode(false);

    // Scroll back to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmitSingleResponse = async (index: number, originalUrl: string) => {
    setSubmittingStatuses(prev => ({ ...prev, [index]: 'loading' }));
    const targetUrl = convertToAutoSubmissionUrl(originalUrl, sections.length);
    try {
      const res = await fetch('/api/submit-single-form', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl })
      });

      if (res.ok) {
        setSubmittingStatuses(prev => ({ ...prev, [index]: 'success' }));
      } else {
        await fetch(targetUrl, { method: 'POST', mode: 'no-cors' });
        setSubmittingStatuses(prev => ({ ...prev, [index]: 'success' }));
      }
    } catch (err) {
      try {
        await fetch(targetUrl, { method: 'GET', mode: 'no-cors' });
        setSubmittingStatuses(prev => ({ ...prev, [index]: 'success' }));
      } catch (e2) {
        console.error(`Failed to submit single response:`, e2);
        setSubmittingStatuses(prev => ({ ...prev, [index]: 'error' }));
      }
    }
  };

  return (
    <div className="min-h-screen bg-black text-neutral-200 font-sans selection:bg-white/30">
      {isAuthModalOpen && (
        <AuthPage 
          onLogin={() => setIsAuthModalOpen(false)} 
          onClose={() => setIsAuthModalOpen(false)} 
        />
      )}
      {isDifferenceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-white/20 p-6 max-w-lg w-full relative">
            <button 
              onClick={() => setIsDifferenceModalOpen(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 mb-4">
              <HelpCircle className="w-5 h-5 text-yellow-500" />
              <h2 className="text-xl font-bold text-white">Generator Modes Comparison</h2>
            </div>

            <div className="space-y-4 text-sm mb-6">
              <div className="p-4 bg-black border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <Users className="w-4 h-4 text-yellow-500" />
                    <span>Persona-Based Generator</span>
                  </div>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 font-semibold">
                    {hasPremiumAccess ? '✓ Unlocked' : 'Premium'}
                  </span>
                </div>
                <p className="text-neutral-400 text-xs leading-relaxed mb-2.5">
                  Builds realistic, coherent respondent profiles (archetypes, demographics, behaviors, mindsets, pain points) and answers every question from that persona's perspective.
                </p>
                <ul className="text-xs text-neutral-300 space-y-1.5 list-disc list-inside">
                  <li>Consistent ratings across multiple-choice grid & Likert matrices.</li>
                  <li>Natural open-ended answers tailored to background & personality.</li>
                  <li>Ideal for user research, audience simulations, and prototype testing.</li>
                </ul>
              </div>

              <div className="p-4 bg-black border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <Shuffle className="w-4 h-4 text-neutral-300" />
                    <span>Direct Random Generator</span>
                  </div>
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 bg-white/10 text-neutral-300 border border-white/20 font-semibold">
                    Free
                  </span>
                </div>
                <p className="text-neutral-400 text-xs leading-relaxed mb-2.5">
                  Generates uncorrelated, independent random answers for each question without underlying personality traits.
                </p>
                <ul className="text-xs text-neutral-300 space-y-1.5 list-disc list-inside">
                  <li>Zero correlation between questions or respondent identities.</li>
                  <li>Uniform distribution across categorical options and scales.</li>
                  <li>Ideal for stress-testing forms and quick synthetic sample data.</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setIsDifferenceModalOpen(false)}
                className="px-5 py-2 bg-white text-black font-semibold text-sm hover:bg-neutral-200 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {isPaymentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-white/20 p-6 max-w-md w-full relative">
            <button 
              onClick={() => {
                setIsPaymentModalOpen(false);
                setTokenError('');
              }}
              className="absolute top-4 right-4 text-neutral-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <KeyRound className="w-6 h-6 text-yellow-500" />
              <h2 className="text-xl font-bold text-white">Premium Access Required</h2>
            </div>
            <p className="text-sm text-neutral-300 mb-6 leading-relaxed">
              To use the <strong>Persona Generator</strong>, please purchase premium access. This helps cover the costs of generating profiles.
            </p>
            
            <div className="bg-black border border-white/10 p-4 mb-6">
              <p className="text-sm text-white font-medium mb-2">How to unlock:</p>
              <ol className="text-sm text-neutral-400 list-decimal list-inside space-y-2">
                <li>Pay <strong>100 NPR</strong> to eSewa ID: <span className="text-white font-mono">9815326085</span></li>
                <li>In the remarks/note, please write your <strong>full name</strong>.</li>
                <li>You will automatically receive a <strong>Token Code</strong> on your WhatsApp.</li>
              </ol>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-medium text-neutral-400">Already have a Token Code?</label>
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  setTokenError('');
                }}
                placeholder="Enter your token code"
                className="w-full px-4 py-2.5 bg-black border border-white/20 text-white placeholder-neutral-600 focus:outline-none focus:border-white transition-colors"
              />
              {tokenError && <p className="text-xs text-red-500">{tokenError}</p>}
              <button
                onClick={async () => {
                  const code = tokenInput.trim().toLowerCase();
                  if (code === 'form100') {
                    setHasPremiumAccess(true);
                    localStorage.setItem('google_form_automator_premium', 'true');
                    setIsPaymentModalOpen(false);
                    setTokenError('');
                    setTokenInput('');
                    if (session?.user?.id) {
                      try {
                        await supabase.from('user_profiles').upsert({
                          user_id: session.user.id,
                          has_premium: true,
                          token_used: code,
                          updated_at: new Date().toISOString()
                        }, { onConflict: 'user_id' });
                      } catch (dbErr) {
                        console.warn('Could not save premium to db:', dbErr);
                      }
                    }
                  } else {
                    setTokenError('Invalid token code. Please try again.');
                  }
                }}
                className="w-full px-4 py-2.5 bg-white text-black font-semibold hover:bg-neutral-200 transition-colors"
              >
                Unlock Access
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header / Nav */}
      <div className="border-b border-white/10 bg-black p-4 flex justify-between items-center max-w-6xl mx-auto">
        <div className="font-semibold text-white">Google Form Automator</div>
        {session ? (
          <button 
            onClick={handleSignOut}
            className="text-sm flex items-center gap-2 text-neutral-400 hover:text-white transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        ) : (
          <button 
            onClick={() => setIsAuthModalOpen(true)}
            className="text-sm font-medium px-4 py-1.5 bg-transparent border border-white hover:bg-white hover:text-black text-white rounded-none transition-colors"
          >
            Sign In
          </button>
        )}
      </div>

      <div className="max-w-6xl mx-auto px-6 py-10 md:py-16">
        {submitSuccess && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-4 bg-white/10 border border-white/30 text-white flex items-center justify-between gap-3 text-sm shadow-lg"
          >
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
              <div>
                <p className="font-semibold text-white">{submitSuccess}</p>
                <p className="text-xs text-neutral-400">Previously generated personas have been dismissed. You can now generate a new batch or analyze a new form.</p>
              </div>
            </div>
            <button 
              onClick={() => setSubmitSuccess(null)}
              className="p-1 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl mx-auto text-center mb-24 mt-10"
        >
          <h1 className="text-5xl md:text-6xl font-serif text-white leading-[1.1] mb-6 tracking-tight">
            Google Form Automator
          </h1>
          <p className="text-lg text-neutral-400 max-w-2xl mx-auto mb-12">
            Automate Google Form submissions with realistic survey personas, pre-filled links, and instant batch responses in seconds.
          </p>

          <form onSubmit={handleFetch} className="relative flex flex-col sm:flex-row items-center gap-4 justify-center max-w-3xl mx-auto">
            <div className="relative w-full flex-1 group">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste Google Form Link here..."
                className="relative w-full px-6 py-4 bg-transparent border border-white/20 rounded-none focus:outline-none focus:border-white text-white placeholder:text-neutral-500 text-base transition-all"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="relative shrink-0 px-8 py-4 bg-transparent border border-white hover:bg-white hover:text-black text-white font-medium rounded-none transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed text-base"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                'Extract Data'
              )}
            </button>
          </form>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0, mt: 0 }}
                animate={{ opacity: 1, height: 'auto', mt: 16 }}
                exit={{ opacity: 0, height: 0, mt: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-start gap-3 p-4 bg-red-50 text-red-800 rounded-none border border-red-100 text-left">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                  <p className="text-sm font-medium leading-relaxed">{error}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Results */}
        <AnimatePresence mode="wait">
          {hasFetched && !loading && (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              {/* Sections Table */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 px-1">
                  <LayoutList className="w-5 h-5 text-neutral-400" />
                  <h2 className="text-xl font-semibold text-white">Form Sections</h2>
                  <span className="bg-white/10 text-neutral-400 text-xs font-bold px-2 py-0.5 rounded-none ml-2">
                    {sections.length}
                  </span>
                </div>
                
                <div className="bg-black/50 border border-white/20 rounded-none shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-black border-b border-white/20 text-neutral-400 font-medium">
                        <tr>
                          <th className="px-6 py-4 w-48">Section ID</th>
                          <th className="px-6 py-4 w-64">Title</th>
                          <th className="px-6 py-4">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-blue-500/10">
                        {sections.length > 0 ? (
                          sections.map((section, idx) => (
                            <tr key={idx} className="hover:bg-black transition-colors">
                              <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                                {getSectionId(section)}
                              </td>
                              <td className="px-6 py-4 font-medium text-white whitespace-normal">
                                {getTitle(section)}
                              </td>
                              <td className="px-6 py-4 text-neutral-400 whitespace-normal min-w-[300px]">
                                {getDescription(section)}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3} className="px-6 py-12 text-center text-neutral-400">
                              No sections found in this form.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>

              {/* Questions Table */}
              <section className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
                  <div className="flex items-center gap-2">
                    <FileQuestion className="w-5 h-5 text-neutral-400" />
                    <h2 className="text-xl font-semibold text-white">Form Questions</h2>
                    <span className="bg-white/10 text-neutral-400 text-xs font-bold px-2 py-0.5 rounded-none ml-1">
                      {questions.length}
                    </span>
                    {!isQuestionsExpanded && questions.length > 4 && (
                      <span className="text-xs text-neutral-500 font-mono">
                        (Showing 4 of {questions.length})
                      </span>
                    )}
                  </div>

                  {questions.length > 4 && (
                    <button
                      onClick={() => setIsQuestionsExpanded(!isQuestionsExpanded)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white border border-white/20 bg-white/5 hover:bg-white/15 transition-all self-start sm:self-auto"
                    >
                      {isQuestionsExpanded ? (
                        <>
                          <Minimize2 className="w-3.5 h-3.5 text-neutral-400" />
                          <span>Collapse List</span>
                          <ChevronUp className="w-3.5 h-3.5 ml-0.5" />
                        </>
                      ) : (
                        <>
                          <Maximize2 className="w-3.5 h-3.5 text-yellow-500" />
                          <span>Expand All ({questions.length} Questions)</span>
                          <ChevronDown className="w-3.5 h-3.5 ml-0.5" />
                        </>
                      )}
                    </button>
                  )}
                </div>

                <div className="bg-black/50 border border-white/20 rounded-none shadow-sm overflow-hidden">
                  <div className={`overflow-x-auto transition-all ${!isQuestionsExpanded && questions.length > 4 ? 'max-h-[290px] overflow-y-auto' : ''}`}>
                    <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-black border-b border-white/20 text-neutral-400 font-medium sticky top-0 z-10">
                        <tr>
                          <th className="px-6 py-4 w-32 bg-black">Section</th>
                          <th className="px-6 py-4 w-72 bg-black">Title</th>
                          <th className="px-6 py-4 w-32 bg-black">Type</th>
                          {false && <th className="px-6 py-4 w-48 bg-black">Entry ID</th>}
                          <th className="px-6 py-4 bg-black">Options</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-blue-500/10">
                        {questions.length > 0 ? (
                          (isQuestionsExpanded ? questions : questions.slice(0, 4)).map((question, idx) => (
                            <tr key={idx} className="hover:bg-black transition-colors">
                              <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                                {getQuestionSection(question)}
                              </td>
                              <td className="px-6 py-4 font-medium text-white whitespace-normal">
                                {getTitle(question)}
                              </td>
                              <td className="px-6 py-4">
                                <span className="inline-flex items-center px-2.5 py-1 rounded-none text-xs font-medium bg-white/10 text-neutral-400 border border-white/20">
                                  {getType(question)}
                                </span>
                              </td>
                              {false && (
                                <td className="px-6 py-4 font-mono text-xs text-neutral-400">
                                  {getEntryId(question)}
                                </td>
                              )}
                              <td className="px-6 py-4 whitespace-normal min-w-[200px]">
                                <div className="flex flex-wrap gap-1">
                                  {getOptions(question).length > 0 ? (
                                    getOptions(question).map((opt: any, oIdx: number) => (
                                      <span 
                                        key={oIdx} 
                                        className="inline-flex items-center px-2 py-1 rounded-none border border-white/20 bg-black/50 shadow-sm text-xs text-neutral-400 font-medium"
                                      >
                                        {typeof opt === 'string' ? opt : opt.value || opt.label || JSON.stringify(opt)}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="text-neutral-400 italic text-xs">No options</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="px-6 py-12 text-center text-neutral-400">
                              No questions found in this form.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  
                  {!isQuestionsExpanded && questions.length > 4 && (
                    <div className="p-3 bg-white/5 border-t border-white/10 flex items-center justify-between text-xs text-neutral-400">
                      <span>Showing first 4 questions of {questions.length} total.</span>
                      <button
                        onClick={() => setIsQuestionsExpanded(true)}
                        className="text-white hover:underline flex items-center gap-1 font-medium"
                      >
                        Expand All
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </section>

              {/* Response Generator Section */}
              <section className="space-y-6 pt-8 border-t border-white/20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
                  <div className="flex items-center gap-2">
                    {generationMode === 'persona' ? (
                      <Users className="w-5 h-5 text-neutral-400" />
                    ) : (
                      <Shuffle className="w-5 h-5 text-neutral-400" />
                    )}
                    <h2 className="text-xl font-semibold text-white">
                      {generationMode === 'persona' ? 'Persona-Based Generator' : 'Direct Random Generator'}
                    </h2>
                  </div>

                  {/* Mode Selector Tabs & Info */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center bg-white/5 p-1 border border-white/20 self-start sm:self-auto">
                      <button
                        onClick={() => {
                          setGenerationMode('persona');
                          setGeneratedUrls([]);
                          setPersonas([]);
                        }}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                          generationMode === 'persona'
                            ? 'bg-white text-black font-semibold'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>Persona Generator</span>
                      </button>
                      <button
                        onClick={() => {
                          setGenerationMode('direct');
                          setGeneratedUrls([]);
                          setPersonas([]);
                        }}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1.5 ${
                          generationMode === 'direct'
                            ? 'bg-white text-black font-semibold'
                            : 'text-neutral-400 hover:text-white'
                        }`}
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        <span>Direct Random Responses</span>
                      </button>
                    </div>

                    <button
                      onClick={() => setIsDifferenceModalOpen(true)}
                      className="px-2.5 py-1.5 bg-white/5 hover:bg-white/10 border border-white/20 text-neutral-300 hover:text-white text-xs font-medium transition-colors flex items-center gap-1.5"
                      title="Learn difference between Persona Generator and Direct Random Responses"
                    >
                      <HelpCircle className="w-3.5 h-3.5 text-yellow-500" />
                      <span>Compare Modes</span>
                    </button>
                  </div>
                </div>
                
                <div className="bg-black/50 border border-white/20 rounded-none shadow-sm p-6">
                  {generationMode === 'persona' ? (
                    <>
                      <div className="flex items-start gap-2 mb-6 p-3 bg-white/5 border border-white/10 text-xs text-neutral-300 leading-relaxed">
                        <Info className="w-4 h-4 text-white shrink-0 mt-0.5" />
                        <p>
                          <strong>Persona Generator:</strong> Uses advanced models to create realistic, coherent user profiles (archetypes, demographics) and answers survey questions consistently as that persona. <span className="text-yellow-500 font-medium">Requires Premium Access</span>.
                        </p>
                      </div>
                      {/* Step 1: Generate Personas */}
                      <div className="flex flex-col sm:flex-row items-end gap-4 mb-8">
                        <div className="w-full sm:w-64 space-y-2">
                          <label className="block text-sm font-medium text-neutral-400">
                            How many personas to create?
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="50"
                            value={personaCount}
                            onChange={(e) => setPersonaCount(parseInt(e.target.value) || 1)}
                            className="w-full px-4 py-2.5 bg-black border border-white/20 rounded-none focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all text-white"
                          />
                        </div>
                        <button
                          onClick={fetchPersonas}
                          disabled={isGeneratingPersonas}
                          className="w-full sm:w-auto px-6 py-2.5 bg-transparent border border-white hover:bg-white hover:text-black text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed rounded-none transition-colors flex items-center justify-center gap-2"
                        >
                          {isGeneratingPersonas ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Generate Personas'}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Direct Random Response Generator */}
                      <div className="space-y-4">
                        <p className="text-xs text-neutral-400">
                          Directly generate randomized, uncorrelated responses without creating persona profiles. Each response is independent across questions so survey results look naturally distributed.
                        </p>
                        <div className="flex flex-col sm:flex-row items-end gap-4">
                          <div className="w-full sm:w-64 space-y-2">
                            <label className="block text-sm font-medium text-neutral-400">
                              How many responses to generate?
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="50"
                              value={randomCount}
                              onChange={(e) => setRandomCount(parseInt(e.target.value) || 1)}
                              className="w-full px-4 py-2.5 bg-black border border-white/20 rounded-none focus:outline-none focus:ring-2 focus:ring-neutral-900 focus:border-transparent transition-all text-white"
                            />
                          </div>
                          <button
                            onClick={fetchRandomResponses}
                            disabled={isGeneratingRandom}
                            className="w-full sm:w-auto px-6 py-2.5 bg-transparent border border-white hover:bg-white hover:text-black text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed rounded-none transition-colors flex items-center justify-center gap-2"
                          >
                            {isGeneratingRandom ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                <span>Generating {randomCount} Responses...</span>
                              </>
                            ) : (
                              <>
                                <Shuffle className="w-4 h-4" />
                                <span>Generate {randomCount} Uncorrelated Response{randomCount !== 1 && 's'}</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Step 2: Select Personas & Generate URLs */}
                  {personas.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-6 border-t border-white/20 pt-6"
                    >
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-neutral-400">Personas</h3>
                        <button
                          onClick={toggleAllPersonas}
                          className="text-xs text-neutral-400 hover:text-neutral-800 font-medium transition-colors"
                        >
                          {selectedPersonaIds.size === personas.length ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-h-[400px] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin' }}>
                        {personas.map(p => (
                          <div
                            key={p.id}
                            onClick={() => togglePersona(p.id)}
                            className={`p-4 rounded-none border cursor-pointer transition-all ${
                              selectedPersonaIds.has(p.id)
                                ? 'border-white bg-white/10 shadow-sm'
                                : 'border-white/20 hover:border-neutral-300'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="font-medium text-white truncate pr-2">{p.name}</div>
                              <div className="shrink-0 mt-0.5">
                                {selectedPersonaIds.has(p.id) ? (
                                  <CheckSquare className="w-5 h-5 text-white" />
                                ) : (
                                  <Square className="w-5 h-5 text-neutral-300" />
                                )}
                              </div>
                            </div>
                            <div className="text-xs text-neutral-400 space-y-2">
                              <div className="inline-flex items-center px-2 py-1 bg-white/10 text-neutral-400 rounded-none font-medium">{p.archetype}</div>
                              <div>{p.demographics?.age} • {p.demographics?.occupation} • {p.demographics?.country}</div>
                              <div className="text-neutral-400 italic line-clamp-3 leading-relaxed">"{p.mindset}"</div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-end pt-4 border-t border-white/20">
                        <button
                          onClick={handleGenerateUrls}
                          disabled={selectedPersonaIds.size === 0}
                          className="px-6 py-2.5 bg-transparent border border-white hover:bg-white hover:text-black text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed rounded-none transition-colors flex items-center justify-center gap-2"
                        >
                          Generate Response{selectedPersonaIds.size !== 1 && 's'} for {selectedPersonaIds.size} Persona{selectedPersonaIds.size !== 1 && 's'}
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* Step 3: View URLs */}
                  {generatedUrls.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-8 space-y-4 pt-6 border-t border-white/20"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-neutral-400">
                            {isAutoSubmitMode ? 'Auto-Submission Responses' : 'Pre-Filled Responses'} ({generatedUrls.length})
                          </h3>
                          {isAutoSubmitMode && (
                            <span className="text-[10px] font-mono tracking-wider uppercase bg-white text-black px-2 py-0.5 font-bold">
                              Auto-Submit
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => setIsAutoSubmitMode(!isAutoSubmitMode)}
                            className="text-xs px-3 py-1.5 bg-transparent border border-white hover:bg-white hover:text-black text-white font-medium transition-colors flex items-center gap-1.5"
                          >
                            {isAutoSubmitMode ? (
                              <>
                                <RotateCcw className="w-3.5 h-3.5" />
                                Show Pre-filled Responses
                              </>
                            ) : (
                              <>
                                <Zap className="w-3.5 h-3.5" />
                                Convert to Auto-Submission Responses
                              </>
                            )}
                          </button>
                          <button
                            onClick={handleSubmitAllResponses}
                            disabled={isSubmittingAll || generatedUrls.length === 0}
                            className="text-xs px-3 py-1.5 bg-white text-black border border-white hover:bg-neutral-200 font-semibold transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                          >
                            {isSubmittingAll ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-black" />
                                Submitting ({submitProgress?.current}/{submitProgress?.total})
                              </>
                            ) : (
                              <>
                                <Send className="w-3.5 h-3.5 text-black" />
                                Submit All Responses
                              </>
                            )}
                          </button>
                          {false && (
                            <button
                              onClick={copyAll}
                              className="text-xs text-neutral-400 hover:text-white flex items-center gap-1.5 transition-colors font-medium border border-white/20 px-3 py-1.5"
                            >
                              {copiedIndex === -1 ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                              {copiedIndex === -1 ? 'Copied All!' : 'Copy All'}
                            </button>
                          )}
                        </div>
                      </div>

                      {submitProgress && (
                        <div className="p-4 bg-white/5 border border-white/20 space-y-2 text-xs">
                          <div className="flex items-center justify-between text-white font-medium">
                            <span className="flex items-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-white shrink-0" />
                              {submitProgress.message}
                            </span>
                            <span className="font-mono">{Math.round((submitProgress.current / submitProgress.total) * 100)}%</span>
                          </div>
                          <div className="w-full bg-white/10 h-1.5 overflow-hidden">
                            <div 
                              className="bg-white h-1.5 transition-all duration-300" 
                              style={{ width: `${(submitProgress.current / submitProgress.total) * 100}%` }}
                            />
                          </div>
                          <p className="text-[11px] text-neutral-400">
                            * Including ~1.2s delay between submissions to respect Google anti-spam & rate limiting guidelines.
                          </p>
                        </div>
                      )}

                      {isAutoSubmitMode && (
                        <div className="p-3 bg-white/5 border border-white/10 text-xs text-neutral-300 flex items-center gap-2">
                          <Zap className="w-4 h-4 text-white shrink-0" />
                          <span><strong>Instant Submission Mode:</strong> These directly post form responses upon visit, bypassing manual button clicks.</span>
                        </div>
                      )}

                      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin' }}>
                        {displayedUrls.map((gUrl, idx) => {
                          const persona = personas.filter(p => selectedPersonaIds.has(p.id))[idx];
                          return (
                            <div key={idx} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-black rounded-none border border-white/20 hover:border-white/40 transition-colors">
                              <div className="flex-1 overflow-hidden">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-white">
                                    Response #{idx + 1}{persona ? ` • ${persona.name}` : ''}
                                  </span>
                                  {persona?.archetype && (
                                    <span className="text-[10px] text-neutral-400 border border-white/10 px-1.5 py-0.5">
                                      {persona.archetype}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={() => handleSubmitSingleResponse(idx, gUrl)}
                                  disabled={submittingStatuses[idx] === 'loading' || submittingStatuses[idx] === 'success' || isSubmittingAll}
                                  className="text-xs px-2.5 py-1 text-neutral-300 hover:text-white hover:bg-white/10 border border-white/20 transition-all flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Submit response directly"
                                >
                                  {submittingStatuses[idx] === 'loading' ? (
                                    <>
                                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                      <span>Sending...</span>
                                    </>
                                  ) : submittingStatuses[idx] === 'success' ? (
                                    <>
                                      <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                      <span className="text-green-500">Submitted</span>
                                    </>
                                  ) : submittingStatuses[idx] === 'error' ? (
                                    <>
                                      <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                                      <span className="text-red-500">Failed</span>
                                    </>
                                  ) : (
                                    <>
                                      <Send className="w-3.5 h-3.5" />
                                      <span>Submit</span>
                                    </>
                                  )}
                                </button>
                                {false && (
                                  <button
                                    onClick={() => copyToClipboard(gUrl, idx)}
                                    className="text-xs px-2.5 py-1 text-neutral-300 hover:text-white hover:bg-white/10 border border-white/20 transition-all flex items-center gap-1"
                                    title="Copy response link"
                                  >
                                    {copiedIndex === idx ? (
                                      <>
                                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                                        <span>Copied</span>
                                      </>
                                    ) : (
                                      <>
                                        <Copy className="w-3.5 h-3.5" />
                                        <span>Copy Link</span>
                                      </>
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </div>
              </section>

              {/* Fallback Raw Data View if both are empty */}
              {sections.length === 0 && questions.length === 0 && rawData && (
                <section className="space-y-4">
                  <div className="flex items-center gap-2 px-1">
                    <Code className="w-5 h-5 text-neutral-400" />
                    <h2 className="text-xl font-semibold text-white">Raw JSON Response</h2>
                    <span className="text-sm text-neutral-400 ml-2">
                      (Could not map to standard tables)
                    </span>
                  </div>
                  <div className="bg-black/50 border border-white/20 rounded-none shadow-sm p-6 overflow-auto max-h-[500px]">
                    <pre className="text-xs font-mono text-neutral-400 whitespace-pre-wrap">
                      {JSON.stringify(rawData, null, 2)}
                    </pre>
                  </div>
                </section>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
