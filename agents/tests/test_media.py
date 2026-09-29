"""Upload + HDR pipeline: detection/ladder rules, the job against a real
Postgres, worker queue separation, and (when ffmpeg is installed) a real
HDR10 encode checked with ffprobe."""

from __future__ import annotations

import json
import pathlib
import shutil
import subprocess

import pytest

from zynalive_agents.config import Settings
from zynalive_agents.media import hdr
from zynalive_agents.media.pipeline import FFmpegTools, process_media
from zynalive_agents.media.storage import LocalStorage
from zynalive_agents.worker import MediaContext, Worker, queue_kinds

from .conftest import as_user

HDR10_STREAM = {
    "codec_type": "video", "codec_name": "hevc", "width": 3840, "height": 2160, "pix_fmt": "yuv420p10le",
    "color_primaries": "bt2020", "color_transfer": "smpte2084", "color_space": "bt2020nc", "avg_frame_rate": "30000/1001",
    "side_data_list": [
        {"side_data_type": "Mastering display metadata", "red_x": "34000/50000", "red_y": "16000/50000",
         "green_x": "13250/50000", "green_y": "34500/50000", "blue_x": "7500/50000", "blue_y": "3000/50000",
         "white_point_x": "15635/50000", "white_point_y": "16450/50000", "min_luminance": "50/10000", "max_luminance": "10000000/10000"},
        {"side_data_type": "Content light level metadata", "max_content": 1000, "max_average": 400},
    ],
}


def probe_of(video: dict, *, audio: bool = True, duration: str = "12.5") -> dict:
    streams = [video] + ([{"codec_type": "audio", "codec_name": "aac"}] if audio else [])
    return {"streams": streams, "format": {"duration": duration}}


# Detection ------------------------------------------------------------------------------

def test_dynamic_range_from_transfer_characteristics():
    assert hdr.detect_dynamic_range("smpte2084") == "hdr10"
    assert hdr.detect_dynamic_range("arib-std-b67") == "hlg"
    assert hdr.detect_dynamic_range("bt709") == "sdr"
    assert hdr.detect_dynamic_range(None) == "sdr"


def test_probe_summary_reads_hdr10_metadata():
    s = hdr.probe_summary(probe_of(HDR10_STREAM))
    assert s["dynamic_range"] == "hdr10" and s["bit_depth"] == 10 and s["fps"] == 29.97
    assert s["duration_ms"] == 12500 and s["has_audio"] is True
    assert s["hdr_metadata"]["max_cll"] == "1000,400"
    assert s["hdr_metadata"]["master_display"]["max_luminance"] == "10000000/10000"


def test_probe_summary_applies_rotation_and_rejects_audio_only():
    rotated = {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "pix_fmt": "yuv420p",
               "side_data_list": [{"rotation": -90}]}
    s = hdr.probe_summary(probe_of(rotated, audio=False))
    assert (s["width"], s["height"]) == (1080, 1920) and s["dynamic_range"] == "sdr" and s["has_audio"] is False
    with pytest.raises(ValueError):
        hdr.probe_summary({"streams": [{"codec_type": "audio"}]})


# Ladder ------------------------------------------------------------------------------------

def labels(rungs):
    return [r.label for r in rungs]


def test_4k_hdr10_source_gets_4k_hdr_1080p_hdr_and_sdr_fallback():
    rungs = hdr.plan_ladder(hdr.probe_summary(probe_of(HDR10_STREAM)))
    assert labels(rungs) == ["2160p_hdr", "1080p_hdr", "1080p", "720p", "480p", "360p"]
    assert all(r.dynamic_range == "hdr10" for r in rungs if r.is_hdr)
    assert rungs[0].codecs.startswith("hvc1.2.4.L153") and rungs[2].codecs == "avc1.640028"


def test_hlg_1080p_source_and_switches():
    hlg = dict(HDR10_STREAM, width=1920, height=1080, color_transfer="arib-std-b67", side_data_list=[])
    s = hdr.probe_summary(probe_of(hlg))
    assert labels(hdr.plan_ladder(s)) == ["1080p_hdr", "1080p", "720p", "480p", "360p"]
    assert hdr.plan_ladder(s)[0].dynamic_range == "hlg"
    # HDR off → SDR only; 4K off → no 2160p rung.
    assert labels(hdr.plan_ladder(s, hdr_enabled=False)) == ["1080p", "720p", "480p", "360p"]
    assert "2160p_hdr" not in labels(hdr.plan_ladder(hdr.probe_summary(probe_of(HDR10_STREAM)), uhd_enabled=False))


def test_portrait_never_upscaled_and_tiny_sources_still_get_sdr():
    portrait = {"codec_type": "video", "codec_name": "h264", "width": 720, "height": 1280, "pix_fmt": "yuv420p"}
    rungs = hdr.plan_ladder(hdr.probe_summary(probe_of(portrait)))
    assert labels(rungs) == ["720p", "480p", "360p"]
    assert (rungs[0].width, rungs[0].height) == (720, 1280) and (rungs[-1].width, rungs[-1].height) == (360, 640)
    tiny = {"codec_type": "video", "codec_name": "h264", "width": 320, "height": 240, "pix_fmt": "yuv420p"}
    only = hdr.plan_ladder(hdr.probe_summary(probe_of(tiny)))
    assert labels(only) == ["240p"] and only[0].dynamic_range == "sdr"


def test_encode_args_carry_hdr_signalling_and_tone_map_for_sdr():
    s = hdr.probe_summary(probe_of(HDR10_STREAM))
    hdr_rung, sdr_rung = hdr.plan_ladder(s)[0], hdr.plan_ladder(s)[2]
    a = hdr.ffmpeg_args("in.mov", "out", hdr_rung, s)
    x265 = a[a.index("-x265-params") + 1]
    assert "libx265" in a and "main10" in a and "hvc1" in a
    assert "transfer=smpte2084" in x265 and "max-cll=1000,400" in x265
    assert "master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,50)" in x265
    b = hdr.ffmpeg_args("in.mov", "out", sdr_rung, s)
    assert "libx264" in b and "tonemap=tonemap=hable" in b[b.index("-vf") + 1]
    assert b[-1] == "out/1080p/index.m3u8" and "fmp4" in b


def test_master_playlist_lists_sdr_first_with_video_range():
    s = hdr.probe_summary(probe_of(HDR10_STREAM))
    text = hdr.master_playlist(hdr.plan_ladder(s), fps=s["fps"], has_audio=True,
                               subtitles=[hdr.SubtitleTrack("en", "English", "subs/en.m3u8", default=True)])
    variants = [ln for ln in text.splitlines() if ln.startswith("#EXT-X-STREAM-INF")]
    assert len(variants) == 6
    assert "VIDEO-RANGE=SDR" in variants[0] and "RESOLUTION=1920x1080" in variants[0]
    assert all("VIDEO-RANGE=PQ" in v for v in variants[-2:])
    assert all('SUBTITLES="subs"' in v and "mp4a.40.2" in v for v in variants)
    assert '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en"' in text


# Job against the database ------------------------------------------------------------------

class FakeTools:
    def __init__(self, probe: dict):
        self._probe = probe
        self.commands: list[list[str]] = []

    def probe(self, path):
        return self._probe

    def run(self, args):
        self.commands.append(args)
        out = pathlib.Path(args[-1])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("#EXTM3U\n" if out.suffix == ".m3u8" else "jpg")


@pytest.fixture()
def media_world(db, tmp_path):
    db.run("""
      insert into public.profiles (id, username, display_name) values ('mhost', 'mhost', 'Media Host');
      insert into public.hosts (user_id) values ('mhost');
    """)
    asset = as_user(db, "mhost", "select id from public.create_media_upload('Night market', 'mov')")[0]["id"]
    source_path = db.one("select source_path from public.media_assets where id = %s", (asset,))["source_path"]
    storage = LocalStorage(tmp_path / "storage")
    (tmp_path / "storage/uploads/mhost").mkdir(parents=True)
    (tmp_path / "storage" / "uploads" / source_path).write_bytes(b"not really a video")
    as_user(db, "mhost", "select public.submit_media_upload(%s)", (asset,))
    return {"asset": str(asset), "storage": storage, "root": tmp_path / "storage"}


def test_pipeline_publishes_hdr_ladder_and_master_playlist(db, media_world):
    tools = FakeTools(probe_of(HDR10_STREAM))
    out = process_media(db, media_world["storage"], tools, media_world["asset"])
    assert out["dynamic_range"] == "hdr10" and out["renditions"][:2] == ["2160p_hdr", "1080p_hdr"]
    row = db.one("select * from public.media_assets where id = %s", (media_world["asset"],))
    assert row["status"] == "ready" and row["dynamic_range"] == "hdr10" and row["color_transfer"] == "smpte2084"
    assert row["playback_path"] == f"{media_world['asset']}/master.m3u8"
    master = (media_world["root"] / "media" / row["playback_path"]).read_text()
    assert "VIDEO-RANGE=PQ" in master and "VIDEO-RANGE=SDR" in master
    labels_db = {r["label"] for r in db.all("select label from public.media_renditions where asset_id = %s", (media_world["asset"],))}
    assert labels_db == {"2160p_hdr", "1080p_hdr", "1080p", "720p", "480p", "360p"}
    assert len(tools.commands) == 7  # 6 rungs + thumbnail
    # Re-running a finished job is a no-op.
    assert process_media(db, media_world["storage"], tools, media_world["asset"]) == {"skipped": True}


def test_pipeline_rejects_overlong_source(db, media_world):
    db.run("update public.platform_settings set value = value || '{\"max_duration_s\": 5}' where key = 'media'")
    try:
        out = process_media(db, media_world["storage"], FakeTools(probe_of(HDR10_STREAM)), media_world["asset"])
    finally:
        db.run("update public.platform_settings set value = value || '{\"max_duration_s\": 3600}' where key = 'media'")
    assert out == {"failed": "too_long"}
    assert db.one("select status from public.media_assets where id = %s", (media_world["asset"],))["status"] == "failed"


def test_worker_queues_are_separate_and_final_failure_marks_asset(db, llm, media_world, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "unused")
    ctx = MediaContext(media_world["storage"], FakeTools(probe_of(HDR10_STREAM)))
    ai = Worker(Settings(queues="ai"), db, llm, ctx)
    assert "media_process" not in ai.kinds
    assert ai.drain_once() == 0  # the queued media job is not the AI worker's
    ai.pool.shutdown(wait=True)

    class Broken(FakeTools):
        def run(self, args):
            raise RuntimeError("encoder crashed")

    media = Worker(Settings(queues="media", max_attempts=1), db, llm, MediaContext(media_world["storage"], Broken(probe_of(HDR10_STREAM))))
    assert media.kinds == ["media_process"]
    assert media.drain_once() == 1
    media.pool.shutdown(wait=True)
    assert db.one("select status from public.ai_jobs where kind = 'media_process'")["status"] == "failed"
    asset = db.one("select status, error from public.media_assets where id = %s", (media_world["asset"],))
    assert asset["status"] == "failed" and "encoder crashed" in asset["error"]


def test_queue_kinds_never_claims_unhandled_media():
    dispatch = {"moderate_message": None, "ceo_briefing": None}
    assert queue_kinds(dispatch, "all") == ["moderate_message", "ceo_briefing"]
    assert queue_kinds(dispatch, "media") == []


def test_long_running_encodes_are_not_requeued_early(db):
    db.run("insert into public.ai_jobs (kind, status, locked_at) values ('media_process', 'running', now() - interval '1 hour')")
    db.run("insert into public.ai_jobs (kind, status, locked_at) values ('moderate_message', 'running', now() - interval '1 hour')")
    assert db.requeue_stale() == 1
    assert db.one("select status from public.ai_jobs where kind = 'media_process'")["status"] == "running"


# Real encode --------------------------------------------------------------------------------

@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_real_hdr10_encode(db, media_world):
    src = media_world["root"] / "uploads" / db.one("select source_path from public.media_assets where id = %s", (media_world["asset"],))["source_path"]
    # 1 s 1080p HDR10 (PQ / BT.2020, 10-bit HEVC) test clip with a tone.
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=10:duration=1",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-vf", "format=yuv420p10le", "-c:v", "libx265", "-preset", "ultrafast",
        "-x265-params", "log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:hdr10=1:max-cll=1000,400",
        "-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc",
        "-c:a", "aac", "-shortest", "-f", "mov", str(src)], check=True)

    out = process_media(db, media_world["storage"], FFmpegTools(), media_world["asset"], preset="ultrafast")
    assert out["dynamic_range"] == "hdr10"
    assert out["renditions"] == ["1080p_hdr", "1080p", "720p", "480p", "360p"]
    base = media_world["root"] / "media" / media_world["asset"]
    assert (base / "thumb.jpg").stat().st_size > 0

    def stream(label):
        seg = sorted((base / label).glob("*.m4s"))[0]
        joined = base / label / "joined.mp4"
        joined.write_bytes((base / label / "init.mp4").read_bytes() + seg.read_bytes())
        info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams",
                                          "-select_streams", "v:0", str(joined)], capture_output=True, text=True, check=True).stdout)
        return info["streams"][0]

    hdr_out = stream("1080p_hdr")
    assert hdr_out["codec_name"] == "hevc" and hdr_out["color_transfer"] == "smpte2084" and hdr_out["pix_fmt"] == "yuv420p10le"
    sdr_out = stream("720p")
    assert sdr_out["codec_name"] == "h264" and sdr_out["color_transfer"] == "bt709" and sdr_out["height"] == 720
    master = (base / "master.m3u8").read_text()
    assert "VIDEO-RANGE=PQ" in master and master.index("VIDEO-RANGE=SDR") < master.index("VIDEO-RANGE=PQ")
    assert db.one("select status from public.media_assets where id = %s", (media_world["asset"],))["status"] == "ready"
