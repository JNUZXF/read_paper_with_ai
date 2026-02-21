import hashlib
from collections.abc import AsyncIterator

from openai import AsyncOpenAI

from app.config import settings


def provider_fingerprint(base_url: str, model: str) -> str:
    raw = f"{base_url}|{model}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def build_client(api_key: str, base_url: str, timeout_seconds: float | None = None) -> AsyncOpenAI:
    return AsyncOpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=timeout_seconds or settings.default_timeout_seconds,
    )


async def chat_once(
    client: AsyncOpenAI,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_output_tokens: int,
    reasoning: dict | None = None,
) -> str:
    kwargs = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_output_tokens,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if reasoning:
        kwargs["extra_body"] = {"reasoning": reasoning}
    resp = await client.chat.completions.create(**kwargs)
    return resp.choices[0].message.content or ""


async def chat_stream(
    client: AsyncOpenAI,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_output_tokens: int,
    reasoning: dict | None = None,
) -> AsyncIterator[str]:
    kwargs = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_output_tokens,
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if reasoning:
        kwargs["extra_body"] = {"reasoning": reasoning}
    stream = await client.chat.completions.create(**kwargs)
    async for chunk in stream:
        delta = chunk.choices[0].delta.content or ""
        if delta:
            yield delta


async def chat_stream_events(
    client: AsyncOpenAI,
    model: str,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
    max_output_tokens: int,
    reasoning: dict | None = None,
) -> AsyncIterator[dict]:
    kwargs = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_output_tokens,
        "stream": True,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if reasoning is not None:
        kwargs["extra_body"] = {"reasoning": reasoning}
    stream = await client.chat.completions.create(**kwargs)
    async for chunk in stream:
        delta_obj = chunk.choices[0].delta
        content = getattr(delta_obj, "content", None) or ""
        if content:
            yield {"type": "content", "text": content}
        reasoning_text = getattr(delta_obj, "reasoning", None) or getattr(delta_obj, "reasoning_content", None) or ""
        if reasoning_text:
            yield {"type": "reasoning", "text": reasoning_text}
