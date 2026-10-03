"""🤖 Subtitles branch: speech-to-text captions for ready videos.

`media_subtitles` jobs (queued by internal_media_ready for videos with audio):
extract audio → transcribe (Whisper via `Transcriber`) → source-language
WebVTT → Claude translates the cues into `media.subtitle_languages` →
per-language HLS subtitle playlists → master playlist rebuilt with
EXT-X-MEDIA subtitle tracks → internal_media_subtitles().

Transcripts are user speech, so they are passed to Claude as untrusted data.
"""

from __future__ import annotations

import logging
import pathlib
import tempfile
from dataclasses import dataclass
from typing import Protocol

from psycopg.types.json import Jsonb
from pydantic import BaseModel

from ..db import Database
from ..llm import LLM, untrusted
from . import hdr
from .pipeline import OUTPUT_BUCKET, SOURCE_BUCKET, MediaTools
from .storage import Storage

log = logging.getLogger("zynalive.subtitles")

# Native names shown in the player's captions menu.
LANGUAGE_NAMES = {
    "en": "English", "ur": "اردو", "hi": "हिन्दी", "bn": "বাংলা", "id": "Bahasa Indonesia", "ms": "Bahasa Melayu",
    "tr": "Türkçe", "ar": "العربية", "fil": "Filipino", "tl": "Filipino", "ne": "नेपाली", "pa": "ਪੰਜਾਬੀ", "ta": "தமிழ்",
}
TRANSLATE_BATCH = 60


@dataclass(frozen=True)
class Cue:
    start: float
    end: float
    text: str


@dataclass(frozen=True)
class Transcript:
    language: str
    cues: list[Cue]


class Transcriber(Protocol):
    def transcribe(self, audio: pathlib.Path) -> Transcript: ...


class WhisperTranscriber:
    """faster-whisper (install `zynalive-agents[subtitles]`). Handles Urdu, Hindi, Bengali, English and code-mixing."""

    def __init__(self, model_size: str = "small", device: str = "auto"):
        from faster_whisper import WhisperModel  # optional dependency, imported lazily

        self._model = WhisperModel(model_size, device=device, compute_type="int8")

    def transcribe(self, audio: pathlib.Path) -> Transcript:
        segments, info = self._model.transcribe(str(audio), vad_filter=True, beam_size=5)
        cues = [Cue(s.start, s.end, s.text.strip()) for s in segments if s.text.strip()]
        return Transcript(info.language, cues)


class CueTranslations(BaseModel):
    texts: list[str]


def _ts(seconds: float) -> str:
    ms = int(round(max(seconds, 0) * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def to_webvtt(cues: list[Cue]) -> str:
    # X-TIMESTAMP-MAP aligns the captions with the (fMP4) media timeline in HLS.
    lines = ["WEBVTT", "X-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000", ""]
    for i, cue in enumerate(cues, 1):
        text = cue.text.replace("-->", "→").strip()
        lines += [str(i), f"{_ts(cue.start)} --> {_ts(max(cue.end, cue.start + 0.2))}", text, ""]
    return "\n".join(lines)


def base_language(code: str) -> str:
    return code.split("-")[0].lower()


def translate_cues(llm: LLM, cues: list[Cue], source: str, target: str) -> list[Cue]:
    out: list[Cue] = []
    for i in range(0, len(cues), TRANSLATE_BATCH):
        batch = cues[i:i + TRANSLATE_BATCH]
        numbered = "\n".join(f"{n}. {c.text}" for n, c in enumerate(batch, 1))
        result = llm.structured(
            branch="subtitles",
            system=("You translate video subtitles. Return exactly one translation per numbered line, in order, "
                    "as natural, concise captions. Keep names, slang and emoji. Roman Urdu/Hindi should be understood "
                    "as such. Never merge, split or drop lines."),
            effort="low",
            schema=CueTranslations,
            prompt=(f"Source language: {source}\nTarget language (BCP-47): {target}\n"
                    f"Lines ({len(batch)}):\n{untrusted(numbered)}"),
        )
        if len(result.texts) != len(batch):
            raise RuntimeError(f"translation returned {len(result.texts)} lines for {len(batch)}")
        out += [Cue(c.start, c.end, t.strip()[:300] or c.text) for c, t in zip(batch, result.texts)]
    return out


def generate_subtitles(db: Database, storage: Storage, tools: MediaTools, transcriber: Transcriber, llm: LLM,
                       asset_id: str) -> dict:
    asset = db.one("select * from public.media_assets where id = %s", (asset_id,))
    if asset is None or asset["status"] != "ready" or asset["subtitle_status"] != "pending":
        return {"skipped": True}
    settings = (db.one("select value from public.platform_settings where key = 'media'") or {}).get("value") or {}
    targets = [base_language(t) for t in settings.get("subtitle_languages") or []]

    with tempfile.TemporaryDirectory(prefix="subs-") as tmp:
        work = pathlib.Path(tmp)
        source = work / pathlib.Path(asset["source_path"]).name
        storage.download(SOURCE_BUCKET, asset["source_path"], source)
        audio = work / "audio.wav"
        tools.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000", str(audio)])
        transcript = transcriber.transcribe(audio)
        if not transcript.cues:
            db.run("select public.internal_media_subtitles(%s, %s)", (asset_id, Jsonb([])))
            return {"tracks": []}

        spoken = base_language(transcript.language)
        by_language = {spoken: transcript.cues}
        for target in targets:
            if target not in by_language:
                by_language[target] = translate_cues(llm, transcript.cues, spoken, target)

        duration = (asset["duration_ms"] or 0) / 1000 or max(c.end for c in transcript.cues)
        subs = work / "subs"
        subs.mkdir()
        tracks, rows = [], []
        for language, cues in by_language.items():
            (subs / f"{language}.vtt").write_text(to_webvtt(cues), encoding="utf-8")
            (subs / f"{language}.m3u8").write_text(hdr.subtitle_playlist(f"{language}.vtt", duration))
            storage.upload(OUTPUT_BUCKET, f"{asset_id}/subs/{language}.vtt", subs / f"{language}.vtt")
            storage.upload(OUTPUT_BUCKET, f"{asset_id}/subs/{language}.m3u8", subs / f"{language}.m3u8")
            name = LANGUAGE_NAMES.get(language, language)
            tracks.append(hdr.SubtitleTrack(language, name, f"subs/{language}.m3u8", default=language == spoken))
            rows.append({"language": language, "name": name, "is_source": language == spoken,
                         "vtt_path": f"{asset_id}/subs/{language}.vtt", "playlist_path": f"{asset_id}/subs/{language}.m3u8"})

        # Rebuild the master playlist from the recorded ladder, now with subtitle tracks.
        rungs = [hdr.rung_from_row(r) for r in db.all(
            "select label, width, height, bitrate_kbps, dynamic_range, codecs from public.media_renditions where asset_id = %s", (asset_id,))]
        master = work / "master.m3u8"
        master.write_text(hdr.master_playlist(rungs, fps=float(asset["fps"]) if asset["fps"] else None,
                                              has_audio=bool(asset["has_audio"]), subtitles=tracks))
        storage.upload(OUTPUT_BUCKET, asset["playback_path"], master)

    db.run("select public.internal_media_subtitles(%s, %s)", (asset_id, Jsonb(rows)))
    return {"spoken": spoken, "tracks": [r["language"] for r in rows]}
