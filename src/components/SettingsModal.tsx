import React, { useState, useEffect } from 'react';
import { X, Key, Download, Upload, Trash2, Check } from 'lucide-react';
import { exportAllNotes, importNotes } from '../lib/storage';

interface Props {
  onClose: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
}

export const SettingsModal: React.FC<Props> = ({ onClose, darkMode, onToggleDark }) => {
  const [apiKey, setApiKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    setApiKey(localStorage.getItem('damoa_gemini_api_key') || '');
  }, []);

  const saveKey = () => {
    if (apiKey.trim()) localStorage.setItem('damoa_gemini_api_key', apiKey.trim());
    else localStorage.removeItem('damoa_gemini_api_key');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleExport = async () => {
    const json = await exportAllNotes();
    const blob = new Blob([json], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `damoa-pen-backup-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      await importNotes(text);
      setImportMsg('✅ 가져오기 완료! 페이지를 새로고침하세요.');
    } catch {
      setImportMsg('❌ 파일 형식이 올바르지 않습니다.');
    }
  };

  const handleClearAll = async () => {
    if (!confirm('모든 노트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    const { deleteNote, getAllNotes } = await import('../lib/storage');
    const notes = await getAllNotes();
    for (const n of notes) await deleteNote(n.id);
    setImportMsg('✅ 모든 노트가 삭제되었습니다. 페이지를 새로고침하세요.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl shadow-2xl overflow-hidden" onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-slate-700">
          <h2 className="font-black text-lg text-stone-900 dark:text-slate-100">⚙️ 설정</h2>
          <button type="button" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-stone-100 dark:hover:bg-slate-800 cursor-pointer">
            <X className="w-5 h-5 text-stone-500"/>
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Theme */}
          <div>
            <div className="text-xs font-extrabold text-stone-400 dark:text-slate-500 uppercase tracking-wider mb-3">화면 테마</div>
            <button type="button" onClick={onToggleDark}
              className="w-full flex items-center justify-between px-4 py-3 bg-stone-50 dark:bg-slate-800 rounded-2xl border border-stone-200 dark:border-slate-700 cursor-pointer hover:bg-stone-100 dark:hover:bg-slate-700">
              <span className="font-bold text-sm text-stone-800 dark:text-slate-200">{darkMode?'🌙 다크 모드':'☀️ 라이트 모드'}</span>
              <span className={`text-xs font-black px-2.5 py-1 rounded-xl ${darkMode?'bg-slate-700 text-slate-200':'bg-amber-100 text-amber-800'}`}>
                {darkMode?'ON':'OFF'}
              </span>
            </button>
          </div>

          {/* Gemini API Key */}
          <div>
            <div className="text-xs font-extrabold text-stone-400 dark:text-slate-500 uppercase tracking-wider mb-1">Gemini API 키 (웹 OCR)</div>
            <p className="text-[11px] text-stone-400 dark:text-slate-500 mb-3">
              안드로이드 앱은 오프라인 ML Kit 사용. 웹 버전에서 AI 인식이 필요한 경우에만 입력하세요.
            </p>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-2xl px-3 gap-2 overflow-hidden">
                <Key className="w-4 h-4 text-stone-400 shrink-0"/>
                <input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 bg-transparent text-sm font-mono outline-none py-3 text-stone-800 dark:text-slate-200 placeholder-stone-300"/>
              </div>
              <button type="button" onClick={saveKey}
                className={`px-4 rounded-2xl font-black text-sm cursor-pointer flex items-center gap-1.5 ${saved?'bg-emerald-500 text-white':'bg-purple-600 hover:bg-purple-700 text-white'}`}>
                {saved ? <><Check className="w-4 h-4"/>저장됨</> : '저장'}
              </button>
            </div>
            {apiKey && (
              <p className="text-[11px] text-emerald-600 font-bold mt-1.5">✅ API 키가 설정되어 있습니다.</p>
            )}
          </div>

          {/* Backup */}
          <div>
            <div className="text-xs font-extrabold text-stone-400 dark:text-slate-500 uppercase tracking-wider mb-3">백업 & 복구</div>
            <div className="space-y-2">
              <button type="button" onClick={handleExport}
                className="w-full flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-2xl hover:bg-blue-100 dark:hover:bg-blue-950/60 cursor-pointer">
                <Download className="w-4 h-4 text-blue-600"/>
                <div className="text-left">
                  <div className="font-black text-sm text-blue-900 dark:text-blue-200">내보내기 (JSON)</div>
                  <div className="text-[11px] text-blue-600 dark:text-blue-400">모든 노트를 JSON 파일로 저장</div>
                </div>
              </button>
              <button type="button" onClick={() => fileRef.current?.click()}
                className="w-full flex items-center gap-3 px-4 py-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl hover:bg-emerald-100 dark:hover:bg-emerald-950/60 cursor-pointer">
                <Upload className="w-4 h-4 text-emerald-600"/>
                <div className="text-left">
                  <div className="font-black text-sm text-emerald-900 dark:text-emerald-200">가져오기 (JSON)</div>
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400">백업 파일에서 노트 복구</div>
                </div>
              </button>
              <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImport}/>
              {importMsg && (
                <p className="text-[11px] font-bold text-center px-2 py-1.5 bg-stone-100 dark:bg-slate-800 rounded-xl text-stone-700 dark:text-slate-300">{importMsg}</p>
              )}
              <button type="button" onClick={handleClearAll}
                className="w-full flex items-center gap-3 px-4 py-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-2xl hover:bg-red-100 dark:hover:bg-red-950/60 cursor-pointer">
                <Trash2 className="w-4 h-4 text-red-600"/>
                <div className="text-left">
                  <div className="font-black text-sm text-red-900 dark:text-red-200">모든 노트 삭제</div>
                  <div className="text-[11px] text-red-600 dark:text-red-400">주의: 복구 불가</div>
                </div>
              </button>
            </div>
          </div>

          {/* Version */}
          <div className="text-center text-[11px] text-stone-300 dark:text-slate-600 font-bold">
            다모아 펜 V1.0 · 로컬 저장 손글씨 앱
          </div>
        </div>
      </div>
    </div>
  );
};
