"""Occurrence-preserving SCREEN TSV storage with explicit positional roles."""
from contextlib import contextmanager
import gzip
import hashlib
import json
from pathlib import Path
import sqlite3
from screen_bulk_source import compact, publish, temporary, verify_file


def lines(path, max_bytes, max_line_bytes):
    size = 0
    with gzip.open(path, "rb") as stream:
        while raw := stream.readline(max_line_bytes + 1):
            size += len(raw)
            if len(raw) > max_line_bytes or size > max_bytes:
                raise ValueError("Decoded artifact exceeds the line or total byte budget")
            # Only TAB delimits cells; retain quotes, empty cells and all whitespace.
            text = raw.decode("utf-8", errors="strict")
            yield raw, text


def cells(text, first):
    if text.endswith("\n"):
        text = text[:-1]
        if text.endswith("\r"):
            text = text[:-1]
    if first and text.startswith("\ufeff"):
        text = text[1:]
    return text.split("\t")


def inspect(path, max_bytes=8 * 1024**3, max_line_bytes=8 * 1024**2, count=5):
    result = []
    iterator = lines(path, max_bytes, max_line_bytes)
    try:
        for line_number, (raw, text) in enumerate(iterator, 1):
            result.append({"line_number": line_number, "bytes": len(raw), "cells": len(cells(text, line_number == 1)),
                           "preview": text[:4096], "preview_truncated": len(text) > 4096})
            if line_number == count:
                break
    finally:
        iterator.close()
    return {"lines": result, "complete_file_validated": False, "instruction": "Inspect native headers; import requires explicit one-based cCRE/gene column positions and header-row selection."}


def validate_column_mapping(header_row, ccre_column, gene_column):
    if header_row not in (0, 1) or type(ccre_column) is not int or ccre_column < 1:
        raise ValueError("Select header row 0/1 and a positive one-based cCRE column")
    if gene_column is not None and (type(gene_column) is not int or gene_column < 1 or gene_column == ccre_column):
        raise ValueError("Select a distinct positive one-based gene column")


def ingest(path, info, expected_sha256, output, *, header_row, ccre_column, gene_column=None,
           max_bytes=64 * 1024**2, max_uncompressed_bytes=8 * 1024**3,
           max_line_bytes=8 * 1024**2, max_rows=10_000_000):
    validate_column_mapping(header_row, ccre_column, gene_column)
    source_hash = verify_file(path, info, expected_sha256, max_bytes)
    temp = temporary(output)
    database = None
    try:
        database = sqlite3.connect(temp)
        database.execute("PRAGMA journal_mode=DELETE")
        database.execute("CREATE TABLE metadata (name TEXT PRIMARY KEY, value TEXT NOT NULL)")
        database.execute("CREATE TABLE source_lines (line_number INTEGER PRIMARY KEY, record_number INTEGER UNIQUE, ccre TEXT, gene TEXT, cells_json TEXT NOT NULL, raw_line BLOB NOT NULL)")
        width = None
        headers = None
        records = 0
        line_count = 0
        raw_size = 0
        decoded_hash = hashlib.sha256()
        with database:
            for line_count, (raw, text) in enumerate(lines(path, max_uncompressed_bytes, max_line_bytes), 1):
                decoded_hash.update(raw)
                raw_size += len(raw)
                values = cells(text, line_count == 1)
                if width is None:
                    width = len(values)
                if len(values) != width or max(ccre_column, gene_column or 1) > width:
                    raise ValueError(f"Column count/mapping mismatch at source line {line_count}")
                if line_count == header_row:
                    headers = values
                    record_number = ccre = gene = None
                else:
                    records += 1
                    if records > max_rows:
                        raise ValueError("Artifact exceeds row budget")
                    record_number = records
                    ccre = values[ccre_column - 1]
                    gene = values[gene_column - 1] if gene_column is not None else None
                    if not ccre or "\x00" in ccre or (gene is not None and "\x00" in gene):
                        raise ValueError(f"Empty or NUL-containing mapped identifier at source line {line_count}")
                database.execute("INSERT INTO source_lines VALUES (?,?,?,?,?,?)", (line_count, record_number, ccre, gene, compact(values), raw))
            if width is None:
                raise ValueError("Empty file cannot establish a column layout")
            # Re-read compressed bytes before publishing, detecting source-file replacement.
            verify_file(path, info, source_hash, max_bytes)
            provenance = {"format_version": "screen-bulk-sqlite-1", "manifest": info, "artifact_sha256": source_hash,
                          "decoded_sha256": decoded_hash.hexdigest(), "decoded_bytes": raw_size,
                          "source_lines": line_count, "records": records, "columns": width, "headers": headers,
                          "mapping": {"header_row": header_row, "ccre_column": ccre_column, "gene_column": gene_column},
                          "scope": "Every parsed TSV cell and original decoded line retained; mapped identifiers are literal selected cells, without namespace normalization, score aggregation, deduplication or causal interpretation."}
            database.execute("INSERT INTO metadata VALUES ('provenance', ?)", (compact(provenance),))
            database.execute("CREATE INDEX source_ccre ON source_lines(ccre,record_number)")
            database.execute("CREATE INDEX source_gene ON source_lines(gene,record_number)")
        database.close()
        database = None
        publish(temp, output)
        return provenance
    finally:
        if database is not None:
            database.close()
        temp.unlink(missing_ok=True)
        Path(str(temp) + "-journal").unlink(missing_ok=True)


@contextmanager
def opened(path):
    database = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        row = database.execute("SELECT value FROM metadata WHERE name='provenance'").fetchone()
        provenance = json.loads(row[0]) if row else {}
        if provenance.get("format_version") != "screen-bulk-sqlite-1":
            raise ValueError("Not a SCREEN bulk snapshot")
        yield database, provenance
    finally:
        database.close()


def query(path, *, ccre=None, gene=None, column=None, column_label=None, limit=100, offset=0):
    if not ccre and not gene:
        raise ValueError("Supply a literal cCRE or gene identifier")
    if type(limit) is not int or not 1 <= limit <= 1000 or type(offset) is not int or offset < 0:
        raise ValueError("Use limit 1–1000 and a nonnegative offset")
    with opened(path) as (database, provenance):
        if gene is not None and provenance["mapping"]["gene_column"] is None:
            raise ValueError("This snapshot has no mapped gene column")
        if column_label is not None:
            positions = [i + 1 for i, label in enumerate(provenance["headers"] or []) if label == column_label]
            if column is not None or len(positions) != 1:
                raise ValueError("Column label is missing/ambiguous; select an explicit position")
            column = positions[0]
        if column is not None and (type(column) is not int or not 1 <= column <= provenance["columns"]):
            raise ValueError("Column position is outside the snapshot layout")
        filters = [("ccre", ccre), ("gene", gene)]
        selected = [(key, value) for key, value in filters if value is not None]
        where = " AND ".join(key + " = ?" for key, _ in selected)
        rows = database.execute("SELECT line_number,record_number,cells_json,raw_line FROM source_lines WHERE " + where + " ORDER BY record_number LIMIT ? OFFSET ?", [value for _, value in selected] + [limit + 1, offset]).fetchall()
        result = []
        for line_number, record_number, encoded, raw in rows[:limit]:
            values = json.loads(encoded)
            item = {"line_number": line_number, "record_number": record_number, "cells": values, "raw_line": raw.decode("utf-8"), "raw_line_sha256": hashlib.sha256(raw).hexdigest()}
            if column is not None:
                item["selected_column"] = {"position": column, "label": provenance["headers"][column - 1] if provenance["headers"] else None, "value": values[column - 1]}
            result.append(item)
        return {"provenance": provenance, "rows": result, "next_offset": offset + limit if len(rows) > limit else None,
                "scope": "One page of literal matches in this imported file; an empty page does not establish absent biological regulation."}


def export(path, output):
    temp = temporary(output)
    try:
        digest = hashlib.sha256()
        with opened(path) as (database, provenance), temp.open("wb") as target:
            for (raw,) in database.execute("SELECT raw_line FROM source_lines ORDER BY line_number"):
                target.write(raw)
                digest.update(raw)
        if digest.hexdigest() != provenance["decoded_sha256"]:
            raise ValueError("Stored source lines no longer match the imported snapshot hash")
        publish(temp, output)
        return {"path": str(output), "sha256": digest.hexdigest()}
    finally:
        temp.unlink(missing_ok=True)
