"""One durable worker per SQLite database. Run separately from the HTTP server."""
import fcntl
import json
import logging
import os
import signal
import time
from . import store, providers
from .app import save_asset

log = logging.getLogger('ruxi.worker')
stop = False


def update(jid, **fields):
    allowed = {'state', 'progress', 'result', 'error', 'remote_id'}
    if not set(fields) <= allowed:
        raise ValueError('invalid job field')
    fields['updated_at'] = store.now()
    with store.connect() as db:
        db.execute('UPDATE jobs SET ' + ','.join(k + '=?' for k in fields) + ' WHERE id=?', [*fields.values(), jid])


def refs(req, pid):
    with store.connect() as db:
        return [dict(db.execute('SELECT * FROM assets WHERE id=? AND project_id=?', (aid, pid)).fetchone()) for aid in req['referenceIds']]


INSTRUCTION = '''你是专业短剧编剧与分镜导演，服务于多种题材和视觉风格，不能擅自限定武侠。
尊重项目的题材、受众、世界设定、角色外貌和服装连续性。输出原创内容。
情节通过人物目标、阻碍、行动与选择推进；镜头必须能被拍摄或生成，有清楚的主体、动作、环境、景别和运镜。
不要把待核验历史内容当作确定史实；不要自动宣称引用了未经提供的资料。
只输出用户所要求的内容。'''


def process(row):
    req = json.loads(row['request']); jid = row['id']; pid = row['project_id']; kind = row['kind']
    try:
        if row['state'] == 'submitted':
            state = providers.video_poll(row['remote_id'])
            if not state['done']:
                update(jid, progress=state.get('progress', 20), error=None); return
            raw = providers.video_content(row['remote_id'], state.get('url'))
            a = save_asset(pid, 'video-' + jid[:8] + '.mp4', raw)
            update(jid, state='completed', progress=100, error=None, result=json.dumps({'asset': a})); return
        update(jid, state='running', progress=5)
        context = json.dumps(req['context'], ensure_ascii=False)
        if kind in ['script', 'shotlist']:
            instruction = INSTRUCTION
            if kind == 'shotlist':
                instruction += '''\n输出严格 JSON 对象 {"shots":[{"title":"","action":"","dialogue":"","sound":"","camera":"","duration":4,"prompt":"","continuity":""}]}。
每镜头 4、8 或 12 秒，建议 6 到 18 个镜头。prompt 为独立可用的完整画面提示词。不要输出 Markdown 围栏。'''
            result = providers.text_generate('项目上下文：\n' + context + '\n创作要求：\n' + req['prompt'], instruction)
            if kind == 'shotlist':
                text = result['text'].strip()
                if text.startswith('```'):
                    text = '\n'.join(text.splitlines()[1:-1])
                try:
                    parsed = json.loads(text)
                    if not isinstance(parsed, dict) or not isinstance(parsed.get('shots'), list) or not 1 <= len(parsed['shots']) <= 100:
                        raise ValueError()
                    for s in parsed['shots']:
                        if not isinstance(s, dict) or not isinstance(s.get('action'), str) or s.get('duration', 4) not in [4, 8, 12]:
                            raise ValueError()
                        for key in ['title','dialogue','sound','camera','prompt','continuity']:
                            if not isinstance(s.get(key, ''), str) or len(s.get(key, '')) > 16000:
                                raise ValueError()
                    result['shots'] = parsed['shots']
                except (ValueError, TypeError):
                    # Preserve generated text even if it cannot be applied as structured shots.
                    result['parseError'] = '模型返回了非标准分镜格式，可复制文本后手动整理。'
            update(jid, state='completed', progress=100, error=None, result=json.dumps(result, ensure_ascii=False))
        elif kind == 'image':
            raw = providers.image_generate(req['prompt'], req['ratio'], refs(req, pid))
            a = save_asset(pid, 'frame-' + jid[:8] + '.png', raw)
            update(jid, state='completed', progress=100, error=None, result=json.dumps({'asset': a}))
        elif kind == 'video':
            references = refs(req, pid)
            remote_id = providers.video_create(req['prompt'], req['ratio'], req['duration'], references[0] if references else None)
            # Persist the remote ID before polling so process restarts resume instead of re-billing.
            update(jid, state='submitted', progress=0, remote_id=remote_id)
    except providers.TransientProviderError as e:
        if row['state'] == 'submitted':
            update(jid, error='远端查询暂时失败，将继续查询同一任务，不重复提交。')
        else:
            update(jid, state='failed', error=str(e))
    except providers.ProviderError as e:
        update(jid, state='failed', error=str(e))
    except Exception as e:
        log.error('Job %s failed: %s', jid, type(e).__name__)
        update(jid, state='failed', error='任务处理失败；结果未自动重试，请检查服务端日志。')


def main():
    global stop
    logging.basicConfig(level=logging.INFO)
    store.init()
    lock = open(store.DATA / 'worker.lock', 'w')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit('该数据库已有 worker 正在运行')
    # A crashed POST may have reached the provider. Never silently submit it again.
    with store.connect() as db:
        db.execute("UPDATE jobs SET state='failed', error='服务在生成过程中重启，提交结果未知。请先检查服务商任务与账单，再手动重试。',updated_at=? WHERE state='running'", (store.now(),))
    def shutdown(*_):
        global stop
        stop = True
    signal.signal(signal.SIGTERM, shutdown); signal.signal(signal.SIGINT, shutdown)
    while not stop:
        with store.connect() as db:
            submitted = db.execute("SELECT * FROM jobs WHERE state='submitted' ORDER BY updated_at LIMIT 10").fetchall()
        for job in submitted:
            if stop:
                break
            process(job)
        with store.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET state='running' WHERE id=? AND state='queued'", (row['id'],))
        if row and not stop:
            process(row)
        time.sleep(3)


if __name__ == '__main__':
    main()
