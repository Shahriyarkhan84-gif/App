import os
from dataclasses import dataclass, field


def _int(name: str, default: int) -> int:
    return int(os.environ.get(name, default))


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.environ["DATABASE_URL"])
    # Default model for every branch; override per branch with AI_MODEL_<BRANCH>
    # (e.g. AI_MODEL_MODERATION) to trade quality for cost on high-volume paths.
    model: str = field(default_factory=lambda: os.environ.get("AI_MODEL", "claude-opus-5"))
    poll_interval_s: float = field(default_factory=lambda: float(os.environ.get("AI_POLL_INTERVAL_S", "2")))
    concurrency: int = field(default_factory=lambda: _int("AI_CONCURRENCY", 4))
    ceo_every_min: int = field(default_factory=lambda: _int("AI_CEO_EVERY_MIN", 60))
    fraud_every_min: int = field(default_factory=lambda: _int("AI_FRAUD_EVERY_MIN", 30))
    recs_every_min: int = field(default_factory=lambda: _int("AI_RECS_EVERY_MIN", 15))
    max_attempts: int = field(default_factory=lambda: _int("AI_MAX_ATTEMPTS", 5))
    # Spending cap: AI (Claude) jobs one replica starts per UTC day. Past it, AI jobs wait in the
    # queue until the next day (media jobs keep running), so a flood of chat, reports or support
    # tickets can't run up an unbounded bill. 0 = no cap.
    daily_ai_jobs: int = field(default_factory=lambda: _int("AI_DAILY_JOB_LIMIT", 5000))
    # Which job queues this replica consumes: "all", "ai" or "media". Run media
    # (ffmpeg encoding) in its own deployment (Dockerfile.media) so long encodes
    # never starve moderation.
    queues: str = field(default_factory=lambda: os.environ.get("WORKER_QUEUES", "all"))
    # Media worker: Supabase Storage access (service role) + encoder preset.
    supabase_url: str | None = field(default_factory=lambda: os.environ.get("SUPABASE_URL"))
    supabase_service_key: str | None = field(default_factory=lambda: os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))
    media_preset: str = field(default_factory=lambda: os.environ.get("MEDIA_PRESET", "medium"))
    # Smart search (Pinecone): the AI worker keeps an index of live rooms in sync every minute.
    pinecone_api_key: str | None = field(default_factory=lambda: os.environ.get("PINECONE_API_KEY"))
    pinecone_index: str = field(default_factory=lambda: os.environ.get("PINECONE_INDEX", "zynalive-live"))
    pinecone_model: str = field(default_factory=lambda: os.environ.get("PINECONE_MODEL", "multilingual-e5-large"))
    # Whisper model size for subtitles (tiny/base/small/medium/large-v3).
    subtitles_model: str = field(default_factory=lambda: os.environ.get("SUBTITLES_MODEL", "small"))

    def model_for(self, branch: str) -> str:
        return os.environ.get(f"AI_MODEL_{branch.upper()}", self.model)
