#!/usr/bin/env python3
"""PAXI disposable in-memory SQLite migration runner. No external DB support."""
import json
import os
import re
import sqlite3
import sys
import time

MAX_MANIFEST = 12 * 1024 * 1024


def authorizer(action, arg1, arg2, database, trigger):
    denied = {
        sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH, sqlite3.SQLITE_PRAGMA,
        sqlite3.SQLITE_CREATE_VTABLE, sqlite3.SQLITE_DROP_VTABLE,
        sqlite3.SQLITE_CREATE_TEMP_INDEX, sqlite3.SQLITE_CREATE_TEMP_TABLE,
        sqlite3.SQLITE_CREATE_TEMP_TRIGGER, sqlite3.SQLITE_CREATE_TEMP_VIEW,
        sqlite3.SQLITE_DROP_TEMP_INDEX, sqlite3.SQLITE_DROP_TEMP_TABLE,
        sqlite3.SQLITE_DROP_TEMP_TRIGGER, sqlite3.SQLITE_DROP_TEMP_VIEW,
    }
    if action in denied:
        return sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION and str(arg2 or arg1 or '').lower() in {'load_extension', 'readfile', 'writefile'}:
        return sqlite3.SQLITE_DENY
    if action in {sqlite3.SQLITE_READ, sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE}:
        if database not in (None, 'main'):
            return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def schema_snapshot(conn):
    conn.set_authorizer(None)
    try:
        rows = conn.execute("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").fetchall()
        integrity = conn.execute('PRAGMA integrity_check').fetchone()[0]
    finally:
        conn.set_authorizer(authorizer)
    normalized = [{'type': row[0], 'name': row[1], 'table': row[2], 'sql': row[3]} for row in rows]
    digest = __import__('hashlib').sha256(json.dumps(normalized, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'objects': normalized, 'sha256': digest, 'integrity': integrity,
            'tables': sum(1 for row in rows if row[0] == 'table'),
            'indexes': sum(1 for row in rows if row[0] == 'index'),
            'views': sum(1 for row in rows if row[0] == 'view')}


def run_script(conn, sql, label):
    # VACUUM INTO can write a file even when the database itself is in memory.
    # Reject it conservatively before SQLite sees the migration text.
    if re.search(r'\bVACUUM\b', sql, flags=re.IGNORECASE):
        return {'migration': label, 'errorType': 'DeniedOperation', 'message': 'VACUUM (including VACUUM INTO) is denied in the disposable migration lab.'}
    try:
        conn.executescript(sql)
        if conn.in_transaction:
            conn.commit()
        return None
    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        return {'migration': label, 'errorType': type(exc).__name__, 'message': str(exc)[:400]}


def main():
    if len(sys.argv) != 2:
        raise ValueError('Expected one manifest path.')
    manifest_path = os.path.realpath(sys.argv[1])
    if os.path.islink(sys.argv[1]) or not os.path.isfile(manifest_path):
        raise ValueError('Manifest must be a regular file.')
    if os.path.getsize(manifest_path) > MAX_MANIFEST:
        raise ValueError('Manifest exceeds size limit.')
    with open(manifest_path, 'r', encoding='utf-8') as handle:
        manifest = json.load(handle)
    if manifest.get('schemaVersion') != 1 or not isinstance(manifest.get('migrations'), list):
        raise ValueError('Unsupported migration manifest.')
    if len(manifest['migrations']) > 100:
        raise ValueError('Too many migrations.')

    conn = sqlite3.connect(':memory:')
    conn.enable_load_extension(False)
    conn.set_authorizer(authorizer)
    if manifest.get('seed'):
        failure = run_script(conn, manifest['seed'], '<seed-schema>')
        if failure:
            raise RuntimeError('Seed SQL failed: ' + failure['message'])
    before = schema_snapshot(conn)
    results = []
    failed = False
    for item in manifest['migrations']:
        label = str(item.get('name', 'migration'))[:200]
        snapshot = sqlite3.connect(':memory:')
        conn.backup(snapshot)
        failure = run_script(conn, str(item.get('sql', '')), label)
        if failure:
            conn.close()
            conn = snapshot
            conn.set_authorizer(authorizer)
            results.append({'name': label, 'status': 'failed', 'errorType': failure['errorType'], 'message': failure['message']})
            failed = True
            break
        snapshot.close()
        state = schema_snapshot(conn)
        if state['integrity'] != 'ok':
            results.append({'name': label, 'status': 'failed', 'message': 'SQLite integrity_check did not return ok.'})
            failed = True
            break
        results.append({'name': label, 'status': 'passed', 'schemaSha256': state['sha256'], 'tables': state['tables'], 'indexes': state['indexes'], 'views': state['views']})
    after = schema_snapshot(conn)
    conn.close()
    output = {
        'schemaVersion': 1, 'reportType': 'paxi-disposable-database-lab',
        'generatedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'status': 'failed' if failed else 'passed', 'passed': not failed,
        'summary': {'total': len(results), 'passed': sum(1 for item in results if item['status'] == 'passed'), 'failed': sum(1 for item in results if item['status'] == 'failed')},
        'before': before, 'after': after, 'schemaChanged': before['sha256'] != after['sha256'],
        'results': results,
        'safety': {'databaseMode': 'sqlite-in-memory', 'externalConnections': False, 'attachDetachDenied': True, 'pragmaDeniedInMigrationSql': True, 'extensionLoading': False, 'productionTargetPossible': False}
    }
    print(json.dumps(output, separators=(',', ':')))
    return 0 if not failed else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'schemaVersion': 1, 'reportType': 'paxi-disposable-database-lab', 'status': 'failed', 'passed': False, 'errorType': type(error).__name__, 'error': str(error)[:500]}))
        raise SystemExit(2)
