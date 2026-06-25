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

const TASKS = [
  { key: 'watched', label: 'Watched lecture' },
  { key: 'notes', label: 'Took notes' },
  { key: 'anki', label: 'Made Anki' },
  { key: 'pass1', label: 'First pass' },
  { key: 'pass2', label: 'Second pass' }
];

function makeJoinCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function niceDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function timeLabel(start, end) {
  if (!start && !end) return 'No time listed';
  return `${start || ''}${end ? ` – ${end}` : ''}`;
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function completionPercent(progress) {
  const done = TASKS.filter((task) => progress?.[task.key]).length;
  return Math.round((done / TASKS.length) * 100);
}

async function commitDeletesInChunks(refs) {
  const chunkSize = 450;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const batch = writeBatch(db);
    refs.slice(i, i + chunkSize).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

function MissingFirebase() {
  return (
    <main className="app-shell centered">
      <section className="setup-card">
        <p className="eyebrow">Firebase setup needed</p>
        <h1>Add your Firebase config in StackBlitz environment variables or `.env` or <code>.env</code>.</h1>
        <p>
          In StackBlitz, add the six <code>VITE_FIREBASE_...</code> values as environment variables, or create a local <code>.env</code> file from <code>.env.example</code>. Paste the values from Firebase Console → Project settings → General → Your apps → Web app.
        </p>
        <pre>{`VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...`}</pre>
        <p>After saving, restart the StackBlitz preview or run <code>npm run dev</code> again.</p>
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
          Import your block calendar CSV, review today’s lectures, and track lecture watching, notes, Anki creation, and passes in one dark-mode dashboard.
        </p>
        <div className="feature-list">
          <span>☁️ Firebase sync across devices</span>
          <span>👥 Separate accounts for classmates</span>
          <span>📄 CSV calendar import</span>
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
              <button
                className="workspace-btn"
                onClick={() => onSelect(workspace.workspaceId)}
              >
                <span>{workspace.name}</span>
                <small>{workspace.role} · {workspace.joinCode}</small>
              </button>
              <button
                type="button"
                className={workspace.role === 'owner' ? 'workspace-delete-btn' : 'workspace-leave-btn'}
                onClick={() => deleteOrLeaveWorkspace(workspace)}
                disabled={busy}
                title={workspace.role === 'owner' ? 'Delete this block for everyone' : 'Leave this block'}
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
  const [manual, setManual] = useState({ date: selectedDate, startTime: '08:00', endTime: '09:00', title: '', course: '', instructor: '' });

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
        setError('No lectures were detected. Use columns: date,startTime,endTime,course,title,instructor,source. Date and title are required.');
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
        date: manual.date,
        startTime: manual.startTime,
        endTime: manual.endTime,
        title: manual.title.trim(),
        course: manual.course.trim(),
        instructor: manual.instructor.trim(),
        source: 'Manual entry',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      setManual((prev) => ({ ...prev, title: '', course: '', instructor: '' }));
      setMessage('Lecture added. The calendar has jumped to that date.');
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
        <strong>CSV columns:</strong> date, startTime, endTime, course, title, instructor, source
        <a href="/lecture-template.csv" download>Download CSV template</a>
      </div>

      <div className="import-grid">
        <label className="upload-box">
          <input type="file" accept=".csv,text/csv" onChange={handleCsv} />
          <span>📄</span>
          <strong>{busy ? 'Reading CSV…' : 'Choose block calendar CSV'}</strong>
          <small>{fileName || 'Use the template format. Date and title are required.'}</small>
        </label>

        <form onSubmit={addManual} className="manual-form">
          <h3>Manual lecture</h3>
          <div className="row-2">
            <input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} />
            <input value={manual.course} onChange={(e) => setManual({ ...manual, course: e.target.value })} placeholder="Course, optional" />
          </div>
          <div className="row-2">
            <input type="time" value={manual.startTime} onChange={(e) => setManual({ ...manual, startTime: e.target.value })} />
            <input type="time" value={manual.endTime} onChange={(e) => setManual({ ...manual, endTime: e.target.value })} />
          </div>
          <input value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} placeholder="Lecture title" />
          <input value={manual.instructor} onChange={(e) => setManual({ ...manual, instructor: e.target.value })} placeholder="Instructor, optional" />
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
              <div className="preview-row" key={`${lecture.date}-${lecture.startTime}-${index}`}>
                <input type="date" value={lecture.date} onChange={(e) => updateImported(index, { date: e.target.value })} />
                <input type="time" value={lecture.startTime} onChange={(e) => updateImported(index, { startTime: e.target.value })} />
                <input type="time" value={lecture.endTime} onChange={(e) => updateImported(index, { endTime: e.target.value })} />
                <input value={lecture.course || ''} onChange={(e) => updateImported(index, { course: e.target.value })} placeholder="Course" />
                <input value={lecture.title} onChange={(e) => updateImported(index, { title: e.target.value })} placeholder="Title" />
                <button className="icon-btn" onClick={() => removeImported(index)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function shiftISODate(iso, delta) {
  const base = iso || todayISO();
  const [y, m, d] = base.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function LectureCard({ lecture, progress, onToggle, onDelete, onSave }) {
  const percent = completionPercent(progress);
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
    source: lecture.source || 'Lecture'
  });

  useEffect(() => {
    setDraft({
      date: lecture.date || todayISO(),
      startTime: lecture.startTime || '',
      endTime: lecture.endTime || '',
      course: lecture.course || '',
      title: lecture.title || '',
      instructor: lecture.instructor || '',
      source: lecture.source || 'Lecture'
    });
    setEditError('');
  }, [lecture.id, lecture.date, lecture.startTime, lecture.endTime, lecture.course, lecture.title, lecture.instructor, lecture.source]);

  async function handleSave(e) {
    e.preventDefault();
    setEditError('');
    if (!draft.date) {
      setEditError('Date is required.');
      return;
    }
    if (!draft.title.trim()) {
      setEditError('Lecture title is required.');
      return;
    }
    setSaving(true);
    try {
      await onSave(lecture.id, {
        date: draft.date,
        startTime: draft.startTime,
        endTime: draft.endTime,
        course: draft.course.trim(),
        title: draft.title.trim(),
        instructor: draft.instructor.trim(),
        source: draft.source.trim() || 'Lecture'
      });
      setEditing(false);
    } catch (err) {
      setEditError(err.message || 'Could not save lecture changes.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="lecture-card">
      {!editing ? (
        <>
          <div className="lecture-topline">
            <div>
              <p className="time-text">{timeLabel(lecture.startTime, lecture.endTime)}</p>
              <h3>{lecture.title}</h3>
              <p className="lecture-meta">{lecture.course || 'No course listed'} · {lecture.instructor || 'No instructor listed'} · {lecture.source || 'Lecture'}</p>
            </div>
            <div className="percent-pill">{percent}%</div>
          </div>
          <div className="task-grid">
            {TASKS.map((task) => (
              <label className={progress?.[task.key] ? 'check-chip checked' : 'check-chip'} key={task.key}>
                <input type="checkbox" checked={Boolean(progress?.[task.key])} onChange={() => onToggle(lecture.id, task.key)} />
                <span>{task.label}</span>
              </label>
            ))}
          </div>
          <div className="card-actions">
            <button className="ghost-btn" onClick={() => setEditing(true)}>Edit / move</button>
            <button className="ghost-btn danger" onClick={() => onDelete(lecture.id)}>Delete lecture</button>
          </div>
        </>
      ) : (
        <form className="edit-lecture-form" onSubmit={handleSave}>
          <div className="lecture-topline">
            <div>
              <p className="eyebrow">Edit lecture</p>
              <h3>Move this lecture or fix its details</h3>
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
            <label>
              Start time
              <input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
            </label>
            <label>
              End time
              <input type="time" value={draft.endTime} onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
            </label>
          </div>
          <label>
            Course
            <input value={draft.course} onChange={(e) => setDraft({ ...draft, course: e.target.value })} placeholder="PATHOLOGY, ANATOMY, OMM..." />
          </label>
          <label>
            Lecture title
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Lecture title" />
          </label>
          <div className="form-row">
            <label>
              Instructor
              <input value={draft.instructor} onChange={(e) => setDraft({ ...draft, instructor: e.target.value })} placeholder="Dr. Name" />
            </label>
            <label>
              Source/block
              <input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="Block 5" />
            </label>
          </div>
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
      (err) => {
        setDataError(err.message || 'Could not load lectures. Check Firestore rules and refresh.');
      }
    );
  }, [workspace?.workspaceId]);

  useEffect(() => {
    if (!workspace?.workspaceId) return undefined;
    const q = collection(db, 'workspaces', workspace.workspaceId, 'progress');
    return onSnapshot(q, (snapshot) => {
      const next = {};
      snapshot.docs.forEach((item) => {
        const data = item.data();
        if (data.userId === user.uid) next[data.lectureId] = data;
      });
      setProgress(next);
    });
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

  const dayLectures = lectures.filter((lecture) => lecture.date === selectedDate);
  const allDone = lectures.reduce((sum, lecture) => sum + TASKS.filter((task) => progress[lecture.id]?.[task.key]).length, 0);
  const totalTasks = lectures.length * TASKS.length;
  const overall = totalTasks ? Math.round((allDone / totalTasks) * 100) : 0;

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

  async function deleteLecture(lectureId) {
    if (!window.confirm('Delete this lecture for everyone in this workspace?')) return;
    await deleteDoc(doc(db, 'workspaces', workspace.workspaceId, 'lectures', lectureId));
  }

  function moveDay(delta) {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + delta);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    setSelectedDate(iso);
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

      <section className="stats-grid">
        <div className="stat-card"><span>Total lectures</span><strong>{lectures.length}</strong></div>
        <div className="stat-card"><span>Today</span><strong>{dayLectures.length}</strong></div>
        <div className="stat-card"><span>Your completion</span><strong>{overall}%</strong></div>
      </section>

      {dataError && <section className="panel warning-panel"><p className="error-text">{dataError}</p></section>}

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
            <p className="eyebrow">Today's lectures</p>
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
            {lectures.slice(0, 30).map((lecture) => (
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
      if (firebaseUser) {
        await setDoc(doc(db, 'users', firebaseUser.uid), {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          username: firebaseUser.displayName || firebaseUser.email,
          lastSeenAt: serverTimestamp()
        }, { merge: true });
      }
      setUser(firebaseUser);
      setLoading(false);
    });
  }, []);

  if (!isFirebaseConfigured) return <MissingFirebase />;
  if (loading) return <main className="app-shell centered"><div className="loader">Loading…</div></main>;
  if (!user) return <AuthScreen />;
  return <AppHome user={user} />;
}
