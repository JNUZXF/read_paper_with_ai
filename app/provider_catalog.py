import json
from pathlib import Path


CACHE_PATH = Path("data/provider_catalog_cache.json")


def _load_openrouter_models_from_md() -> list[str]:
    model_file = Path("openrouter模型.md")
    if not model_file.exists():
        return []

    models: list[str] = []
    for raw in model_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "/" in line and " " not in line:
            models.append(line)
    return models


def _base_catalog() -> list[dict]:
    openrouter_models = _load_openrouter_models_from_md()
    return [
        {
            "provider": "OpenAI",
            "base_url": "https://api.openai.com/v1",
            "models": ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1"],
            "note": "官方 OpenAI API。",
            "reference": "https://platform.openai.com/docs/api-reference/chat/create-chat-completion",
        },
        {
            "provider": "OpenRouter",
            "base_url": "https://openrouter.ai/api/v1",
            "models": openrouter_models or ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.5"],
            "note": "模型列表优先读取本地 openrouter模型.md。",
            "reference": "https://openrouter.ai/docs/quickstart",
        },
        {
            "provider": "Groq",
            "base_url": "https://api.groq.com/openai/v1",
            "models": ["llama-3.3-70b-versatile", "deepseek-r1-distill-llama-70b"],
            "note": "OpenAI 兼容地址。",
            "reference": "https://console.groq.com/docs/openai",
        },
        {
            "provider": "DeepSeek",
            "base_url": "https://api.deepseek.com/v1",
            "models": ["deepseek-chat", "deepseek-reasoner"],
            "note": "DeepSeek 官方 API。",
            "reference": "https://api-docs.deepseek.com/",
        },
        {
            "provider": "Together",
            "base_url": "https://api.together.xyz/v1",
            "models": ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
            "note": "Together OpenAI 兼容接口。",
            "reference": "https://docs.together.ai/docs/openai-api-compatibility",
        },
        {
            "provider": "Fireworks",
            "base_url": "https://api.fireworks.ai/inference/v1",
            "models": ["accounts/fireworks/models/deepseek-v3", "accounts/fireworks/models/llama-v3p1-70b-instruct"],
            "note": "Fireworks OpenAI 兼容接口。",
            "reference": "https://docs.fireworks.ai/tools-sdks/openai-compatibility",
        },
        {
            "provider": "xAI",
            "base_url": "https://api.x.ai/v1",
            "models": [],
            "note": "xAI API（OpenAI 兼容，模型名请按控制台最新列表填写）。",
            "reference": "https://docs.x.ai/docs/api-reference",
        },
        {
            "provider": "Cerebras",
            "base_url": "https://api.cerebras.ai/v1",
            "models": ["llama3.1-8b", "llama-3.3-70b", "gpt-oss-120b", "qwen-3-32b"],
            "note": "Cerebras OpenAI 兼容接口。",
            "reference": "https://inference-docs.cerebras.ai/resources/openai",
        },
        {
            "provider": "DashScope(Qwen)",
            "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
            "models": ["qwen-max", "qwen-plus", "qwen-turbo"],
            "note": "阿里云 DashScope OpenAI 兼容模式。",
            "reference": "https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope",
        },
        {
            "provider": "Custom (OpenAI-Compatible)",
            "base_url": "",
            "models": [],
            "note": "可自定义任意兼容 OpenAI 协议的网关。",
            "reference": "",
        },
    ]


def read_catalog_cache() -> dict:
    if not CACHE_PATH.exists():
        return {"updated_at": None, "targets": {}}
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"updated_at": None, "targets": {}}


def write_catalog_cache(cache: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def get_provider_catalog() -> list[dict]:
    base = _base_catalog()
    cache = read_catalog_cache().get("targets", {})
    for item in base:
        synced = cache.get(item["provider"], {})
        models = synced.get("models") or []
        if item["provider"] == "OpenRouter":
            # OpenRouter 推荐模型以本地 openrouter模型.md 为主，避免被远端同步覆盖。
            local_models = item["models"][:]
            if models:
                local_set = set(local_models)
                merged = local_models + [m for m in models if m not in local_set]
                item["models"] = merged
                item["note"] = f"{item['note']} 已同步远端模型（追加在推荐列表后）。"
            item["default_model"] = (
                "moonshotai/kimi-k2.5"
                if "moonshotai/kimi-k2.5" in item["models"]
                else (item["models"][0] if item["models"] else "")
            )
            continue

        if models:
            item["models"] = models
            item["note"] = f"{item['note']} 已自动同步最新模型列表。"
        item["default_model"] = item["models"][0] if item["models"] else ""

    # 给没有进入循环分支设置 default_model（理论上不会漏，但保持鲁棒）
    for item in base:
        if "default_model" not in item:
            item["default_model"] = item["models"][0] if item["models"] else ""
    return base


def get_catalog_sync_status() -> dict:
    return read_catalog_cache()
