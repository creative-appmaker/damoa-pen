import React from 'react';
import { Pin, Trash2, Edit2, FileText } from 'lucide-react';
import { PenNote } from '../types';

export type ViewMode = 'grid' | 'grid-large' | 'list' | 'compact';

interface Props {
  note: PenNote;
  viewMode: ViewMode;
  onEdit: (note: PenNote) => void;
  onDeleteRequest: (note: PenNote) => void; // 삭제 확인 요청 (모달 트리거)
  onTogglePin: (note: PenNote) => void;
}

function fmtDate(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
}
function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

export const NoteCard: React.FC<Props> = ({ note, viewMode, onEdit, onDeleteRequest, onTogglePin }) => {
  const bgColor   = note.paperType==='black'?'#1a1a1a':note.paperType==='yellow'?'#fef9c3':'#ffffff';
  const textColor = note.paperType==='black'?'#e2e8f0':'#1c1917';
  const hasPdf    = !!note.pdfBase64;

  // ── LIST 뷰 ──────────────────────────────────────────────────────────────
  if (viewMode === 'list') {
    return (
      <div
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
            <span className="text-sm font-black text-stone-900 dark:text-slate-100 truncate">{note.title || '제목 없음'}</span>
          </div>
          {note.ocrText && (
            <p className="text-[11px] text-stone-500 dark:text-slate-400 truncate leading-snug">{note.ocrText}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {note.tags?.slice(0,3).map(t => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 bg-purple-100 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 rounded-full font-bold">#{t}</span>
            ))}
            <span className="text-[10px] text-stone-400 dark:text-slate-500 ml-auto font-bold shrink-0">{fmtDate(note.updatedAt)} {fmtTime(note.updatedAt)}</span>
          </div>
        </div>
        {/* 액션 버튼 */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
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
    );
  }

  // ── COMPACT 뷰 (작은 카드, 4열) ──────────────────────────────────────────
  if (viewMode === 'compact') {
    return (
      <div className="group relative rounded-xl overflow-hidden border border-stone-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.97] flex flex-col"
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
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100">
            <button type="button" onClick={e=>{e.stopPropagation();onDeleteRequest(note);}}
              className="w-7 h-7 bg-red-500/90 rounded-lg flex items-center justify-center shadow cursor-pointer">
              <Trash2 className="w-3.5 h-3.5 text-white"/>
            </button>
          </div>
        </div>
        <div className="px-1.5 py-1" style={{backgroundColor:bgColor}}>
          <div className="text-[10px] font-black truncate" style={{color:textColor}}>{note.title || '제목 없음'}</div>
          <div className="text-[9px] opacity-50 font-bold" style={{color:textColor}}>{fmtDate(note.updatedAt)}</div>
        </div>
      </div>
    );
  }

  // ── GRID-LARGE 뷰 (큰 카드, 1~2열) ──────────────────────────────────────
  if (viewMode === 'grid-large') {
    return (
      <div className="group relative rounded-2xl overflow-hidden border border-stone-200 dark:border-slate-700 shadow-sm hover:shadow-lg transition-all cursor-pointer active:scale-[0.99] flex flex-col"
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
          {hasPdf && (
            <div className="absolute top-2 right-2 px-2 py-0.5 bg-amber-500 text-white rounded-lg text-[10px] font-black">PDF</div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
            <button type="button" onClick={e=>{e.stopPropagation();onEdit(note);}}
              className="w-10 h-10 bg-white/90 rounded-xl flex items-center justify-center shadow-lg cursor-pointer">
              <Edit2 className="w-4 h-4 text-purple-600"/>
            </button>
            <button type="button" onClick={e=>{e.stopPropagation();onTogglePin(note);}}
              className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg cursor-pointer ${note.isPinned?'bg-amber-400/90':'bg-white/90'}`}>
              <Pin className={`w-4 h-4 ${note.isPinned?'text-stone-900 fill-stone-900':'text-amber-600'}`}/>
            </button>
            <button type="button" onClick={e=>{e.stopPropagation();onDeleteRequest(note);}}
              className="w-10 h-10 bg-red-500/90 rounded-xl flex items-center justify-center shadow-lg cursor-pointer">
              <Trash2 className="w-4 h-4 text-white"/>
            </button>
          </div>
        </div>
        <div className="px-3 py-2.5 flex-1" style={{backgroundColor:bgColor}}>
          <div className="text-sm font-black truncate mb-1" style={{color:textColor}}>{note.title || '제목 없음'}</div>
          {note.ocrText && (
            <p className="text-xs opacity-60 line-clamp-3 leading-snug mb-1.5" style={{color:textColor}}>{note.ocrText}</p>
          )}
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
    );
  }

  // ── GRID 뷰 (기본, 2~3열) ────────────────────────────────────────────────
  return (
    <div className="group relative rounded-2xl overflow-hidden border border-stone-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all cursor-pointer active:scale-[0.98] flex flex-col"
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
        {hasPdf && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-amber-500 text-white rounded-md text-[9px] font-black">PDF</div>
        )}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <button type="button" onClick={e=>{e.stopPropagation();onEdit(note);}}
            className="w-9 h-9 bg-white/90 rounded-xl flex items-center justify-center shadow-lg cursor-pointer">
            <Edit2 className="w-4 h-4 text-purple-600"/>
          </button>
          <button type="button" onClick={e=>{e.stopPropagation();onTogglePin(note);}}
            className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-lg cursor-pointer ${note.isPinned?'bg-amber-400/90':'bg-white/90'}`}>
            <Pin className={`w-4 h-4 ${note.isPinned?'text-stone-900 fill-stone-900':'text-amber-600'}`}/>
          </button>
          <button type="button" onClick={e=>{e.stopPropagation();onDeleteRequest(note);}}
            className="w-9 h-9 bg-red-500/90 rounded-xl flex items-center justify-center shadow-lg cursor-pointer">
            <Trash2 className="w-4 h-4 text-white"/>
          </button>
        </div>
      </div>
      <div className="px-2.5 py-2 flex-1" style={{backgroundColor:bgColor}}>
        <div className="text-xs font-black truncate mb-0.5" style={{color:textColor}}>{note.title || '제목 없음'}</div>
        {note.ocrText && (
          <div className="text-[10px] opacity-60 line-clamp-2 leading-tight mb-1" style={{color:textColor}}>{note.ocrText}</div>
        )}
        <div className="text-[10px] opacity-50 font-bold" style={{color:textColor}}>{fmtDate(note.updatedAt)} {fmtTime(note.updatedAt)}</div>
      </div>
    </div>
  );
};
