"""Read-only lookup of the Cyber Mao SQLite corpus."""
import argparse
from bisect import bisect_right
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys


ROOT = Path(__file__).resolve().parents[1]


def line_offsets(raw):
    offsets = [0]
    for line in raw.splitlines(keepends=True):
        offsets.append(offsets[-1] + len(line))
    return offsets


def chunks(db, source):
    return list(db.execute('''
        SELECT c.char_start, c.char_end, c.kind, c.article_id, c.volume_id,
               v.supplementary, a.title, a.date_raw
        FROM chunks c LEFT JOIN volumes v ON v.id=c.volume_id
        LEFT JOIN articles a ON a.id=c.article_id
        WHERE c.source_id=? ORDER BY c.char_start
    ''', (source,)))


def locate(source, raw, offsets, start, end, parts):
    return {
        'source_id': source, 'start_line': bisect_right(offsets, start),
        'end_line': bisect_right(offsets, end - 1),
        'layout_kinds': sorted({p['kind'] for p in parts}),
        'supplementary': any(p['supplementary'] for p in parts),
        'titles_as_indexed': sorted({p['title'] for p in parts if p['title']}),
        'dates_as_transcribed': sorted({p['date_raw'] for p in parts if p['date_raw']}),
        'text': raw[start:end],
    }


def body_ranges(parts, include_supplementary):
    group = []
    for part in parts:
        eligible = part['kind'] == 'attributed_text' and (include_supplementary or not part['supplementary'])
        continuous = group and all(group[-1][k] == part[k] for k in ('article_id', 'volume_id')) and group[-1]['char_end'] == part['char_start']
        if group and (not eligible or not continuous):
            yield group
            group = []
        if eligible:
            group.append(part)
    if group:
        yield group


def lookup(db, args):
    hits = []
    for row in db.execute('SELECT id,raw_text FROM sources ORDER BY id'):
        source, raw = row
        if args.source and args.source != source:
            continue
        offsets = line_offsets(raw)
        parts = chunks(db, source)
        starts = [p['char_start'] for p in parts]
        if args.command == 'quote':
            cursor = 0
            while len(hits) < args.limit:
                start = raw.find(args.phrase, cursor)
                if start == -1:
                    break
                cursor = start + 1
                end = start + len(args.phrase)
                lo = max(0, bisect_right(starts, start) - 1)
                hi = bisect_right(starts, end - 1)
                relevant = parts[lo:hi]
                if not relevant or (not args.include_supplementary and any(p['supplementary'] for p in relevant)):
                    continue
                if not args.include_editorial and any(p['kind'] != 'attributed_text' for p in relevant):
                    continue
                hit = locate(source, raw, offsets, start, end, relevant)
                hit['context'] = raw[max(0, start - 160):end + 220]
                hits.append(hit)
        else:
            for group in body_ranges(parts, args.include_supplementary):
                start, end = group[0]['char_start'], group[-1]['char_end']
                body = raw[start:end]
                terms = [term for term in args.terms if term in body]
                if not terms or (not args.any and len(terms) != len(args.terms)):
                    continue
                offset = start + min(body.index(term) for term in terms)
                hit = locate(source, raw, offsets, max(start, offset - 120), min(end, offset + 820), group)
                hit['matched_terms_in_body'] = terms
                hits.append(hit)
        if len(hits) >= args.limit:
            break
    return {'matches': hits[:args.limit], 'attribution_requires_context': True}


def verify(db):
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ValueError('SQLite integrity check failed')
    result = []
    for source, raw, expected in db.execute('SELECT id,raw_text,sha256 FROM sources ORDER BY id'):
        rebuilt = ''.join(row[0] for row in db.execute('SELECT text FROM chunks WHERE source_id=? ORDER BY char_start', (source,)))
        actual = hashlib.sha256(raw.encode('utf-8')).hexdigest()
        if rebuilt != raw or actual != expected:
            raise ValueError(f'Source verification failed: {source}')
        result.append({'id': source, 'sha256': actual, 'characters': len(raw)})
    if {row['id'] for row in result} != {'wenji', 'xuanji'}:
        raise ValueError('Expected both baseline sources')
    return {'integrity': 'ok', 'reconstruction': 'exact', 'sources': result}


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db', type=Path, default=ROOT / 'assets/corpus.sqlite3')
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('verify')
    works = sub.add_parser('works'); works.add_argument('term', nargs='?', default='')
    for command in ('search', 'quote', 'read'):
        query = sub.add_parser(command)
        query.add_argument('--include-supplementary', action='store_true')
        if command == 'read':
            query.add_argument('source', choices=['wenji', 'xuanji'])
            query.add_argument('start', type=int); query.add_argument('end', type=int)
            continue
        query.add_argument('--source', choices=['wenji', 'xuanji'])
        query.add_argument('--limit', type=int, choices=range(1, 21), default=5)
        if command == 'search':
            query.add_argument('terms', nargs='+'); query.add_argument('--any', action='store_true')
        else:
            query.add_argument('phrase'); query.add_argument('--include-editorial', action='store_true')
    args = parser.parse_args()
    if not args.db.is_file():
        parser.error('Corpus database missing. See references/sources.md or use --db PATH.')
    try:
        with closing(sqlite3.connect(args.db.resolve().as_uri() + '?mode=ro', uri=True)) as db:
            db.row_factory = sqlite3.Row
            if args.command == 'verify':
                result = verify(db)
            elif args.command == 'works':
                result = {'matches': [dict(row) for row in db.execute('''
                    SELECT a.title,a.source_id,a.date_raw,a.start_line,a.end_line,v.supplementary
                    FROM articles a JOIN volumes v ON v.id=a.volume_id
                    WHERE instr(a.title,?)>0 ORDER BY v.supplementary,a.source_id,a.start_line LIMIT 50
                ''', (args.term,))]}
            elif args.command == 'read':
                raw = db.execute('SELECT raw_text FROM sources WHERE id=?', (args.source,)).fetchone()[0]
                offsets = line_offsets(raw)
                if not (1 <= args.start <= args.end < len(offsets) and args.end - args.start < 500):
                    raise ValueError('Use a valid inclusive range of at most 500 lines')
                start, end = offsets[args.start - 1], offsets[args.end]
                result = locate(args.source, raw, offsets, start, end, [p for p in chunks(db, args.source) if p['char_start'] < end and p['char_end'] > start])
                if result['supplementary'] and not args.include_supplementary:
                    raise ValueError('Use --include-supplementary to inspect the private compilation')
            else:
                if not all(x.strip() for x in ([args.phrase] if args.command == 'quote' else args.terms)):
                    raise ValueError('Lookup terms must not be blank')
                result = lookup(db, args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, ValueError, sqlite3.DatabaseError) as error:
        parser.error(str(error))


if __name__ == '__main__':
    main()
