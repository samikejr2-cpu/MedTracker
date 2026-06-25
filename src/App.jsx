import React, { useEffect, useMemo, useState } from 'react';
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

      {dataError && <section className="panel warning-panel"><p className="error-text">{dataError}</p></section>}

      <TodayPlan selectedDate={selectedDate} lectures={lectures} progress={progress} overdueLectures={overdueLectures} recommendation={recommendation} onSelectDate={setSelectedDate} />
      <ExamCards lectures={lectures} progress={progress} onSelectDate={setSelectedDate} />
      <OverduePanel overdueLectures={overdueLectures} progress={progress} onSelectDate={setSelectedDate} onMoveLecture={moveLectureToDate} />
      <SmartCatchUp overdueLectures={overdueLectures} progress={progress} />
      <ProgressBreakdown lectures={lectures} progress={progress} />
      <WeeklyView selectedDate={selectedDate} lectures={lectures} progress={progress} onSelectDate={setSelectedDate} onDropLecture={handleDropLecture} onDragStart={handleDragStart} />
      <WeeklyReport selectedDate={selectedDate} lectures={lectures} progress={progress} />

      <section className="date-strip">
        {dates.map((date) => (
          <button key={date} className={date === selectedDate ? 'date-chip active' : 'date-chip'} onClick={() => setSelectedDate(date)}>
            {niceDate(date).replace(/, \d{4}/, '')}
          </button>
        ))}
      </section>

      <section className="panel">
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

      {dayLectures.length === 0 && lectures.length > 0 && (
        <section className="panel">
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
      )}

      <CsvImporter workspaceId={workspace.workspaceId} selectedDate={selectedDate} onSavedDate={setSelectedDate} />
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
