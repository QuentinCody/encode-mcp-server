"""Pinned public SCREEN artifacts; standard library only."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.request

CONFIG_URL = "https://raw.githubusercontent.com/weng-lab/SCREEN3.0/staging/src/common/config.json"
DOWNLOADS = "https://downloads.wenglab.org/"
ARTIFACTS = json.loads((Path(__file__).parents[1] / "src/lib/bulk-artifacts.json").read_text())


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def sha256(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def manifest(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("format_version") != "screen-bulk-manifest-1":
        raise ValueError("Expected the complete screen-bulk-manifest-1 data object")
    artifact = value["artifact"]
    if not isinstance(artifact, dict):
        raise ValueError("Artifact metadata must be an object")
    selected = next((item for item in ARTIFACTS if item["key"] == artifact["key"]), None)
    if not selected or artifact["url"] != DOWNLOADS + selected["file"]:
        raise ValueError("Artifact is not a reviewed public SCREEN download")
    if any(artifact.get(key) != selected[key] for key in ("key", "file", "kind")):
        raise ValueError("Artifact identity differs from the reviewed source")
    source = value["source"]
    if not isinstance(source, dict) or not isinstance(source.get("native"), dict) or not isinstance(source["native"].get("Downloads"), dict):
        raise ValueError("Catalogue source and Downloads must be objects")
    if source["url"] != CONFIG_URL or hashlib.sha256(source["config_text"].encode()).hexdigest() != source["catalog_sha256"]:
        raise ValueError("Catalogue source hash or identity does not match")
    if json.loads(source["config_text"]) != source["native"]:
        raise ValueError("Parsed catalogue differs from its pinned source text")
    for item in ARTIFACTS:
        if source["native"]["Downloads"].get(item["key"]) != DOWNLOADS + item["file"]:
            raise ValueError("Catalogue download references changed")
    if type(artifact["bytes"]) is not int or artifact["bytes"] <= 0:
        raise ValueError("Artifact requires a positive byte size")
    if not isinstance(artifact.get("etag"), str) or not re.fullmatch(r'"[^"\r\n]+"', artifact["etag"]):
        raise ValueError("Artifact requires a strong ETag")
    if value.get("assembly") != "GRCh38" or artifact.get("assembly") != "GRCh38" or artifact.get("compression") != "gzip":
        raise ValueError("Unexpected artifact assembly or compression")
    return value


def verify_file(path, info, expected_sha256, max_bytes):
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected_sha256):
        raise ValueError("Supply an exact expected SHA-256")
    size = Path(path).stat().st_size
    if size != info["artifact"]["bytes"] or size > max_bytes:
        raise ValueError("Artifact size differs from manifest or exceeds the byte budget")
    digest = sha256(path)
    if digest != expected_sha256.lower():
        raise ValueError("Artifact SHA-256 differs from the selected pin")
    return digest


def temporary(output):
    output = Path(output)
    if output.exists() or output.is_symlink():
        raise FileExistsError("Output already exists; select a new output path")
    handle, name = tempfile.mkstemp(prefix=".screen-bulk-", dir=output.parent)
    os.close(handle)
    return Path(name)


def publish(temp, output):
    # Exclusive publication preserves an output created by another process too.
    os.link(temp, output)
    temp.unlink()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("SCREEN artifact redirected; select and verify a new manifest")


def acquire(info, output, max_bytes=64 * 1024 * 1024, opener=None):
    artifact = info["artifact"]
    if artifact["bytes"] > max_bytes:
        raise ValueError("Artifact exceeds download budget")
    temp = temporary(output)
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    started = time.monotonic()
    size = 0
    digest = hashlib.sha256()
    try:
        request = urllib.request.Request(artifact["url"], headers={"Accept-Encoding": "identity", "If-Match": artifact["etag"], "User-Agent": "bio-mcp-screen-bulk/1.0"})
        with opener(request, timeout=30) as response, temp.open("wb") as target:
            if response.status != 200 or response.headers.get("Content-Range") is not None:
                raise ValueError("Artifact requires complete HTTP 200")
            if response.headers.get("ETag") != artifact["etag"]:
                raise ValueError("Artifact ETag changed or is missing")
            if response.headers.get("Content-Encoding", "identity").lower() != "identity":
                raise ValueError("Unexpected HTTP content encoding; preserve exact gzip bytes")
            length = response.headers.get("Content-Length")
            if length is not None and (not re.fullmatch(r"[0-9]+", length) or int(length) != artifact["bytes"]):
                raise ValueError("Artifact Content-Length changed")
            while chunk := response.read(65536):
                size += len(chunk)
                if size > min(max_bytes, artifact["bytes"]) or time.monotonic() - started > 300:
                    raise ValueError("Artifact exceeded download byte/time budget")
                digest.update(chunk)
                target.write(chunk)
        if size != artifact["bytes"]:
            raise ValueError("Artifact is shorter than the manifest")
        publish(temp, output)
        return {"artifact": artifact, "path": str(output), "bytes": size, "sha256": digest.hexdigest(), "etag_verified": True,
                "scope": "Complete transferred bytes; gzip structure, native rows and file coverage are verified separately by import."}
    finally:
        temp.unlink(missing_ok=True)
