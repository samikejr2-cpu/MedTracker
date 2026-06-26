import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from './firebase.js';
import { parseCalendarCsv, todayISO } from './csvImport.js';

const CORE_TASKS = [
  { key: 'watched', label: 'Watched lecture', group: 'Core' },
  { key: 'notes', label: 'Took notes', group: 'Core' },
  { key: 'anki', label: 'Made Anki', group: 'Core' },
  { key: 'pass1', label: 'First pass', group: 'Core' },
  { key: 'pass2', label: 'Second pass', group: 'Core' }
];

const BOARD_TASKS = [
  { key: 'boardVideo', label: 'Board video/resource', group: 'Board' },
  { key: 'firstAid', label: 'First Aid / board notes', group: 'Board' },
  { key: 'questions', label: 'Question bank set', group: 'Board' },
  { key: 'missedReview', label: 'Missed questions reviewed', group: 'Board' }
];

const PRACTICAL_TASKS = [
  { key: 'structures', label: 'Structures reviewed', group: 'Practical' },
  { key: 'labManual', label: 'Lab manual reviewed', group: 'Practical' },
  { key: 'practicePractical', label: 'Practice practical done', group: 'Practical' },
  { key: 'weakSpots', label: 'Weak structures marked', group: 'Practical' }
];

const PRIORITIES = ['high', 'medium', 'low'];
const LECTURE_TYPES = ['lecture', 'sdl', 'lab', 'practical', 'exam'];

const DEFAULT_DASHBOARD_WIDGETS = [
  { id: 'todayPlan', label: "Today's Plan", enabled: true },
  { id: 'pomodoro', label: 'Pomodoro Focus Timer', enabled: true },
  { id: 'qbank', label: 'Board Questions Tracker', enabled: true },
  { id: 'examCards', label: 'Exam Countdown + Readiness', enabled: true },
  { id: 'overdue', label: 'Overdue Lectures', enabled: true },
  { id: 'catchUp', label: 'Smart Catch-Up Planner', enabled: true },
  { id: 'progress', label: 'Progress Bars', enabled: true },
  { id: 'weeklyView', label: 'Weekly View', enabled: true },
  { id: 'weeklyReport', label: 'Weekly Report', enabled: true },
  { id: 'selectedDay', label: 'Selected Day Lectures', enabled: true },
  { id: 'allLectures', label: 'All Saved Lectures Fallback', enabled: true },
  { id: 'importer', label: 'CSV Import + Manual Lecture', enabled: true }
];

const THEME_PRESETS = {
  midnight: {
    name: 'Midnight Blue',
    bg: '#070b14',
    panel: 'rgba(15, 23, 42, 0.94)',
    panel2: 'rgba(20, 31, 54, 0.88)',
    accent: '#38bdf8',
    blue: '#3b82f6',
    purple: '#7c3aed',
    cyan: '#2dd4bf',
    orange: '#fb923c',
    success: '#22c55e',
    danger: '#f87171',
    text: '#eef4ff',
    muted: '#9fb0ce'
  },
  forest: {
    name: 'Forest Green',
    bg: '#06110d',
    panel: 'rgba(10, 28, 21, 0.94)',
    panel2: 'rgba(15, 45, 34, 0.9)',
    accent: '#34d399',
    blue: '#10b981',
    purple: '#84cc16',
    cyan: '#2dd4bf',
    orange: '#f59e0b',
    success: '#22c55e',
    danger: '#fb7185',
    text: '#ecfdf5',
    muted: '#a7f3d0'
  },
  aubergine: {
    name: 'Aubergine',
    bg: '#140819',
    panel: 'rgba(38, 18, 47, 0.94)',
    panel2: 'rgba(58, 24, 70, 0.9)',
    accent: '#f0abfc',
    blue: '#a855f7',
    purple: '#d946ef',
    cyan: '#67e8f9',
    orange: '#fb923c',
    success: '#4ade80',
    danger: '#fb7185',
    text: '#fff7ff',
    muted: '#e9d5ff'
  },
  slate: {
    name: 'Clean Slate',
    bg: '#0f172a',
    panel: 'rgba(30, 41, 59, 0.94)',
    panel2: 'rgba(51, 65, 85, 0.9)',
    accent: '#e2e8f0',
    blue: '#94a3b8',
    purple: '#64748b',
    cyan: '#cbd5e1',
    orange: '#fbbf24',
    success: '#86efac',
    danger: '#fca5a5',
    text: '#f8fafc',
    muted: '#cbd5e1'
  }
};

const DEFAULT_THEME = THEME_PRESETS.midnight;

function safeStorageGet(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage can fail in private browsing. The app should still work.
  }
}

function useLocalStorageState(key, fallback) {
  const [value, setValue] = useState(() => safeStorageGet(key, fallback));
  useEffect(() => {
    safeStorageSet(key, value);
  }, [key, value]);
  return [value, setValue];
}

function mergeWidgetSettings(saved) {
  const savedMap = new Map((Array.isArray(saved) ? saved : []).map((item) => [item.id, item]));
  const merged = DEFAULT_DASHBOARD_WIDGETS.map((item) => ({ ...item, ...(savedMap.get(item.id) || {}) }));
  const unknown = (Array.isArray(saved) ? saved : []).filter((item) => item?.id && !DEFAULT_DASHBOARD_WIDGETS.some((known) => known.id === item.id));
  return [...merged, ...unknown];
}

function tasksForLecture(lecture) {
  const typeText = `${lecture.lectureType || ''} ${lecture.title || ''} ${lecture.course || ''}`.toLowerCase();
  const practical = typeText.includes('lab') || typeText.includes('practical') || typeText.includes('anatomy') || typeText.includes('omm');
  return practical ? [...CORE_TASKS, ...BOARD_TASKS, ...PRACTICAL_TASKS] : [...CORE_TASKS, ...BOARD_TASKS];
}

function makeJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function toLocalDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function isoFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function shiftISODate(iso, delta) {
  const date = toLocalDate(iso || todayISO()) || new Date();
  date.setDate(date.getDate() + delta);
  return isoFromDate(date);
}

function startOfWeekISO(iso) {
  const date = toLocalDate(iso || todayISO()) || new Date();
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return isoFromDate(date);
}

function weekDates(iso) {
  const start = toLocalDate(startOfWeekISO(iso));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return isoFromDate(date);
  });
}

function niceDate(iso, short = false) {
  if (!iso) return '';
  const date = toLocalDate(iso);
  if (!date) return iso;
  return date.toLocaleDateString(undefined, short
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function daysBetween(fromIso, toIso) {
  const from = toLocalDate(fromIso);
  const to = toLocalDate(toIso);
  if (!from || !to) return null;
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  return Math.round((to - from) / 86400000);
}

function timeLabel(start, end) {
  if (!start && !end) return 'No time listed';
  return `${start || ''}${end ? ` – ${end}` : ''}`;
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function completionPercent(lecture, progress) {
  const tasks = tasksForLecture(lecture);
  if (tasks.length === 0) return 0;
  const done = tasks.filter((task) => progress?.[task.key]).length;
  return Math.round((done / tasks.length) * 100);
}

function taskCountsForLectures(lectures, progress) {
  let done = 0;
  let total = 0;
  lectures.forEach((lecture) => {
    const tasks = tasksForLecture(lecture);
    total += tasks.length;
    done += tasks.filter((task) => progress[lecture.id]?.[task.key]).length;
  });
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

function groupProgress(lectures, progress, key) {
  const groups = new Map();
  lectures.forEach((lecture) => {
    const label = lecture[key] || `No ${key}`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(lecture);
  });
  return Array.from(groups.entries())
    .map(([label, items]) => ({ label, count: items.length, ...taskCountsForLectures(items, progress) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function commitDeletesInChunks(refs) {
  const chunkSize = 450;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = writeBatch(db);
    refs.slice(i, i + chunkSize).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

function ProgressBar({ value }) {
  return (
    <div className="progress-wrap" aria-label={`${value}% complete`}>
      <div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, value || 0))}%` }} />
    </div>
  );
}

function MissingFirebase() {
  return (
    <main className="app-shell centered">
      <section className="setup-card">
        <p className="eyebrow">Firebase setup needed</p>
        <h1>Add your Firebase config in StackBlitz environment variables or <code>.env</code>.</h1>
        <p>Paste the six Firebase web app values from Firebase Console → Project settings → General → Your apps → Web app.</p>
        <pre>{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...`}</pre>
      </section>
    </main>
  );
}

function AuthScreen() {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'create') {
        const credential = await createUserWithEmailAndPassword(auth, normalizeEmail(email), password);
        await updateProfile(credential.user, { displayName: username.trim() || normalizeEmail(email) });
        await setDoc(doc(db, 'users', credential.user.uid), {
          uid: credential.user.uid,
          username: username.trim() || normalizeEmail(email),
          email: normalizeEmail(email),
          createdAt: serverTimestamp()
        }, { merge: true });
      } else {
        await signInWithEmailAndPassword(auth, normalizeEmail(email), password);
      }
    } catch (err) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="hero-panel">
        <p className="eyebrow">Med School Tracker</p>
        <h1>Lecture progress that follows you from PC to iPad.</h1>
        <p className="subcopy">
          Import your block calendar CSV, plan catch-up work, track exam readiness, and keep lecture progress synced across devices.
        </p>
        <div className="feature-list">
          <span>☁️ Firebase sync across devices</span>
          <span>📆 Weekly plan + overdue tracker</span>
          <span>🧠 Exam, board, and practical checklists</span>
        </div>
      </section>

      <section className="auth-card">
        <div className="tab-row">
          <button className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>Log in</button>
          <button className={mode === 'create' ? 'tab active' : 'tab'} onClick={() => setMode('create')}>Create account</button>
        </div>
        <form onSubmit={handleSubmit} className="form-stack">
          {mode === 'create' && (
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Papi Mike" required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} placeholder="Minimum 6 characters" required />
          </label>
          <button className="primary-btn" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Log in' : 'Create account'}</button>
          {error && <p className="error-text">{error}</p>}
        </form>
      </section>
    </main>
  );
}

function WorkspaceSidebar({ user, workspaces, selectedId, onSelect }) {
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function createWorkspace(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const code = makeJoinCode();
      const wid = code;
      await setDoc(doc(db, 'workspaces', wid), {
        id: wid,
        name: name.trim(),
        ownerId: user.uid,
        joinCode: code,
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, 'workspaces', wid, 'members', user.uid), {
        userId: user.uid,
        role: 'owner',
        email: user.email,
        username: user.displayName || user.email,
        joinCode: code,
        joinedAt: serverTimestamp()
      });
      await setDoc(doc(db, 'users', user.uid, 'workspaces', wid), {
        workspaceId: wid,
        name: name.trim(),
        role: 'owner',
        joinCode: code,
        joinedAt: serverTimestamp()
      });
      setName('');
      onSelect(wid);
    } catch (err) {
      setMessage(err.message || 'Could not create workspace.');
    } finally {
      setBusy(false);
    }
  }

  async function joinWorkspace(e) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setBusy(true);
    setMessage('');
    try {
      const workspaceSnap = await getDoc(doc(db, 'workspaces', code));
      if (!workspaceSnap.exists()) throw new Error('No workspace found with that code.');
      const workspace = workspaceSnap.data();
      const batch = writeBatch(db);
      batch.set(doc(db, 'workspaces', code, 'members', user.uid), {
        userId: user.uid,
        role: 'member',
        email: user.email,
        username: user.displayName || user.email,
        joinCode: code,
        joinedAt: serverTimestamp()
      }, { merge: true });
      batch.set(doc(db, 'users', user.uid, 'workspaces', code), {
        workspaceId: code,
        name: workspace.name,
        role: 'member',
        joinCode: code,
        joinedAt: serverTimestamp()
      }, { merge: true });
      await batch.commit();
      setJoinCode('');
      onSelect(code);
    } catch (err) {
      setMessage(err.message || 'Could not join workspace.');
    } finally {
      setBusy(false);
    }
  }

  async function deleteOrLeaveWorkspace(workspace) {
    const wid = workspace.workspaceId;
    const isOwner = workspace.role === 'owner';
    const prompt = isOwner
      ? `Delete "${workspace.name}" for everyone? This removes its lectures, members, and progress.`
      : `Leave "${workspace.name}"? Your progress for this block will no longer show in your account.`;
    if (!window.confirm(prompt)) return;

    setBusy(true);
    setMessage('');
    try {
      if (isOwner) {
        const [lecturesSnap, progressSnap, membersSnap] = await Promise.all([
          getDocs(collection(db, 'workspaces', wid, 'lectures')),
          getDocs(collection(db, 'workspaces', wid, 'progress')),
          getDocs(collection(db, 'workspaces', wid, 'members'))
        ]);
        const refsToDelete = [];
        lecturesSnap.forEach((snap) => refsToDelete.push(snap.ref));
        progressSnap.forEach((snap) => refsToDelete.push(snap.ref));
        membersSnap.forEach((snap) => {
          refsToDelete.push(snap.ref);
          refsToDelete.push(doc(db, 'users', snap.id, 'workspaces', wid));
        });
        refsToDelete.push(doc(db, 'workspaces', wid));
        await commitDeletesInChunks(refsToDelete);
      } else {
        const batch = writeBatch(db);
        batch.delete(doc(db, 'workspaces', wid, 'members', user.uid));
        batch.delete(doc(db, 'users', user.uid, 'workspaces', wid));
        await batch.commit();
      }

      if (selectedId === wid) onSelect('');
      setMessage(isOwner ? 'Block deleted.' : 'You left the block.');
    } catch (err) {
      setMessage(err.message || 'Could not update that workspace.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <p className="eyebrow">Signed in as</p>
        <strong>{user.displayName || user.email}</strong>
        <small>{user.email}</small>
      </div>

      <section className="sidebar-section">
        <h3>Workspaces</h3>
        <div className="workspace-list">
          {workspaces.length === 0 && <p className="muted">Create or join a block to begin.</p>}
          {workspaces.map((workspace) => (
            <div className={selectedId === workspace.workspaceId ? 'workspace-item active' : 'workspace-item'} key={workspace.workspaceId}>
              <button className="workspace-btn" onClick={() => onSelect(workspace.workspaceId)}>
                <span>{workspace.name}</span>
                <small>{workspace.role} · {workspace.joinCode}</small>
              </button>
              <button
                type="button"
                className={workspace.role === 'owner' ? 'workspace-delete-btn' : 'workspace-leave-btn'}
                onClick={() => deleteOrLeaveWorkspace(workspace)}
                disabled={busy}
              >
                {workspace.role === 'owner' ? 'Delete' : 'Leave'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="sidebar-section compact">
        <h3>Create block</h3>
        <form onSubmit={createWorkspace} className="mini-form">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Block 5" />
          <button disabled={busy}>Create</button>
        </form>
      </section>

      <section className="sidebar-section compact">
        <h3>Join block</h3>
        <form onSubmit={joinWorkspace} className="mini-form">
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="Join code" />
          <button disabled={busy}>Join</button>
        </form>
        {message && <p className="error-text small">{message}</p>}
      </section>

      <button className="ghost-btn full" onClick={() => signOut(auth)}>Sign out</button>
    </aside>
  );
}

function CsvImporter({ workspaceId, selectedDate, onSavedDate }) {
  const [fileName, setFileName] = useState('');
  const [imported, setImported] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [manual, setManual] = useState({
    date: selectedDate,
    startTime: '08:00',
    endTime: '09:00',
    title: '',
    course: '',
    instructor: '',
    exam: '',
    examDate: '',
    priority: 'medium',
    lectureType: 'lecture',
    estimatedMinutes: 60,
    boardResource: '',
    notesLink: ''
  });

  useEffect(() => {
    setManual((prev) => ({ ...prev, date: selectedDate }));
  }, [selectedDate]);

  async function handleCsv(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    setError('');
    setMessage('');
    setImported([]);
    try {
      const lectures = await parseCalendarCsv(file);
      setImported(lectures);
      if (lectures.length === 0) {
        setError('No lectures were detected. Date and title are required. Optional productivity columns: exam, examDate, priority, lectureType, estimatedMinutes, boardResource, notesLink.');
      } else {
        setMessage(`Detected ${lectures.length} lecture${lectures.length === 1 ? '' : 's'}. Review the preview, then click Save all.`);
      }
    } catch (err) {
      setError(err.message || 'Could not read CSV. Check the template and try again.');
    } finally {
      setBusy(false);
      e.target.value = '';
    }
  }

  function updateImported(index, patch) {
    setImported((items) => items.map((item, i) => i === index ? { ...item, ...patch } : item));
  }

  function removeImported(index) {
    setImported((items) => items.filter((_, i) => i !== index));
  }

  async function saveImported() {
    if (!workspaceId) {
      setError('Create or select a workspace before saving lectures.');
      return;
    }
    if (imported.length === 0) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const batch = writeBatch(db);
      imported.forEach((lecture) => {
        const ref = doc(collection(db, 'workspaces', workspaceId, 'lectures'));
        const { _rowNumber, ...cleanLecture } = lecture;
        batch.set(ref, {
          ...cleanLecture,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
      const savedCount = imported.length;
      const firstDate = imported[0]?.date;
      setImported([]);
      setFileName('');
      setMessage(`Saved ${savedCount} lecture${savedCount === 1 ? '' : 's'} to the calendar.`);
      if (firstDate) onSavedDate?.(firstDate);
    } catch (err) {
      setError(err.message || 'Could not save imported lectures.');
    } finally {
      setBusy(false);
    }
  }

  async function addManual(e) {
    e.preventDefault();
    if (!workspaceId) {
      setError('Create or select a workspace before adding lectures.');
      return;
    }
    if (!manual.title.trim()) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await addDoc(collection(db, 'workspaces', workspaceId, 'lectures'), {
        ...manual,
        title: manual.title.trim(),
        course: manual.course.trim(),
        instructor: manual.instructor.trim(),
        estimatedMinutes: Number(manual.estimatedMinutes) || 60,
        source: 'Manual entry',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setManual((prev) => ({ ...prev, title: '', course: '', instructor: '', boardResource: '', notesLink: '' }));
      setMessage('Lecture added.');
      onSavedDate?.(manual.date);
    } catch (err) {
      setError(err.message || 'Could not add lecture.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel import-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Calendar import</p>
          <h2>Import CSV or add lectures manually</h2>
        </div>
      </div>

      <div className="csv-help">
        <strong>Core columns:</strong> date, startTime, endTime, course, title, instructor, source
        <span>Optional: exam, examDate, priority, lectureType, estimatedMinutes, boardResource, notesLink</span>
        <a href="/lecture-template.csv" download>Download CSV template</a>
      </div>

      <div className="import-grid">
        <label className="upload-box">
          <input type="file" accept=".csv,text/csv" onChange={handleCsv} />
          <span>📄</span>
          <strong>{busy ? 'Reading CSV…' : 'Choose block calendar CSV'}</strong>
          <small>{fileName || 'Use the template. Date and title are required.'}</small>
        </label>

        <form onSubmit={addManual} className="manual-form">
          <h3>Manual lecture</h3>
          <div className="row-2">
            <input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
            <input value={manual.course} onChange={(e) => setManual({ ...manual, course: e.target.value })} placeholder="Course" />
          </div>
          <div className="row-2">
            <input type="time" value={manual.startTime} onChange={(e) => setManual({ ...manual, startTime: e.target.value })} />
            <input type="time" value={manual.endTime} onChange={(e) => setManual({ ...manual, endTime: e.target.value })} />
          </div>
          <input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} placeholder="Lecture title" />
          <input value={manual.instructor} onChange={(e) => setManual({ ...manual, instructor: e.target.value })} placeholder="Instructor" />
          <div className="row-2">
            <input value={manual.exam} onChange={(e) => setManual({ ...manual, exam: e.target.value })} placeholder="Exam tag, e.g. Path Exam 1" />
            <input type="date" value={manual.examDate} onChange={(e) => setManual({ ...manual, examDate: e.target.value })} title="Exam date" />
          </div>
          <div className="row-3">
            <select value={manual.priority} onChange={(e) => setManual({ ...manual, priority: e.target.value })}>
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
            <select value={manual.lectureType} onChange={(e) => setManual({ ...manual, lectureType: e.target.value })}>
              {LECTURE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <input type="number" min="5" value={manual.estimatedMinutes} onChange={(e) => setManual({ ...manual, estimatedMinutes: e.target.value })} placeholder="Minutes" />
          </div>
          <input value={manual.boardResource} onChange={(e) => setManual({ ...manual, boardResource: e.target.value })} placeholder="Board resource link/name, optional" />
          <input value={manual.notesLink} onChange={(e) => setManual({ ...manual, notesLink: e.target.value })} placeholder="Notes/Canvas link, optional" />
          <button disabled={busy}>Add lecture</button>
        </form>
      </div>

      {error && <p className="error-text">{error}</p>}
      {message && <p className="success-text">{message}</p>}

      {imported.length > 0 && (
        <div className="preview-block">
          <div className="panel-heading compact-heading">
            <h3>Preview CSV lectures ({imported.length})</h3>
            <button className="primary-btn small-btn" onClick={saveImported} disabled={busy}>Save all</button>
          </div>
          <div className="preview-table">
            {imported.map((lecture, index) => (
              <div className="preview-row productivity-preview-row" key={`${lecture.date}-${lecture.startTime}-${index}`}>
                <input type="date" value={lecture.date} onChange={(e) => updateImported(index, { date: e.target.value })} />
                <input type="time" value={lecture.startTime} onChange={(e) => updateImported(index, { startTime: e.target.value })} />
                <input type="time" value={lecture.endTime} onChange={(e) => updateImported(index, { endTime: e.target.value })} />
                <input value={lecture.course || ''} onChange={(e) => updateImported(index, { course: e.target.value })} placeholder="Course" />
                <input value={lecture.title} onChange={(e) => updateImported(index, { title: e.target.value })} placeholder="Title" />
                <input value={lecture.exam || ''} onChange={(e) => updateImported(index, { exam: e.target.value })} placeholder="Exam" />
                <select value={lecture.priority || 'medium'} onChange={(e) => updateImported(index, { priority: e.target.value })}>
                  {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </select>
                <button className="icon-btn" onClick={() => removeImported(index)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function LectureCard({ lecture, progress, onToggle, onDelete, onSave, onMoveToDate, onDragStart }) {
  const tasks = tasksForLecture(lecture);
  const percent = completionPercent(lecture, progress);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [draft, setDraft] = useState({
    date: lecture.date || todayISO(),
    startTime: lecture.startTime || '',
    endTime: lecture.endTime || '',
    course: lecture.course || '',
    title: lecture.title || '',
    instructor: lecture.instructor || '',
    source: lecture.source || 'Lecture',
    exam: lecture.exam || '',
    examDate: lecture.examDate || '',
    priority: lecture.priority || 'medium',
    lectureType: lecture.lectureType || 'lecture',
    estimatedMinutes: lecture.estimatedMinutes || 60,
    boardResource: lecture.boardResource || '',
    notesLink: lecture.notesLink || ''
  });

  useEffect(() => {
    setDraft({
      date: lecture.date || todayISO(),
      startTime: lecture.startTime || '',
      endTime: lecture.endTime || '',
      course: lecture.course || '',
      title: lecture.title || '',
      instructor: lecture.instructor || '',
      source: lecture.source || 'Lecture',
      exam: lecture.exam || '',
      examDate: lecture.examDate || '',
      priority: lecture.priority || 'medium',
      lectureType: lecture.lectureType || 'lecture',
      estimatedMinutes: lecture.estimatedMinutes || 60,
      boardResource: lecture.boardResource || '',
      notesLink: lecture.notesLink || ''
    });
    setEditError('');
  }, [lecture]);

  async function handleSave(e) {
    e.preventDefault();
    setEditError('');
    if (!draft.date) return setEditError('Date is required.');
    if (!draft.title.trim()) return setEditError('Lecture title is required.');
    setSaving(true);
    try {
      await onSave(lecture.id, {
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        course: draft.course.trim(),
        title: draft.title.trim(),
        instructor: draft.instructor.trim(),
        source: draft.source.trim() || 'Lecture',
        exam: draft.exam.trim(),
        examDate: draft.examDate,
        priority: draft.priority,
        lectureType: draft.lectureType,
        estimatedMinutes: Number(draft.estimatedMinutes) || 60,
        boardResource: draft.boardResource.trim(),
        notesLink: draft.notesLink.trim()
      });
      setEditing(false);
    } catch (err) {
      setEditError(err.message || 'Could not save lecture changes.');
    } finally {
      setSaving(false);
    }
  }

  const groups = ['Core', 'Board', 'Practical'];

  return (
    <article
      className={`lecture-card priority-${lecture.priority || 'medium'}`}
      draggable={!editing}
      onDragStart={(e) => onDragStart?.(e, lecture.id)}
    >
      {!editing ? (
        <>
          <div className="lecture-topline">
            <div>
              <p className="time-text">{timeLabel(lecture.startTime, lecture.endTime)}</p>
              <h3>{lecture.title}</h3>
              <p className="lecture-meta">{lecture.course || 'No course listed'} · {lecture.instructor || 'No instructor listed'}</p>
              <div className="tag-row">
                <span className={`priority-badge ${lecture.priority || 'medium'}`}>{lecture.priority || 'medium'}</span>
                {lecture.exam && <span className="soft-badge">{lecture.exam}</span>}
                {lecture.lectureType && <span className="soft-badge">{lecture.lectureType}</span>}
                {lecture.estimatedMinutes && <span className="soft-badge">~{lecture.estimatedMinutes} min</span>}
              </div>
            </div>
            <div className="percent-pill">{percent}%</div>
          </div>

          <ProgressBar value={percent} />

          {lecture.boardResource && <p className="resource-line">Board resource: {lecture.boardResource}</p>}
          {lecture.notesLink && <p className="resource-line">Notes/link: {lecture.notesLink}</p>}

          {groups.map((group) => {
            const groupTasks = tasks.filter((task) => task.group === group);
            if (groupTasks.length === 0) return null;
            return (
              <div key={group} className="task-section">
                <p className="task-section-title">{group} checklist</p>
                <div className="task-grid">
                  {groupTasks.map((task) => (
                    <label className={progress?.[task.key] ? 'check-chip checked' : 'check-chip'} key={task.key}>
                      <input type="checkbox" checked={Boolean(progress?.[task.key])} onChange={() => onToggle(lecture.id, task.key)} />
                      <span>{task.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="card-actions">
            <button className="ghost-btn" onClick={() => setEditing(true)}>Edit / move</button>
            <button className="ghost-btn" onClick={() => onMoveToDate?.(lecture.id, todayISO())}>Move to today</button>
            <button className="ghost-btn" onClick={() => onMoveToDate?.(lecture.id, shiftISODate(todayISO(), 1))}>Move to tomorrow</button>
            <button className="ghost-btn danger" onClick={() => onDelete(lecture.id)}>Delete lecture</button>
          </div>
        </>
      ) : (
        <form className="edit-lecture-form" onSubmit={handleSave}>
          <div className="lecture-topline">
            <div>
              <p className="eyebrow">Edit lecture</p>
              <h3>Move this lecture or update productivity details</h3>
            </div>
            <div className="percent-pill">{percent}%</div>
          </div>
          <label>
            Date
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </label>
          <div className="inline-actions">
            <button type="button" className="ghost-btn" onClick={() => setDraft({ ...draft, date: shiftISODate(draft.date, -1) })}>Move back 1 day</button>
            <button type="button" className="ghost-btn" onClick={() => setDraft({ ...draft, date: todayISO() })}>Move to today</button>
            <button type="button" className="ghost-btn" onClick={() => setDraft({ ...draft, date: shiftISODate(draft.date, 1) })}>Move forward 1 day</button>
          </div>
          <div className="form-row">
            <label>Start time<input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} /></label>
            <label>End time<input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} /></label>
          </div>
          <label>Course<input value={draft.course} onChange={(e) => setDraft({ ...draft, course: e.target.value })} placeholder="PATHOLOGY, ANATOMY, OMM..." /></label>
          <label>Lecture title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Lecture title" /></label>
          <div className="form-row">
            <label>Instructor<input value={draft.instructor} onChange={(e) => setDraft({ ...draft, instructor: e.target.value })} /></label>
            <label>Source/block<input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} /></label>
          </div>
          <div className="form-row">
            <label>Exam tag<input value={draft.exam} onChange={(e) => setDraft({ ...draft, exam: e.target.value })} placeholder="Path Exam 1" /></label>
            <label>Exam date<input type="date" value={draft.examDate} onChange={(e) => setDraft({ ...draft, examDate: e.target.value })} /></label>
          </div>
          <div className="form-row three">
            <label>Priority<select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>{PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>
            <label>Type<select value={draft.lectureType} onChange={(e) => setDraft({ ...draft, lectureType: e.target.value })}>{LECTURE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label>Minutes<input type="number" min="5" value={draft.estimatedMinutes} onChange={(e) => setDraft({ ...draft, estimatedMinutes: e.target.value })} /></label>
          </div>
          <label>Board resource<input value={draft.boardResource} onChange={(e) => setDraft({ ...draft, boardResource: e.target.value })} placeholder="B&B, Sketchy, First Aid, Bootcamp, TrueLearn..." /></label>
          <label>Notes/link<input value={draft.notesLink} onChange={(e) => setDraft({ ...draft, notesLink: e.target.value })} placeholder="Canvas, Google Doc, Anki deck, notes link..." /></label>
          {editError && <p className="error-text">{editError}</p>}
          <div className="card-actions">
            <button className="primary-btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
            <button className="ghost-btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      )}
    </article>
  );
}

function TodayPlan({ selectedDate, lectures, progress, overdueLectures, recommendation, onSelectDate }) {
  const todayLectures = lectures.filter((lecture) => lecture.date === selectedDate);
  const unfinishedToday = todayLectures.filter((lecture) => completionPercent(lecture, progress[lecture.id]) < 100);
  const estimatedMinutes = unfinishedToday.reduce((sum, lecture) => sum + (Number(lecture.estimatedMinutes) || 60), 0);
  const dayScore = taskCountsForLectures(todayLectures, progress).percent;

  return (
    <section className="panel plan-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Today’s plan</p>
          <h2>{unfinishedToday.length ? `${unfinishedToday.length} unfinished lecture${unfinishedToday.length === 1 ? '' : 's'}` : 'No unfinished lectures today'}</h2>
        </div>
        <div className="score-badge">{dayScore}% day score</div>
      </div>
      <div className="plan-grid">
        <div className="plan-card">
          <span>Estimated remaining workload</span>
          <strong>{Math.round(estimatedMinutes / 60 * 10) / 10} hr</strong>
        </div>
        <div className="plan-card overdue-card" onClick={() => overdueLectures[0] && onSelectDate(overdueLectures[0].date)}>
          <span>Overdue lectures</span>
          <strong>{overdueLectures.length}</strong>
        </div>
        <div className="plan-card recommendation-card">
          <span>What should I do next?</span>
          <strong>{recommendation?.title || 'No urgent task'}</strong>
          {recommendation && <small>{recommendation.taskLabel} · {recommendation.reason}</small>}
        </div>
      </div>
    </section>
  );
}

function OverduePanel({ overdueLectures, progress, onSelectDate, onMoveLecture }) {
  if (!overdueLectures.length) return null;
  return (
    <section className="panel warning-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Overdue lectures</p>
          <h2>{overdueLectures.length} lecture{overdueLectures.length === 1 ? '' : 's'} need catch-up</h2>
        </div>
      </div>
      <div className="overdue-list">
        {overdueLectures.slice(0, 8).map((lecture) => (
          <div className="overdue-row" key={lecture.id}>
            <button onClick={() => onSelectDate(lecture.date)}>
              <span>{niceDate(lecture.date, true)} · {lecture.course}</span>
              <strong>{lecture.title}</strong>
              <small>{completionPercent(lecture, progress[lecture.id])}% complete · {lecture.priority || 'medium'} priority</small>
            </button>
            <div className="overdue-actions">
              <button className="ghost-btn" onClick={() => onMoveLecture(lecture.id, todayISO())}>Today</button>
              <button className="ghost-btn" onClick={() => onMoveLecture(lecture.id, shiftISODate(todayISO(), 1))}>Tomorrow</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExamCards({ lectures, progress, onSelectDate }) {
  const exams = useMemo(() => {
    const map = new Map();
    lectures.forEach((lecture) => {
      if (!lecture.exam) return;
      if (!map.has(lecture.exam)) map.set(lecture.exam, []);
      map.get(lecture.exam).push(lecture);
    });
    return Array.from(map.entries()).map(([exam, items]) => {
      const dates = items.map((item) => item.examDate).filter(Boolean).sort();
      const examDate = dates[0] || '';
      return { exam, examDate, items, ...taskCountsForLectures(items, progress) };
    }).sort((a, b) => (a.examDate || '9999').localeCompare(b.examDate || '9999'));
  }, [lectures, progress]);

  if (!exams.length) return null;

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Exam mode</p>
          <h2>Exam countdown and readiness</h2>
        </div>
      </div>
      <div className="exam-grid">
        {exams.map((exam) => {
          const days = exam.examDate ? daysBetween(todayISO(), exam.examDate) : null;
          return (
            <button className="exam-card" key={exam.exam} onClick={() => onSelectDate(exam.items[0]?.date || todayISO())}>
              <span>{exam.examDate ? niceDate(exam.examDate, true) : 'No exam date'}</span>
              <strong>{exam.exam}</strong>
              <small>{exam.items.length} lecture{exam.items.length === 1 ? '' : 's'} · {days === null ? 'date missing' : days < 0 ? 'past' : `${days} day${days === 1 ? '' : 's'} away`}</small>
              <ProgressBar value={exam.percent} />
              <small>{exam.percent}% ready</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ProgressBreakdown({ lectures, progress }) {
  const courseRows = groupProgress(lectures, progress, 'course').filter((row) => row.label !== 'No course');
  const examRows = groupProgress(lectures, progress, 'exam').filter((row) => row.label !== 'No exam');

  if (!courseRows.length && !examRows.length) return null;

  return (
    <section className="panel progress-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Progress bars</p>
          <h2>Completion by course and exam</h2>
        </div>
      </div>
      <div className="progress-columns">
        <div>
          <h3>By course</h3>
          {courseRows.map((row) => (
            <div className="progress-row" key={row.label}>
              <div><strong>{row.label}</strong><small>{row.count} lectures · {row.percent}%</small></div>
              <ProgressBar value={row.percent} />
            </div>
          ))}
        </div>
        <div>
          <h3>By exam</h3>
          {examRows.map((row) => (
            <div className="progress-row" key={row.label}>
              <div><strong>{row.label}</strong><small>{row.count} lectures · {row.percent}%</small></div>
              <ProgressBar value={row.percent} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SmartCatchUp({ overdueLectures, progress }) {
  if (!overdueLectures.length) return null;
  const planDays = [todayISO(), shiftISODate(todayISO(), 1), shiftISODate(todayISO(), 2), shiftISODate(todayISO(), 3)];
  const sorted = [...overdueLectures].sort((a, b) => {
    const priorityScore = { high: 0, medium: 1, low: 2 };
    return (priorityScore[a.priority || 'medium'] - priorityScore[b.priority || 'medium']) || a.date.localeCompare(b.date);
  });
  const buckets = planDays.map((date) => ({ date, lectures: [] }));
  sorted.forEach((lecture, index) => buckets[index % buckets.length].lectures.push(lecture));

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Smart catch-up planner</p>
          <h2>Suggested catch-up distribution</h2>
        </div>
      </div>
      <div className="catchup-grid">
        {buckets.map((bucket) => (
          <div className="catchup-day" key={bucket.date}>
            <strong>{niceDate(bucket.date, true)}</strong>
            {bucket.lectures.length === 0 ? <small>No catch-up assigned</small> : bucket.lectures.map((lecture) => (
              <div className="mini-lecture" key={lecture.id}>
                <span>{lecture.course || 'Lecture'} · {completionPercent(lecture, progress[lecture.id])}%</span>
                <p>{lecture.title}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function WeeklyView({ selectedDate, lectures, progress, onSelectDate, onDropLecture, onDragStart }) {
  const dates = weekDates(selectedDate);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Weekly view</p>
          <h2>Drag a lecture onto another day to reschedule</h2>
        </div>
      </div>
      <div className="week-grid">
        {dates.map((date) => {
          const dayItems = lectures.filter((lecture) => lecture.date === date);
          const dayProgress = taskCountsForLectures(dayItems, progress).percent;
          return (
            <div
              className={date === selectedDate ? 'week-day active' : 'week-day'}
              key={date}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropLecture(e, date)}
            >
              <button className="week-day-header" onClick={() => onSelectDate(date)}>
                <strong>{niceDate(date, true)}</strong>
                <small>{dayItems.length} lectures · {dayProgress}%</small>
              </button>
              <div className="week-items">
                {dayItems.map((lecture) => (
                  <div className={`week-mini priority-${lecture.priority || 'medium'}`} key={lecture.id} draggable onDragStart={(e) => onDragStart(e, lecture.id)}>
                    <span>{timeLabel(lecture.startTime, lecture.endTime)}</span>
                    <p>{lecture.title}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WeeklyReport({ selectedDate, lectures, progress }) {
  const dates = weekDates(selectedDate);
  const weekLectures = lectures.filter((lecture) => dates.includes(lecture.date));
  const counts = taskCountsForLectures(weekLectures, progress);
  const courseRows = groupProgress(weekLectures, progress, 'course').filter((row) => row.label !== 'No course').sort((a, b) => a.percent - b.percent);
  const weakest = courseRows[0];
  const strongest = [...courseRows].sort((a, b) => b.percent - a.percent)[0];

  return (
    <section className="panel report-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Weekly report</p>
          <h2>{niceDate(dates[0], true)} – {niceDate(dates[6], true)}</h2>
        </div>
      </div>
      <div className="report-grid">
        <div><span>Lectures this week</span><strong>{weekLectures.length}</strong></div>
        <div><span>Weekly completion</span><strong>{counts.percent}%</strong></div>
        <div><span>Most behind</span><strong>{weakest?.label || 'N/A'}</strong></div>
        <div><span>Strongest</span><strong>{strongest?.label || 'N/A'}</strong></div>
      </div>
    </section>
  );
}


function BoardQuestionsTracker({ selectedDate, qbankDay, qbankDays, onSave }) {
  const [draft, setDraft] = useState({ planned: 0, completed: 0, source: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const week = weekDates(selectedDate);
  const weekRows = week.map((date) => qbankDays[date] || { date, planned: 0, completed: 0 });
  const weekPlanned = weekRows.reduce((sum, row) => sum + (Number(row.planned) || 0), 0);
  const weekCompleted = weekRows.reduce((sum, row) => sum + (Number(row.completed) || 0), 0);
  const percent = weekPlanned ? Math.min(100, Math.round((weekCompleted / weekPlanned) * 100)) : 0;

  useEffect(() => {
    setDraft({
      planned: qbankDay?.planned || 0,
      completed: qbankDay?.completed || 0,
      source: qbankDay?.source || '',
      notes: qbankDay?.notes || ''
    });
    setMessage('');
  }, [qbankDay, selectedDate]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await onSave(selectedDate, {
        planned: Math.max(0, Number(draft.planned) || 0),
        completed: Math.max(0, Number(draft.completed) || 0),
        source: draft.source.trim(),
        notes: draft.notes.trim()
      });
      setMessage('Question goal saved.');
    } catch (err) {
      setMessage(err.message || 'Could not save question tracker.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel qbank-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Board questions</p>
          <h2>Daily question goal</h2>
        </div>
        <div className="score-badge">{weekCompleted}/{weekPlanned || 0} this week</div>
      </div>
      <div className="qbank-grid">
        <form className="manual-form qbank-form" onSubmit={save}>
          <h3>{niceDate(selectedDate, true)}</h3>
          <div className="row-2">
            <label>Planned questions<input type="number" min="0" value={draft.planned} onChange={(e) => setDraft({ ...draft, planned: e.target.value })} /></label>
            <label>Completed questions<input type="number" min="0" value={draft.completed} onChange={(e) => setDraft({ ...draft, completed: e.target.value })} /></label>
          </div>
          <label>Question source<input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="TrueLearn, UWorld, COMBANK, AMBOSS..." /></label>
          <label>Notes<textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Topic set, weakness, missed-question plan..." rows={3} /></label>
          <button className="primary-btn" disabled={saving}>{saving ? 'Saving…' : 'Save question goal'}</button>
          {message && <p className={message.includes('Could') ? 'error-text small' : 'success-text'}>{message}</p>}
        </form>
        <div className="qbank-summary">
          <div className="plan-card">
            <span>Selected day</span>
            <strong>{Number(draft.completed) || 0}/{Number(draft.planned) || 0}</strong>
          </div>
          <div className="plan-card">
            <span>Weekly target completion</span>
            <strong>{percent}%</strong>
            <ProgressBar value={percent} />
          </div>
          <div className="qbank-week-list">
            {weekRows.map((row) => (
              <div className="qbank-week-row" key={row.date}>
                <span>{niceDate(row.date, true)}</span>
                <strong>{Number(row.completed) || 0}/{Number(row.planned) || 0}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function PomodoroTimer({ lectures, selectedDate }) {
  const [mode, setMode] = useState('focus');
  const [durations, setDurations] = useLocalStorageState('medtracker:pomodoro-durations', { focus: 25, short: 5, long: 15 });
  const [secondsLeft, setSecondsLeft] = useState((durations.focus || 25) * 60);
  const [running, setRunning] = useState(false);
  const [immersiveOpen, setImmersiveOpen] = useState(false);
  const [sessionCount, setSessionCount] = useLocalStorageState('medtracker:pomodoro-session-count', 0);
  const [selectedLectureId, setSelectedLectureId] = useState('');
  const [sessionNote, setSessionNote] = useState('');
  const [customBackground, setCustomBackground] = useLocalStorageState('medtracker:pomodoro-background-image', '');
  const intervalRef = useRef(null);

  const modeMinutes = Number(durations[mode]) || (mode === 'focus' ? 25 : 5);
  const todayLectures = lectures.filter((lecture) => lecture.date === selectedDate);
  const selectedLecture = lectures.find((lecture) => lecture.id === selectedLectureId);
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const timeLabel = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const backgroundStyle = customBackground ? { backgroundImage: `linear-gradient(120deg, rgba(3, 7, 18, 0.35), rgba(15, 23, 42, 0.5)), url(${customBackground})` } : undefined;

  useEffect(() => {
    setSecondsLeft(modeMinutes * 60);
    setRunning(false);
  }, [mode, modeMinutes]);

  useEffect(() => {
    if (!running) return undefined;
    intervalRef.current = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(intervalRef.current);
          setRunning(false);
          setSessionCount((count) => count + 1);
          setSessionNote(`Session complete${selectedLecture ? `: ${selectedLecture.title}` : ''}.`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(intervalRef.current);
  }, [running, selectedLecture, setSessionCount]);

  function resetTimer() {
    setRunning(false);
    setSecondsLeft(modeMinutes * 60);
    setSessionNote('');
  }

  function startFocusSession() {
    setRunning(true);
    setImmersiveOpen(true);
  }

  function updateDuration(key, value) {
    const next = { ...durations, [key]: Math.max(1, Number(value) || 1) };
    setDurations(next);
    if (key === mode) {
      setRunning(false);
      setSecondsLeft(next[key] * 60);
    }
  }

  function handleBackgroundUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setSessionNote('Please upload an image file for your focus background.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCustomBackground(reader.result);
      setSessionNote('Custom focus background saved on this device.');
    };
    reader.readAsDataURL(file);
  }

  const timerControls = (
    <>
      <div className="timer-mode-row">
        <button className={mode === 'focus' ? 'tab active' : 'tab'} onClick={() => setMode('focus')}>Focus</button>
        <button className={mode === 'short' ? 'tab active' : 'tab'} onClick={() => setMode('short')}>Short break</button>
        <button className={mode === 'long' ? 'tab active' : 'tab'} onClick={() => setMode('long')}>Long break</button>
      </div>
      <div className="timer-display">{timeLabel}</div>
      <div className="timer-actions">
        <button className="primary-btn" onClick={() => running ? setRunning(false) : startFocusSession()}>{running ? 'Pause' : 'Start focus mode'}</button>
        <button className="ghost-btn" onClick={resetTimer}>Reset</button>
      </div>
      {sessionNote && <p className="success-text">{sessionNote}</p>}
    </>
  );

  return (
    <section className="panel pomodoro-panel">
      {immersiveOpen && (
        <div className="focus-immersion" style={backgroundStyle}>
          <div className="focus-topbar">
            <button className="ghost-btn focus-exit" onClick={() => setImmersiveOpen(false)}>Back to dashboard</button>
            <span>{running ? 'Focus session running' : 'Focus session paused'}</span>
          </div>
          <div className="focus-card">
            <p className="eyebrow">{mode === 'focus' ? 'Deep work' : mode === 'short' ? 'Short break' : 'Long break'}</p>
            <div className="focus-timer-display">{timeLabel}</div>
            {selectedLecture && <p className="focus-lecture">{selectedLecture.course ? `${selectedLecture.course}: ` : ''}{selectedLecture.title}</p>}
            <div className="timer-actions centered">
              <button className="primary-btn" onClick={() => setRunning((value) => !value)}>{running ? 'Pause' : 'Resume'}</button>
              <button className="ghost-btn" onClick={resetTimer}>Reset</button>
              <button className="ghost-btn" onClick={() => setImmersiveOpen(false)}>Keep timer, return</button>
            </div>
          </div>
        </div>
      )}
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Focus timer</p>
          <h2>Pomodoro study session</h2>
        </div>
        <div className="score-badge">{sessionCount} session{sessionCount === 1 ? '' : 's'} logged</div>
      </div>
      <div className="pomodoro-grid">
        <div className="timer-card nature-preview" style={backgroundStyle}>
          {timerControls}
          <p className="muted light-muted">Starting the timer opens a full-screen nature focus background with the timer over top.</p>
        </div>
        <div className="manual-form timer-settings">
          <h3>Session settings</h3>
          <label>Attach session to lecture
            <select value={selectedLectureId} onChange={(e) => setSelectedLectureId(e.target.value)}>
              <option value="">No lecture selected</option>
              {todayLectures.map((lecture) => <option key={lecture.id} value={lecture.id}>{lecture.course ? `${lecture.course}: ` : ''}{lecture.title}</option>)}
              {lectures.filter((lecture) => lecture.date !== selectedDate).slice(0, 30).map((lecture) => <option key={lecture.id} value={lecture.id}>{niceDate(lecture.date, true)} · {lecture.title}</option>)}
            </select>
          </label>
          <div className="row-3">
            <label>Focus min<input type="number" min="1" value={durations.focus} onChange={(e) => updateDuration('focus', e.target.value)} /></label>
            <label>Short min<input type="number" min="1" value={durations.short} onChange={(e) => updateDuration('short', e.target.value)} /></label>
            <label>Long min<input type="number" min="1" value={durations.long} onChange={(e) => updateDuration('long', e.target.value)} /></label>
          </div>
          <label>Upload focus background image
            <input type="file" accept="image/*" onChange={handleBackgroundUpload} />
          </label>
          <div className="inline-actions no-margin">
            <button type="button" className="ghost-btn small-btn" onClick={() => setCustomBackground('')}>Use default nature scene</button>
            <button type="button" className="ghost-btn small-btn" onClick={() => setImmersiveOpen(true)}>Preview focus mode</button>
          </div>
          <p className="muted">Uploaded backgrounds save on this browser/device. Use this for lecture blocks, Anki, or board questions.</p>
        </div>
      </div>
    </section>
  );
}

function DashboardCustomizer({ widgets, setWidgets, theme, setTheme, open, setOpen }) {
  function toggleWidget(id) {
    setWidgets(widgets.map((item) => item.id === id ? { ...item, enabled: !item.enabled } : item));
  }

  function moveWidget(index, delta) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= widgets.length) return;
    const next = [...widgets];
    const [item] = next.splice(index, 1);
    next.splice(nextIndex, 0, item);
    setWidgets(next);
  }

  function resetWidgets() {
    setWidgets(DEFAULT_DASHBOARD_WIDGETS);
  }

  function applyPreset(key) {
    setTheme(THEME_PRESETS[key]);
  }

  function updateTheme(key, value) {
    setTheme({ ...theme, [key]: value });
  }

  if (!open) return null;

  return (
    <div className="settings-overlay" onClick={() => setOpen(false)}>
      <section className="settings-drawer panel customizer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>Main page layout and colors</h2>
          </div>
          <button className="ghost-btn" onClick={() => setOpen(false)}>Close</button>
        </div>
        <div className="customizer-grid">
          <div className="customizer-column">
            <div className="panel-heading compact-heading">
              <h3>Homepage sections</h3>
              <button className="ghost-btn small-btn" onClick={resetWidgets}>Reset order</button>
            </div>
            <p className="muted">Choose what appears on the main page and use the arrows to reorder your dashboard.</p>
            <div className="widget-sort-list">
              {widgets.map((widget, index) => (
                <div className={widget.enabled ? 'widget-sort-row' : 'widget-sort-row disabled'} key={widget.id}>
                  <label className="check-chip">
                    <input type="checkbox" checked={widget.enabled} onChange={() => toggleWidget(widget.id)} />
                    <span>{widget.label}</span>
                  </label>
                  <div className="inline-actions no-margin">
                    <button className="icon-btn" onClick={() => moveWidget(index, -1)} disabled={index === 0}>↑</button>
                    <button className="icon-btn" onClick={() => moveWidget(index, 1)} disabled={index === widgets.length - 1}>↓</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="customizer-column">
            <h3>Color theme</h3>
            <p className="muted">Pick a preset or adjust the full app color palette.</p>
            <div className="preset-row">
              {Object.entries(THEME_PRESETS).map(([key, preset]) => (
                <button className="ghost-btn small-btn" key={key} onClick={() => applyPreset(key)}>{preset.name}</button>
              ))}
            </div>
            <div className="color-grid">
              <label>Background<input type="color" value={theme.bg || DEFAULT_THEME.bg} onChange={(e) => updateTheme('bg', e.target.value)} /></label>
              <label>Panel<input type="color" value={(theme.panel || '#0f172a').replace(/rgba?\((.*?)\)/, DEFAULT_THEME.bg)} onChange={(e) => updateTheme('panel', e.target.value)} /></label>
              <label>Secondary panel<input type="color" value={(theme.panel2 || theme.panel || '#111827').replace(/rgba?\((.*?)\)/, DEFAULT_THEME.bg)} onChange={(e) => updateTheme('panel2', e.target.value)} /></label>
              <label>Accent<input type="color" value={theme.accent || DEFAULT_THEME.accent} onChange={(e) => updateTheme('accent', e.target.value)} /></label>
              <label>Button<input type="color" value={theme.blue || DEFAULT_THEME.blue} onChange={(e) => updateTheme('blue', e.target.value)} /></label>
              <label>Purple<input type="color" value={theme.purple || DEFAULT_THEME.purple} onChange={(e) => updateTheme('purple', e.target.value)} /></label>
              <label>Success<input type="color" value={theme.success || DEFAULT_THEME.success} onChange={(e) => updateTheme('success', e.target.value)} /></label>
              <label>Danger<input type="color" value={theme.danger || DEFAULT_THEME.danger} onChange={(e) => updateTheme('danger', e.target.value)} /></label>
              <label>Text<input type="color" value={theme.text || DEFAULT_THEME.text} onChange={(e) => updateTheme('text', e.target.value)} /></label>
              <label>Muted text<input type="color" value={theme.muted || DEFAULT_THEME.muted} onChange={(e) => updateTheme('muted', e.target.value)} /></label>
            </div>
            <p className="muted">Dashboard layout and colors are saved per browser/device, so your PC and iPad can each have a different setup.</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function findRecommendation(lectures, progress, selectedDate) {
  const incomplete = lectures.filter((lecture) => completionPercent(lecture, progress[lecture.id]) < 100);
  if (!incomplete.length) return null;
  const scorePriority = { high: 0, medium: 1, low: 2 };
  const today = todayISO();
  const ranked = incomplete.sort((a, b) => {
    const overdueA = a.date < today ? -2 : 0;
    const overdueB = b.date < today ? -2 : 0;
    const selectedA = a.date === selectedDate ? -1 : 0;
    const selectedB = b.date === selectedDate ? -1 : 0;
    const examA = a.examDate ? Math.max(-10, daysBetween(today, a.examDate) ?? 999) : 999;
    const examB = b.examDate ? Math.max(-10, daysBetween(today, b.examDate) ?? 999) : 999;
    return (overdueA + selectedA) - (overdueB + selectedB)
      || (scorePriority[a.priority || 'medium'] - scorePriority[b.priority || 'medium'])
      || examA - examB
      || a.date.localeCompare(b.date);
  });
  const lecture = ranked[0];
  const task = tasksForLecture(lecture).find((item) => !progress[lecture.id]?.[item.key]) || CORE_TASKS[0];
  let reason = 'next incomplete task';
  if (lecture.date < today) reason = 'overdue';
  else if (lecture.date === selectedDate) reason = 'scheduled today';
  else if (lecture.examDate) reason = `${lecture.exam || 'exam'} upcoming`;
  return { title: lecture.title, lectureId: lecture.id, date: lecture.date, taskLabel: task.label, reason };
}

function Dashboard({ user, workspace }) {
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [lectures, setLectures] = useState([]);
  const [progress, setProgress] = useState({});
  const [dataError, setDataError] = useState('');
  const [members, setMembers] = useState([]);
  const [qbankDays, setQbankDays] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const widgetKey = `medtracker:widgets:${user.uid}:${workspace.workspaceId}`;
  const themeKey = `medtracker:theme:${user.uid}`;
  const [widgets, setWidgets] = useLocalStorageState(widgetKey, DEFAULT_DASHBOARD_WIDGETS);
  const [theme, setTheme] = useLocalStorageState(themeKey, DEFAULT_THEME);

  useEffect(() => {
    if (!workspace?.workspaceId) return undefined;
    setDataError('');
    return onSnapshot(
      collection(db, 'workspaces', workspace.workspaceId, 'lectures'),
      (snapshot) => {
        const items = snapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => `${a.date || ''} ${a.startTime || ''} ${a.title || ''}`.localeCompare(`${b.date || ''} ${b.startTime || ''} ${b.title || ''}`));
        setLectures(items);
      },
      (err) => setDataError(err.message || 'Could not load lectures. Check Firestore rules and refresh.')
    );
  }, [workspace?.workspaceId]);

  useEffect(() => {
    if (!workspace?.workspaceId) return undefined;
    return onSnapshot(collection(db, 'workspaces', workspace.workspaceId, 'progress'), (snapshot) => {
      const next = {};
      snapshot.docs.forEach((item) => {
        const data = item.data();
        if (data.userId === user.uid) next[data.lectureId] = data;
      });
      setProgress(next);
    }, (err) => setDataError(err.message || 'Could not load progress.'));
  }, [workspace?.workspaceId, user.uid]);

  useEffect(() => {
    if (!workspace?.workspaceId) return undefined;
    return onSnapshot(collection(db, 'workspaces', workspace.workspaceId, 'members'), (snapshot) => {
      setMembers(snapshot.docs.map((item) => item.data()));
    });
  }, [workspace?.workspaceId]);

  useEffect(() => {
    setWidgets((current) => mergeWidgetSettings(current));
  }, [widgetKey, setWidgets]);

  useEffect(() => {
    const root = document.documentElement;
    const applied = { ...DEFAULT_THEME, ...(theme || {}) };
    root.style.setProperty('--bg', applied.bg);
    root.style.setProperty('--panel', applied.panel);
    root.style.setProperty('--panel-2', applied.panel2 || applied.panel);
    root.style.setProperty('--accent', applied.accent);
    root.style.setProperty('--blue', applied.blue);
    root.style.setProperty('--purple', applied.purple);
    root.style.setProperty('--cyan', applied.cyan);
    root.style.setProperty('--orange', applied.orange);
    root.style.setProperty('--success', applied.success);
    root.style.setProperty('--danger', applied.danger);
    root.style.setProperty('--text', applied.text);
    root.style.setProperty('--muted', applied.muted);
  }, [theme]);

  useEffect(() => {
    if (!workspace?.workspaceId) return undefined;
    return onSnapshot(collection(db, 'workspaces', workspace.workspaceId, 'qbankDays'), (snapshot) => {
      const next = {};
      snapshot.docs.forEach((item) => {
        const data = item.data();
        if (data.userId === user.uid && data.date) next[data.date] = data;
      });
      setQbankDays(next);
    }, (err) => setDataError(err.message || 'Could not load question tracker.'));
  }, [workspace?.workspaceId, user.uid]);

  const dates = useMemo(() => {
    const unique = Array.from(new Set(lectures.map((lecture) => lecture.date).filter(Boolean))).sort();
    return unique.length ? unique : [selectedDate];
  }, [lectures, selectedDate]);

  const today = todayISO();
  const dayLectures = lectures.filter((lecture) => lecture.date === selectedDate);
  const overdueLectures = lectures.filter((lecture) => lecture.date < today && completionPercent(lecture, progress[lecture.id]) < 100);
  const overall = taskCountsForLectures(lectures, progress).percent;
  const dayScore = taskCountsForLectures(dayLectures, progress).percent;
  const recommendation = findRecommendation([...lectures], progress, selectedDate);

  async function toggleTask(lectureId, key) {
    const current = progress[lectureId] || {};
    const nextValue = !current[key];
    const ref = doc(db, 'workspaces', workspace.workspaceId, 'progress', `${user.uid}_${lectureId}`);
    await setDoc(ref, {
      userId: user.uid,
      lectureId,
      [key]: nextValue,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  async function updateLecture(lectureId, patch) {
    await updateDoc(doc(db, 'workspaces', workspace.workspaceId, 'lectures', lectureId), {
      ...patch,
      updatedAt: serverTimestamp()
    });
    if (patch.date) setSelectedDate(patch.date);
  }

  async function moveLectureToDate(lectureId, date) {
    await updateLecture(lectureId, { date });
  }

  async function deleteLecture(lectureId) {
    if (!window.confirm('Delete this lecture for everyone in this workspace?')) return;
    await deleteDoc(doc(db, 'workspaces', workspace.workspaceId, 'lectures', lectureId));
  }

  async function saveQbankDay(date, patch) {
    const current = qbankDays[date] || {};
    await setDoc(doc(db, 'workspaces', workspace.workspaceId, 'qbankDays', `${user.uid}_${date}`), {
      ...current,
      ...patch,
      userId: user.uid,
      date,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  function moveDay(delta) {
    setSelectedDate(shiftISODate(selectedDate, delta));
  }

  function handleDragStart(e, lectureId) {
    e.dataTransfer.setData('text/plain', lectureId);
    e.dataTransfer.effectAllowed = 'move';
  }

  async function handleDropLecture(e, date) {
    e.preventDefault();
    const lectureId = e.dataTransfer.getData('text/plain');
    if (lectureId) await moveLectureToDate(lectureId, date);
  }

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h1>{niceDate(selectedDate)}</h1>
          <p className="muted">Share code: <strong className="code-pill">{workspace.joinCode}</strong> · {members.length} member{members.length === 1 ? '' : 's'}</p>
        </div>
        <div className="date-controls">
          <button onClick={() => moveDay(-1)}>←</button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
          <button onClick={() => moveDay(1)}>→</button>
          <button onClick={() => setSelectedDate(todayISO())}>Today</button>
        </div>
      </header>

      <section className="stats-grid productivity-stats">
        <div className="stat-card"><span>Total lectures</span><strong>{lectures.length}</strong></div>
        <div className="stat-card"><span>Today</span><strong>{dayLectures.length}</strong></div>
        <div className="stat-card"><span>Overdue</span><strong>{overdueLectures.length}</strong></div>
        <div className="stat-card"><span>Day score</span><strong>{dayScore}%</strong></div>
        <div className="stat-card"><span>Block completion</span><strong>{overall}%</strong></div>
      </section>

      <aside className="right-action-menu" aria-label="Quick actions">
        <button type="button" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
        <button type="button" onClick={() => setSelectedDate(todayISO())}>Today</button>
        <button type="button" onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })}>Import</button>
      </aside>

      {dataError && <section className="panel warning-panel"><p className="error-text">{dataError}</p></section>}

      <DashboardCustomizer widgets={widgets} setWidgets={setWidgets} theme={theme} setTheme={setTheme} open={settingsOpen} setOpen={setSettingsOpen} />

      <section className="date-strip">
        {dates.map((date) => (
          <button key={date} className={date === selectedDate ? 'date-chip active' : 'date-chip'} onClick={() => setSelectedDate(date)}>
            {niceDate(date).replace(/, \d{4}/, '')}
          </button>
        ))}
      </section>

      {widgets.filter((widget) => widget.enabled).map((widget) => {
        if (widget.id === 'todayPlan') return <TodayPlan key={widget.id} selectedDate={selectedDate} lectures={lectures} progress={progress} overdueLectures={overdueLectures} recommendation={recommendation} onSelectDate={setSelectedDate} />;
        if (widget.id === 'pomodoro') return <PomodoroTimer key={widget.id} lectures={lectures} selectedDate={selectedDate} />;
        if (widget.id === 'qbank') return <BoardQuestionsTracker key={widget.id} selectedDate={selectedDate} qbankDay={qbankDays[selectedDate]} qbankDays={qbankDays} onSave={saveQbankDay} />;
        if (widget.id === 'examCards') return <ExamCards key={widget.id} lectures={lectures} progress={progress} onSelectDate={setSelectedDate} />;
        if (widget.id === 'overdue') return <OverduePanel key={widget.id} overdueLectures={overdueLectures} progress={progress} onSelectDate={setSelectedDate} onMoveLecture={moveLectureToDate} />;
        if (widget.id === 'catchUp') return <SmartCatchUp key={widget.id} overdueLectures={overdueLectures} progress={progress} />;
        if (widget.id === 'progress') return <ProgressBreakdown key={widget.id} lectures={lectures} progress={progress} />;
        if (widget.id === 'weeklyView') return <WeeklyView key={widget.id} selectedDate={selectedDate} lectures={lectures} progress={progress} onSelectDate={setSelectedDate} onDropLecture={handleDropLecture} onDragStart={handleDragStart} />;
        if (widget.id === 'weeklyReport') return <WeeklyReport key={widget.id} selectedDate={selectedDate} lectures={lectures} progress={progress} />;
        if (widget.id === 'selectedDay') return (
          <section className="panel" key={widget.id}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Selected day</p>
                <h2>{dayLectures.length ? `${dayLectures.length} lecture${dayLectures.length === 1 ? '' : 's'}` : 'No lectures listed for this day'}</h2>
              </div>
            </div>
            <div className="lecture-list">
              {dayLectures.map((lecture) => (
                <LectureCard
                  key={lecture.id}
                  lecture={lecture}
                  progress={progress[lecture.id]}
                  onToggle={toggleTask}
                  onDelete={deleteLecture}
                  onSave={updateLecture}
                  onMoveToDate={moveLectureToDate}
                  onDragStart={handleDragStart}
                />
              ))}
            </div>
          </section>
        );
        if (widget.id === 'allLectures') return dayLectures.length === 0 && lectures.length > 0 ? (
          <section className="panel" key={widget.id}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">All saved lectures</p>
                <h2>Pick one of these dates to view lectures</h2>
              </div>
            </div>
            <div className="all-lecture-list">
              {lectures.slice(0, 40).map((lecture) => (
                <button className="saved-lecture-row" key={lecture.id} onClick={() => setSelectedDate(lecture.date)}>
                  <span>{niceDate(lecture.date)}</span>
                  <strong>{timeLabel(lecture.startTime, lecture.endTime)} · {lecture.title}</strong>
                </button>
              ))}
            </div>
          </section>
        ) : null;
        if (widget.id === 'importer') return <CsvImporter key={widget.id} workspaceId={workspace.workspaceId} selectedDate={selectedDate} onSavedDate={setSelectedDate} />;
        return null;
      })}
    </main>
  );
}

function AppHome({ user }) {
  const [workspaces, setWorkspaces] = useState([]);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    const ref = collection(db, 'users', user.uid, 'workspaces');
    return onSnapshot(ref, (snapshot) => {
      const items = snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => a.name.localeCompare(b.name));
      setWorkspaces(items);
      setSelectedId((prev) => items.some((item) => item.workspaceId === prev) ? prev : (items.length ? items[0].workspaceId : ''));
    });
  }, [user.uid]);

  const selectedWorkspace = workspaces.find((item) => item.workspaceId === selectedId);

  return (
    <div className="app-frame">
      <WorkspaceSidebar user={user} workspaces={workspaces} selectedId={selectedId} onSelect={setSelectedId} />
      {selectedWorkspace ? (
        <Dashboard user={user} workspace={selectedWorkspace} />
      ) : (
        <main className="dashboard empty-state">
          <section className="setup-card">
            <p className="eyebrow">Start here</p>
            <h1>Create a block workspace or join one with a share code.</h1>
            <p>After that, import the CSV block calendar and start checking off your lectures from any device.</p>
          </section>
        </main>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isFirebaseConfigured || !auth) {
      setLoading(false);
      return undefined;
    }
    return onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          await setDoc(doc(db, 'users', firebaseUser.uid), {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            username: firebaseUser.displayName || firebaseUser.email,
            lastSeenAt: serverTimestamp()
          }, { merge: true });
        }
        setUser(firebaseUser);
      } catch (err) {
        console.error('User profile sync failed:', err);
        setUser(firebaseUser);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  if (!isFirebaseConfigured) return <MissingFirebase />;
  if (loading) return <main className="app-shell centered"><div className="loader">Loading…</div></main>;
  if (!user) return <AuthScreen />;
  return <AppHome user={user} />;
}
