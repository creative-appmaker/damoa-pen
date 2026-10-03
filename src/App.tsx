import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FolderOpen, FolderPlus, X, ChevronRight, Tag } from 'lucide-react';
import { PenNote, Folder, PenSettings, PenLayer, WordBox } from './types';
import { getAllNotes, saveNote, deleteNote, getFolders, saveFolder, deleteFolder } from './lib/storage';
import { PenCanvas } from './components/PenCanvas';
import { NoteList } from './components/NoteList';
import { SettingsModal } from './components/SettingsModal';
import { LockScreen, LOCK_KEY } from './components/LockScreen';

type View = 'list' | 'canvas';

const FOLDER_COLORS = ['#8b5cf6','#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#2563eb','#ec4899'];
const TAB_PALETTE   = ['#8b5cf6','#22c55e','#3b82f6','#f97316','#ec4899','#14b8a6'];

export default function App() {
  const [notes,       setNotes]       = useState<PenNote[]>([]);
  const [folders,     setFolders]     = useState<Folder[]>([]);
  const [view,        setView]        = useState<View>('list');
  const [editingNote, setEditingNote] = useState<PenNote | null>(null);
  const [showSettings,setShowSettings]= useState(false);
  const [notesLoaded, setNotesLoaded] = useState(false);
  const hasRestoredTabsRef            = useRef(false);

  // ── 탭 시스템 (localStorage 영속) ────────────────────────────────────────
  const [openTabs,    setOpenTabs]    = useState<Array<{noteId:string|null; title:string; color:string; pageIdx:number; zoom?:{scale:number;x:number;y:number}; tabId:string}>>(() => {
    try {
      const s = localStorage.getItem('damoa_open_tabs');
      const tabs = s ? JSON.parse(s) : [];
      // tabId 없는 기존 탭에 고유 ID 부여 (하위 호환)
      return tabs.map((t: any, i: number) => ({ ...t, tabId: t.tabId ?? `tab-legacy-${i}-${Date.now()}` }));
    } catch { return []; }
  });
  const [activeTabIdx,setActiveTabIdx]= useState(() => {
    try { const s = localStorage.getItem('damoa_active_tab_idx'); return s ? parseInt(s, 10) : 0; } catch { return 0; }
  });
  const [tabEditIdx,  setTabEditIdx]  = useState<number | null>(null); // 탭 편집 팝업
  const [pendingPdfFile, setPendingPdfFile] = useState<File | null>(null);
  const [isLocked,    setIsLocked]    = useState(() => localStorage.getItem(LOCK_KEY) === 'true');
  const [darkMode,    setDarkMode]    = useState(() => {
    const stored = localStorage.getItem('damoa_pen_dark');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // ── 폴더 필터 ─────────────────────────────────────────────────────────────
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [filterTag,        setFilterTag]        = useState<string | null>(null);
  const [showFolderPanel,  setShowFolderPanel]  = useState(false);

  // ── 폴더 추가 UI ──────────────────────────────────────────────────────────
  const [newFolderName,  setNewFolderName]  = useState('');
  const [newFolderColor, setNewFolderColor] = useState(FOLDER_COLORS[0]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('damoa_pen_dark', String(darkMode));
  }, [darkMode]);

  // 탭 변경 시 localStorage에 저장
  useEffect(() => { localStorage.setItem('damoa_open_tabs', JSON.stringify(openTabs)); }, [openTabs]);
  useEffect(() => { localStorage.setItem('damoa_active_tab_idx', String(activeTabIdx)); }, [activeTabIdx]);

  // PDF 파일 전달 후 즉시 클리어 (PenCanvas가 useEffect로 consume)
  useEffect(() => {
    if (pendingPdfFile) { const t = setTimeout(() => setPendingPdfFile(null), 600); return () => clearTimeout(t); }
  }, [pendingPdfFile]);

  const loadNotes = useCallback(async () => {
    const all = await getAllNotes();
    setNotes(all);
    setNotesLoaded(true);
  }, []);

  const loadFolders = useCallback(async () => {
    const all = await getFolders();
    setFolders(all);
  }, []);

  useEffect(() => { loadNotes(); loadFolders(); }, [loadNotes, loadFolders]);

  // 앱 시작 시 탭 복원 (notes 로드 완료 후 1회만)
  useEffect(() => {
    if (!notesLoaded || hasRestoredTabsRef.current) return;
    hasRestoredTabsRef.current = true;
    // 삭제된 노트의 탭 제거
    const validTabs = openTabs.filter(t => !t.noteId || notes.some(n => n.id === t.noteId));
    if (validTabs.length !== openTabs.length) setOpenTabs(validTabs);
    if (validTabs.length === 0) return;
    const safeIdx = Math.min(activeTabIdx, validTabs.length - 1);
    const tab = validTabs[safeIdx];
    if (tab?.noteId) {
      const note = notes.find(n => n.id === tab.noteId);
      if (note) {
        setEditingNote(note);
        setActiveTabIdx(safeIdx);
        setView('canvas');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notesLoaded]);

  // ── 표시 노트 필터링 ──────────────────────────────────────────────────────
  const filteredNotes = useMemo(() => {
    let list = notes;
    if (selectedFolderId) list = list.filter(n => n.folderId === selectedFolderId);
    if (filterTag) list = list.filter(n => n.tags?.includes(filterTag));
    return list;
  }, [notes, selectedFolderId, filterTag]);

  // 전체 태그 목록
  const allTags = useMemo(() => {
    const set = new Set<string>();
    notes.forEach(n => n.tags?.forEach(t => set.add(t)));
    return [...set].sort();
  }, [notes]);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const handleNew = () => {
    const color = TAB_PALETTE[openTabs.length % TAB_PALETTE.length];
    const newIdx = openTabs.length;
    setOpenTabs(prev => [...prev, { noteId: null, title: '새 노트', color, pageIdx: 0, tabId: `tab-${Date.now()}-${Math.random().toString(36).slice(2)}` }]);
    setActiveTabIdx(newIdx);
    setEditingNote(null);
    setView('canvas');
  };

  const [searchQuery,     setSearchQuery]     = useState('');
  const [listSearchQuery, setListSearchQuery] = useState(''); // 목록 검색어 (view 전환해도 유지)

  const handleEdit = (note: PenNote, query?: string) => {
    if (query !== undefined) setSearchQuery(query);
    const existingIdx = openTabs.findIndex(t => t.noteId === note.id);
    if (existingIdx >= 0) {
      setActiveTabIdx(existingIdx);
      setEditingNote(note);
      setView('canvas');
      return;
    }
    const color = TAB_PALETTE[openTabs.length % TAB_PALETTE.length];
    const newIdx = openTabs.length;
    setOpenTabs(prev => [...prev, { noteId: note.id, title: note.title, color, pageIdx: 0, tabId: `tab-${Date.now()}-${Math.random().toString(36).slice(2)}` }]);
    setActiveTabIdx(newIdx);
    setEditingNote(note);
    setView('canvas');
  };

  const handleSave = async (
    dataUrl: string,
    ocrText: string,
    title: string,
    paperType: 'white' | 'yellow' | 'black',
    tags: string[],
    folderId?: string,
    pdfBase64?: string,
    pdfText?: string,
    pdfPageCount?: number,
    pageStrokes?: import('./types').SavedStroke[][],
    penSettings?: PenSettings,
    pageImages?: (string | undefined)[],
    id?: string,
    pageOcrTexts?: string[],
    pageWordBoxes?: import('./types').WordBox[][],
    ocrCanvasDims?: { w: number; h: number },
    penLayers?: PenLayer[],
    activeLayerId?: string,
    extraData?: {
      coverType?: 'none'|'color'|'gradient';
      coverColor?: string;
      coverGradient?: string;
      outline?: Array<{label: string; pageIdx: number}>;
    },
  ) => {
    const now = Date.now();
    const noteId = id || `note-${now}-${Math.random().toString(36).slice(2)}`;
    const note: PenNote = {
      id: noteId,
      title: title || `손글씨 노트 ${new Date(now).toLocaleDateString('ko-KR')}`,
      dataUrl,
      ocrText,
      createdAt: editingNote?.createdAt ?? now,
      updatedAt: now,
      isPinned: editingNote?.isPinned ?? false,
      paperType,
      tags:          tags.length ? tags : (editingNote?.tags ?? []),
      folderId:      folderId ?? editingNote?.folderId ?? selectedFolderId ?? undefined,
      pdfBase64:     pdfBase64     ?? editingNote?.pdfBase64,
      pdfText:       pdfText       ?? editingNote?.pdfText,
      pdfPageCount:  pdfPageCount  ?? editingNote?.pdfPageCount,
      pageStrokes:   pageStrokes   ?? editingNote?.pageStrokes,
      penSettings:   penSettings   ?? editingNote?.penSettings,
      pageImages:    pageImages    ?? editingNote?.pageImages,
      pageOcrTexts:  pageOcrTexts  ?? editingNote?.pageOcrTexts,
      pageWordBoxes: pageWordBoxes ?? editingNote?.pageWordBoxes,
      ocrCanvasDims: ocrCanvasDims ?? editingNote?.ocrCanvasDims,
      penLayers:     penLayers     ?? editingNote?.penLayers,
      activeLayerId: activeLayerId ?? editingNote?.activeLayerId,
      coverType:     extraData?.coverType  ?? editingNote?.coverType,
      coverColor:    extraData?.coverColor  ?? editingNote?.coverColor,
      coverGradient: extraData?.coverGradient ?? editingNote?.coverGradient,
      outline:       extraData?.outline    ?? editingNote?.outline,
    };
    await saveNote(note);
    await loadNotes();
    // 탭 시스템: 목록으로 돌아가지 않고 캔버스 유지
    setEditingNote(note);
    setOpenTabs(prev => prev.map((t, i) =>
      i === activeTabIdx ? { ...t, noteId: noteId, title: note.title } : t
    ));
  };

  const handleDelete = async (noteId: string) => {
    await deleteNote(noteId);
    await loadNotes();
  };

  const handleTogglePin = async (note: PenNote) => {
    await saveNote({ ...note, isPinned: !note.isPinned, updatedAt: Date.now() });
    await loadNotes();
  };

  const handleMoveToFolder = async (note: PenNote, fid: string | undefined) => {
    await saveNote({ ...note, folderId: fid, updatedAt: Date.now() });
    await loadNotes();
  };

  // 탭을 유지하면서 목록으로 돌아가기 (탭 삭제 안 함)
  const handleBack = () => { setView('list'); };

  // 새 노트(미저장) 탭의 스트로크 임시 보관소 (탭 전환 후 복원용)
  const tempTabStrokesRef = useRef<Map<string, any[][]>>(new Map());
  // handleAutoSave 안에서 stale closure 없이 최신 값 참조
  const activeTabIdxRef = useRef(activeTabIdx);
  useEffect(() => { activeTabIdxRef.current = activeTabIdx; }, [activeTabIdx]);
  const openTabsRef = useRef(openTabs);
  useEffect(() => { openTabsRef.current = openTabs; }, [openTabs]);

  // 스트로크 자동저장 (탭 전환 시 손글씨 유지)
  const handleAutoSave = useCallback(async (noteId: string | undefined, pageStrokes: any[][]) => {
    if (!noteId) {
      // 새 노트: 임시 저장소에 보관 → 탭 복귀 시 initialPageStrokes로 복원
      const tabId = openTabsRef.current[activeTabIdxRef.current]?.tabId;
      if (tabId) tempTabStrokesRef.current.set(tabId, pageStrokes);
      return;
    }
    let updatedNote: PenNote | undefined;
    // setNotes functional updater로 stale closure 방지
    setNotes(prev => {
      const note = prev.find(n => n.id === noteId);
      if (!note) return prev;
      updatedNote = { ...note, pageStrokes, updatedAt: Date.now() };
      return prev.map(n => n.id === noteId ? updatedNote! : n);
    });
    // IndexedDB 저장 — updatedNote는 setNotes 콜백 직후 동기적으로 세팅됨
    if (updatedNote) await saveNote(updatedNote);
  }, []); // notes 의존성 제거 → stale closure 없음

  // ── 스트로크 클립보드 (잘라내기/복사/붙이기) ──────────────────────────────
  const [clipboardStrokes, setClipboardStrokes] = useState<import('./types').SavedStroke[]>([]);

  const handleCutStrokes = useCallback((strokes: import('./types').SavedStroke[]) => {
    setClipboardStrokes(strokes);
  }, []);

  const handleCopyStrokes = useCallback((strokes: import('./types').SavedStroke[]) => {
    setClipboardStrokes(strokes);
  }, []);

  // ── 배치 OCR ──────────────────────────────────────────────────────────────
  const [batchOcrProgress, setBatchOcrProgress] = useState<{current:number;total:number;noteTitle:string}|null>(null);
  const [batchOcrDone, setBatchOcrDone] = useState<{ok:number;fail:number}|null>(null);

  const handleBatchOcr = useCallback(async (noteIds: string[]) => {
    const visionApiKey = localStorage.getItem('damoa_vision_api_key') ?? '';
    const geminiApiKey = localStorage.getItem('damoa_gemini_api_key') ?? '';
    if (!visionApiKey && !geminiApiKey) {
      alert('⚙️ 설정에서 Cloud Vision 또는 Gemini API 키를 먼저 입력해주세요.');
      return;
    }
    const { extractHandwritingImage, runCloudVisionOcrFull } = await import('./lib/inkOcr');
    const CANVAS_W = 1200, CANVAS_H = 1600, SCALE = 2;
    let ok = 0, fail = 0;

    for (let i = 0; i < noteIds.length; i++) {
      const note = notes.find(n => n.id === noteIds[i]);
      if (!note) continue;
      setBatchOcrProgress({ current: i + 1, total: noteIds.length, noteTitle: note.title || '제목 없음' });

      const pageStrokes = note.pageStrokes ?? [[]];
      const pageOcrTexts: string[] = [];
      const pageWordBoxes: WordBox[][] = [];

      let noteFailed = false;
      for (let pi = 0; pi < pageStrokes.length; pi++) {
        const pg = pageStrokes[pi];
        const existingText  = note.pageOcrTexts?.[pi] ?? '';
        const existingBoxes = (note.pageWordBoxes?.[pi] ?? []) as WordBox[];
        if (pg.length === 0) { pageOcrTexts.push(existingText); pageWordBoxes.push(existingBoxes); continue; }
        try {
          const imgBase64 = extractHandwritingImage(pg as any, CANVAS_W, CANVAS_H, SCALE);
          if (visionApiKey) {
            const { text, wordBoxes: wb } = await runCloudVisionOcrFull(imgBase64, visionApiKey, SCALE, CANVAS_W, CANVAS_H);
            pageOcrTexts.push(text || existingText);
            pageWordBoxes.push(wb.map(b => ({ text: b.text, x: b.xFrac, y: b.yFrac, w: b.wFrac, h: b.hFrac })));
          } else {
            // Gemini fallback (텍스트만, 바운딩 박스 없음)
            const dataUrl = `data:image/jpeg;base64,${imgBase64}`;
            const m = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
            if (!m) { pageOcrTexts.push(existingText); pageWordBoxes.push(existingBoxes); continue; }
            const res = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
              { method:'POST', headers:{'Content-Type':'application/json'},
                body: JSON.stringify({ contents:[{parts:[
                  {text:'이 손글씨 이미지에 쓰여진 텍스트를 정확하게 인식하여 원본 그대로 출력해주세요. 줄바꿈 유지, 인식 텍스트만 출력.'},
                  {inline_data:{mime_type:`image/${m[1]}`,data:m[2]}}
                ]}], generationConfig:{maxOutputTokens:2048,temperature:0.1} }) }
            );
            if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
            const d = await res.json();
            const text = d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            pageOcrTexts.push(text || existingText);
            pageWordBoxes.push(existingBoxes);
          }
        } catch (e) {
          console.warn('[damoa-pen] 배치 OCR 실패 페이지', pi, e);
          pageOcrTexts.push(existingText); pageWordBoxes.push(existingBoxes);
          noteFailed = true;
        }
      }

      const ocrText = pageOcrTexts.filter(Boolean).join(' ');
      try {
        await saveNote({ ...note, ocrText, pageOcrTexts, pageWordBoxes, updatedAt: Date.now() });
        if (!noteFailed) ok++; else fail++;
      } catch { fail++; }
    }

    await loadNotes();
    setBatchOcrProgress(null);
    setBatchOcrDone({ ok, fail });
  }, [notes, loadNotes]);

  // ── 페이지 복사 (병합 모달 "복사" 모드) ───────────────────────────────────
  const handleCopyPages = useCallback(async (
    sourcePageIdxes: number[],
    targetNoteId: string,
    insertAfter: number,
  ) => {
    if (!editingNote) return;
    const targetNote = notes.find(n => n.id === targetNoteId);
    if (!targetNote) return;

    const srcPages = editingNote.pageStrokes ?? [[]];
    // 복사: 원본 삭제 없이 대상에만 삽입
    const copiedPages = sourcePageIdxes.map(i => [...(srcPages[i] ?? [])]);

    const tgtPages = [...(targetNote.pageStrokes ?? [[]])];
    const insertIdx = insertAfter + 1;
    tgtPages.splice(insertIdx, 0, ...copiedPages);

    await saveNote({ ...targetNote, pageStrokes: tgtPages, updatedAt: Date.now() });
    await loadNotes();
  }, [editingNote, notes, loadNotes]);

  // 현재 탭의 페이지 위치 저장
  const handlePageChange = useCallback((pageIdx: number) => {
    setOpenTabs(prev => prev.map((t, i) => i === activeTabIdx ? { ...t, pageIdx } : t));
  }, [activeTabIdx]);

  // ── 페이지 병합 ────────────────────────────────────────────────────────────
  const handleMergePages = useCallback(async (
    sourcePageIdxes: number[],
    targetNoteId: string,
    insertAfter: number,   // -1 = 맨 앞, 0 = 1p 뒤, …
  ) => {
    if (!editingNote) return;
    const targetNote = notes.find(n => n.id === targetNoteId);
    if (!targetNote) return;

    // source pageStrokes
    const srcPages = editingNote.pageStrokes ?? [[]];
    const movedPages = sourcePageIdxes.map(i => srcPages[i] ?? []);

    // target pageStrokes with insertion
    const tgtPages = [...(targetNote.pageStrokes ?? [[]])];
    const insertIdx = insertAfter + 1; // -1→0 (맨 앞), 0→1 (1p 뒤), …
    tgtPages.splice(insertIdx, 0, ...movedPages);

    // save target note
    await saveNote({ ...targetNote, pageStrokes: tgtPages, updatedAt: Date.now() });

    // remove moved pages from source (keep remaining)
    const remaining = srcPages.filter((_, i) => !sourcePageIdxes.includes(i));
    const newSrc = remaining.length > 0 ? remaining : [[]];
    const updatedSource: PenNote = { ...editingNote, pageStrokes: newSrc, updatedAt: Date.now() };
    await saveNote(updatedSource);

    await loadNotes();
    setEditingNote(updatedSource);
  }, [editingNote, notes, loadNotes]);

  // ── 탭 핸들러 ─────────────────────────────────────────────────────────────
  const handleTabSwitch = (idx: number) => {
    setActiveTabIdx(idx);
    const tab = openTabs[idx];
    if (tab?.noteId) {
      setEditingNote(notes.find(n => n.id === tab.noteId) ?? null);
    } else {
      setEditingNote(null);
    }
  };

  const handleTabClose = (idx: number) => {
    const newTabs = openTabs.filter((_, i) => i !== idx);
    if (newTabs.length === 0) {
      setOpenTabs([]);
      setView('list');
      setEditingNote(null);
      setActiveTabIdx(0);
      return;
    }
    const newIdx = idx >= newTabs.length ? newTabs.length - 1 : idx;
    setOpenTabs(newTabs);
    setActiveTabIdx(newIdx);
    const newTab = newTabs[newIdx];
    setEditingNote(newTab.noteId ? (notes.find(n => n.id === newTab.noteId) ?? null) : null);
  };

  const handleTabColorCycle = (idx: number) => {
    setOpenTabs(prev => prev.map((t, i) => {
      if (i !== idx) return t;
      const ci = TAB_PALETTE.indexOf(t.color);
      return { ...t, color: TAB_PALETTE[(ci + 1) % TAB_PALETTE.length] };
    }));
  };

  const handleTabEdit = (idx: number) => setTabEditIdx(idx === tabEditIdx ? null : idx);
  const handleTabTitleChange = (idx: number, title: string) => {
    setOpenTabs(prev => prev.map((t, i) => i === idx ? { ...t, title } : t));
  };
  const handleTabColorSet = (idx: number, color: string) => {
    setOpenTabs(prev => prev.map((t, i) => i === idx ? { ...t, color } : t));
  };

  const handleNewTab = () => handleNew();

  const handleZoomChange = useCallback((zoom: {scale:number;x:number;y:number}) => {
    setOpenTabs(prev => prev.map((t, i) => i === activeTabIdx ? { ...t, zoom } : t));
  }, [activeTabIdx]);

  const handleTabReorder = (fromIdx: number, toIdx: number) => {
    setOpenTabs(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
    // activeTabIdx 조정
    setActiveTabIdx(prev => {
      if (prev === fromIdx) return toIdx;
      if (fromIdx < toIdx && prev > fromIdx && prev <= toIdx) return prev - 1;
      if (fromIdx > toIdx && prev >= toIdx && prev < fromIdx) return prev + 1;
      return prev;
    });
  };

  const handleOpenPdf = (file: File) => {
    const color = TAB_PALETTE[openTabs.length % TAB_PALETTE.length];
    const newIdx = openTabs.length;
    setOpenTabs(prev => [...prev, { noteId: null, title: file.name.replace(/\.pdf$/i,''), color, pageIdx: 0, tabId: `tab-${Date.now()}-${Math.random().toString(36).slice(2)}` }]);
    setActiveTabIdx(newIdx);
    setEditingNote(null);
    setPendingPdfFile(file);
    setView('canvas');
  };

  // ── 폴더 CRUD ─────────────────────────────────────────────────────────────
  const handleAddFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const folder: Folder = {
      id: `f-${Date.now()}`,
      name,
      color: newFolderColor,
      createdAt: Date.now(),
    };
    await saveFolder(folder);
    await loadFolders();
    setNewFolderName('');
  };

  const handleDeleteFolder = async (id: string) => {
    await deleteFolder(id);
    // 해당 폴더에 속한 노트들은 folderId를 제거
    const affected = notes.filter(n => n.folderId === id);
    for (const n of affected) await saveNote({ ...n, folderId: undefined });
    await loadNotes();
    await loadFolders();
    if (selectedFolderId === id) setSelectedFolderId(null);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-dvh overflow-hidden bg-stone-50 dark:bg-slate-950 text-stone-900 dark:text-slate-100 flex">
      {isLocked && <LockScreen onUnlock={() => setIsLocked(false)}/>}

      {/* ── 배치 OCR 진행 오버레이 ── */}
      {batchOcrProgress && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-7 w-80 max-w-[90vw] flex flex-col items-center gap-4 shadow-2xl">
            <div className="text-3xl animate-spin">✨</div>
            <div className="text-base font-black text-stone-900 dark:text-slate-100 text-center">AI 인식 중...</div>
            <div className="text-sm text-stone-500 dark:text-slate-400 text-center truncate max-w-full px-2">
              {batchOcrProgress.noteTitle}
            </div>
            <div className="w-full bg-stone-200 dark:bg-slate-700 rounded-full h-2.5 overflow-hidden">
              <div className="bg-purple-500 h-2.5 rounded-full transition-all duration-300"
                style={{width:`${(batchOcrProgress.current/batchOcrProgress.total)*100}%`}}/>
            </div>
            <div className="text-xs font-black text-stone-500 dark:text-slate-400">
              {batchOcrProgress.current} / {batchOcrProgress.total} 완료
            </div>
          </div>
        </div>
      )}

      {/* ── 배치 OCR 완료 알림 ── */}
      {batchOcrDone && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setBatchOcrDone(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-7 w-72 max-w-[90vw] flex flex-col items-center gap-3 shadow-2xl"
            onClick={e => e.stopPropagation()}>
            <div className="text-3xl">{batchOcrDone.fail === 0 ? '✅' : '⚠️'}</div>
            <div className="text-base font-black text-stone-900 dark:text-slate-100">AI 인식 완료</div>
            <div className="text-sm text-stone-500 dark:text-slate-400 text-center">
              성공 {batchOcrDone.ok}개{batchOcrDone.fail > 0 ? ` · 실패 ${batchOcrDone.fail}개` : ''}
            </div>
            <button type="button" onClick={() => setBatchOcrDone(null)}
              className="mt-1 px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-black text-sm rounded-2xl cursor-pointer">
              확인
            </button>
          </div>
        </div>
      )}

      {/* ── 폴더 사이드패널 (list view 전용) ── */}
      {view === 'list' && (
        <>
          {/* 오버레이 */}
          {showFolderPanel && (
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setShowFolderPanel(false)}/>
          )}

          {/* 사이드패널 */}
          <div className={`fixed top-0 left-0 bottom-0 z-50 w-64 bg-white dark:bg-slate-900 border-r border-stone-200 dark:border-slate-700 shadow-2xl flex flex-col transition-transform duration-200 ${showFolderPanel ? 'translate-x-0' : '-translate-x-full'}`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-slate-700">
              <span className="font-black text-sm text-stone-800 dark:text-slate-100">폴더</span>
              <button type="button" onClick={() => setShowFolderPanel(false)}
                className="p-1 rounded-lg hover:bg-stone-100 dark:hover:bg-slate-800 cursor-pointer">
                <X className="w-4 h-4 text-stone-500"/>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {/* 전체 */}
              <button type="button" onClick={() => { setSelectedFolderId(null); setFilterTag(null); setShowFolderPanel(false); }}
                className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-bold cursor-pointer ${!selectedFolderId && !filterTag ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300' : 'text-stone-700 dark:text-slate-300 hover:bg-stone-50 dark:hover:bg-slate-800'}`}>
                <FolderOpen className="w-4 h-4"/>
                <span>전체 노트</span>
                <span className="ml-auto text-xs text-stone-400 font-bold">{notes.length}</span>
              </button>

              {/* 폴더 목록 */}
              {folders.map(f => (
                <div key={f.id} className="group flex items-center">
                  <button type="button" onClick={() => { setSelectedFolderId(f.id); setFilterTag(null); setShowFolderPanel(false); }}
                    className={`flex-1 flex items-center gap-2.5 px-4 py-2.5 text-sm font-bold cursor-pointer ${selectedFolderId === f.id ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700' : 'text-stone-700 dark:text-slate-300 hover:bg-stone-50 dark:hover:bg-slate-800'}`}>
                    <span className="w-3 h-3 rounded-full shrink-0" style={{background: f.color}}/>
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto text-xs text-stone-400 font-bold">{notes.filter(n => n.folderId === f.id).length}</span>
                  </button>
                  <button type="button" onClick={() => handleDeleteFolder(f.id)}
                    className="hidden group-hover:flex pr-3 p-1 text-stone-300 hover:text-red-400 cursor-pointer">
                    <X className="w-3.5 h-3.5"/>
                  </button>
                </div>
              ))}

              {/* 태그 필터 */}
              {allTags.length > 0 && (
                <div className="mt-3 px-4">
                  <div className="text-[10px] font-black text-stone-400 dark:text-slate-500 mb-2 uppercase tracking-wider">태그</div>
                  <div className="flex flex-wrap gap-1">
                    {allTags.map(t => (
                      <button key={t} type="button"
                        onClick={() => { setFilterTag(filterTag === t ? null : t); setSelectedFolderId(null); setShowFolderPanel(false); }}
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold cursor-pointer border ${filterTag === t ? 'bg-purple-600 text-white border-purple-600' : 'bg-stone-100 dark:bg-slate-800 text-stone-600 dark:text-slate-300 border-stone-200 dark:border-slate-700 hover:border-purple-300'}`}>
                        #{t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* 폴더 추가 */}
            <div className="px-4 py-3 border-t border-stone-200 dark:border-slate-700">
              <div className="text-[10px] font-black text-stone-400 mb-2 uppercase tracking-wider">새 폴더</div>
              <div className="flex gap-1.5 mb-2">
                {FOLDER_COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setNewFolderColor(c)}
                    className={`w-5 h-5 rounded-full cursor-pointer ${newFolderColor === c ? 'ring-2 ring-offset-1 ring-purple-500' : ''}`}
                    style={{background: c}}/>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddFolder()}
                  placeholder="폴더 이름"
                  className="flex-1 text-xs px-2.5 py-1.5 rounded-xl bg-stone-100 dark:bg-slate-800 text-stone-800 dark:text-slate-100 outline-none border border-transparent focus:border-purple-400"
                  style={{touchAction:'auto'}}
                />
                <button type="button" onClick={handleAddFolder}
                  className="p-1.5 bg-purple-600 text-white rounded-xl cursor-pointer hover:bg-purple-700">
                  <FolderPlus className="w-4 h-4"/>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── 메인 콘텐츠 ── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {view === 'list' ? (
          <>
            {/* 폴더/태그 필터 배너 */}
            {(selectedFolderId || filterTag) && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 dark:bg-purple-950/40 border-b border-purple-200 dark:border-purple-800 text-xs font-bold text-purple-800 dark:text-purple-200">
                {selectedFolderId && (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full" style={{background: folders.find(f => f.id === selectedFolderId)?.color}}/>
                    <span>{folders.find(f => f.id === selectedFolderId)?.name}</span>
                  </>
                )}
                {filterTag && (
                  <>
                    <Tag className="w-3 h-3"/>
                    <span>#{filterTag}</span>
                  </>
                )}
                <button type="button" onClick={() => { setSelectedFolderId(null); setFilterTag(null); }}
                  className="ml-auto text-purple-400 hover:text-purple-700 cursor-pointer">
                  <X className="w-3.5 h-3.5"/>
                </button>
              </div>
            )}

            <NoteList
              notes={filteredNotes}
              folders={folders}
              onNew={handleNew}
              onOpenPdf={handleOpenPdf}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
              onMoveToFolder={handleMoveToFolder}
              onOpenFolderPanel={() => setShowFolderPanel(true)}
              onSettings={() => setShowSettings(true)}
              darkMode={darkMode}
              searchQuery={listSearchQuery}
              onSearchQueryChange={setListSearchQuery}
              onBatchOcr={handleBatchOcr}
            />
          </>
        ) : (
          <PenCanvas
            key={`tab-${activeTabIdx}`}
            editingNote={editingNote}
            initialPageStrokes={(() => {
              const tabId = openTabs[activeTabIdx]?.tabId;
              return tabId ? tempTabStrokesRef.current.get(tabId) : undefined;
            })()}
            darkMode={darkMode}
            folders={folders}
            onSave={handleSave}
            onBack={handleBack}
            initialSearchQuery={searchQuery || undefined}
            openTabs={openTabs}
            activeTabIdx={activeTabIdx}
            onTabSwitch={handleTabSwitch}
            onTabClose={handleTabClose}
            onTabColorCycle={handleTabColorCycle}
            onTabEdit={handleTabEdit}
            onTabTitleChange={handleTabTitleChange}
            onTabColorSet={handleTabColorSet}
            tabEditIdx={tabEditIdx}
            onTabReorder={handleTabReorder}
            onNewTab={handleNewTab}
            initialPdfFile={pendingPdfFile}
            onAutoSave={handleAutoSave}
            initialPageIdx={openTabs[activeTabIdx]?.pageIdx ?? 0}
            initialZoom={openTabs[activeTabIdx]?.zoom}
            onZoomChange={handleZoomChange}
            onPageChange={handlePageChange}
            allNotes={notes}
            onMergePages={handleMergePages}
            clipboardStrokes={clipboardStrokes}
            onCutStrokes={handleCutStrokes}
            onCopyStrokes={handleCopyStrokes}
            onCopyPages={handleCopyPages}
          />
        )}
      </div>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          darkMode={darkMode}
          onToggleDark={() => setDarkMode(d => !d)}
        />
      )}
    </div>
  );
}
