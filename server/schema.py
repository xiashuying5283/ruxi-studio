"""Keep imports, browser writes and model output bounded and structurally valid."""
import copy
import json
import math
import re

GENRES = ['剧情', '悬疑', '爱情', '喜剧', '科幻', '奇幻', '历史', '武侠', '都市', '其他']
STYLES = ['真人电影', '写实动画', '二维动画', '三维动画', '水墨风格', '定格动画', '其他']


def clean_text(value, limit=10000):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError('文本字段类型不正确或超出长度限制')
    return value


def number(value, lower, upper):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lower <= value <= upper:
        raise ValueError('数值超出允许范围')
    return value


def records(value, fields, maximum=500):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError('列表格式不正确或数量超限')
    out = []
    ids = set()
    for item in value:
        if not isinstance(item, dict):
            raise ValueError('列表中的条目必须是对象')
        row = {}
        for key, default in fields.items():
            val = item.get(key, copy.deepcopy(default))
            if isinstance(default, str):
                row[key] = clean_text(val, 100000 if key == 'script' else 16000)
            elif isinstance(default, list):
                if not isinstance(val, list) or len(val) > 100:
                    raise ValueError('引用列表格式错误')
                row[key] = [clean_text(v, 100) for v in val]
            else:
                row[key] = number(val, 0, 1000000)
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', row.get('id', '')) or row['id'] in ids:
            raise ValueError('条目 ID 缺失或重复')
        ids.add(row['id'])
        out.append(row)
    return out


SHOT = dict(id='', episodeId='', title='', sceneId='', characterIds=[], action='', dialogue='', sound='',
            camera='中景 · 固定机位', duration=4, status='待制作', prompt='', negative='',
            imageId='', videoId='', cost=0, continuity='')
CHARACTER = dict(id='', name='', role='', appearance='', costume='', motivation='', voice='', referenceId='')
SCENE = dict(id='', name='', description='', lighting='', referenceId='')
EPISODE = dict(id='', title='', synopsis='', script='')


def validate(data):
    if not isinstance(data, dict) or len(json.dumps(data, ensure_ascii=False)) > 2000000:
        raise ValueError('项目格式错误或超过 2MB 文本限制')
    p = {k: clean_text(data.get(k, v), 16000) for k, v in
         dict(title='未命名项目', genre='剧情', style='真人电影', ratio='9:16', logline='', setting='', notes='').items()}
    if not p['title'].strip():
        raise ValueError('项目名称不能为空')
    if p['ratio'] not in ['9:16', '16:9', '1:1']:
        raise ValueError('不支持的画幅')
    p['budget'] = number(data.get('budget', 1000), 0, 100000000)
    p['episodes'] = records(data.get('episodes', []), EPISODE, 200)
    p['characters'] = records(data.get('characters', []), CHARACTER, 200)
    p['scenes'] = records(data.get('scenes', []), SCENE, 200)
    p['shots'] = records(data.get('shots', []), SHOT, 2000)
    ep_ids = {e['id'] for e in p['episodes']}
    char_ids = {c['id'] for c in p['characters']}
    scene_ids = {s['id'] for s in p['scenes']}
    for s in p['shots']:
        if s['episodeId'] not in ep_ids or any(c not in char_ids for c in s['characterIds']):
            raise ValueError('镜头引用了不存在的分集或角色')
        if s['sceneId'] and s['sceneId'] not in scene_ids:
            raise ValueError('镜头引用了不存在的场景')
        if s['status'] not in ['待制作', '制作中', '待审核', '已完成'] or not 1 <= s['duration'] <= 60:
            raise ValueError('镜头状态或时长不正确')
    return p
