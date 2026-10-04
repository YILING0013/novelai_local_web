"""读取只读提示词词库，为官方联想补充中文搜索与翻译。"""

import csv
from pathlib import Path

TAG_DATA_DIRECTORY = Path(__file__).resolve().parent.parent / "prompt_tags"


def normalize_tag(value: str) -> str:
    """把标签统一为小写空格形式，让下划线与空格表示同一个词。

    Args:
        value: 英文标签或搜索词。

    Returns:
        去掉首尾空白、合并连续空白并替换下划线后的字符串。
    """
    return ' '.join(value.lower().replace('_', ' ').split())


def load_tag_database() -> dict:
    """读取 Gallery 主库 CSV，按完整标签去重并按引用量降序排列。

    Args:
        None.

    Returns:
        以规范化标签为键、包含英文名、中文翻译、分组和引用量的字典。
    """
    files = sorted(TAG_DATA_DIRECTORY.glob('*.csv'))
    if not files:
        raise FileNotFoundError(f'提示词 CSV 词库缺失：{TAG_DATA_DIRECTORY}')

    blocked = set()
    for path in sorted((TAG_DATA_DIRECTORY / 'blacklist').glob('*.csv')):
        with path.open(encoding='utf-8-sig', newline='') as source:
            for row in csv.reader(source):
                if not row or row[0].strip().lower() in {'单词', 'word', 'tag'}:
                    continue
                blocked.add(normalize_tag(row[0]))
                if len(row) > 3:
                    blocked.update(normalize_tag(alias) for alias in row[3].split(',') if alias.strip())

    tags = {}
    for path in files:
        with path.open(encoding='utf-8-sig', newline='') as source:
            for row in csv.reader(source):
                if not row or row[0].strip() == '单词':
                    continue
                name, group, count, _aliases, translation = (value.strip() for value in row)
                if not name:
                    continue
                key = normalize_tag(name)
                if key in blocked:
                    continue
                count = int(count or '0')
                if key in tags:
                    # 主库分片存在重复词：保留最高引用量，只补齐缺失翻译与分组。
                    entry = tags[key]
                    entry['count'] = max(entry['count'], count)
                    if not entry['translation']:
                        entry['translation'] = translation
                    if not entry['group']:
                        entry['group'] = group
                        entry['d_category'] = group
                else:
                    tags[key] = {
                        'name': name,
                        'translation': translation,
                        'count': count,
                        'group': group,
                        # 保留旧前端使用的字段，允许先发布后端再发布新编辑器。
                        'tag_name': name,
                        'd_category': group,
                    }

    return dict(sorted(tags.items(), key=lambda item: (-item[1]['count'], item[0])))


# 在 API 启动时检查词库。发布漏带文件时立即报错，避免上线后才发现联想全部失效。
TAG_DATABASE = load_tag_database()
