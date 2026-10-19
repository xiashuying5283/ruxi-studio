import csv
import hmac
import io
import json
import mimetypes
import os
import secrets
import sqlite3
import time
import tempfile
import zipfile
from datetime import timedelta
from pathlib import Path
from flask import Flask, jsonify, request, session, send_file, send_from_directory
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash, generate_password_hash
from . import store, schema, providers

ROOT = Path(__file__).resolve().parents[1]


def create_app(test_config=None):
    app = Flask(__name__, static_folder=str(ROOT / 'web'), static_url_path='/static')
    secret = os.getenv('SECRET_KEY', '')
    password = os.getenv('ADMIN_PASSWORD', '')
    password_hash = os.getenv('ADMIN_PASSWORD_HASH', '')
    if test_config:
        secret = 'test-only-secret-at-least-32-characters'; password = 'test-password-123'
    if len(secret) < 32 or (not password_hash and len(password) < 12):
        raise RuntimeError('请配置至少 32 字符 SECRET_KEY 和至少 12 字符 ADMIN_PASSWORD，或 ADMIN_PASSWORD_HASH')
    app.config.update(SECRET_KEY=secret, MAX_CONTENT_LENGTH=100 * 1024 * 1024,
                      SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Strict',
                      SESSION_COOKIE_SECURE=os.getenv('COOKIE_SECURE', '1') == '1',
                      PERMANENT_SESSION_LIFETIME=timedelta(hours=12))
    if test_config:
        app.config.update(test_config)
    login_hash = password_hash or generate_password_hash(password)
    store.init()

    def fail(message, status=400):
        return jsonify(error=message), status

    def body():
        d = request.get_json(silent=True)
        if not isinstance(d, dict):
            raise ValueError('请求必须是 JSON 对象')
        return d

    @app.before_request
    def protect():
        if not request.path.startswith('/api/'):
            return
        if request.method not in ['GET', 'HEAD', 'OPTIONS']:
            token = request.headers.get('X-CSRF-Token', '')
            if not token or not hmac.compare_digest(token, session.get('csrf', '')):
                return fail('会话校验失效，请刷新后重试', 403)
        if request.path not in ['/api/session', '/api/login'] and not session.get('owner'):
            return fail('请先登录', 401)

    @app.after_request
    def headers(response):
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        return response

    @app.errorhandler(ValueError)
    def invalid(e):
        return fail(str(e))

    @app.errorhandler(HTTPException)
    def http_error(e):
        if request.path.startswith('/api/'):
            return fail('上传文件超出 100MB 限制' if e.code == 413 else e.description, e.code)
        return e

    @app.errorhandler(Exception)
    def unexpected(e):
        app.logger.error('Unexpected server error: %s', type(e).__name__)
        return fail('服务器处理失败，请查看服务端日志并保留当前编辑内容', 500)

    @app.get('/healthz')
    def health():
        with store.connect() as db:
            db.execute('SELECT 1').fetchone()
        return jsonify(status='ok')

    @app.get('/')
    def index():
        return send_from_directory(ROOT / 'web', 'index.html')

    @app.get('/api/session')
    def current():
        if 'csrf' not in session:
            session['csrf'] = secrets.token_urlsafe(32)
        return jsonify(authenticated=bool(session.get('owner')), csrf=session['csrf'])

    @app.post('/api/login')
    def login():
        address = request.remote_addr or 'unknown'  # Never trust arbitrary X-Forwarded-For.
        with store.connect() as db:
            row = db.execute('SELECT * FROM login_attempts WHERE address=?', (address,)).fetchone()
            if row and row['reset_at'] > time.time() and row['attempts'] >= 10:
                return fail('登录尝试过多，请 15 分钟后再试', 429)
        supplied = body().get('password', '')
        if not isinstance(supplied, str) or len(supplied) > 1024:
            return fail('密码格式错误')
        if not check_password_hash(login_hash, supplied):
            with store.connect() as db:
                db.execute('''INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(address)
                  DO UPDATE SET attempts=CASE WHEN reset_at < ? THEN 1 ELSE attempts+1 END,
                  reset_at=CASE WHEN reset_at < ? THEN ? ELSE reset_at END''',
                           (address, time.time()+900, time.time(), time.time(), time.time()+900))
            return fail('密码不正确', 401)
        with store.connect() as db:
            db.execute('DELETE FROM login_attempts WHERE address=?', (address,))
        session.clear(); session['owner'] = True; session['csrf'] = secrets.token_urlsafe(32); session.permanent = True
        return jsonify(authenticated=True, csrf=session['csrf'])

    @app.post('/api/logout')
    def logout():
        session.clear()
        return jsonify(ok=True)

    @app.get('/api/config')
    def configuration():
        return jsonify(providers=providers.capabilities(), genres=schema.GENRES, styles=schema.STYLES,
                       storage='SQLite + 本地文件', version='2.0.0', max_upload_mb=100)

    @app.get('/api/projects')
    def list_projects():
        with store.connect() as db:
            rows = db.execute('SELECT * FROM projects ORDER BY updated_at DESC').fetchall()
        return jsonify(projects=[store.project(r) for r in rows])

    @app.post('/api/projects')
    def create_project():
        p = schema.validate(body()); pid = store.uid(); stamp = store.now()
        with store.connect() as db:
            db.execute('INSERT INTO projects VALUES (?,?,1,?,?)', (pid, json.dumps(p, ensure_ascii=False), stamp, stamp))
        return jsonify(store.get_project(pid)), 201

    @app.get('/api/projects/<pid>')
    def read_project(pid):
        p = store.get_project(pid)
        return jsonify(p) if p else fail('项目不存在', 404)

    @app.put('/api/projects/<pid>')
    def update_project(pid):
        data = body(); revision = data.get('revision'); p = schema.validate(data)
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            prev = db.execute('SELECT * FROM projects WHERE id=?', (pid,)).fetchone()
            if not prev:
                return fail('项目不存在', 404)
            if revision != prev['revision']:
                return fail('项目已在其他窗口更新。请先导出当前编辑，再刷新合并；不会覆盖服务器内容。', 409)
            db.execute('INSERT INTO versions(project_id,revision,document,created_at) VALUES (?,?,?,?)',
                       (pid, prev['revision'], prev['document'], store.now()))
            db.execute('DELETE FROM versions WHERE project_id=? AND id NOT IN (SELECT id FROM versions WHERE project_id=? ORDER BY id DESC LIMIT 50)', (pid, pid))
            db.execute('UPDATE projects SET document=?, revision=revision+1, updated_at=? WHERE id=?',
                       (json.dumps(p, ensure_ascii=False), store.now(), pid))
        return jsonify(store.get_project(pid))

    @app.get('/api/projects/<pid>/versions')
    def versions(pid):
        with store.connect() as db:
            rows = db.execute('SELECT revision,created_at FROM versions WHERE project_id=? ORDER BY id DESC', (pid,)).fetchall()
        return jsonify(versions=[dict(r) for r in rows])

    @app.get('/api/projects/<pid>/versions/<int:revision>')
    def version(pid, revision):
        with store.connect() as db:
            row = db.execute('SELECT document FROM versions WHERE project_id=? AND revision=?', (pid, revision)).fetchone()
        return jsonify(json.loads(row['document'])) if row else fail('版本不存在', 404)

    @app.get('/api/projects/<pid>/assets')
    def list_assets(pid):
        with store.connect() as db:
            rows = db.execute('SELECT * FROM assets WHERE project_id=? ORDER BY created_at DESC', (pid,)).fetchall()
        return jsonify(assets=[store.public_asset(r) for r in rows])

    @app.post('/api/projects/<pid>/assets')
    def upload(pid):
        if not store.get_project(pid):
            return fail('项目不存在', 404)
        f = request.files.get('file')
        if not f:
            return fail('请选择文件')
        raw = f.read()
        asset = save_asset(pid, f.filename or 'asset', raw, source='upload')
        return jsonify(asset), 201

    @app.get('/api/assets/<aid>/file')
    def asset_file(aid):
        with store.connect() as db:
            a = db.execute('SELECT * FROM assets WHERE id=?', (aid,)).fetchone()
        if not a:
            return fail('素材不存在', 404)
        return send_file(store.DATA / 'assets' / a['id'], mimetype=a['mime'],
                         as_attachment=request.args.get('download') == '1', download_name=a['name'], conditional=True)

    @app.get('/api/projects/<pid>/jobs')
    def jobs(pid):
        with store.connect() as db:
            rows = db.execute('SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 100', (pid,)).fetchall()
        return jsonify(jobs=[store.public_job(r) for r in rows])

    @app.post('/api/projects/<pid>/jobs')
    def enqueue(pid):
        p = store.get_project(pid)
        if not p:
            return fail('项目不存在', 404)
        d = body(); kind = d.get('kind')
        if kind not in ['script', 'shotlist', 'image', 'video']:
            return fail('不支持的生成任务')
        mode = 'text' if kind in ['script', 'shotlist'] else kind
        c = providers.config(mode)
        if not c['key']:
            return fail('尚未配置此类模型，请先在服务器 .env 中配置 API 密钥', 503)
        prompt = schema.clean_text(d.get('prompt', ''), 30000).strip()
        if not prompt:
            return fail('请输入生成要求')
        refs = d.get('referenceIds', [])
        if not isinstance(refs, list) or len(refs) > 4 or any(not isinstance(x, str) for x in refs):
            return fail('参考素材格式错误')
        with store.connect() as db:
            for aid in refs:
                a = db.execute('SELECT * FROM assets WHERE id=? AND project_id=?', (aid, pid)).fetchone()
                if not a or not a['mime'].startswith('image/') or a['size'] > 20 * 1024 * 1024:
                    return fail('参考素材必须为本项目中不超过 20MB 的图片')
        duration = d.get('duration', 4)
        if kind == 'video':
            schema.number(duration, 2, 12)
            if int(duration) != duration:
                return fail('视频时长必须为整数秒')
            if c['adapter'] == 'openai' and (duration not in [4, 8, 12] or p['ratio'] == '1:1'):
                return fail('当前 OpenAI 视频接口请选择 4/8/12 秒及横屏或竖屏画幅')
        key = schema.clean_text(d.get('idempotencyKey', ''), 100)
        if len(key) < 16:
            return fail('缺少有效请求标识，请刷新重试')
        req = {'prompt': prompt, 'referenceIds': refs, 'duration': duration, 'ratio': p['ratio'],
               'model': c['model'], 'adapter': c['adapter'], 'shotId': d.get('shotId', ''),
               'episodeId': d.get('episodeId', ''), 'context': {
                   'title': p['title'], 'genre': p['genre'], 'style': p['style'],
                   'setting': p['setting'], 'logline': p['logline'],
                   'characters': p['characters'], 'scenes': p['scenes']}}
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT * FROM jobs WHERE idempotency_key=?', (key,)).fetchone()
            if existing:
                if existing['project_id'] != pid:
                    return fail('请求标识重复', 409)
                return jsonify(store.public_job(existing))
            active = db.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','running','submitted')").fetchone()[0]
            if active >= 20:
                return fail('待处理任务已达 20 个，请等待任务完成', 429)
            jid = store.uid(); stamp = store.now()
            db.execute('''INSERT INTO jobs(id,project_id,kind,state,request,created_at,updated_at,idempotency_key)
                          VALUES (?,?,?,'queued',?,?,?,?)''',
                       (jid, pid, kind, json.dumps(req, ensure_ascii=False), stamp, stamp, key))
            result = store.public_job(db.execute('SELECT * FROM jobs WHERE id=?', (jid,)).fetchone())
        return jsonify(result), 202

    @app.post('/api/jobs/<jid>/cancel')
    def cancel(jid):
        with store.connect() as db:
            cur = db.execute("UPDATE jobs SET state='cancelled',updated_at=? WHERE id=? AND state='queued'", (store.now(), jid))
        return jsonify(ok=True) if cur.rowcount else fail('仅排队中的任务可以取消；已提交的任务会继续取回结果', 409)

    @app.get('/api/projects/<pid>/export')
    def export(pid):
        p = store.get_project(pid)
        if not p:
            return fail('项目不存在', 404)
        with store.connect() as db:
            assets = db.execute('SELECT * FROM assets WHERE project_id=?', (pid,)).fetchall()
        buf = tempfile.TemporaryFile(dir=store.DATA)
        with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('project.json', json.dumps(p, ensure_ascii=False, indent=2))
            z.writestr('README.txt', '入戏 Studio 项目交付包\nproject.json 可导入恢复文字档案；assets 包含原始素材，需重新上传并绑定。\n数据库完整恢复请使用服务器 data 目录备份。\n')
            z.writestr('production.md', production_markdown(p))
            csvbuf = io.StringIO(); writer = csv.writer(csvbuf)
            writer.writerow(['编号', '分集', '镜头', '画面', '对白', '景别运镜', '秒数', '状态', '费用', '图片素材ID', '视频素材ID'])
            for i, s in enumerate(p['shots']):
                values = [i+1, s['episodeId'], s['title'], s['action'], s['dialogue'], s['camera'], s['duration'], s['status'], s['cost'], s['imageId'], s['videoId']]
                writer.writerow(["'" + str(v) if str(v).startswith(('=', '+', '-', '@', '\t', '\r')) else v for v in values])
            z.writestr('shots.csv', '\ufeff' + csvbuf.getvalue())
            for a in assets:
                file = store.DATA / 'assets' / a['id']
                if file.exists():
                    z.write(file, 'assets/' + a['id'] + '.' + a['name'].rsplit('.', 1)[-1])
        buf.seek(0)
        response = send_file(buf, mimetype='application/zip', as_attachment=True, download_name='ruxi-project.zip')
        response.call_on_close(buf.close)
        return response

    return app


def production_markdown(p):
    lines = [f"# {p['title']}", p['logline'], f"题材：{p['genre']}｜风格：{p['style']}｜画幅：{p['ratio']}", '## 世界与时代', p['setting'], '## 角色']
    for c in p['characters']:
        lines += ['### ' + c['name'], c['appearance'], c['costume'], c['motivation']]
    for e in p['episodes']:
        lines += ['## ' + e['title'], e['script']]
        for i, s in enumerate([s for s in p['shots'] if s['episodeId'] == e['id']]):
            lines += [f"### 镜头 {i+1} · {s['title']} · {s['duration']} 秒", s['action'], '对白：' + s['dialogue'], '运镜：' + s['camera'], '提示词：' + s['prompt'], '连续性：' + s['continuity']]
    return '\n\n'.join(lines)


def save_asset(pid, name, raw, source='generated'):
    from PIL import Image
    mime = None
    try:
        im = Image.open(io.BytesIO(raw)); im.verify()
        mime = Image.MIME.get(im.format)
    except Exception:
        pass
    if mime not in ['image/png', 'image/jpeg', 'image/webp']:
        if len(raw) > 12 and raw[4:8] == b'ftyp':
            mime = 'video/mp4'
        elif raw.startswith(b'ID3') or raw.startswith(b'\xff\xfb'):
            mime = 'audio/mpeg'
        elif raw.startswith(b'RIFF') and raw[8:12] == b'WAVE':
            mime = 'audio/wav'
        else:
            raise ValueError('支持 PNG/JPG/WebP、MP4、MP3、WAV 素材；文件内容与格式必须匹配')
    aid = store.uid()
    ext = {'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'video/mp4': '.mp4', 'audio/mpeg': '.mp3', 'audio/wav': '.wav'}[mime]
    safe_name = Path(name).stem[:100] + ext
    path = store.DATA / 'assets' / aid
    path.write_bytes(raw)
    try:
        with store.connect() as db:
            db.execute('INSERT INTO assets VALUES (?,?,?,?,?,?,?)', (aid, pid, safe_name, mime, len(raw), source, store.now()))
            a = store.public_asset(db.execute('SELECT * FROM assets WHERE id=?', (aid,)).fetchone())
        return a
    except Exception:
        path.unlink(missing_ok=True)
        raise
