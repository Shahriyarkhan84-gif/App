"""📺 Upload / live-recording pipeline: probe → HDR detection → ladder → HLS.

Runs `media_process` jobs. Each step reports back through service-role RPCs
(`internal_media_*`), which own the state machine and invariants (e.g. every
ladder keeps an SDR fallback). Encoding is done by ffmpeg through `MediaTools`
so tests can swap in a fake.
"""

from __future__ import annotations

import json
import logging
import pathlib
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Protocol

from psycopg.types.json import Jsonb

from ..db import Database
from . import hdr
from .storage import Storage, upload_tree

log = logging.getLogger("zynalive.media")

SOURCE_BUCKET = "uploads"
OUTPUT_BUCKET = "media"


class MediaError(RuntimeError):
    """A source that can't be processed (not retryable): bad file, too long..."""


class MediaTools(Protocol):
    def probe(self, path: pathlib.Path) -> dict: ...
    def run(self, args: list[str]) -> None: ...


@dataclass
class FFmpegTools:
    ffprobe: str = "ffprobe"
    timeout_s: int = 6 * 3600

    def probe(self, path: pathlib.Path) -> dict:
        out = subprocess.run(
            [self.ffprobe, "-v", "error", "-print_format", "json", "-show_format", "-show_streams",
             # First frame's side data carries HDR10 mastering / light-level metadata.
             "-show_frames", "-read_intervals", "%+#1", "-select_streams", "v:0", str(path)],
            capture_output=True, text=True, timeout=300, check=False)
        if out.returncode != 0:
            raise MediaError(f"unreadable source: {out.stderr.strip()[:300]}")
        data = json.loads(out.stdout or "{}")
        # -select_streams limited streams to video; re-probe once for audio presence.
        audio = subprocess.run([self.ffprobe, "-v", "error", "-print_format", "json", "-show_streams",
                                "-select_streams", "a", str(path)], capture_output=True, text=True, timeout=120, check=False)
        data["streams"] = (data.get("streams") or []) + (json.loads(audio.stdout or "{}").get("streams") or [])
        return data

    def run(self, args: list[str]) -> None:
        out = subprocess.run(args, capture_output=True, text=True, timeout=self.timeout_s, check=False)
        if out.returncode != 0:
            raise RuntimeError(f"{args[0]} exited {out.returncode}: {out.stderr.strip()[-500:]}")


def _settings(db: Database) -> dict:
    row = db.one("select value from public.platform_settings where key = 'media'")
    return (row or {}).get("value") or {}


def process_media(db: Database, storage: Storage, tools: MediaTools, asset_id: str, *, preset: str = "medium") -> dict:
    asset = db.one("select * from public.media_assets where id = %s", (asset_id,))
    if asset is None or asset["status"] in ("ready", "removed"):
        return {"skipped": True}
    settings = _settings(db)
    db.run("select public.internal_media_started(%s)", (asset_id,))
    try:
        with tempfile.TemporaryDirectory(prefix="media-") as tmp:
            work = pathlib.Path(tmp)
            source = work / pathlib.Path(asset["source_path"]).name
            storage.download(SOURCE_BUCKET, asset["source_path"], source)
            max_mb = settings.get("max_upload_mb")
            if max_mb and source.stat().st_size > int(max_mb) * 1024 * 1024:
                raise MediaError("file_too_large")

            summary = hdr.probe_summary(tools.probe(source))
            max_s = settings.get("max_duration_s")
            if max_s and summary["duration_ms"] and summary["duration_ms"] > int(max_s) * 1000:
                raise MediaError("too_long")
            db.run("select public.internal_media_probed(%s, %s)", (asset_id, Jsonb(summary)))

            ladder = hdr.plan_ladder(summary, hdr_enabled=settings.get("hdr_enabled", True) is not False,
                                     uhd_enabled=settings.get("uhd_enabled", True) is not False)
            out = work / "out"
            for rung in ladder:
                (out / rung.label).mkdir(parents=True, exist_ok=True)
                tools.run(hdr.ffmpeg_args(str(source), str(out), rung, summary, preset=preset))
            tools.run(hdr.thumbnail_args(str(source), str(out / "thumb.jpg"), summary))
            (out / "master.m3u8").write_text(hdr.master_playlist(ladder, fps=summary["fps"], has_audio=summary["has_audio"]))

            upload_tree(storage, OUTPUT_BUCKET, asset_id, out)
    except MediaError as exc:
        db.run("select public.internal_media_failed(%s, %s)", (asset_id, str(exc)))
        log.warning("media %s rejected: %s", asset_id, exc)
        return {"failed": str(exc)}
    # Anything else (network, encoder crash) propagates: the job is retried with
    # backoff, and the worker marks the asset failed after the last attempt.

    renditions = [
        {"label": r.label, "width": r.width, "height": r.height, "bitrate_kbps": r.bitrate_kbps,
         "codecs": r.codecs, "dynamic_range": r.dynamic_range, "playlist_path": f"{asset_id}/{r.playlist}"}
        for r in ladder
    ]
    db.run("select public.internal_media_ready(%s, %s, %s, %s)",
           (asset_id, f"{asset_id}/master.m3u8", f"{asset_id}/thumb.jpg", Jsonb(renditions)))
    return {"dynamic_range": summary["dynamic_range"], "renditions": [r.label for r in ladder]}
