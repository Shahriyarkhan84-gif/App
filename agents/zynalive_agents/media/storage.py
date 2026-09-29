"""Object storage for the media worker.

Production uses Supabase Storage's REST API with the service-role key (the
worker is the only writer of the public `media` bucket). Tests use
`LocalStorage`, a directory per bucket.
"""

from __future__ import annotations

import mimetypes
import pathlib
import shutil
from typing import Protocol

import httpx

mimetypes.add_type("application/vnd.apple.mpegurl", ".m3u8")
mimetypes.add_type("video/iso.segment", ".m4s")
mimetypes.add_type("text/vtt", ".vtt")


class Storage(Protocol):
    def download(self, bucket: str, name: str, dest: pathlib.Path) -> None: ...
    def upload(self, bucket: str, name: str, source: pathlib.Path) -> None: ...


def content_type(path: pathlib.Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def upload_tree(storage: Storage, bucket: str, prefix: str, root: pathlib.Path) -> None:
    for f in sorted(p for p in root.rglob("*") if p.is_file()):
        storage.upload(bucket, f"{prefix}/{f.relative_to(root).as_posix()}", f)


class SupabaseStorage:
    def __init__(self, url: str, service_key: str, timeout_s: float = 300):
        self._base = url.rstrip("/") + "/storage/v1/object"
        self._client = httpx.Client(timeout=timeout_s, headers={"Authorization": f"Bearer {service_key}", "apikey": service_key})

    def download(self, bucket: str, name: str, dest: pathlib.Path) -> None:
        with self._client.stream("GET", f"{self._base}/authenticated/{bucket}/{name}") as r:
            r.raise_for_status()
            with dest.open("wb") as fh:
                for chunk in r.iter_bytes(1 << 20):
                    fh.write(chunk)

    def upload(self, bucket: str, name: str, source: pathlib.Path) -> None:
        with source.open("rb") as fh:
            r = self._client.post(
                f"{self._base}/{bucket}/{name}",
                content=fh,
                headers={"Content-Type": content_type(source), "x-upsert": "true", "Cache-Control": "max-age=31536000"},
            )
        r.raise_for_status()


class LocalStorage:
    def __init__(self, root: pathlib.Path):
        self.root = root

    def download(self, bucket: str, name: str, dest: pathlib.Path) -> None:
        shutil.copyfile(self.root / bucket / name, dest)

    def upload(self, bucket: str, name: str, source: pathlib.Path) -> None:
        target = self.root / bucket / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
