"""Real provider adapters. No fabricated success, hidden retries, or browser-side keys."""
import base64
import ipaddress
import json
import os
import re
import socket
from urllib.parse import urlparse
import requests
from .store import DATA


class ProviderError(Exception):
    pass


class TransientProviderError(ProviderError):
    pass


def config(kind):
    base = os.getenv(kind.upper() + '_BASE_URL', os.getenv('OPENAI_BASE_URL', 'https://api.openai.com/v1')).rstrip('/')
    key = os.getenv(kind.upper() + '_API_KEY', '') or os.getenv('OPENAI_API_KEY', '')
    defaults = {'text': 'gpt-6-astra', 'image': 'gpt-image-2.5-flare', 'video': 'sora-2-pro'}
    return {'base': base, 'key': key, 'model': os.getenv(kind.upper() + '_MODEL', defaults[kind]),
            'adapter': os.getenv(kind.upper() + '_ADAPTER', 'openai')}


def capabilities():
    return {k: {'configured': bool(config(k)['key']), 'model': config(k)['model'],
                'adapter': config(k)['adapter']} for k in ['text', 'image', 'video']}


def request(kind, method, path, **kwargs):
    c = config(kind)
    if not c['key']:
        raise ProviderError('服务端尚未配置 ' + kind.upper() + '_API_KEY / OPENAI_API_KEY')
    parsed = urlparse(c['base'])
    if parsed.scheme != 'https' and os.getenv('ALLOW_INSECURE_PROVIDER') != '1':
        raise ProviderError('服务商地址必须使用 HTTPS')
    headers = {'Authorization': 'Bearer ' + c['key']}
    try:
        r = requests.request(method, c['base'] + path, headers=headers, timeout=(15, 240),
                             allow_redirects=False, **kwargs)
    except requests.RequestException:
        error = TransientProviderError if method == 'GET' else ProviderError
        raise error('服务商请求超时或连接失败。创建任务未自动重试，请先检查服务商账单。') from None
    if not 200 <= r.status_code < 300:
        # Keep keys, submitted prompts, private URLs and provider tracebacks out of UI/logs.
        error = TransientProviderError if method == 'GET' and (r.status_code == 429 or r.status_code >= 500) else ProviderError
        raise error(f'服务商返回 HTTP {r.status_code}；请检查账号权限、余额、模型名称及输入限制。')
    return r


def text_generate(prompt, instruction):
    c = config('text')
    if c['adapter'] == 'chat':
        d = request('text', 'POST', '/chat/completions', json={
            'model': c['model'], 'messages': [{'role': 'system', 'content': instruction},
                                             {'role': 'user', 'content': prompt}]}).json()
        text = d['choices'][0]['message']['content']
    else:
        d = request('text', 'POST', '/responses', json={
            'model': c['model'], 'instructions': instruction, 'input': prompt,
            'max_output_tokens': int(os.getenv('TEXT_MAX_OUTPUT_TOKENS', '16000')), 'store': False}).json()
        if d.get('status') == 'incomplete':
            raise ProviderError('文本输出达到长度上限，请缩小到单场戏后重试')
        text = ''.join(part.get('text', '') for out in d.get('output', [])
                       for part in out.get('content', []) if part.get('type') == 'output_text')
    if not isinstance(text, str) or not text.strip():
        raise ProviderError('服务商未返回可用文本')
    return {'text': text, 'usage': d.get('usage', {})}


def image_generate(prompt, ratio, references):
    c = config('image')
    size = {'9:16': '864x1536', '16:9': '1536x864', '1:1': '1024x1024'}[ratio]
    if c['model'].startswith('gpt-image-1'):
        size = {'9:16': '1024x1536', '16:9': '1536x1024', '1:1': '1024x1024'}[ratio]
    data = {'model': c['model'], 'prompt': prompt, 'size': size, 'quality': os.getenv('IMAGE_QUALITY', 'max' if 'gpt-image-2.5' in c['model'] else 'high'), 'n': 1}
    handles = []
    try:
        if references:
            files = []
            for a in references[:4]:
                h = open(DATA / 'assets' / a['id'], 'rb'); handles.append(h)
                files.append(('image[]', (a['name'], h, a['mime'])))
            d = request('image', 'POST', '/images/edits', data=data, files=files).json()
        else:
            d = request('image', 'POST', '/images/generations', json=data).json()
    finally:
        for h in handles:
            h.close()
    encoded = d.get('data', [{}])[0].get('b64_json')
    if not encoded:
        raise ProviderError('图片服务未返回 b64_json；本适配器要求 GPT Image 格式')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception:
        raise ProviderError('图片数据解码失败') from None
    if len(raw) > 40 * 1024 * 1024:
        raise ProviderError('图片超过 40MB 限制')
    return raw


def video_create(prompt, ratio, duration, reference):
    c = config('video')
    if c['adapter'] == 'seedance':
        content = [{'type': 'text', 'text': prompt}]
        if reference:
            encoded = base64.b64encode((DATA / 'assets' / reference['id']).read_bytes()).decode()
            content.append({'type': 'image_url', 'image_url': {'url': 'data:' + reference['mime'] + ';base64,' + encoded}, 'role': 'first_frame'})
        d = request('video', 'POST', '/contents/generations/tasks', json={
            'model': c['model'], 'content': content, 'ratio': ratio,
            'duration': duration, 'resolution': os.getenv('VIDEO_RESOLUTION', '1080p')}).json()
    else:
        size = {'9:16': '720x1280', '16:9': '1280x720'}.get(ratio)
        if not size or duration not in [4, 8, 12]:
            raise ProviderError('当前 OpenAI 视频适配器使用 4/8/12 秒及 9:16/16:9 画幅')
        data = {'model': c['model'], 'prompt': prompt, 'size': size, 'seconds': str(duration)}
        if reference:
            # The reference must match the video resolution. Preserve the original asset.
            from PIL import Image, ImageOps
            import io
            image = ImageOps.fit(Image.open(DATA / 'assets' / reference['id']).convert('RGB'), tuple(map(int, size.split('x'))))
            buf = io.BytesIO(); image.save(buf, format='JPEG'); buf.seek(0)
            d = request('video', 'POST', '/videos', data=data,
                        files={'input_reference': ('reference.jpg', buf, 'image/jpeg')}).json()
        else:
            d = request('video', 'POST', '/videos', files={k: (None, str(v)) for k, v in data.items()}).json()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', d.get('id', '')):
        raise ProviderError('视频服务未返回有效任务 ID')
    return d['id']


def video_poll(remote_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,200}', remote_id):
        raise ProviderError('视频任务 ID 格式错误')
    seedance = config('video')['adapter'] == 'seedance'
    path = '/contents/generations/tasks/' if seedance else '/videos/'
    d = request('video', 'GET', path + remote_id).json()
    status = d.get('status')
    if status in ['failed', 'expired', 'cancelled']:
        raise ProviderError('视频任务失败或过期，请在服务商控制台查看拒绝原因或输入限制。')
    if status in ['completed', 'succeeded']:
        if seedance:
            return {'done': True, 'url': d.get('content', {}).get('video_url')}
        return {'done': True}
    return {'done': False, 'progress': min(95, int(d.get('progress', 20)))}


def video_content(remote_id, url=None):
    if url:
        return download_public(url)
    r = request('video', 'GET', '/videos/' + remote_id + '/content', stream=True)
    return bounded_bytes(r)


def bounded_bytes(response):
    try:
        out = bytearray()
        for chunk in response.iter_content(65536):
            out.extend(chunk)
            if len(out) > 150 * 1024 * 1024:
                raise ProviderError('生成素材超过 150MB 下载限制')
        return bytes(out)
    finally:
        response.close()


def download_public(url):
    """Only download video results from operator-approved public CDN hosts, without API auth."""
    allowed = os.getenv('MEDIA_HOST_SUFFIXES', 'volces.com,volccdn.com,byteimg.com,openai.com,blob.core.windows.net').split(',')
    for _ in range(4):
        p = urlparse(url or '')
        host = (p.hostname or '').lower()
        if p.scheme != 'https' or p.username or p.password or p.port not in [None, 443] or not any(host == s.strip() or host.endswith('.' + s.strip()) for s in allowed if s.strip()):
            raise ProviderError('生成视频的下载域名不在 MEDIA_HOST_SUFFIXES 白名单中')
        try:
            if any(not ipaddress.ip_address(a[4][0]).is_global for a in socket.getaddrinfo(host, 443)):
                raise ProviderError('禁止下载内网地址')
            r = requests.get(url, timeout=(15, 120), stream=True, allow_redirects=False)
        except requests.RequestException:
            raise ProviderError('生成素材下载失败') from None
        if r.is_redirect:
            from urllib.parse import urljoin
            url = urljoin(url, r.headers.get('Location', '')); r.close(); continue
        if r.status_code != 200:
            r.close(); raise ProviderError('生成素材下载失败')
        return bounded_bytes(r)
    raise ProviderError('生成素材下载重定向过多')
