#!/usr/bin/env python3
"""Acquire, inspect, import and query a pinned public SCREEN TSV gzip."""
import argparse
import json
import sqlite3
import sys
from screen_bulk_source import acquire, manifest
from screen_bulk_store import export, ingest, inspect, query


def command_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser("fetch", help="Acquire exact manifest bytes and print the observed SHA-256")
    fetch.add_argument("manifest")
    fetch.add_argument("output")
    fetch.add_argument("--max-bytes", type=int, default=64 * 1024**2)
    preview = commands.add_parser("inspect", help="Bounded first-line preview; does not validate the complete gzip")
    preview.add_argument("source")
    load = commands.add_parser("import", help="Validate complete gzip/TSV and publish a new local SQLite snapshot")
    load.add_argument("manifest")
    load.add_argument("source")
    load.add_argument("output")
    load.add_argument("--sha256", required=True)
    load.add_argument("--header-row", type=int, choices=[0, 1], required=True)
    load.add_argument("--ccre-column", type=int, required=True)
    load.add_argument("--gene-column", type=int)
    load.add_argument("--max-bytes", type=int, default=64 * 1024**2)
    load.add_argument("--max-uncompressed-bytes", type=int, default=8 * 1024**3)
    load.add_argument("--max-line-bytes", type=int, default=8 * 1024**2)
    load.add_argument("--max-rows", type=int, default=10_000_000)
    lookup = commands.add_parser("query", help="Read literal indexed cCRE/gene matches and optional matrix columns")
    lookup.add_argument("database")
    lookup.add_argument("--ccre")
    lookup.add_argument("--gene")
    lookup.add_argument("--column", type=int)
    lookup.add_argument("--column-label")
    lookup.add_argument("--limit", type=int, default=100)
    lookup.add_argument("--offset", type=int, default=0)
    reconstruct = commands.add_parser("export", help="Reconstruct and verify every original decoded source byte")
    reconstruct.add_argument("database")
    reconstruct.add_argument("output")
    return parser


def main():
    parser = command_parser()
    args = parser.parse_args()
    if args.command == "fetch":
        result = acquire(manifest(args.manifest), args.output, args.max_bytes)
    elif args.command == "inspect":
        result = inspect(args.source)
    elif args.command == "import":
        result = ingest(args.source, manifest(args.manifest), args.sha256, args.output,
                        header_row=args.header_row, ccre_column=args.ccre_column, gene_column=args.gene_column,
                        max_bytes=args.max_bytes, max_uncompressed_bytes=args.max_uncompressed_bytes,
                        max_line_bytes=args.max_line_bytes, max_rows=args.max_rows)
    elif args.command == "query":
        result = query(args.database, ccre=args.ccre, gene=args.gene, column=args.column,
                       column_label=args.column_label, limit=args.limit, offset=args.offset)
    else:
        result = export(args.database, args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, EOFError, sqlite3.Error) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
