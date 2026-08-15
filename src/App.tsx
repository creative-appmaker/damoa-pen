import React, { useState, useEffect, useCallback } from 'react';
import { PenNote } from './types';
import { getAllNotes, saveNote, deleteNote } from './lib/storage';
import { PenCanvas } from './components/PenCanvas';
import { NoteList } from './components/NoteList';
import { SettingsModal } from './components/SettingsModal';
import { LockScreen, LOCK_KEY } from './components/LockScreen';

type View = 'list' | 'canvas';

export default function App() {
  const [notes, setNotes] = useState<PenNote[]>([]);
  const [view, setView] = useState<View>('list');
  const [editingNote, setEditingNote] = useState<PenNote | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isLocked,  setIsLocked]  = useState(() => localStorage.getItem(LOCK_KEY) === 'true');
  const [darkMode, setDarkMode] = useState(() => {
    const stored = localStorage.getItem('damoa_pen_dark');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('damoa_pen_dark', String(darkMode));
  }, [darkMode]);

  const loadNotes = useCallback(async () => {
    const all = await getAllNotes();
    setNotes(all);
  }, []);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const handleNew = () => {
    setEditingNote(null);
    setView('canvas');
  };

  const handleEdit = (note: PenNote) => {
    setEditingNote(note);
    setView('canvas');
  };

  const handleSave = async (
    dataUrl: string,
    ocrText: string,
    title: string,
    paperType: 'white' | 'yellow' | 'black',
    id?: string,
  ) => {
    const now = Date.now();
    const note: PenNote = {
      id: id || `note-${now}-${Math.random().toString(36).slice(2)}`,
      title: title || `손글씨 노트 ${new Date(now).toLocaleDateString('ko-KR')}`,
      dataUrl,
      ocrText,
      createdAt: editingNote?.createdAt ?? now,
      updatedAt: now,
      isPinned: editingNote?.isPinned ?? false,
      paperType,
    };
    await saveNote(note);
    await loadNotes();
    setView('list');
    setEditingNote(null);
  };

  const handleDelete = async (noteId: string) => {
    await deleteNote(noteId);
    await loadNotes();
  };

  const handleTogglePin = async (note: PenNote) => {
    await saveNote({ ...note, isPinned: !note.isPinned, updatedAt: Date.now() });
    await loadNotes();
  };

  const handleBack = () => {
    setView('list');
    setEditingNote(null);
  };

  return (
    <div className="h-dvh overflow-hidden bg-stone-50 dark:bg-slate-950 text-stone-900 dark:text-slate-100">
      {isLocked && <LockScreen onUnlock={() => setIsLocked(false)}/>}
      {view === 'list' ? (
        <NoteList
          notes={notes}
          onNew={handleNew}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onTogglePin={handleTogglePin}
          onSettings={() => setShowSettings(true)}
          darkMode={darkMode}
        />
      ) : (
        <PenCanvas
          editingNote={editingNote}
          darkMode={darkMode}
          onSave={handleSave}
          onBack={handleBack}
        />
      )}

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
