"""SQLite persistence shared by HTTP processes and the single durable worker."""
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DATA = Path(os.getenv('DATA_DIR', './data')).resolve()
DATA.mkdir(parents=True, exist_ok=True)
(DATA / 'assets').mkdir(exist_ok=True)
DB = DATA / 'studio.sqlite3'


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid.uuid4().hex


@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init():
    with connect() as db:
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY, document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS versions (
          id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL,
          revision INTEGER NOT NULL, document TEXT NOT NULL, created_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
          mime TEXT NOT NULL, size INTEGER NOT NULL, source TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL,
          state TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
          request TEXT NOT NULL, result TEXT, error TEXT, remote_id TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          idempotency_key TEXT UNIQUE NOT NULL,
          FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state, created_at);
        CREATE TABLE IF NOT EXISTS login_attempts (address TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at REAL NOT NULL);
        ''')


def project(row):
    if row is None:
        return None
    return {**json.loads(row['document']), 'id': row['id'], 'revision': row['revision'],
            'created_at': row['created_at'], 'updated_at': row['updated_at']}


def get_project(pid):
    with connect() as db:
        return project(db.execute('SELECT * FROM projects WHERE id=?', (pid,)).fetchone())


def public_asset(row):
    return {**dict(row), 'url': '/api/assets/' + row['id'] + '/file'}


def public_job(row):
    d = dict(row)
    d['request'] = json.loads(d['request'])
    d['result'] = json.loads(d['result']) if d['result'] else None
    return d
