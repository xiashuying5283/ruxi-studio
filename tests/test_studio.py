import base64
import io
import json
import os
import tempfile
import unittest
import zipfile
from unittest.mock import patch, Mock

os.environ['DATA_DIR'] = tempfile.mkdtemp(prefix='ruxi-test-')
os.environ['COOKIE_SECURE'] = '0'
from PIL import Image
from server import store, providers
from server.app import create_app
from server.worker import process


def png():
    b = io.BytesIO(); Image.new('RGB', (16, 16), '#a2c8b0').save(b, 'PNG'); return b.getvalue()


def project():
    return {'title': '测试 · 科幻', 'genre': '科幻', 'style': '真人电影', 'ratio': '16:9',
            'episodes': [{'id': 'ep1', 'title': '第一集', 'script': '列车停下。'}],
            'shots': [{'id': 's1', 'episodeId': 'ep1', 'action': '列车停下，检票员望向乘客。'}]}


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app({'TESTING': True, 'SESSION_COOKIE_SECURE': False})
        self.c = self.app.test_client()
        self.csrf = self.c.get('/api/session').json['csrf']
        r = self.post('/login', {'password': 'test-password-123'})
        self.assertEqual(r.status_code, 200)
        self.csrf = r.json['csrf']
        self.p = self.post('/projects', project()).json

    def post(self, path, data):
        return self.c.post('/api' + path, json=data, headers={'X-CSRF-Token': self.csrf})

    def test_auth_and_csrf(self):
        fresh = self.app.test_client()
        self.assertEqual(fresh.get('/api/projects').status_code, 401)
        self.assertEqual(self.c.post('/api/projects', json=project()).status_code, 403)
        self.assertNotIn('API_KEY', json.dumps(self.c.get('/api/config').json))
        with self.c.get('/') as response:
            self.assertIn("script-src 'self'", response.headers['Content-Security-Policy'])
        self.assertEqual(self.c.get('/healthz').status_code, 200)

    def test_revision_conflict_preserves_history(self):
        old = dict(self.p); self.p['title'] = '新的标题'
        r = self.c.put('/api/projects/'+self.p['id'], json=self.p, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json['revision'], 2)
        r2 = self.c.put('/api/projects/'+self.p['id'], json=old, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(r2.status_code, 409)
        v = self.c.get('/api/projects/'+self.p['id']+'/versions/1').json
        self.assertEqual(v['title'], old['title'])

    def test_schema_rejects_bad_references_nan_and_empty_title(self):
        p = project(); p['shots'][0]['episodeId'] = 'missing'
        self.assertEqual(self.post('/projects', p).status_code, 400)
        p = project(); p['budget'] = float('nan')
        self.assertEqual(self.post('/projects', p).status_code, 400)
        p = project(); p['title'] = ' '
        self.assertEqual(self.post('/projects', p).status_code, 400)

    def test_upload_export_and_auth_file_access(self):
        url = '/api/projects/'+self.p['id']+'/assets'
        r = self.c.post(url, data={'file': (io.BytesIO(png()), '../../frame.png')}, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(r.status_code, 201)
        a = r.json; self.assertEqual(a['name'], 'frame.png')
        self.assertTrue((store.DATA/'assets'/a['id']).exists())
        self.assertEqual(self.app.test_client().get(a['url']).status_code, 401)
        invalid = self.c.post(url, data={'file': (io.BytesIO(b'<script>bad()</script>'), 'fake.png')}, headers={'X-CSRF-Token': self.csrf})
        self.assertEqual(invalid.status_code, 400)
        r = self.c.get('/api/projects/'+self.p['id']+'/export')
        self.assertEqual(r.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(r.data)) as z:
            self.assertIn('project.json', z.namelist())
            self.assertIn('production.md', z.namelist())
            self.assertTrue(any(s.startswith('assets/') for s in z.namelist()))
        r.close()

    @patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-test-key'})
    def test_idempotent_queue_cancel_and_unconfigured(self):
        request = {'kind': 'script', 'prompt': '写一场科幻剧', 'idempotencyKey': store.uid()}
        path = '/projects/'+self.p['id']+'/jobs'
        first = self.post(path, request); second = self.post(path, request)
        self.assertEqual(first.status_code, 202)
        self.assertEqual(first.json['id'], second.json['id'])
        cancel = self.post('/jobs/'+first.json['id']+'/cancel', {})
        self.assertEqual(cancel.status_code, 200)
        self.assertEqual(self.post('/jobs/'+first.json['id']+'/cancel', {}).status_code, 409)

    @patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-test-key'})
    def test_character_portrait_targets_character_without_overwriting_reference(self):
        p = project(); p['characters'] = [{'id':'hero', 'name':'检票员', 'appearance':'短发，瘦削'}]
        p = self.post('/projects', p).json
        r = self.post('/projects/'+p['id']+'/jobs', {
            'kind':'image', 'characterId':'hero', 'prompt':'角色定妆图', 'idempotencyKey':store.uid()})
        self.assertEqual(r.status_code, 202)
        self.assertEqual(r.json['request']['characterId'], 'hero')
        self.assertEqual(r.json['request']['characterName'], '检票员')
        self.assertEqual(r.json['request']['ratio'], '9:16')
        with store.connect() as db:
            row=db.execute('SELECT * FROM jobs WHERE id=?',(r.json['id'],)).fetchone()
        with patch('server.providers.image_generate', return_value=png()) as generate:
            process(row)
        self.assertEqual(generate.call_args.args[1], '9:16')
        self.assertEqual(store.get_project(p['id'])['characters'][0]['referenceId'], '')
        with store.connect() as db:
            result=store.public_job(db.execute('SELECT * FROM jobs WHERE id=?',(r.json['id'],)).fetchone())
        self.assertEqual(result['state'],'completed')
        self.assertTrue(result['result']['asset']['mime'].startswith('image/'))

    @patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-test-key'})
    def test_character_portrait_rejects_missing_character_and_wrong_kind(self):
        path='/projects/'+self.p['id']+'/jobs'
        for kind in ['image','video','script']:
            r=self.post(path, {'kind':kind,'characterId':'not-in-project','prompt':'test','idempotencyKey':store.uid()})
            self.assertEqual(r.status_code,400)

    def test_missing_key_is_not_fake_success(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': '', 'TEXT_API_KEY': ''}):
            r = self.post('/projects/'+self.p['id']+'/jobs', {'kind':'script','prompt':'test','idempotencyKey':store.uid()})
        self.assertEqual(r.status_code, 503)

    @patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-test-key'})
    def test_worker_text_output_keeps_original_script(self):
        r = self.post('/projects/'+self.p['id']+'/jobs', {'kind':'script','prompt':'写剧本','idempotencyKey':store.uid()})
        with store.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (r.json['id'],)).fetchone()
        with patch('server.providers.text_generate', return_value={'text':'新的候选剧本','usage':{'total_tokens':20}}):
            process(row)
        with store.connect() as db:
            out = store.public_job(db.execute('SELECT * FROM jobs WHERE id=?', (r.json['id'],)).fetchone())
        self.assertEqual(out['state'], 'completed')
        self.assertEqual(out['result']['text'], '新的候选剧本')
        self.assertEqual(store.get_project(self.p['id'])['episodes'][0]['script'], '列车停下。')

    @patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-test-key'})
    def test_worker_image_and_video_persist_assets(self):
        r = self.post('/projects/'+self.p['id']+'/jobs', {'kind':'image','prompt':'列车','idempotencyKey':store.uid()})
        with store.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (r.json['id'],)).fetchone()
        with patch('server.providers.image_generate', return_value=png()):
            process(row)
        with store.connect() as db:
            job = db.execute('SELECT * FROM jobs WHERE id=?', (r.json['id'],)).fetchone()
        self.assertEqual(job['state'], 'completed')
        r = self.post('/projects/'+self.p['id']+'/jobs', {'kind':'video','prompt':'列车进站','duration':4,'idempotencyKey':store.uid()})
        with store.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (r.json['id'],)).fetchone()
        with patch('server.providers.video_create', return_value='video_test'):
            process(row)
        with store.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (r.json['id'],)).fetchone()
        self.assertEqual(row['state'], 'submitted'); self.assertEqual(row['remote_id'], 'video_test')
        with patch('server.providers.video_poll', return_value={'done':True}), patch('server.providers.video_content', return_value=b'\x00\x00\x00\x18ftypmp42'+b'\x00'*20):
            process(row)
        with store.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (r.json['id'],)).fetchone()
        self.assertEqual(row['state'], 'completed')

    @patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-test-key'})
    def test_worker_failure_is_persisted(self):
        r = self.post('/projects/'+self.p['id']+'/jobs', {'kind':'image','prompt':'test','idempotencyKey':store.uid()})
        with store.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (r.json['id'],)).fetchone()
        with patch('server.providers.image_generate', side_effect=providers.ProviderError('余额不足')):
            process(row)
        with store.connect() as db:
            row = db.execute('SELECT * FROM jobs WHERE id=?', (r.json['id'],)).fetchone()
        self.assertEqual(row['state'], 'failed'); self.assertEqual(row['error'], '余额不足')


class ProviderTests(unittest.TestCase):
    @patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-test-key', 'TEXT_ADAPTER':'openai'})
    def test_responses_protocol(self):
        response = Mock(status_code=200)
        response.json.return_value={'output':[{'content':[{'type':'output_text','text':'结果'}]}]}
        with patch('requests.request', return_value=response) as req:
            self.assertEqual(providers.text_generate('要求','系统')['text'],'结果')
        self.assertTrue(req.call_args.args[1].endswith('/responses'))
        self.assertFalse(req.call_args.kwargs['json']['store'])

    @patch.dict(os.environ, {'OPENAI_API_KEY': 'unit-test-key'})
    def test_image_generation_body(self):
        response = Mock(status_code=200)
        response.json.return_value={'data':[{'b64_json':base64.b64encode(png()).decode()}]}
        with patch('requests.request', return_value=response) as req:
            self.assertEqual(providers.image_generate('电影画面','16:9',[]),png())
        self.assertEqual(req.call_args.kwargs['json']['quality'],'max')
        self.assertEqual(req.call_args.kwargs['json']['size'],'1536x864')

    @patch.dict(os.environ, {'VIDEO_API_KEY':'unit-test-key','VIDEO_ADAPTER':'seedance', 'VIDEO_BASE_URL':'https://ark.cn-beijing.volces.com/api/v3','VIDEO_MODEL':'configured-model'})
    def test_seedance_protocol(self):
        response = Mock(status_code=200); response.json.return_value={'id':'task_123'}
        with patch('requests.request',return_value=response) as req:
            self.assertEqual(providers.video_create('镜头','9:16',4,None),'task_123')
        payload=req.call_args.kwargs['json']
        self.assertEqual(payload['content'][0]['type'],'text')
        self.assertEqual(payload['model'],'configured-model')
        self.assertTrue(req.call_args.args[1].endswith('/contents/generations/tasks'))

    @patch.dict(os.environ, {'VIDEO_API_KEY':'unit-test-key', 'VIDEO_ADAPTER':'openai', 'VIDEO_BASE_URL':'https://api.openai.com/v1'})
    def test_openai_video_multipart_has_only_valid_fields(self):
        response = Mock(status_code=200); response.json.return_value={'id':'video_123'}
        with patch('requests.request', return_value=response) as req:
            providers.video_create('列车进站', '16:9', 8, None)
        self.assertEqual(set(req.call_args.kwargs['files']), {'prompt','model','size','seconds'})
        self.assertEqual(req.call_args.kwargs['files']['seconds'], (None,'8'))
        with self.assertRaises(providers.ProviderError):
            providers.video_create('列车进站', '1:1', 5, None)

    @patch.dict(os.environ, {'OPENAI_API_KEY':'unit-test-key'})
    def test_transient_get_can_resume_without_new_submission(self):
        response = Mock(status_code=503)
        with patch('requests.request', return_value=response):
            with self.assertRaises(providers.TransientProviderError):
                providers.request('video','GET','/videos/video_123')
            with self.assertRaises(providers.ProviderError):
                providers.request('video','POST','/videos')

    def test_media_download_rejects_private_and_unknown_domains(self):
        for url in ['http://127.0.0.1/a','https://evil.example/a','https://openai.com.evil.example/a']:
            with self.assertRaises(providers.ProviderError):
                providers.download_public(url)
        with patch('socket.getaddrinfo',return_value=[(2,1,6,'',('127.0.0.1',443))]):
            with self.assertRaises(providers.ProviderError):
                providers.download_public('https://cdn.openai.com/a')

    @patch.dict(os.environ, {'OPENAI_API_KEY':'unit-test-key'})
    def test_errors_do_not_leak_key_or_prompt(self):
        r=Mock(status_code=401);r.text='unit-test-key private prompt'
        with patch('requests.request',return_value=r):
            with self.assertRaises(providers.ProviderError) as ctx:
                providers.request('text','POST','/responses',json={})
        self.assertNotIn('unit-test-key',str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
