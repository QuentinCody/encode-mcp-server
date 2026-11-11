"""Offline integrity/occurrence regressions; synthetic fixtures, not native qualification."""
import copy
from email.message import Message
import gzip
import hashlib
import io
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import screen_bulk_source as source
import screen_bulk_store as store


class BulkTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.raw = '\ufeffccre\tgene\tcell\tcell\tempty\r\nEH1\tGENE1\tPLS\t"NA"\t\r\nEH1\tGENE2\t0\tNA\t \r\nEH2\tGENE1\t-1e-9\tλ\t'.encode()
        self.file = self.root / "source.gz"
        self.file.write_bytes(gzip.compress(self.raw, mtime=0))
        self.digest = source.sha256(self.file)
        native = {"future": {"n": 1e-7, "text": "λ"}, "Downloads": {item["key"]: source.DOWNLOADS + item["file"] for item in source.ARTIFACTS}}
        text = json.dumps(native, ensure_ascii=False, indent=2)
        self.info = {"format_version": "screen-bulk-manifest-1", "assembly": "GRCh38",
                     "source": {"url": source.CONFIG_URL, "native": native, "config_text": text, "catalog_sha256": hashlib.sha256(text.encode()).hexdigest()},
                     "artifact": {**source.ARTIFACTS[0], "url": source.DOWNLOADS + source.ARTIFACTS[0]["file"],
                                  "bytes": self.file.stat().st_size, "etag": '"fixture"', "assembly": "GRCh38", "compression": "gzip"}}
        self.manifest = self.root / "manifest.json"
        self.manifest.write_text(json.dumps(self.info))
        self.database = self.root / "data.sqlite"

    def ingest(self, **kwargs):
        return store.ingest(self.file, self.info, self.digest, self.database, **{"header_row": 1, "ccre_column": 1, "gene_column": 2, **kwargs})

    def clean(self):
        self.assertFalse(self.database.exists())
        self.assertEqual(list(self.root.glob(".screen-bulk-*")), [])

    def test_manifest_preserves_text_hash_after_canonical_json_transport(self):
        self.manifest.write_text(json.dumps(self.info, sort_keys=True))
        self.assertEqual(source.manifest(self.manifest), self.info)

    def test_manifest_rejects_substitutions(self):
        mutations = [("source", "url", "https://example.org"), ("source", "catalog_sha256", "0" * 64),
                     ("source", "config_text", "{}"), ("source", "native", {}),
                     ("artifact", "url", "https://example.org/a.gz"), ("artifact", "kind", "invented"),
                     ("artifact", "file", "other.gz"), ("artifact", "key", "other"),
                     ("artifact", "bytes", True), ("artifact", "bytes", 0), ("artifact", "bytes", 1.5),
                     ("artifact", "etag", 'W/"weak"'), ("artifact", "assembly", "GRCh37"),
                     ("artifact", "compression", "zip")]
        for parent, key, value in mutations:
            with self.subTest(parent=parent, key=key):
                info = copy.deepcopy(self.info)
                info[parent][key] = value
                self.manifest.write_text(json.dumps(info))
                with self.assertRaises((ValueError, KeyError, TypeError)):
                    source.manifest(self.manifest)

    def test_manifest_rejects_wrong_root_and_reference_drift(self):
        for value in ([], None, {}, {**self.info, "assembly": "mm10"}, {**self.info, "artifact": []},
                      {**self.info, "source": {"native": {"Downloads": None}}}):
            self.manifest.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                source.manifest(self.manifest)
        self.info["source"]["native"]["Downloads"][source.ARTIFACTS[0]["key"]] = "https://example.org/changed"
        text = json.dumps(self.info["source"]["native"])
        self.info["source"].update(config_text=text, catalog_sha256=hashlib.sha256(text.encode()).hexdigest())
        self.manifest.write_text(json.dumps(self.info))
        with self.assertRaisesRegex(ValueError, "references changed"):
            source.manifest(self.manifest)

    def response(self, body=None, status=200, **headers):
        response = io.BytesIO(self.file.read_bytes() if body is None else body)
        response.status = status
        response.headers = Message()
        for key, value in {"ETag": '"fixture"', **headers}.items():
            response.headers[key] = value
        return response

    def test_acquire_pins_conditional_request_and_exact_bytes(self):
        output = self.root / "download.gz"
        calls = []
        def opener(request, timeout):
            calls.append((request.full_url, dict(request.header_items()), timeout))
            return self.response(**{"Content-Length": str(self.file.stat().st_size)})
        receipt = source.acquire(self.info, output, opener=opener)
        self.assertEqual(output.read_bytes(), self.file.read_bytes())
        self.assertEqual(receipt["sha256"], self.digest)
        self.assertEqual(calls, [(self.info["artifact"]["url"], {"Accept-encoding": "identity", "If-match": '"fixture"', "User-agent": "bio-mcp-screen-bulk/1.0"}, 30)])

    def test_acquire_rejects_partial_changed_encoded_or_unbounded_transfer(self):
        cases = [{"status": 206}, {"Content-Range": "bytes 0-1/10"}, {"ETag": '"changed"'},
                 {"Content-Encoding": "gzip"}, {"Content-Length": "1"}, {"Content-Length": "1.5"},
                 {"body": self.file.read_bytes()[:-1]}, {"body": self.file.read_bytes() + b"x"}]
        for case in cases:
            with self.subTest(case=list(case)):
                output = self.root / "download.gz"
                with self.assertRaises(ValueError):
                    source.acquire(self.info, output, opener=lambda *_args, **_kw: self.response(**case))
                self.assertFalse(output.exists())
                self.assertEqual(list(self.root.glob(".screen-bulk-*")), [])

    def test_acquire_budget_and_existing_output_precede_network(self):
        output = self.root / "download.gz"
        with patch("urllib.request.build_opener") as opener:
            with self.assertRaises(ValueError):
                source.acquire(self.info, output, max_bytes=1)
            output.write_bytes(b"existing")
            with self.assertRaises(FileExistsError):
                source.acquire(self.info, output)
            opener.assert_not_called()
        self.assertEqual(output.read_bytes(), b"existing")

    def test_acquire_checks_elapsed_time_and_refuses_redirects(self):
        with patch("screen_bulk_source.time.monotonic", side_effect=[0, 301]):
            with self.assertRaisesRegex(ValueError, "time budget"):
                source.acquire(self.info, self.root / "download.gz", opener=lambda *_a, **_k: self.response())
        with self.assertRaisesRegex(ValueError, "redirected"):
            source.NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere")

    def test_full_ingestion_export_and_occurrence_queries(self):
        provenance = self.ingest()
        self.assertEqual((provenance["records"], provenance["source_lines"], provenance["columns"]), (3, 4, 5))
        self.assertEqual(provenance["decoded_sha256"], hashlib.sha256(self.raw).hexdigest())
        first = store.query(self.database, ccre="EH1", limit=1, column=4)
        self.assertEqual(first["next_offset"], 1)
        self.assertEqual(first["rows"][0]["selected_column"], {"position": 4, "label": "cell", "value": '"NA"'})
        second = store.query(self.database, ccre="EH1", limit=1, offset=1)
        self.assertIsNone(second["next_offset"])
        self.assertEqual(second["rows"][0]["cells"], ["EH1", "GENE2", "0", "NA", " "])
        self.assertEqual([row["record_number"] for row in store.query(self.database, gene="GENE1")["rows"]], [1, 3])
        self.assertEqual(len(store.query(self.database, ccre="EH1", gene="GENE1")["rows"]), 1)
        self.assertEqual(store.query(self.database, ccre="EH1' OR 1=1 --")["rows"], [])
        self.assertEqual(store.query(self.database, ccre="eh1")["rows"], [])
        output = self.root / "original.tsv"
        store.export(self.database, output)
        self.assertEqual(output.read_bytes(), self.raw)
        self.assertEqual(source.sha256(self.file), self.digest)

    def test_exact_matrix_column_selection_and_ambiguous_labels(self):
        self.ingest(gene_column=None)
        self.assertEqual(store.query(self.database, ccre="EH1", column_label="empty")["rows"][0]["selected_column"]["value"], "")
        for params in ({"column_label": "cell"}, {"column_label": "missing"}, {"column": 0}, {"column": 6}, {"column": 1, "column_label": "ccre"}, {"gene": "GENE1"}):
            with self.subTest(params=params), self.assertRaises(ValueError):
                store.query(self.database, ccre="EH1", **params)

    def test_headerless_file_retains_first_record(self):
        self.file.write_bytes(gzip.compress(b"EH1\tGENE1\nEH1\tGENE1", mtime=0))
        self.digest = source.sha256(self.file)
        self.info["artifact"]["bytes"] = self.file.stat().st_size
        self.assertEqual(self.ingest(header_row=0)["records"], 2)
        self.assertEqual([row["line_number"] for row in store.query(self.database, ccre="EH1")["rows"]], [1, 2])

    def test_import_checks_hash_size_and_all_resource_budgets(self):
        for kwargs in ({"max_bytes": 1}, {"max_uncompressed_bytes": 1}, {"max_line_bytes": 1}, {"max_rows": 1},
                       {"header_row": 2}, {"ccre_column": 0}, {"gene_column": 1}, {"gene_column": 6}):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                self.ingest(**kwargs)
            self.clean()
        self.digest = "0" * 64
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.ingest()
        self.clean()

    def test_corrupt_or_invalid_source_never_publishes_partial_database(self):
        valid = self.file.read_bytes()
        crc_bad = bytearray(valid)
        crc_bad[-8] ^= 1
        cases = [valid[:-2], bytes(crc_bad), valid + b"junk", gzip.compress(b"a\tb\nEH1\tx\textra\n"),
                 gzip.compress(b"a\tb\n\tx\n"), gzip.compress(b"a\tb\nEH\x00\tx\n"),
                 gzip.compress(b"a\tb\nEH1\t\xff\n"), gzip.compress(b"")]
        for content in cases:
            with self.subTest(content_sha256=hashlib.sha256(content).hexdigest()):
                self.file.write_bytes(content)
                self.info["artifact"]["bytes"] = len(content)
                self.digest = source.sha256(self.file)
                with self.assertRaises((ValueError, OSError, EOFError)):
                    self.ingest()
                self.clean()

    def test_preview_is_bounded_and_does_not_claim_complete_validation(self):
        self.assertFalse(store.inspect(self.file)["complete_file_validated"])
        self.assertEqual(len(store.inspect(self.file, count=1)["lines"]), 1)
        with self.assertRaises(ValueError):
            store.inspect(self.file, max_line_bytes=1)

    def test_query_validation_and_readonly_missing_database(self):
        with self.assertRaises(sqlite3.OperationalError):
            store.query(self.database, ccre="EH1")
        self.assertFalse(self.database.exists())
        self.ingest()
        for params in ({}, {"ccre": "EH1", "limit": 0}, {"ccre": "EH1", "limit": 1001}, {"ccre": "EH1", "offset": -1}):
            with self.assertRaises(ValueError):
                store.query(self.database, **params)

    def test_export_refuses_tampered_raw_bytes(self):
        self.ingest()
        with sqlite3.connect(self.database) as connection:
            connection.execute("UPDATE source_lines SET raw_line=? WHERE line_number=2", (b"altered",))
        output = self.root / "original.tsv"
        with self.assertRaisesRegex(ValueError, "no longer match"):
            store.export(self.database, output)
        self.assertFalse(output.exists())

    def test_outputs_are_exclusive_and_failed_publication_preserves_other_writer(self):
        self.ingest()
        before = self.database.read_bytes()
        with self.assertRaises(FileExistsError):
            self.ingest()
        self.assertEqual(self.database.read_bytes(), before)
        output = self.root / "race"
        temp = source.temporary(output)
        temp.write_bytes(b"ours")
        output.write_bytes(b"theirs")
        with self.assertRaises(FileExistsError):
            source.publish(temp, output)
        self.assertEqual(output.read_bytes(), b"theirs")
        link = self.root / "dangling"
        link.symlink_to(self.root / "missing")
        with self.assertRaises(FileExistsError):
            source.temporary(link)

    def test_cli_import_query_export_and_errors(self):
        script = Path(__file__).with_name("screen_bulk.py")
        def run(*args):
            return subprocess.run([sys.executable, str(script), *map(str, args)], capture_output=True, text=True)
        loaded = run("import", self.manifest, self.file, self.database, "--sha256", self.digest, "--header-row", "1", "--ccre-column", "1", "--gene-column", "2")
        self.assertEqual(loaded.returncode, 0, loaded.stderr)
        self.assertEqual(json.loads(loaded.stdout)["records"], 3)
        self.assertEqual(len(json.loads(run("query", self.database, "--gene", "GENE1").stdout)["rows"]), 2)
        output = self.root / "export.tsv"
        self.assertEqual(run("export", self.database, output).returncode, 0)
        self.assertEqual(output.read_bytes(), self.raw)
        error = run("query", self.root / "missing", "--ccre", "EH1")
        self.assertEqual(error.returncode, 1)
        self.assertNotIn("Traceback", error.stderr)


if __name__ == "__main__":
    unittest.main()
