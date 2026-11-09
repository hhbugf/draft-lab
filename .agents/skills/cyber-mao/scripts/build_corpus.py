"""Build a lossless, line-addressable corpus from the supplied Mao TXT files.

This is mechanical indexing, not a claim that the full corpus was read.
"""
import argparse
from bisect import bisect_right
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
from tempfile import TemporaryDirectory

SOURCE_SPECS = [{'id': 'wenji', 'path': 'mao-wenji.txt', 'library_file_id': None, 'file_id': None, 'name': '毛泽东文集（基准 TXT）', 'sha256': 'd34783714147b13f12e6e4efb87afad8760244d3c71a8abe4ad9e69cd9904d82'}, {'id': 'xuanji', 'path': 'mao-xuanji.txt', 'library_file_id': None, 'file_id': None, 'name': '毛泽东选集（基准 TXT）', 'sha256': '6f8268fa3121fba84f220fe1e9881cc7328948cb2c2dc0e5e9a06f7052ca8674'}]
CN = dict(zip('〇○零O一二三四五六七八九', '0000123456789'))
DATE = re.compile(r'^[（(]([一二三四五六七八九〇○零O0-9]{4})年[^\n]{0,140}[）)]')
VOL = re.compile(r'^第([一二三四五六七])卷(?:（静火版）)?$')
NOTE = re.compile(r'^(?:[\[〔（(][0-9０-９]+[\]〕）)>]|[＊*]?静火有言)')


def norm(s):
    s = re.sub(r'[\[〔][0-9０-９]+[\]〕>]', '', s)
    return re.sub(r'[\s*＊]', '', s)


def nearest_title(lines, date_index, toc):
    # Match one or several wrapped title lines against the actual TOC.
    recent = [i for i in range(max(0, date_index - 16), date_index) if lines[i].strip()]
    for end in range(len(recent), 0, -1):
        for n in range(1, min(4, end) + 1):
            chosen = recent[end - n:end]
            parts = [lines[i].strip() for i in chosen]
            if any(len(p) > 110 or DATE.match(p) for p in parts):
                break
            candidate = norm(''.join(parts))
            if candidate in toc:
                return chosen[0], ''.join(parts).strip('*＊'), 'toc_and_date'
    return None


def parse_source(spec, raw):
    text = raw.decode('utf-8-sig', errors='strict')
    lines = text.splitlines(keepends=True)
    plain = [l.rstrip('\r\n') for l in lines]
    offsets = [0]
    for l in lines:
        offsets.append(offsets[-1] + len(l))
    assert offsets[-1] == len(text)
    if spec['id'] == 'wenji':
        starts = [i for i, l in enumerate(plain) if l.strip() == '《毛泽东文集》']
        assert len(starts) == 8, starts
        volumes = [{'number': j + 1, 'start': i, 'label': f'文集拼接分册{j + 1}（卷次待纸本确认）', 'edition': 'published_collection_transcription_unverified', 'volume_confidence': 'inferred_from_eight_repeated_book_frontmatters', 'supplementary': False} for j, i in enumerate(starts)]
    else:
        markers = [(i, VOL.fullmatch(l.strip())) for i, l in enumerate(plain)]
        markers = [(i, m) for i, m in markers if m]
        firsts = [i for i, m in markers if m.group(1) == '一']
        assert len(firsts) == 2, firsts
        body_start = firsts[-1]
        volumes = []
        for i, m in markers:
            if i < body_start:
                continue
            n = '一二三四五六七'.index(m.group(1)) + 1
            ed = '1991_second_edition_claim_unverified' if n <= 4 else ('1977_volume5_claim_unverified' if n == 5 else 'jinghuo_private_compilation_crosscheck_required')
            volumes.append({'number': n, 'start': i, 'label': plain[i].strip(), 'edition': ed, 'volume_confidence': 'explicit_heading', 'supplementary': n >= 6})
        assert [v['number'] for v in volumes] == list(range(1, 8))
    global_toc = {norm(l) for l in plain[:volumes[0]['start']] if l.strip() and len(l) < 130}
    all_articles, unknown_dates = [], []
    for j, v in enumerate(volumes):
        v['end'] = volumes[j + 1]['start'] if j + 1 < len(volumes) else len(lines)
        v['id'] = f"{spec['id']}-{v['number']}"
        first_date = next(i for i in range(v['start'], v['end']) if DATE.match(plain[i].strip()))
        tail_toc = next((i for i in range(first_date + 1, v['end']) if re.fullmatch(r'目\s*录\s*[0-9一二三四五六七八]*', plain[i].strip())), v['end'])
        v['trailing_toc_line'] = tail_toc + 1 if tail_toc < v['end'] else None
        ds = [i for i in range(v['start'], tail_toc) if DATE.match(plain[i].strip())]
        # In Wenji each stitched book has its own frontmatter and TOC.
        toc = global_toc if spec['id'] == 'xuanji' else {norm(l) for l in plain[v['start']:ds[0] - 3] if l.strip() and len(l) < 130}
        found = []
        for i in ds:
            hit = nearest_title(plain, i, toc)
            if hit:
                start, title, confidence = hit
                found.append({'source_id': spec['id'], 'volume_id': v['id'], 'title': title, 'start_line': start + 1, 'date_line': i + 1, 'date_raw': plain[i].strip(), 'year': int(''.join(CN.get(c, c) for c in DATE.match(plain[i].strip()).group(1))), 'detection': confidence, 'supplementary': v['supplementary']})
            else:
                unknown_dates.append({'source_id': spec['id'], 'volume_id': v['id'], 'line': i + 1, 'date': plain[i].strip(), 'previous': [plain[k] for k in range(max(v['start'], i - 4), i) if plain[k].strip()]})
        # Several dated subsections can belong to the same parent title.
        found = list({a['start_line']: a for a in found}.values())
        found.sort(key=lambda a: a['start_line'])
        for k, a in enumerate(found):
            a['id'] = f"{v['id']}-L{a['start_line']}"
            a['end_line'] = found[k + 1]['start_line'] - 1 if k + 1 < len(found) else v['end']
        v['first_article_line'] = found[0]['start_line'] if found else None
        v['article_anchors'] = len(found)
        all_articles.extend(found)
    return text, lines, offsets, volumes, all_articles, unknown_dates


def make_chunks(spec, text, lines, offsets, volumes, articles):
    article_starts = {a['start_line'] - 1: a for a in articles}
    vol_starts = {v['start']: v for v in volumes}
    current_vol = None
    current_article = None
    kind = 'table_of_contents'
    segments = []
    for i, rawline in enumerate(lines):
        l = rawline.strip()
        if i in vol_starts:
            current_vol = vol_starts[i]
            current_article = None
            kind = 'frontmatter_or_contents'
        if i in article_starts:
            current_article = article_starts[i]
            kind = 'attributed_text'
        if current_vol and current_vol.get('trailing_toc_line') == i + 1:
            kind = 'table_of_contents'
            current_article = None
        if l == '静火有言' or (l.startswith('〔*静火有言') or l.startswith('〔静火有言')):
            line_kind = 'editor_comment'
            if l == '静火有言':
                kind = 'editor_comment'
        elif re.fullmatch(r'注\s*释', l):
            kind = 'notes'
            line_kind = kind
        elif NOTE.match(l) and kind == 'notes':
            line_kind = 'notes'
        elif '静火有言' in l:
            line_kind = 'contains_editor_comment'
        else:
            line_kind = kind
        key = (current_vol['id'] if current_vol else None, current_article['id'] if current_article else None, line_kind)
        start, end = offsets[i], offsets[i + 1]
        # Keep exact text and offsets; split long paragraphs without losing a byte.
        while start < end:
            stop = min(end, start + 1500)
            if segments and segments[-1]['key'] == key and segments[-1]['end'] == start and stop - segments[-1]['start'] <= 1500:
                segments[-1]['end'] = stop
            else:
                segments.append({'start': start, 'end': stop, 'key': key})
            start = stop
    cursor = 0
    for j, seg in enumerate(segments, 1):
        assert seg['start'] == cursor
        cursor = seg['end']
        a, b = seg['start'], seg['end']
        seg['id'] = f"{spec['id']}-C{j:05d}"
        seg['source_id'] = spec['id']
        seg['volume_id'], seg['article_id'], seg['kind'] = seg.pop('key')
        seg['start_line'] = bisect_right(offsets, a)
        seg['end_line'] = bisect_right(offsets, b - 1)
        seg['text'] = text[a:b]
    assert cursor == len(text)
    assert ''.join(s['text'] for s in segments) == text
    return segments


def build(source_paths, out_dir):
    originals = {}
    for spec in SOURCE_SPECS:
        source_path = source_paths[spec['id']]
        raw = source_path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != spec['sha256']:
            raise ValueError(f"{spec['id']}: {source_path} does not match the baseline TXT SHA-256")
        originals[spec['id']] = raw

    out_dir.mkdir(parents=True, exist_ok=True)
    db_path = out_dir / 'Cyber_Mao_Corpus.sqlite3'
    if db_path.exists():
        raise FileExistsError(f'Refusing to overwrite {db_path}')
    db = sqlite3.connect(db_path)
    db.executescript('''
    CREATE TABLE sources(id TEXT PRIMARY KEY, name TEXT, library_file_id TEXT, file_id TEXT, sha256 TEXT, bytes INTEGER, characters INTEGER, lines INTEGER, raw_text TEXT);
    CREATE TABLE volumes(id TEXT PRIMARY KEY, source_id TEXT, number INTEGER, label TEXT, start_line INTEGER, end_line INTEGER, edition TEXT, supplementary INTEGER);
    CREATE TABLE articles(id TEXT PRIMARY KEY, source_id TEXT, volume_id TEXT, title TEXT, date_raw TEXT, year INTEGER, start_line INTEGER, end_line INTEGER, detection TEXT);
    CREATE TABLE chunks(id TEXT PRIMARY KEY, source_id TEXT, volume_id TEXT, article_id TEXT, kind TEXT, start_line INTEGER, end_line INTEGER, char_start INTEGER, char_end INTEGER, text TEXT);
    CREATE INDEX article_title ON articles(title);
    CREATE INDEX chunks_source ON chunks(source_id,start_line);
    CREATE INDEX chunks_article ON chunks(article_id);
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
    ''')
    summary = {'version': '2.0', 'indexed_date': '2026-11-08', 'reading_status': 'mechanically_indexed_not_fully_read', 'source_files': [], 'warnings': [], 'article_anchors': [], 'unmatched_date_anchors': []}
    for spec in SOURCE_SPECS:
        raw = originals[spec['id']]
        sha = spec['sha256']
        text, lines, offsets, volumes, articles, unknowns = parse_source(spec, raw)
        chunks = make_chunks(spec, text, lines, offsets, volumes, articles)
        db.execute('INSERT INTO sources VALUES(?,?,?,?,?,?,?,?,?)', (spec['id'], spec['name'], spec['library_file_id'], spec['file_id'], sha, len(raw), len(text), len(lines), text))
        for v in volumes:
            db.execute('INSERT INTO volumes VALUES(?,?,?,?,?,?,?,?)', (v['id'], spec['id'], v['number'], v['label'], v['start'] + 1, v['end'], v['edition'], int(v['supplementary'])))
        for a in articles:
            db.execute('INSERT INTO articles VALUES(?,?,?,?,?,?,?,?,?)', (a['id'], a['source_id'], a['volume_id'], a['title'], a['date_raw'], a['year'], a['start_line'], a['end_line'], a['detection']))
        for c in chunks:
            db.execute('INSERT INTO chunks VALUES(?,?,?,?,?,?,?,?,?,?)', (c['id'], c['source_id'], c['volume_id'], c['article_id'], c['kind'], c['start_line'], c['end_line'], c['start'], c['end'], c['text']))
        counts = Counter(c['kind'] for c in chunks)
        summary['source_files'].append({**{k: v for k, v in spec.items() if k != 'path'}, 'bytes': len(raw), 'characters': len(text), 'lines': len(lines), 'replacement_characters': text.count('\ufffd'), 'chunks': len(chunks), 'chunk_kinds': dict(counts), 'volume_blocks': [{k: val for k, val in v.items() if k not in ('start','end')} | {'start_line': v['start'] + 1, 'end_line': v['end']} for v in volumes]})
        summary['article_anchors'].extend(articles)
        summary['unmatched_date_anchors'].extend(unknowns)
    summary['warnings'] = ['TXT copies have not been collated against the printed editions.', 'Wenji volume numbers are provisional stitching-order labels, not verified printed volume numbers.', 'Article boundaries are automatic TOC/date anchors; internal dates and missing anchors can cause merged ranges. Check the next heading before citing an entire range.', 'Xuanji volumes 6 and 7 are a private Jinghuo compilation; editorial comments and style-based attributions must not be quoted as authenticated Mao text.', 'Attributed text is a layout label, not authentication of authorship.', 'No claim of full-corpus semantic reading or permanent model learning is made.']
    summary['counts'] = {'source_files': 2, 'characters': sum(s['characters'] for s in summary['source_files']), 'lines': sum(s['lines'] for s in summary['source_files']), 'bytes': sum(s['bytes'] for s in summary['source_files']), 'volume_blocks': sum(len(s['volume_blocks']) for s in summary['source_files']), 'article_anchors': len(summary['article_anchors']), 'chunks': sum(s['chunks'] for s in summary['source_files']), 'unmatched_dates': len(summary['unmatched_date_anchors'])}
    db.execute('INSERT INTO metadata VALUES(?,?)', ('manifest', json.dumps({k: v for k, v in summary.items() if k not in ('article_anchors','unmatched_date_anchors')}, ensure_ascii=False)))
    db.commit()
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    # Independent reconstruction from persisted chunks, not in-memory segments.
    for spec in SOURCE_SPECS:
        reconstructed = ''.join(r[0] for r in db.execute('SELECT text FROM chunks WHERE source_id=? ORDER BY char_start', (spec['id'],)))
        stored = db.execute('SELECT raw_text FROM sources WHERE id=?', (spec['id'],)).fetchone()[0]
        assert reconstructed == stored
        assert hashlib.sha256(reconstructed.encode('utf-8')).hexdigest() == spec['sha256']
    db.close()
    (out_dir / 'Cyber_Mao_Corpus_Manifest.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary['counts'], ensure_ascii=False))
    for source in summary['source_files']:
        print(source['id'], [(v['number'],v['article_anchors']) for v in source['volume_blocks']])


def install(source_paths):
    assets = Path(__file__).resolve().parents[1] / 'assets'
    destination = assets / 'corpus.sqlite3'
    if destination.exists():
        raise FileExistsError(f'Refusing to overwrite {destination}')
    assets.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='corpus-', dir=assets) as temp:
        out_dir = Path(temp)
        build(source_paths, out_dir)
        # Publish the verified database atomically without replacing another install.
        built = out_dir / 'Cyber_Mao_Corpus.sqlite3'
        if os.name == 'nt':
            built.rename(destination)
        else:
            os.link(built, destination)
    print(f'Installed {destination}')


def search(db_path, terms, limit, include_supplementary, any_term=False, editorial=False):
    db = sqlite3.connect(f'file:{db_path.resolve().as_posix()}?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    op = ' OR ' if any_term else ' AND '
    conditions = [f'({op.join("instr(c.text, ?) > 0" for _ in terms)})']
    if not include_supplementary:
        conditions.append('(v.supplementary=0)')
    if not editorial:
        conditions.append("c.kind='attributed_text'")
    rows = list(db.execute('''SELECT c.*,a.title,a.date_raw,v.label,v.supplementary,s.library_file_id FROM chunks c LEFT JOIN articles a ON a.id=c.article_id LEFT JOIN volumes v ON v.id=c.volume_id JOIN sources s ON s.id=c.source_id WHERE ''' + ' AND '.join(conditions), terms))
    for row in sorted(rows, key=lambda r: (-sum(r['text'].count(t) for t in terms), r['source_id'], r['start_line']))[:limit]:
        payload = dict(row)
        text = payload['text']
        hit = min([text.find(t) for t in terms if t in text], default=0)
        a, b = max(0, hit - 160), min(len(text), hit + 800)
        payload['excerpt_char_start'] = payload['char_start'] + a
        payload['excerpt_char_end'] = payload['char_start'] + b
        payload['text'] = text[a:b]
        print(json.dumps(payload, ensure_ascii=False))
    db.close()


def read(db_path, source, start, end):
    db = sqlite3.connect(f'file:{db_path.resolve().as_posix()}?mode=ro', uri=True)
    row = db.execute('SELECT raw_text FROM sources WHERE id=?', (source,)).fetchone()
    if not row:
        raise ValueError('Unknown source')
    lines = row[0].splitlines()
    if start < 1 or end < start or end > len(lines) or end - start > 499:
        raise ValueError('Use an existing range of no more than 500 lines')
    for i in range(start - 1, end):
        print(f'{i + 1}: {lines[i]}')
    db.close()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    subs = p.add_subparsers(dest='command', required=True)
    b = subs.add_parser('build'); b.add_argument('--sources', type=Path, required=True); b.add_argument('--out', type=Path, required=True)
    i = subs.add_parser('install', help='Build and install the baseline database in assets/')
    i.add_argument('--wenji', type=Path, required=True)
    i.add_argument('--xuanji', type=Path, required=True)
    s = subs.add_parser('search'); s.add_argument('db', type=Path); s.add_argument('terms', nargs='+'); s.add_argument('--limit', type=int, default=5); s.add_argument('--include-supplementary', action='store_true'); s.add_argument('--any', action='store_true'); s.add_argument('--editorial', action='store_true')
    r = subs.add_parser('read'); r.add_argument('db', type=Path); r.add_argument('source', choices=['wenji','xuanji']); r.add_argument('start', type=int); r.add_argument('end', type=int)
    args = p.parse_args()
    if args.command in ('build', 'install'):
        try:
            if args.command == 'build':
                source_paths = {spec['id']: args.sources / spec['path'] for spec in SOURCE_SPECS}
                build(source_paths, args.out)
            else:
                install({'wenji': args.wenji, 'xuanji': args.xuanji})
        except (OSError, ValueError) as error:
            p.exit(1, f'{error}\n')
    elif args.command == 'search':
        search(args.db, args.terms, args.limit, args.include_supplementary, args.any, args.editorial)
    else:
        read(args.db, args.source, args.start, args.end)


if __name__ == '__main__':
    main()
