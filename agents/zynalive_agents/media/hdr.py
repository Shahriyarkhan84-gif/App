"""HDR detection, rendition ladder planning, and HLS playlist authoring.

Pure functions (no I/O) so the rules are unit-tested without ffmpeg:

- `probe_summary()` turns ffprobe JSON into the columns stored on
  `media_assets`, including the detected dynamic range:
  PQ (smpte2084) → HDR10, ARIB STD-B67 → HLG, anything else → SDR.
- `plan_ladder()` picks renditions: 4K HDR and 1080p HDR rungs for HDR
  sources that are big enough, and *always* an SDR ladder (tone-mapped from
  HDR sources) so every screen can play. Never upscales.
- `ffmpeg_args()` builds the encode for one rung (HEVC Main10 + HDR metadata
  for HDR rungs, H.264 for SDR rungs, fMP4 HLS segments).
- `master_playlist()` writes the adaptive-bitrate master playlist with
  VIDEO-RANGE on every variant, so players choose HDR or SDR by display.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction
from typing import Literal

DynamicRange = Literal["sdr", "hdr10", "hlg"]

PQ = "smpte2084"
HLG = "arib-std-b67"

SEGMENT_SECONDS = 6
AUDIO_KBPS = 128


@dataclass(frozen=True)
class Rung:
    label: str
    width: int
    height: int
    bitrate_kbps: int
    dynamic_range: DynamicRange
    codecs: str

    @property
    def is_hdr(self) -> bool:
        return self.dynamic_range != "sdr"

    @property
    def playlist(self) -> str:
        return f"{self.label}/index.m3u8"


# Short-side height → (HDR kbps, SDR kbps). Short side, so portrait phone video
# (1080x1920) is a "1080p" rung just like landscape.
_HDR_RUNGS = ((2160, 16000, "L153"), (1080, 6500, "L123"))
_SDR_RUNGS = ((1080, 5000, "avc1.640028"), (720, 2800, "avc1.64001f"), (480, 1400, "avc1.64001e"), (360, 800, "avc1.64001e"))


def detect_dynamic_range(color_transfer: str | None) -> DynamicRange:
    t = (color_transfer or "").lower()
    if t == PQ:
        return "hdr10"
    if t == HLG:
        return "hlg"
    return "sdr"


def _rotation(video: dict) -> int:
    for side in video.get("side_data_list") or []:
        if "rotation" in side:
            return abs(int(side["rotation"])) % 180
    rotate = (video.get("tags") or {}).get("rotate")
    return abs(int(rotate)) % 180 if rotate else 0


def _fps(video: dict) -> float | None:
    rate = video.get("avg_frame_rate") or video.get("r_frame_rate")
    try:
        value = Fraction(rate)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    return round(float(value), 3) if value > 0 else None


def _bit_depth(video: dict) -> int | None:
    if video.get("bits_per_raw_sample"):
        return int(video["bits_per_raw_sample"])
    pix = video.get("pix_fmt") or ""
    if "10" in pix:
        return 10
    if "12" in pix:
        return 12
    return 8 if pix else None


def _hdr_metadata(video: dict, frames: list[dict]) -> dict | None:
    """Mastering display + content light level (HDR10 static metadata) if present."""
    out: dict = {}
    for side in (video.get("side_data_list") or []) + [s for f in frames for s in (f.get("side_data_list") or [])]:
        kind = side.get("side_data_type", "")
        if kind == "Mastering display metadata" and "master_display" not in out:
            out["master_display"] = {k: side[k] for k in (
                "red_x", "red_y", "green_x", "green_y", "blue_x", "blue_y", "white_point_x", "white_point_y",
                "min_luminance", "max_luminance") if k in side}
        elif kind == "Content light level metadata" and "max_cll" not in out:
            out["max_cll"] = f"{side.get('max_content', 0)},{side.get('max_average', 0)}"
    return out or None


def probe_summary(probe: dict) -> dict:
    """ffprobe `-show_streams -show_format [-show_frames]` JSON → media_assets probe columns."""
    streams = probe.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video" and not (s.get("disposition") or {}).get("attached_pic")), None)
    if video is None:
        raise ValueError("no_video_stream")
    width, height = int(video["width"]), int(video["height"])
    if _rotation(video) == 90:
        width, height = height, width
    duration = video.get("duration") or (probe.get("format") or {}).get("duration")
    transfer = video.get("color_transfer")
    return {
        "duration_ms": int(float(duration) * 1000) if duration else None,
        "width": width,
        "height": height,
        "fps": _fps(video),
        "video_codec": video.get("codec_name"),
        "bit_depth": _bit_depth(video),
        "color_primaries": video.get("color_primaries"),
        "color_transfer": transfer,
        "color_space": video.get("color_space"),
        "dynamic_range": detect_dynamic_range(transfer),
        "hdr_metadata": _hdr_metadata(video, probe.get("frames") or []),
        "has_audio": any(s.get("codec_type") == "audio" for s in streams),
    }


def _even(n: float) -> int:
    return max(2, int(round(n / 2)) * 2)


def _scaled(width: int, height: int, short_side: int) -> tuple[int, int]:
    if width <= height:  # portrait / square: width is the short side
        return _even(short_side), _even(height * short_side / width)
    return _even(width * short_side / height), _even(short_side)


def plan_ladder(summary: dict, *, hdr_enabled: bool = True, uhd_enabled: bool = True) -> list[Rung]:
    """Rendition ladder for a probed source (see module docstring)."""
    width, height = summary["width"], summary["height"]
    short = min(width, height)
    dynamic_range: DynamicRange = summary["dynamic_range"]
    rungs: list[Rung] = []

    if dynamic_range != "sdr" and hdr_enabled:
        for side, kbps, level in _HDR_RUNGS:
            if side == 2160 and not uhd_enabled:
                continue
            # Accept sources a few pixels short (e.g. 2156p crops) for the rung.
            if short >= side * 0.97:
                w, h = _scaled(width, height, min(side, short))
                rungs.append(Rung(f"{side}p_hdr", w, h, kbps, dynamic_range, f"hvc1.2.4.{level}.B0"))

    for side, kbps, codec in _SDR_RUNGS:
        if short >= side * 0.97:
            w, h = _scaled(width, height, min(side, short))
            rungs.append(Rung(f"{side}p", w, h, kbps, "sdr", codec))
    if not any(r.dynamic_range == "sdr" for r in rungs):
        # Tiny source (< 360p short side): one SDR rung at source size.
        w, h = _even(width), _even(height)
        rungs.append(Rung(f"{max(min(h, w), 100)}p", w, h, 600, "sdr", "avc1.64001e"))
    return rungs


# SDR from HDR: linearize, tone-map (Hable), convert primaries to BT.709.
_TONEMAP = ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
            "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p")


def video_filter(rung: Rung, source_range: DynamicRange) -> str:
    scale = f"scale={rung.width}:{rung.height}:flags=lanczos"
    if rung.is_hdr:
        return f"{scale},format=yuv420p10le"
    if source_range != "sdr":
        return f"{_TONEMAP},{scale}"
    return f"{scale},format=yuv420p"


def _x265_hdr_params(rung: Rung, summary: dict) -> str:
    transfer = PQ if rung.dynamic_range == "hdr10" else HLG
    params = ["repeat-headers=1", "colorprim=bt2020", f"transfer={transfer}", "colormatrix=bt2020nc", "range=limited"]
    meta = summary.get("hdr_metadata") or {}
    if rung.dynamic_range == "hdr10":
        params.append("hdr10=1")
        md = meta.get("master_display")
        if md and all(k in md for k in ("red_x", "white_point_x", "max_luminance")):
            def c(v: str, scale: int) -> int:
                return round(float(Fraction(v)) * scale)
            params.append(
                "master-display=G({},{})B({},{})R({},{})WP({},{})L({},{})".format(
                    c(md["green_x"], 50000), c(md["green_y"], 50000), c(md["blue_x"], 50000), c(md["blue_y"], 50000),
                    c(md["red_x"], 50000), c(md["red_y"], 50000), c(md["white_point_x"], 50000), c(md["white_point_y"], 50000),
                    c(md["max_luminance"], 10000), c(md["min_luminance"], 10000)))
        if meta.get("max_cll"):
            params.append(f"max-cll={meta['max_cll']}")
    return ":".join(params)


def ffmpeg_args(source: str, out_dir: str, rung: Rung, summary: dict, *, preset: str = "medium") -> list[str]:
    """One rung → fMP4 HLS (`<out_dir>/<label>/index.m3u8`)."""
    fps = summary.get("fps") or 30
    gop = max(1, round(fps * 2))  # 2 s keyframe interval → segment boundaries line up across rungs
    maxrate = int(rung.bitrate_kbps * 1.25)
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", source, "-map", "0:v:0"]
    if summary.get("has_audio"):
        args += ["-map", "0:a:0", "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-ac", "2"]
    args += ["-vf", video_filter(rung, summary["dynamic_range"])]
    if rung.is_hdr:
        args += ["-c:v", "libx265", "-preset", preset, "-profile:v", "main10", "-tag:v", "hvc1",
                 "-x265-params", f"{_x265_hdr_params(rung, summary)}:keyint={gop}:min-keyint={gop}:scenecut=0",
                 "-color_primaries", "bt2020", "-color_trc", PQ if rung.dynamic_range == "hdr10" else HLG,
                 "-colorspace", "bt2020nc"]
    else:
        args += ["-c:v", "libx264", "-preset", preset, "-profile:v", "high", "-g", str(gop), "-keyint_min", str(gop),
                 "-sc_threshold", "0", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
    args += ["-b:v", f"{rung.bitrate_kbps}k", "-maxrate", f"{maxrate}k", "-bufsize", f"{rung.bitrate_kbps * 2}k",
             "-f", "hls", "-hls_time", str(SEGMENT_SECONDS), "-hls_playlist_type", "vod",
             "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
             "-hls_segment_filename", f"{out_dir}/{rung.label}/seg_%05d.m4s", f"{out_dir}/{rung.label}/index.m3u8"]
    return args


def thumbnail_args(source: str, dest: str, summary: dict) -> list[str]:
    at = min(1.0, (summary.get("duration_ms") or 0) / 2000)
    tone = f"{_TONEMAP}," if summary["dynamic_range"] != "sdr" else ""
    return ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{at:.2f}", "-i", source,
            "-frames:v", "1", "-vf", f"{tone}scale=640:-2,format=yuvj420p", "-q:v", "3", dest]


_VIDEO_RANGE = {"sdr": "SDR", "hdr10": "PQ", "hlg": "HLG"}


@dataclass(frozen=True)
class SubtitleTrack:
    language: str
    name: str
    playlist: str
    default: bool = False


def master_playlist(rungs: list[Rung], *, fps: float | None, has_audio: bool,
                    subtitles: list[SubtitleTrack] | None = None) -> str:
    """HLS master playlist. SDR variants are listed first (the safe start point
    for players that don't evaluate VIDEO-RANGE), then HDR variants."""
    lines = ["#EXTM3U", "#EXT-X-VERSION:7", "#EXT-X-INDEPENDENT-SEGMENTS"]
    subtitles = subtitles or []
    for track in subtitles:
        lines.append(
            f'#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="{track.language}",NAME="{track.name}",'
            f'DEFAULT={"YES" if track.default else "NO"},AUTOSELECT=YES,URI="{track.playlist}"')
    ordered = sorted(rungs, key=lambda r: (r.is_hdr, -r.height * r.width))
    for rung in ordered:
        audio_kbps = AUDIO_KBPS if has_audio else 0
        codecs = rung.codecs + (",mp4a.40.2" if has_audio else "")
        attrs = [
            f"BANDWIDTH={int((rung.bitrate_kbps * 1.25 + audio_kbps) * 1000)}",
            f"AVERAGE-BANDWIDTH={(rung.bitrate_kbps + audio_kbps) * 1000}",
            f"RESOLUTION={rung.width}x{rung.height}",
            f'CODECS="{codecs}"',
            f"VIDEO-RANGE={_VIDEO_RANGE[rung.dynamic_range]}",
        ]
        if fps:
            attrs.append(f"FRAME-RATE={fps:.3f}")
        if subtitles:
            attrs.append('SUBTITLES="subs"')
        lines.append("#EXT-X-STREAM-INF:" + ",".join(attrs))
        lines.append(rung.playlist)
    return "\n".join(lines) + "\n"


def subtitle_playlist(vtt_file: str, duration_s: float) -> str:
    """Single-segment VOD playlist wrapping a whole WebVTT file."""
    target = max(1, int(duration_s + 0.999))
    return "\n".join([
        "#EXTM3U", "#EXT-X-VERSION:3", f"#EXT-X-TARGETDURATION:{target}", "#EXT-X-MEDIA-SEQUENCE:0",
        "#EXT-X-PLAYLIST-TYPE:VOD", f"#EXTINF:{duration_s:.3f},", vtt_file, "#EXT-X-ENDLIST",
    ]) + "\n"


def rung_from_row(row: dict) -> Rung:
    return Rung(row["label"], row["width"], row["height"], row["bitrate_kbps"], row["dynamic_range"], row["codecs"])
