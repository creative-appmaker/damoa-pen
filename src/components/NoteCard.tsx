import React, { useState, useRef } from 'react';
import { Pin, Trash2, FileText, FolderOpen, X } from 'lucide-react';
import { PenNote, Folder } from '../types';

export type ViewMode = 'grid' | 'grid-large' | 'list' | 'compact';

interface Props {
  note: PenNote;
  viewMode: ViewMode;
  onEdit: (note: PenNote) => void;
  onDeleteRequest: (note: PenNote) => void;
  onTogglePin: (note: PenNote) => void;
  folders?: Folder[];
  onMoveToFolder?: (noteId: string, folderId: string | undefined) => void;
  searchQuery?: string;
}

// 검색어 박스 하이라이트 헬퍼
function hl(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;
  const q = query.trim().toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  const boxStyle: React.CSSProperties = {
    display: 'inline',
    border: '1.5px solid #f59e0b',
    borderRadius: '3px',
    padding: '0 2px',
    color: 'inherit',
    background: 'rgba(245,158,11,0.15)',
    fontWeight: 900,
  };
  return (
    <>{text.slice(0, idx)}<span style={boxStyle}>{text.slice(idx, idx + q.length)}</span>{text.slice(idx + q.length)}</>
  );
}

// OCR 전문에서 검색어 주변 스니펫 추출 (제목 제외, 본문만)
function getSnippet(note: PenNote, query: string): string | null {
  if (!query.trim()) return null;
  const q = query.trim().toLowerCase();
  // 제목에서만 매치되면 스니펫 불필요
  const sources = [
    note.ocrText ?? '',
    ...(note.pageOcrTexts ?? []),
    note.pdfText ?? '',
  ].filter(s => s.trim().length > 0);
  for (const src of sources) {
    const clean = src.replace(/\s+/g, ' ').trim();
    const idx = clean.toLowerCase().indexOf(q);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 30);
    const end   = Math.min(clean.length, idx + q.length + 30);
    return (start > 0 ? '…' : '') + clean.slice(start, end) + (end < clean.length ? '…' : '');
  }
  return null;
}

function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export const NoteCard: React.FC<Props> = ({
  note, viewMode, onEdit, onDeleteRequest, onTogglePin, folders, onMoveToFolder, searchQuery,
}) => {
  const sq = searchQuery?.trim() ?? '';
  const bgColor   = note.paperType==='black'?'#1a1a1a':note.paperType==='yellow'?'#fef9c3':'#ffffff';
  const textColor = note.paperType==='black'?'#e2e8f0':'#1c1917';
  const hasPdf    = !!note.pdfBase64;
  const hasOcr    = !!(note.ocrText?.trim() || note.pageOcrTexts?.some(t => t?.trim()));
  const hasStrokes = !!(note.pageStrokes?.some(p => p.length > 0));
  const ocrDot = hasOcr
    ? <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0 inline-block" title="OCR 완료"/>
    : hasStrokes
      ? <span className="w-2 h-2 rounded-full bg-red-500 shrink-0 inline-block" title="OCR 미완료"/>
      : null;

  // ── Long-press → folder move popup ───────────────────────────────────────
  const [showMovePopup, setShowMovePopup] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const startLongPress = () => {
    longPressTimer.current = setTimeout(() => {
      setShowMovePopup(true);
      try { navigator.vibrate?.(60); } catch {}
    }, 600);
  };
  const cancelLongPress = () => clearTimeout(longPressTimer.current);

  const movePopup = showMovePopup && onMoveToFolder ? (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{backgroundColor:'rgba(0,0,0,0.45)'}}
      onClick={() => setShowMovePopup(false)}>
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-t-3xl px-4 pt-4 pb-8 shadow-2xl"
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-purple-600"/>
            <span className="text-sm font-black text-stone-800 dark:text-slate-100">폴더로 이동</span>
          </div>
          <button type="button" onClick={() => setShowMovePopup(false)}
            className="w-7 h-7 rounded-full bg-stone-100 dark:bg-slate-800 flex items-center justify-center cursor-pointer">
            <X className="w-3.5 h-3.5 text-stone-500"/>
          </button>
        </div>
        <div className="text-xs text-stone-500 dark:text-slate-400 mb-3 truncate">
          「{note.title || '제목 없음'}」
        </div>
        {/* Folder list */}
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {/* Root (no folder) */}
          <button type="button"
            onClick={() => { onMoveToFolder(note.id, undefined); setShowMovePopup(false); }}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 cursor-pointer transition-colors
              ${!note.folderId
                ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                : 'hover:bg-stone-100 dark:hover:bg-slate-800 text-stone-700 dark:text-slate-300'}`}>
            <span className="text-base">📁</span>
            <span>전체 (폴더 없음)</span>
            {!note.folderId && <span className="ml-auto text-[10px] font-black text-purple-500">현재</span>}
          </button>
          {/* Each folder */}
          {(folders ?? []).map(f => (
            <button key={f.id} type="button"
              onClick={() => { onMoveToFolder(note.id, f.id); setShowMovePopup(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 cursor-pointer transition-colors
                ${note.folderId === f.id
                  ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
                  : 'hover:bg-stone-100 dark:hover:bg-slate-800 text-stone-700 dark:text-slate-300'}`}>
              <span className="text-base">🗂️</span>
              <span className="truncate">{f.name}</span>
              {note.folderId === f.id && <span className="ml-auto text-[10px] font-black text-purple-500 shrink-0">현재</span>}
            </button>
          ))}
          {(folders ?? []).length === 0 && (
            <div className="text-center text-xs text-stone-400 py-4">
              폴더가 없습니다. 먼저 폴더를 만들어주세요.
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  // Long-press handlers added to each card wrapper
  const longPressProps = {
    onTouchStart: startLongPress,
    onTouchEnd: cancelLongPress,
    onTouchMove: cancelLongPress,
    onMouseDown: startLongPress,
    onMouseUp: cancelLongPress,
    onMouseLeave: cancelLongPress,
  };

  // ── LIST 뷰 ──────────────────────────────────────────────────────────────
  if (viewMode === 'list') {
    return (
      <>
        {movePopup}
        <div {...longPressProps}
          className="flex items-center gap-3 bg-white dark:bg-slate-900 border border-stone-200 dark:border-slate-700 rounded-2xl px-3 py-2.5 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.99] group"
          onClick={() => onEdit(note)}>
          {/* 썸네일 */}
          <div className="w-12 h-14 rounded-xl overflow-hidden shrink-0 border border-stone-200 dark:border-slate-700" style={{backgroundColor:bgColor}}>
            {note.dataUrl
              ? <img src={note.dataUrl} alt="" className="w-full h-full object-cover object-top" loading="lazy"/>
              : <div className="w-full h-full flex items-center justify-center text-xl opacity-20">✏️</div>}
          </div>
          {/* 정보 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              {note.isPinned && <Pin className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0"/>}
              {hasPdf && <FileText className="w-3 h-3 text-amber-600 shrink-0"/>}
              {ocrDot}
              <span className="text-sm font-black text-stone-900 dark:text-slate-100 truncate">{sq ? hl(note.title || '제목 없음', sq) : (note.title || '제목 없음')}</span>
            </div>
            {sq && (() => { const snip = getSnippet(note, sq); return snip ? (
              <div className="text-[11px] text-stone-500 dark:text-slate-400 mt-0.5 line-clamp-1">{hl(snip, sq)}</div>
            ) : null; })()}
            <div className="flex items-center gap-2 mt-1">
              {note.tags?.slice(0,3).map(t => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 rounded-full font-bold">#{t}</span>
              ))}
              <span className="text-[10px] text-stone-400 dark:text-slate-500 ml-auto font-bold shrink-0">{fmtDate(note.updatedAt)} {fmtTime(note.updatedAt)}</span>
            </div>
          </div>
          {/* 액션 버튼 */}
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" onClick={e=>{e.stopPropagation();onTogglePin(note);}}
              className={`w-8 h-8 rounded-xl flex items-center justify-center cursor-pointer ${note.isPinned?'bg-amber-100 dark:bg-amber-900/40':'bg-stone-100 dark:bg-slate-800 hover:bg-stone-200'}`}>
              <Pin className={`w-3.5 h-3.5 ${note.isPinned?'text-amber-600 fill-amber-600':'text-stone-500'}`}/>
            </button>
            <button type="button" onClick={e=>{e.stopPropagation();onDeleteRequest(note);}}
              className="w-8 h-8 rounded-xl flex items-center justify-center cursor-pointer bg-red-50 dark:bg-red-950/40 hover:bg-red-100 text-red-500">
              <Trash2 className="w-3.5 h-3.5"/>
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── COMPACT 뷰 (작은 카드, 4열) ──────────────────────────────────────────
  if (viewMode === 'compact') {
    return (
      <>
        {movePopup}
        <div {...longPressProps}
          className="group relative rounded-xl overflow-hidden border border-stone-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.97] flex flex-col"
          style={{backgroundColor:bgColor}}
          onClick={() => onEdit(note)}>
          <div className="relative aspect-[3/4] overflow-hidden">
            {note.dataUrl
              ? <img src={note.dataUrl} alt="" className="w-full h-full object-cover object-top" loading="lazy"/>
              : <div className="w-full h-full flex items-center justify-center" style={{backgroundColor:bgColor}}><span className="text-3xl opacity-20">✏️</span></div>}
            {note.isPinned && (
              <div className="absolute top-1 left-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center">
                <Pin className="w-2 h-2 text-stone-900 fill-stone-900"/>
              </div>
            )}
            <button type="button" onClick={e=>{e.stopPropagation();onDeleteRequest(note);}}
              className="absolute top-1 right-1 w-6 h-6 bg-black/40 hover:bg-red-500/90 rounded-lg flex items-center justify-center shadow cursor-pointer backdrop-blur-sm">
              <Trash2 className="w-3 h-3 text-white"/>
            </button>
          </div>
          <div className="px-1.5 py-1" style={{backgroundColor:bgColor}}>
            <div className="flex items-center gap-1"><span>{ocrDot}</span><div className="text-[10px] font-black truncate" style={{color:textColor}}>{sq ? hl(note.title || '제목 없음', sq) : (note.title || '제목 없음')}</div></div>
            <div className="text-[9px] opacity-50 font-bold" style={{color:textColor}}>{fmtDate(note.updatedAt)}</div>
          </div>
        </div>
      </>
    );
  }

  // ── GRID-LARGE 뷰 (큰 카드, 1~2열) ──────────────────────────────────────
  if (viewMode === 'grid-large') {
    return (
      <>
        {movePopup}
        <div {...longPressProps}
          className="group relative rounded-2xl overflow-hidden border border-stone-200 dark:border-slate-700 shadow-sm hover:shadow-lg transition-all cursor-pointer active:scale-[0.99] flex flex-col"
          style={{backgroundColor:bgColor}}
          onClick={() => onEdit(note)}>
          <div className="relative aspect-[4/3] overflow-hidden">
            {note.dataUrl
              ? <img src={note.dataUrl} alt="" className="w-full h-full object-cover object-top" loading="lazy"/>
              : <div className="w-full h-full flex items-center justify-center" style={{backgroundColor:bgColor}}><span className="text-6xl opacity-20">✏️</span></div>}
            {note.isPinned && (
              <div className="absolute top-2 left-2 w-6 h-6 bg-amber-400 rounded-full flex items-center justify-center shadow-md">
                <Pin className="w-3 h-3 text-stone-900 fill-stone-900"/>
              </div>
            )}
            <div className="absolute top-2 right-2 flex items-center gap-1">
              {hasPdf && <span className="px-2 py-0.5 bg-amber-500 text-white rounded-lg text-[10px] font-black">PDF</span>}
              <button type="button" onClick={e=>{e.stopPropagation();onDeleteRequest(note);}}
                className="w-7 h-7 bg-black/40 hover:bg-red-500/90 rounded-lg flex items-center justify-center shadow cursor-pointer backdrop-blur-sm">
                <Trash2 className="w-3.5 h-3.5 text-white"/>
              </button>
            </div>
            <button type="button" onClick={e=>{e.stopPropagation();onTogglePin(note);}}
              className={`absolute bottom-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center shadow cursor-pointer backdrop-blur-sm ${note.isPinned?'bg-amber-400/90':'bg-black/30 hover:bg-black/50'}`}>
              <Pin className={`w-3.5 h-3.5 ${note.isPinned?'text-stone-900 fill-stone-900':'text-white'}`}/>
            </button>
          </div>
          <div className="px-3 py-2.5 flex-1" style={{backgroundColor:bgColor}}>
            <div className="flex items-center gap-1.5 mb-1">{ocrDot}<div className="text-sm font-black truncate" style={{color:textColor}}>{sq ? hl(note.title || '제목 없음', sq) : (note.title || '제목 없음')}</div></div>
            {sq && (() => { const snip = getSnippet(note, sq); return snip ? (
              <div className="text-[11px] opacity-70 line-clamp-2 mb-1" style={{color:textColor}}>{hl(snip, sq)}</div>
            ) : null; })()}
            {note.tags && note.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-1.5">
                {note.tags.slice(0,4).map(t => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 rounded-full font-bold">#{t}</span>
                ))}
              </div>
            )}
            <div className="text-[11px] opacity-50 font-bold" style={{color:textColor}}>{fmtDate(note.updatedAt)} {fmtTime(note.updatedAt)}</div>
          </div>
        </div>
      </>
    );
  }

  // ── GRID 뷰 (기본, 2~3열) ────────────────────────────────────────────────
  return (
    <>
      {movePopup}
      <div {...longPressProps}
        className="group relative rounded-2xl overflow-hidden border border-stone-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.98] flex flex-col"
        style={{backgroundColor:bgColor}}
        onClick={() => onEdit(note)}>
        <div className="relative aspect-[3/4] overflow-hidden">
          {note.dataUrl
            ? <img src={note.dataUrl} alt="" className="w-full h-full object-cover object-top" loading="lazy"/>
            : <div className="w-full h-full flex items-center justify-center" style={{backgroundColor:bgColor}}><span className="text-4xl opacity-20">✏️</span></div>}
          {note.isPinned && (
            <div className="absolute top-2 left-2 w-6 h-6 bg-amber-400 rounded-full flex items-center justify-center shadow-md">
              <Pin className="w-3 h-3 text-stone-900 fill-stone-900"/>
            </div>
          )}
          <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
            {hasPdf && <span className="px-1.5 py-0.5 bg-amber-500 text-white rounded-md text-[9px] font-black">PDF</span>}
            <button type="button" onClick={e=>{e.stopPropagation();onDeleteRequest(note);}}
              className="w-6 h-6 bg-black/40 hover:bg-red-500/90 rounded-lg flex items-center justify-center shadow cursor-pointer backdrop-blur-sm">
              <Trash2 className="w-3 h-3 text-white"/>
            </button>
          </div>
          <button type="button" onClick={e=>{e.stopPropagation();onTogglePin(note);}}
            className={`absolute bottom-1.5 right-1.5 w-6 h-6 rounded-lg flex items-center justify-center shadow cursor-pointer backdrop-blur-sm ${note.isPinned?'bg-amber-400/90':'bg-black/30 hover:bg-black/50'}`}>
            <Pin className={`w-3 h-3 ${note.isPinned?'text-stone-900 fill-stone-900':'text-white'}`}/>
          </button>
        </div>
        <div className="px-2.5 py-2 flex-1" style={{backgroundColor:bgColor}}>
          <div className="flex items-center gap-1 mb-0.5">{ocrDot}<div className="text-xs font-black truncate" style={{color:textColor}}>{sq ? hl(note.title || '제목 없음', sq) : (note.title || '제목 없음')}</div></div>
          {sq && (() => { const snip = getSnippet(note, sq); return snip ? (
            <div className="text-[10px] opacity-60 line-clamp-1 mb-0.5" style={{color:textColor}}>{hl(snip, sq)}</div>
          ) : null; })()}
          <div className="text-[10px] opacity-50 font-bold" style={{color:textColor}}>{fmtDate(note.updatedAt)} {fmtTime(note.updatedAt)}</div>
        </div>
      </div>
    </>
  );
};
