import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FolderOpen, FolderPlus, X, ChevronRight, Tag } from 'lucide-react';
import { PenNote, Folder, PenSettings } from './types';
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
  const [openTabs,    setOpenTabs]    = useState<Array<{noteId:string|null; title:string; color:string; pageIdx:number}>>(() => {
    try { const s = localStorage.getItem('damoa_open_tabs'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [activeTabIdx,setActiveTabIdx]= useState(() => {
    try { const s = localStorage.getItem('damoa_active_tab_idx'); return s ? parseInt(s, 10) : 0; } catch { return 0; }
  });
  const [tabEditIdx,  setTabEditIdx]  = useState<number | null>(null); // 탭 편집 팝업
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
    setOpenTabs(prev => [...prev, { noteId: null, title: '새 노트', color, pageIdx: 0 }]);
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
    setOpenTabs(prev => [...prev, { noteId: note.id, title: note.title, color, pageIdx: 0 }]);
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

  // 스트로크 자동저장 (탭 전환 시 손글씨 유지)
  const handleAutoSave = useCallback(async (noteId: string | undefined, pageStrokes: any[][]) => {
    if (!noteId) return; // 새 노트는 자동저장 안 함
    const note = notes.find(n => n.id === noteId);
    if (!note) return;
    await saveNote({ ...note, pageStrokes, updatedAt: Date.now() });
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, pageStrokes } : n));
  }, [notes]);

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
              onEdit={handleEdit}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
              onMoveToFolder={handleMoveToFolder}
              onOpenFolderPanel={() => setShowFolderPanel(true)}
              onSettings={() => setShowSettings(true)}
              darkMode={darkMode}
              searchQuery={listSearchQuery}
              onSearchQueryChange={setListSearchQuery}
            />
          </>
        ) : (
          <PenCanvas
            editingNote={editingNote}
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
            onNewTab={handleNewTab}
            onAutoSave={handleAutoSave}
            initialPageIdx={openTabs[activeTabIdx]?.pageIdx ?? 0}
            onPageChange={handlePageChange}
            allNotes={notes}
            onMergePages={handleMergePages}
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
