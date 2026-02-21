import asyncio
import os
from datetime import datetime, timezone

import httpx

from app.config import settings
from app.provider_catalog import read_catalog_cache, write_catalog_cache


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _extract_models(payload: dict) -> list[str]:
    data = payload.get("data")
    if not isinstance(data, list):
        return []
    models: list[str] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        model_id = item.get("id") or item.get("model") or item.get("name")
        if isinstance(model_id, str) and model_id.strip():
            models.append(model_id.strip())
    # 去重且保持顺序
    uniq: list[str] = []
    seen = set()
    for m in models:
        if m not in seen:
            seen.add(m)
            uniq.append(m)
    return uniq


async def _fetch_models(
    provider: str,
    url: str,
    api_key: str | None = None,
    headers: dict | None = None,
) -> dict:
    req_headers = headers.copy() if headers else {}
    if api_key:
        req_headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with httpx.AsyncClient(timeout=settings.catalog_sync_timeout_seconds) as client:
            resp = await client.get(url, headers=req_headers)
            resp.raise_for_status()
            payload = resp.json()
        models = _extract_models(payload)
        if not models:
            return {
                "provider": provider,
                "ok": False,
                "models": [],
                "source": url,
                "updated_at": _now_iso(),
                "error": "empty_model_list",
            }
        return {
            "provider": provider,
            "ok": True,
            "models": models,
            "source": url,
            "updated_at": _now_iso(),
            "error": None,
        }
    except Exception as exc:
        return {
            "provider": provider,
            "ok": False,
            "models": [],
            "source": url,
            "updated_at": _now_iso(),
            "error": str(exc),
        }


async def sync_catalog_once() -> dict:
    tasks = [
        _fetch_models("OpenRouter", "https://openrouter.ai/api/v1/models"),
    ]

    openai_key = os.getenv("OPENAI_API_KEY", "").strip().strip("'\"")
    if openai_key:
        tasks.append(_fetch_models("OpenAI", "https://api.openai.com/v1/models", openai_key))

    groq_key = os.getenv("GROQ_API_KEY", "").strip().strip("'\"")
    if groq_key:
        tasks.append(_fetch_models("Groq", "https://api.groq.com/openai/v1/models", groq_key))

    deepseek_key = os.getenv("DEEPSEEK_API_KEY", "").strip().strip("'\"")
    if deepseek_key:
        tasks.append(_fetch_models("DeepSeek", "https://api.deepseek.com/v1/models", deepseek_key))

    together_key = os.getenv("TOGETHER_API_KEY", "").strip().strip("'\"")
    if together_key:
        tasks.append(_fetch_models("Together", "https://api.together.xyz/v1/models", together_key))

    fireworks_key = os.getenv("FIREWORKS_API_KEY", "").strip().strip("'\"")
    if fireworks_key:
        tasks.append(_fetch_models("Fireworks", "https://api.fireworks.ai/inference/v1/models", fireworks_key))

    xai_key = os.getenv("XAI_API_KEY", "").strip().strip("'\"")
    if xai_key:
        tasks.append(_fetch_models("xAI", "https://api.x.ai/v1/models", xai_key))

    cerebras_key = os.getenv("CEREBRAS_API_KEY", "").strip().strip("'\"")
    if cerebras_key:
        tasks.append(_fetch_models("Cerebras", "https://api.cerebras.ai/v1/models", cerebras_key))

    dashscope_key = os.getenv("DASHSCOPE_API_KEY", "").strip().strip("'\"")
    if dashscope_key:
        tasks.append(
            _fetch_models(
                "DashScope(Qwen)",
                "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
                dashscope_key,
            )
        )

    results = await asyncio.gather(*tasks)
    targets = {r["provider"]: r for r in results}
    cache = read_catalog_cache()
    cache["updated_at"] = _now_iso()
    cache["targets"] = {**cache.get("targets", {}), **targets}
    write_catalog_cache(cache)
    return cache


async def periodic_sync_loop(stop_event: asyncio.Event) -> None:
    if settings.catalog_sync_on_startup:
        await sync_catalog_once()

    while not stop_event.is_set():
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=settings.catalog_sync_interval_seconds)
        except asyncio.TimeoutError:
            await sync_catalog_once()
