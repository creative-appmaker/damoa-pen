import React, { useState, useMemo } from 'react';
import {
  Search, Settings, Plus, Pin, SortAsc, FolderOpen,
  LayoutGrid, List, AlignJustify, Rows3, Trash2, X,
} from 'lucide-react';
import { PenNote, Folder } from '../types';
import { NoteCard, ViewMode } from './NoteCard';

interface Props {
  notes: PenNote[];
  folders?: Folder[];
  onNew: () => void;
  onEdit: (note: PenNote, query?: string) => void;
  onDelete: (id: string) => void;
  onTogglePin: (note: PenNote) => void;
  onMoveToFolder?: (note: PenNote, folderId: string | undefined) => void;
  onOpenFolderPanel?: () => void;
  onSettings: () => void;
  darkMode: boolean;
}

type SortMode = 'updatedAt' | 'createdAt' | 'title';

const VIEW_MODES: { mode: ViewMode; icon: React.ReactNode; label: string }[] = [
  { mode: 'grid',       icon: <LayoutGrid className="w-4 h-4"/>,   label: '카드' },
  { mode: 'grid-large', icon: <Rows3 className="w-4 h-4"/>,        label: '큰 카드' },
  { mode: 'compact',    icon: <AlignJustify className="w-4 h-4"/>, label: '컴팩트' },
  { mode: 'list',       icon: <List className="w-4 h-4"/>,         label: '목록' },
];

export const NoteList: React.FC<Props> = ({
  notes, folders, onNew, onEdit, onDelete, onTogglePin,
  onMoveToFolder, onOpenFolderPanel, onSettings, darkMode,
}) => {
  const [query,         setQuery]         = useState('');
  const [showPinnedOnly,setShowPinnedOnly]= useState(false);
  const [sortMode,      setSortMode]      = useState<SortMode>('updatedAt');
  const [showSort,      setShowSort]      = useState(false);
  const [viewMode,      setViewMode]      = useState<ViewMode>('grid');

  // ── 삭제 확인 모달 ────────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<PenNote | null>(null);

  const handleDeleteConfirm = () => {
    if (deleteTarget) { onDelete(deleteTarget.id); setDeleteTarget(null); }
  };

  const filtered = useMemo(() => {
    let list = [...notes];
    if (showPinnedOnly) list = list.filter(n => n.isPinned);
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(n =>
        n.title.toLowerCase().includes(q) ||
        n.ocrText.toLowerCase().includes(q) ||
        (n.pdfText ?? '').toLowerCase().includes(q) ||
        (n.pageOcrTexts ?? []).some(t => t.toLowerCase().includes(q))
      );
    }
    list.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (sortMode === 'title') return a.title.localeCompare(b.title, 'ko');
      if (sortMode === 'createdAt') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
    return list;
  }, [notes, query, showPinnedOnly, sortMode]);

  const pinnedCount = notes.filter(n => n.isPinned).length;

  const gridClass: Record<ViewMode, string> = {
    'grid':       'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3',
    'grid-large': 'grid grid-cols-1 sm:grid-cols-2 gap-4',
    'compact':    'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2',
    'list':       'flex flex-col gap-2',
  };

  return (
    <div className="flex flex-col h-dvh bg-stone-50 dark:bg-slate-950 select-none">

      {/* ── 삭제 확인 모달 ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => setDeleteTarget(null)}>
          <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-6 max-w-sm w-full"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-red-100 dark:bg-red-950/60 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600"/>
              </div>
              <div>
                <div className="font-black text-stone-900 dark:text-slate-100 text-base">노트 삭제</div>
                <div className="text-sm text-stone-500 dark:text-slate-400 mt-0.5">이 작업은 되돌릴 수 없습니다.</div>
              </div>
            </div>
            <div className="bg-stone-100 dark:bg-slate-800 rounded-2xl px-4 py-3 mb-5">
              <div className="text-sm font-black text-stone-900 dark:text-slate-100 truncate">{deleteTarget.title || '제목 없음'}</div>
              {deleteTarget.ocrText && (
                <div className="text-xs text-stone-500 dark:text-slate-400 mt-0.5 line-clamp-2">{deleteTarget.ocrText}</div>
              )}
            </div>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setDeleteTarget(null)}
                className="flex-1 py-3 rounded-2xl bg-stone-100 dark:bg-slate-800 text-stone-700 dark:text-slate-300 font-black text-sm cursor-pointer hover:bg-stone-200 dark:hover:bg-slate-700">
                취소
              </button>
              <button type="button" onClick={handleDeleteConfirm}
                className="flex-1 py-3 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-black text-sm cursor-pointer">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b border-stone-200 dark:border-slate-800 px-4 py-3 space-y-2.5 shadow-sm">
        {/* Brand row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center shadow-sm text-lg">
              ✒️
            </div>
            <div>
              <h1 className="font-black text-base text-stone-900 dark:text-slate-100 leading-none">다모아 펜</h1>
              <p className="text-[11px] font-bold text-stone-400 dark:text-slate-500 mt-0.5">손글씨 전용 노트</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* 뷰 모드 토글 */}
            <div className="flex items-center gap-0.5 bg-stone-100 dark:bg-slate-800 rounded-xl p-0.5">
              {VIEW_MODES.map(({ mode, icon, label }) => (
                <button key={mode} type="button" title={label}
                  onClick={() => setViewMode(mode)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-all ${viewMode===mode?'bg-white dark:bg-slate-700 shadow-sm text-purple-600':'text-stone-500 dark:text-slate-400 hover:text-stone-700'}`}>
                  {icon}
                </button>
              ))}
            </div>
            {/* Folder */}
            {onOpenFolderPanel && (
              <button type="button" onClick={onOpenFolderPanel}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 cursor-pointer">
                <FolderOpen className="w-4 h-4 text-purple-600"/>
              </button>
            )}
            {/* Sort */}
            <div className="relative">
              <button type="button" onClick={() => setShowSort(!showSort)}
                className="w-9 h-9 flex items-center justify-center rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 cursor-pointer">
                <SortAsc className="w-4 h-4 text-stone-600 dark:text-slate-400"/>
              </button>
              {showSort && (
                <div className="absolute right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-2xl shadow-xl z-20 overflow-hidden min-w-[140px]"
                  onPointerLeave={() => setShowSort(false)}>
                  {([['updatedAt','최근 수정'],['createdAt','최근 생성'],['title','이름순']] as const).map(([m, label]) => (
                    <button key={m} type="button" onClick={() => {setSortMode(m);setShowSort(false);}}
                      className={`w-full px-4 py-2.5 text-xs font-black text-left cursor-pointer ${sortMode===m?'bg-purple-600 text-white':'text-stone-800 dark:text-slate-200 hover:bg-stone-100 dark:hover:bg-slate-800'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Settings */}
            <button type="button" onClick={onSettings}
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-stone-100 dark:bg-slate-800 hover:bg-stone-200 cursor-pointer">
              <Settings className="w-4 h-4 text-stone-600 dark:text-slate-400"/>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 bg-stone-100 dark:bg-slate-800 rounded-2xl px-3 py-2">
          <Search className="w-4 h-4 text-stone-400 dark:text-slate-500 shrink-0"/>
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="제목, 손글씨 텍스트 검색..."
            className="flex-1 bg-transparent text-sm outline-none text-stone-800 dark:text-slate-200 placeholder-stone-400 font-medium"
            style={{touchAction:'auto'}}
            onPointerDown={e => e.stopPropagation()}/>
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-stone-400 hover:text-stone-600 cursor-pointer">
              <X className="w-4 h-4"/>
            </button>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowPinnedOnly(!showPinnedOnly)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black cursor-pointer ${showPinnedOnly?'bg-amber-400 text-stone-900':'bg-stone-100 dark:bg-slate-800 text-stone-600 dark:text-slate-400 hover:bg-stone-200'}`}>
            <Pin className={`w-3 h-3 ${showPinnedOnly?'fill-stone-900':''}`}/>
            <span>고정 ({pinnedCount})</span>
          </button>
          <span className="text-xs font-bold text-stone-400 dark:text-slate-500 ml-auto">
            {filtered.length}/{notes.length} 노트
          </span>
        </div>
      </div>

      {/* Note grid / list */}
      <div className="flex-1 overflow-y-auto p-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
            {notes.length === 0 ? (
              <>
                <div className="text-6xl">✒️</div>
                <div className="font-black text-lg text-stone-800 dark:text-slate-200">첫 번째 노트를 써보세요</div>
                <p className="text-sm text-stone-400 dark:text-slate-500">아래 + 버튼을 눌러 손글씨 작성을 시작하세요.</p>
                <button type="button" onClick={onNew}
                  className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black px-6 py-3 rounded-2xl shadow-lg cursor-pointer active:scale-95">
                  + 새 노트 쓰기
                </button>
              </>
            ) : (
              <>
                <div className="text-4xl opacity-30">🔍</div>
                <div className="font-black text-stone-500 dark:text-slate-500">검색 결과 없음</div>
              </>
            )}
          </div>
        ) : (
          <div className={gridClass[viewMode]}>
            {filtered.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                viewMode={viewMode}
                onEdit={n => onEdit(n, query.trim() || undefined)}
                onDeleteRequest={setDeleteTarget}
                onTogglePin={onTogglePin}
              />
            ))}
          </div>
        )}
      </div>

      {/* FAB */}
      {notes.length > 0 && (
        <div className="fixed bottom-6 right-6 z-20" style={{bottom:'calc(1.5rem + env(safe-area-inset-bottom,0px))'}}>
          <button type="button" onClick={onNew}
            className="w-14 h-14 bg-gradient-to-br from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-2xl shadow-2xl flex items-center justify-center cursor-pointer active:scale-95 transition-all">
            <Plus className="w-7 h-7"/>
          </button>
        </div>
      )}
    </div>
  );
};
