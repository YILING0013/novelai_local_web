import json

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
