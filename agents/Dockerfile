# Long-running background worker (Fly.io, Railway, Render, ECS, k8s...).
# Not for Vercel: serverless functions can't host a persistent worker loop.
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
COPY pyproject.toml ./
COPY zynalive_agents ./zynalive_agents
RUN pip install .
RUN useradd --create-home agent
USER agent
# Required: DATABASE_URL, ANTHROPIC_API_KEY. Optional: AI_MODEL, AI_MODEL_<BRANCH>, AI_CONCURRENCY, AI_*_EVERY_MIN.
CMD ["python", "-m", "zynalive_agents"]
