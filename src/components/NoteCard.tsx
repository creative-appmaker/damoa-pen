import React from 'react';
import { Pin, Trash2, Edit2 } from 'lucide-react';
import { PenNote } from '../types';

interface Props {
  note: PenNote;
  onEdit: (note: PenNote) => void;
  onDelete: (id: string) => void;
  onTogglePin: (note: PenNote) => void;
}

export const NoteCard: React.FC<Props> = ({ note, onEdit, onDelete, onTogglePin }) => {
  const date = new Date(note.updatedAt);
  const dateStr = `${date.getFullYear()}.${String(date.getMonth()+1).padStart(2,'0')}.${String(date.getDate()).padStart(2,'0')}`;
  const timeStr = `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;

  const bgColor = note.paperType==='black'?'#1a1a1a':note.paperType==='yellow'?'#fef9c3':'#ffffff';
  const textColor = note.paperType==='black'?'#e2e8f0':'#1c1917';

  return (
    <div className="group relative rounded-2xl overflow-hidden border border-stone-200 dark:border-slate-700 shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer active:scale-[0.98] flex flex-col"
      style={{backgroundColor:bgColor}}
      onClick={() => onEdit(note)}>

      {/* Thumbnail */}
      <div className="relative aspect-[3/4] overflow-hidden">
        {note.dataUrl ? (
          <img src={note.dataUrl} alt={note.title||'노트'} className="w-full h-full object-cover object-top" loading="lazy"/>
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{backgroundColor:bgColor}}>
            <span className="text-4xl opacity-20">✏️</span>
          </div>
        )}
        {/* Pin badge */}
        {note.isPinned && (
          <div className="absolute top-2 left-2 w-6 h-6 bg-amber-400 rounded-full flex items-center justify-center shadow-md">
            <Pin className="w-3 h-3 text-stone-900 fill-stone-900"/>
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all duration-200 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
          <button type="button" onClick={e=>{e.stopPropagation();onEdit(note);}}
            className="w-9 h-9 bg-white/90 rounded-xl flex items-center justify-center shadow-lg hover:bg-white cursor-pointer">
            <Edit2 className="w-4 h-4 text-purple-600"/>
          </button>
          <button type="button" onClick={e=>{e.stopPropagation();onTogglePin(note);}}
            className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-lg cursor-pointer ${note.isPinned?'bg-amber-400/90 hover:bg-amber-400':'bg-white/90 hover:bg-white'}`}>
            <Pin className={`w-4 h-4 ${note.isPinned?'text-stone-900 fill-stone-900':'text-amber-600'}`}/>
          </button>
          <button type="button" onClick={e=>{e.stopPropagation();if(confirm('이 노트를 삭제할까요?'))onDelete(note.id);}}
            className="w-9 h-9 bg-red-500/90 rounded-xl flex items-center justify-center shadow-lg hover:bg-red-500 cursor-pointer">
            <Trash2 className="w-4 h-4 text-white"/>
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="px-2.5 py-2 flex-1" style={{backgroundColor:bgColor}}>
        <div className="text-xs font-black truncate mb-0.5" style={{color:textColor}}>
          {note.title || '제목 없음'}
        </div>
        {note.ocrText && (
          <div className="text-[10px] opacity-60 line-clamp-2 leading-tight mb-1" style={{color:textColor}}>
            {note.ocrText}
          </div>
        )}
        <div className="text-[10px] opacity-50 font-bold" style={{color:textColor}}>
          {dateStr} {timeStr}
        </div>
      </div>
    </div>
  );
};
