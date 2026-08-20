import React, { useState, useEffect } from 'react';
import { X, Key, Download, Upload, Trash2, Check, Lock, LockOpen, ShieldCheck } from 'lucide-react';
import { exportAllNotes, importNotes } from '../lib/storage';
import { PatternInput, PinInput, hashSecret, LOCK_KEY, TYPE_KEY, HASH_KEY, HINT_KEY } from './LockScreen';

interface Props {
  onClose: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
}

type LockStep =
  | 'idle'           // show main security panel
  | 'choose_type'    // pick pattern or PIN
  | 'set_pattern'    // draw new pattern
  | 'confirm_pattern'// confirm the new pattern
  | 'set_pin'        // enter new PIN
  | 'confirm_pin'    // confirm the new PIN
  | 'verify_old';    // verify existing lock before changing

export const SettingsModal: React.FC<Props> = ({ onClose, darkMode, onToggleDark }) => {
  const [apiKey,       setApiKey]       = useState('');
  const [visionKey,    setVisionKey]    = useState('');
  const [saved,        setSaved]        = useState(false);
  const [importMsg, setImportMsg] = useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  // ── Security state ──────────────────────────────────────────────────────
  const [lockEnabled, setLockEnabled] = useState(() => localStorage.getItem(LOCK_KEY) === 'true');
  const [lockType,    setLockType]    = useState<'pattern'|'pin'>(() => (localStorage.getItem(TYPE_KEY)||'pattern') as 'pattern'|'pin');
  const [lockStep,    setLockStep]    = useState<LockStep>('idle');
  const [lockHint,    setLockHint]    = useState(() => localStorage.getItem(HINT_KEY) || '');
  const [firstVal,    setFirstVal]    = useState('');  // first entry (for confirm)
  const [lockErr,     setLockErr]     = useState('');
  const [lockOk,      setLockOk]      = useState('');

  // ── ML Kit 모델 다운로드 ────────────────────────────────────────────────────
  const [inkModelStatus, setInkModelStatus] = useState<'idle'|'loading'|'done'|'error'>('idle');
  const [inkModelMsg,    setInkModelMsg]    = useState('');

  const handleDownloadInkModel = async () => {
    setInkModelStatus('loading');
    setInkModelMsg('⏳ 한국어 손글씨 모델 다운로드 중...');
    try {
      const { downloadInkModel } = await import('../lib/inkOcr');
      await downloadInkModel('ko-KR');
      setInkModelStatus('done');
      setInkModelMsg('✅ 한국어 모델 다운로드 완료! 이제 오프라인에서도 인식됩니다.');
    } catch (e: any) {
      setInkModelStatus('error');
      setInkModelMsg(`❌ 실패: ${e?.message ?? '알 수 없는 오류'}`);
    }
  };

  const isNativeAndroid = (): boolean => {
    try { return (window as any)?.Capacitor?.getPlatform?.() === 'android'; } catch { return false; }
  };

  useEffect(() => {
    setApiKey(localStorage.getItem('damoa_gemini_api_key') || '');
    setVisionKey(localStorage.getItem('damoa_vision_api_key') || '');
  }, []);

  const saveKey = () => {
    if (apiKey.trim()) localStorage.setItem('damoa_gemini_api_key', apiKey.trim());
    else localStorage.removeItem('damoa_gemini_api_key');
    if (visionKey.trim()) localStorage.setItem('damoa_vision_api_key', visionKey.trim());
    else localStorage.removeItem('damoa_vision_api_key');
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

  // ── Lock helpers ────────────────────────────────────────────────────────
  const saveLock = (hash: string, type: 'pattern'|'pin') => {
    localStorage.setItem(LOCK_KEY, 'true');
    localStorage.setItem(TYPE_KEY, type);
    localStorage.setItem(HASH_KEY, hash);
    localStorage.setItem(HINT_KEY, lockHint);
    setLockEnabled(true); setLockType(type);
    setLockStep('idle'); setFirstVal(''); setLockErr('');
    setLockOk(type === 'pattern' ? '✅ 패턴 잠금이 설정되었습니다!' : '✅ PIN 잠금이 설정되었습니다!');
    setTimeout(() => setLockOk(''), 3000);
  };

  const disableLock = () => {
    localStorage.removeItem(LOCK_KEY);
    localStorage.removeItem(TYPE_KEY);
    localStorage.removeItem(HASH_KEY);
    localStorage.removeItem(HINT_KEY);
    setLockEnabled(false); setLockStep('idle');
    setLockOk('🔓 잠금이 해제되었습니다.'); setTimeout(() => setLockOk(''), 2000);
  };

  // Pattern flow
  const onFirstPattern = (pattern: number[]) => {
    setFirstVal(pattern.join(',')); setLockStep('confirm_pattern'); setLockErr('');
  };
  const onConfirmPattern = (pattern: number[]) => {
    if (pattern.join(',') === firstVal) {
      saveLock(hashSecret(firstVal), 'pattern');
    } else {
      setLockErr('패턴이 일치하지 않습니다. 다시 시도하세요.'); setLockStep('set_pattern'); setFirstVal('');
    }
  };

  // PIN flow
  const onFirstPin = (pin: string) => {
    setFirstVal(pin); setLockStep('confirm_pin'); setLockErr('');
  };
  const onConfirmPin = (pin: string) => {
    if (pin === firstVal) {
      saveLock(hashSecret(firstVal), 'pin');
    } else {
      setLockErr('PIN이 일치하지 않습니다. 다시 시도하세요.'); setLockStep('set_pin'); setFirstVal('');
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

          {/* ── ML Kit 오프라인 모델 ── */}
          {isNativeAndroid() && (
            <div>
              <div className="text-xs font-extrabold text-stone-400 dark:text-slate-500 uppercase tracking-wider mb-3">오프라인 한글 인식 모델</div>
              <div className="space-y-2">
                <p className="text-[11px] text-stone-400 dark:text-slate-500">
                  ML Kit 한국어 손글씨 모델을 미리 다운로드합니다. 이후 인터넷 없이도 AI 인식이 가능합니다.
                </p>
                <button
                  type="button"
                  disabled={inkModelStatus === 'loading' || inkModelStatus === 'done'}
                  onClick={handleDownloadInkModel}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border cursor-pointer transition-colors
                    ${inkModelStatus === 'done'
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                      : inkModelStatus === 'error'
                      ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800'
                      : 'bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800 hover:bg-purple-100 dark:hover:bg-purple-950/60'}
                    disabled:opacity-60`}>
                  <Download className={`w-4 h-4 shrink-0 ${inkModelStatus === 'done' ? 'text-emerald-600' : inkModelStatus === 'error' ? 'text-red-600' : 'text-purple-600'}`}/>
                  <div className="text-left">
                    <div className={`font-black text-sm ${inkModelStatus === 'done' ? 'text-emerald-900 dark:text-emerald-200' : inkModelStatus === 'error' ? 'text-red-900 dark:text-red-200' : 'text-purple-900 dark:text-purple-200'}`}>
                      {inkModelStatus === 'loading' ? '다운로드 중...'
                        : inkModelStatus === 'done' ? '다운로드 완료'
                        : inkModelStatus === 'error' ? '다시 시도'
                        : '한국어 손글씨 모델 다운로드'}
                    </div>
                    <div className={`text-[11px] ${inkModelStatus === 'done' ? 'text-emerald-600' : inkModelStatus === 'error' ? 'text-red-500' : 'text-purple-600 dark:text-purple-400'}`}>
                      {inkModelMsg || 'Wi-Fi 연결 후 클릭하세요 (약 20~30MB)'}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

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

          {/* Google Cloud Vision API Key */}
          <div>
            <div className="text-xs font-extrabold text-stone-400 dark:text-slate-500 uppercase tracking-wider mb-1">
              Google Cloud Vision API 키 (손글씨 보완 인식)
            </div>
            <p className="text-[11px] text-stone-400 dark:text-slate-500 mb-3">
              인터넷 연결 시 저장할 때 손글씨를 Cloud Vision으로 추가 인식합니다.
              오프라인 ML Kit 결과를 보완하며, 한국어 인식률이 크게 향상됩니다.{'\n'}
              Google Cloud Console → Vision API 활성화 → API 키 생성 (월 1,000건 무료)
            </p>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-2xl px-3 gap-2 overflow-hidden">
                <Key className="w-4 h-4 text-blue-400 shrink-0"/>
                <input type="password" value={visionKey} onChange={e=>setVisionKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 bg-transparent text-sm font-mono outline-none py-3 text-stone-800 dark:text-slate-200 placeholder-stone-300"
                  style={{touchAction:'auto'}} onPointerDown={e=>e.stopPropagation()}/>
              </div>
              <button type="button" onClick={saveKey}
                className={`px-4 rounded-2xl font-black text-sm cursor-pointer flex items-center gap-1.5 ${saved?'bg-emerald-500 text-white':'bg-blue-600 hover:bg-blue-700 text-white'}`}>
                {saved ? <><Check className="w-4 h-4"/>저장됨</> : '저장'}
              </button>
            </div>
            {visionKey && (
              <p className="text-[11px] text-emerald-600 font-bold mt-1.5">✅ Cloud Vision 키 설정됨 — 저장 시 자동으로 보완 인식합니다.</p>
            )}
          </div>

          {/* ── Security ── */}
          <div>
            <div className="text-xs font-extrabold text-stone-400 dark:text-slate-500 uppercase tracking-wider mb-3">보안 잠금</div>

            {lockOk && (
              <p className="text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 rounded-xl px-3 py-2 mb-3">{lockOk}</p>
            )}
            {lockErr && (
              <p className="text-xs font-bold text-red-500 bg-red-50 dark:bg-red-950/40 rounded-xl px-3 py-2 mb-3">{lockErr}</p>
            )}

            {lockStep === 'idle' && (
              <div className="space-y-2">
                {/* Status row */}
                <div className="flex items-center justify-between px-4 py-3 bg-stone-50 dark:bg-slate-800 rounded-2xl border border-stone-200 dark:border-slate-700">
                  <div className="flex items-center gap-2.5">
                    {lockEnabled
                      ? <Lock className="w-4 h-4 text-purple-600"/>
                      : <LockOpen className="w-4 h-4 text-stone-400"/>}
                    <div>
                      <div className="font-black text-sm text-stone-800 dark:text-slate-200">
                        {lockEnabled ? `잠금 설정됨 (${lockType === 'pattern' ? '패턴' : 'PIN'})` : '잠금 없음'}
                      </div>
                      {lockEnabled && (
                        <div className="text-[11px] text-stone-400 dark:text-slate-500">앱 시작 시 잠금 화면 표시</div>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs font-black px-2.5 py-1 rounded-xl ${lockEnabled ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300' : 'bg-stone-100 text-stone-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                    {lockEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>

                {/* Action buttons */}
                {!lockEnabled ? (
                  <button type="button" onClick={() => { setLockStep('choose_type'); setLockErr(''); }}
                    className="w-full flex items-center gap-3 px-4 py-3 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-2xl hover:bg-purple-100 cursor-pointer">
                    <ShieldCheck className="w-4 h-4 text-purple-600"/>
                    <div className="text-left">
                      <div className="font-black text-sm text-purple-900 dark:text-purple-200">잠금 설정하기</div>
                      <div className="text-[11px] text-purple-600 dark:text-purple-400">패턴 또는 PIN 선택</div>
                    </div>
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setLockStep('choose_type'); setLockErr(''); setFirstVal(''); }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-xl hover:bg-purple-100 cursor-pointer text-xs font-black text-purple-700 dark:text-purple-300">
                      <Lock className="w-3.5 h-3.5"/> 변경
                    </button>
                    <button type="button" onClick={disableLock}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-xl hover:bg-red-100 cursor-pointer text-xs font-black text-red-600">
                      <LockOpen className="w-3.5 h-3.5"/> 잠금 해제
                    </button>
                  </div>
                )}
              </div>
            )}

            {lockStep === 'choose_type' && (
              <div className="space-y-2">
                <p className="text-sm font-bold text-stone-700 dark:text-slate-300 text-center mb-3">잠금 방식 선택</p>
                <button type="button" onClick={() => { setLockType('pattern'); setLockStep('set_pattern'); setLockErr(''); }}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-2xl hover:bg-purple-100 cursor-pointer">
                  <span className="text-2xl">🔲</span>
                  <div>
                    <div className="font-black text-sm text-purple-900 dark:text-purple-200">패턴 잠금</div>
                    <div className="text-[11px] text-purple-600 dark:text-purple-400">3×3 격자에 패턴 그리기</div>
                  </div>
                </button>
                <button type="button" onClick={() => { setLockType('pin'); setLockStep('set_pin'); setLockErr(''); }}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-2xl hover:bg-blue-100 cursor-pointer">
                  <span className="text-2xl">🔢</span>
                  <div>
                    <div className="font-black text-sm text-blue-900 dark:text-blue-200">PIN 잠금</div>
                    <div className="text-[11px] text-blue-600 dark:text-blue-400">6자리 숫자 입력</div>
                  </div>
                </button>
                <button type="button" onClick={() => setLockStep('idle')}
                  className="w-full text-xs font-bold text-stone-400 hover:text-stone-600 cursor-pointer py-1 text-center">
                  취소
                </button>
              </div>
            )}

            {(lockStep === 'set_pattern' || lockStep === 'confirm_pattern') && (
              <div className="flex flex-col items-center gap-2">
                <PatternInput
                  onComplete={lockStep === 'set_pattern' ? onFirstPattern : onConfirmPattern}
                  label={lockStep === 'set_pattern' ? '새 패턴을 그려주세요 (최소 4개 점)' : '패턴을 한 번 더 그려주세요'}
                  minDots={4}
                />
                {/* Hint */}
                {lockStep === 'set_pattern' && (
                  <div className="w-full mt-1">
                    <input value={lockHint} onChange={e => setLockHint(e.target.value)}
                      placeholder="힌트 (선택사항, 잠금 화면에 표시됨)"
                      className="w-full text-xs px-3 py-2 bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl outline-none text-stone-700 dark:text-slate-300 placeholder-stone-300"/>
                  </div>
                )}
                <button type="button" onClick={() => { setLockStep('idle'); setFirstVal(''); setLockErr(''); }}
                  className="text-xs font-bold text-stone-400 hover:text-stone-600 cursor-pointer">취소</button>
              </div>
            )}

            {(lockStep === 'set_pin' || lockStep === 'confirm_pin') && (
              <div className="flex flex-col items-center gap-2">
                <PinInput
                  onComplete={lockStep === 'set_pin' ? onFirstPin : onConfirmPin}
                  label={lockStep === 'set_pin' ? '새 PIN 6자리를 입력하세요' : 'PIN을 한 번 더 입력하세요'}
                  length={6}
                />
                {lockStep === 'set_pin' && (
                  <div className="w-full mt-1">
                    <input value={lockHint} onChange={e => setLockHint(e.target.value)}
                      placeholder="힌트 (선택사항)"
                      className="w-full text-xs px-3 py-2 bg-stone-50 dark:bg-slate-800 border border-stone-200 dark:border-slate-700 rounded-xl outline-none text-stone-700 dark:text-slate-300 placeholder-stone-300"/>
                  </div>
                )}
                <button type="button" onClick={() => { setLockStep('idle'); setFirstVal(''); setLockErr(''); }}
                  className="text-xs font-bold text-stone-400 hover:text-stone-600 cursor-pointer">취소</button>
              </div>
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
