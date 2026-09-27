import json

import pytest

from api_utils.local_store import LocalStoreError
from api_utils.reference_store import ReferenceStore


def test_migration_does_not_restore_deleted_records_on_restart(tmp_path):
    data = tmp_path / 'data'
    data.mkdir()
    (data / 'artist-threads.json').write_text(json.dumps({'data': [
        {'id': 'synthetic', 'title': 'Test', 'prompt': 'test', 'images': []},
    ]}), encoding='utf-8')
    store = ReferenceStore(data, tmp_path / 'public')
    assert len(store.list('artist')) == 1
    assert store.delete('artist', 'synthetic')
    assert ReferenceStore(data, tmp_path / 'public').list('artist') == []


def test_update_can_explicitly_clear_parameters(tmp_path):
    store = ReferenceStore(tmp_path, tmp_path / 'public')
    entry = {'id': 'synthetic', 'title': 'Test', 'prompt': '',
             'parameters': {'seed': 42}, 'created_at': '2026-01-01'}
    store.create('image', entry, [])
    assert store.update('image', entry['id'], 'Test', '', None, True)['parameters'] is None


def test_migration_adds_missing_records_without_overwriting_existing_records(tmp_path):
    store = ReferenceStore(tmp_path, tmp_path / 'public')
    store.create('artist', {
        'id': 'existing', 'title': 'Edited', 'prompt': 'current', 'created_at': '2026-01-01',
    }, [])
    legacy_path = tmp_path / 'artist-threads.json'
    legacy_content = json.dumps({'data': [
        {'id': 'existing', 'title': 'Old', 'prompt': 'old', 'images': []},
        {'id': 'missing', 'title': 'Imported', 'prompt': 'legacy', 'images': []},
    ]})
    legacy_path.write_text(legacy_content, encoding='utf-8')

    migrated = ReferenceStore(tmp_path, tmp_path / 'public')
    assert migrated.get('artist', 'existing')['title'] == 'Edited'
    assert migrated.get('artist', 'missing')['prompt'] == 'legacy'
    assert legacy_path.read_text(encoding='utf-8') == legacy_content
    assert migrated.delete('artist', 'missing')
    assert ReferenceStore(tmp_path, tmp_path / 'public').get('artist', 'missing') is None


@pytest.mark.parametrize('content', ['broken JSON', '{"data": {}}'])
def test_migration_exposes_unreadable_legacy_data_instead_of_silently_ignoring_it(tmp_path, content):
    legacy_path = tmp_path / 'artist-threads.json'
    legacy_path.write_text(content, encoding='utf-8')
    with pytest.raises(LocalStoreError):
        ReferenceStore(tmp_path, tmp_path / 'public')
    assert legacy_path.read_text(encoding='utf-8') == content
