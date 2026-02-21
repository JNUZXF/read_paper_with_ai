import asyncio
from collections.abc import AsyncIterator

from app.config import settings
from app.llm_client import build_client, chat_once, chat_stream_events
from app.prompts import (
    DEFAULT_ANGLE_SPECS,
    SYSTEM_PROMPT,
    build_angle_prompt,
    build_final_summary_prompt,
)
from app.schemas import AnalyzeOptions, AngleResult, AngleSpec, PaperAnalysisResponse


def clamp_text(raw_text: str, max_chars: int) -> str:
    if len(raw_text) <= max_chars:
        return raw_text
    return raw_text[:max_chars]


def pick_angle_specs(options: AnalyzeOptions) -> list[AngleSpec]:
    if options.angle_specs:
        return options.angle_specs[: settings.max_analysis_angles]
    if options.angles:
        return [
            AngleSpec(
                title=angle,
                prompt="请围绕该角度给出可复核、结构化结论，并明确证据与不确定性。",
            )
            for angle in options.angles[: settings.max_analysis_angles]
        ]
    return [
        AngleSpec.model_validate(spec)
        for spec in DEFAULT_ANGLE_SPECS[: settings.max_analysis_angles]
    ]


def resolve_max_input_chars(options: AnalyzeOptions) -> int:
    target = options.max_input_chars or settings.max_pdf_chars
    return min(target, settings.max_pdf_chars)


def reasoning_config(options: AnalyzeOptions) -> dict | None:
    if not options.enable_reasoning:
        return {"enabled": False}
    return {"enabled": True, "effort": options.reasoning_effort}


def _mock_text(angle: str, paper_title: str) -> str:
    return (
        f"- 角度: {angle}\n"
        f"- 论文: {paper_title}\n"
        "- 模拟结论: 该论文在该角度下具有清晰贡献，建议结合原文复核。\n"
    )


def clean_analysis_output(text: str) -> str:
    stripped = text.lstrip()
    prefix_patterns = (
        "好的",
        "当然",
        "可以",
        "下面开始分析",
        "以下是",
        "我将",
        "我会",
    )
    changed = True
    while changed:
        changed = False
        for prefix in prefix_patterns:
            if stripped.startswith(prefix):
                stripped = stripped[len(prefix) :].lstrip("：:，,。\n\t ")
                changed = True
    return stripped or text


async def _run_single_angle(
    client,
    options: AnalyzeOptions,
    paper_title: str,
    paper_text: str,
    angle_spec: AngleSpec,
) -> AngleResult:
    prompt = build_angle_prompt(
        angle_title=angle_spec.title,
        angle_instruction=angle_spec.prompt,
        paper_title=paper_title,
        paper_text=paper_text,
        user_prompt=options.user_prompt,
    )
    result = await chat_once(
        client=client,
        model=options.model,
        system_prompt=SYSTEM_PROMPT,
        user_prompt=prompt,
        temperature=options.temperature,
        max_output_tokens=options.max_output_tokens or settings.max_output_tokens,
        reasoning=reasoning_config(options),
    )
    cleaned = clean_analysis_output(result)
    return AngleResult(angle=angle_spec.title, rounds=[cleaned], final=cleaned)


async def analyze_paper(
    options: AnalyzeOptions,
    paper_text: str,
    paper_title: str,
) -> PaperAnalysisResponse:
    clipped_text = clamp_text(paper_text, resolve_max_input_chars(options))
    angle_specs = pick_angle_specs(options)
    if options.mock_mode:
        angle_results = [
            AngleResult(
                angle=spec.title,
                rounds=[_mock_text(spec.title, paper_title)],
                final=_mock_text(spec.title, paper_title),
            )
            for spec in angle_specs
        ]
        return PaperAnalysisResponse(
            paper_title=paper_title,
            model=options.model or "mock-model",
            base_url=str(options.base_url or "mock://local"),
            text_char_count=len(clipped_text),
            angles=angle_results,
            final_report="模拟最终报告：各角度分析已完成，可用于健康检查。",
        )

    client = build_client(options.api_key, str(options.base_url))

    # 限制并发，避免部分服务商限流导致全量失败。
    semaphore = asyncio.Semaphore(3)

    async def wrapped(angle_spec: AngleSpec) -> AngleResult:
        async with semaphore:
            return await _run_single_angle(client, options, paper_title, clipped_text, angle_spec)

    angle_results = await asyncio.gather(*(wrapped(spec) for spec in angle_specs))
    angle_map = {a.angle: a.final for a in angle_results}

    final_report_prompt = build_final_summary_prompt(angle_map)
    final_report = await chat_once(
        client=client,
        model=options.model,
        system_prompt=SYSTEM_PROMPT,
        user_prompt=final_report_prompt,
        temperature=options.temperature,
        max_output_tokens=options.max_output_tokens or settings.max_output_tokens,
        reasoning=reasoning_config(options),
    )
    final_report = clean_analysis_output(final_report)

    return PaperAnalysisResponse(
        paper_title=paper_title,
        model=options.model,
        base_url=str(options.base_url),
        text_char_count=len(clipped_text),
        angles=angle_results,
        final_report=final_report,
    )


async def _stream_single_angle(
    queue: asyncio.Queue,
    client,
    options: AnalyzeOptions,
    paper_title: str,
    paper_text: str,
    angle_spec: AngleSpec,
) -> None:
    rounds: list[str] = []
    try:
        prompt = build_angle_prompt(
            angle_title=angle_spec.title,
            angle_instruction=angle_spec.prompt,
            paper_title=paper_title,
            paper_text=paper_text,
            user_prompt=options.user_prompt,
        )
        final_text = ""
        streamed_content = False
        try:
            async for ev in chat_stream_events(
                client=client,
                model=options.model,
                system_prompt=SYSTEM_PROMPT,
                user_prompt=prompt,
                temperature=options.temperature,
                max_output_tokens=options.max_output_tokens or settings.max_output_tokens,
                reasoning=reasoning_config(options),
            ):
                if ev["type"] == "content":
                    final_text += ev["text"]
                    streamed_content = True
                    await queue.put(
                        {
                            "event": "angle_delta",
                            "angle": angle_spec.title,
                            "delta": ev["text"],
                        }
                    )
                elif ev["type"] == "reasoning":
                    await queue.put(
                        {
                            "event": "angle_reasoning_delta",
                            "angle": angle_spec.title,
                            "delta": ev["text"],
                        }
                    )
        except Exception:
            final_text = await chat_once(
                client=client,
                model=options.model,
                system_prompt=SYSTEM_PROMPT,
                user_prompt=prompt,
                temperature=options.temperature,
                max_output_tokens=options.max_output_tokens or settings.max_output_tokens,
                reasoning=reasoning_config(options),
            )

        cleaned = clean_analysis_output(final_text)
        rounds.append(cleaned)
        if not streamed_content:
            await queue.put(
                {
                    "event": "angle_delta",
                    "angle": angle_spec.title,
                    "delta": cleaned,
                }
            )

        await queue.put(
            {
                "event": "angle_done",
                "angle": angle_spec.title,
                "rounds": rounds,
                "final": rounds[-1] if rounds else "",
            }
        )
    except Exception as exc:
        await queue.put(
            {
                "event": "angle_error",
                "angle": angle_spec.title,
                "message": str(exc),
            }
        )


async def analyze_paper_stream(
    options: AnalyzeOptions,
    paper_text: str,
    paper_title: str,
) -> AsyncIterator[dict]:
    clipped_text = clamp_text(paper_text, resolve_max_input_chars(options))
    angle_specs = pick_angle_specs(options)
    angle_titles = [spec.title for spec in angle_specs]
    if options.mock_mode:
        yield {"event": "meta", "paper_title": paper_title, "angles": angle_titles, "stream_mode": options.stream_mode}
        angle_map: dict[str, str] = {}
        for spec in angle_specs:
            msg = _mock_text(spec.title, paper_title)
            for ch in msg:
                yield {"event": "angle_delta", "angle": spec.title, "delta": ch}
            await asyncio.sleep(0.001)
            angle_map[spec.title] = _mock_text(spec.title, paper_title)
            yield {"event": "angle_done", "angle": spec.title, "rounds": [], "final": angle_map[spec.title]}
        yield {"event": "final_start"}
        final_report = "模拟最终报告：各角度流式输出正常。"
        for ch in final_report:
            yield {"event": "final_delta", "delta": ch}
        yield {
            "event": "final_done",
            "final_report": final_report,
            "text_char_count": len(clipped_text),
            "model": options.model or "mock-model",
            "base_url": str(options.base_url or "mock://local"),
        }
        return

    client = build_client(options.api_key, str(options.base_url))
    yield {
        "event": "meta",
        "paper_title": paper_title,
        "angles": angle_titles,
        "stream_mode": options.stream_mode,
    }

    angle_map: dict[str, str] = {}
    queue: asyncio.Queue = asyncio.Queue()

    if options.stream_mode == "parallel":
        semaphore = asyncio.Semaphore(options.parallel_limit)

        async def run_with_limit(spec: AngleSpec) -> None:
            async with semaphore:
                await _stream_single_angle(
                    queue=queue,
                    client=client,
                    options=options,
                    paper_title=paper_title,
                    paper_text=clipped_text,
                    angle_spec=spec,
                )

        tasks = [asyncio.create_task(run_with_limit(spec)) for spec in angle_specs]
        done_count = 0
        while done_count < len(tasks):
            item = await queue.get()
            if item["event"] == "angle_done":
                angle_map[item["angle"]] = item["final"]
                done_count += 1
            elif item["event"] == "angle_error":
                done_count += 1
            yield item
        await asyncio.gather(*tasks, return_exceptions=True)
    else:
        for spec in angle_specs:
            task = asyncio.create_task(
                _stream_single_angle(
                    queue=queue,
                    client=client,
                    options=options,
                    paper_title=paper_title,
                    paper_text=clipped_text,
                    angle_spec=spec,
                )
            )
            angle_finished = False
            while not angle_finished:
                item = await queue.get()
                if item["event"] == "angle_done" and item["angle"] == spec.title:
                    angle_map[item["angle"]] = item["final"]
                    angle_finished = True
                elif item["event"] == "angle_error" and item["angle"] == spec.title:
                    angle_finished = True
                yield item
            await task

    if options.enable_final_report:
        final_prompt = build_final_summary_prompt(angle_map)
        final_report = ""
        yield {"event": "final_start"}
        streamed_content = False
        try:
            async for ev in chat_stream_events(
                client=client,
                model=options.model,
                system_prompt=SYSTEM_PROMPT,
                user_prompt=final_prompt,
                temperature=options.temperature,
                max_output_tokens=options.max_output_tokens or settings.max_output_tokens,
                reasoning=reasoning_config(options),
            ):
                if ev["type"] == "content":
                    final_report += ev["text"]
                    streamed_content = True
                    yield {"event": "final_delta", "delta": ev["text"]}
                elif ev["type"] == "reasoning":
                    yield {"event": "final_reasoning_delta", "delta": ev["text"]}
        except Exception:
            final_report = await chat_once(
                client=client,
                model=options.model,
                system_prompt=SYSTEM_PROMPT,
                user_prompt=final_prompt,
                temperature=options.temperature,
                max_output_tokens=options.max_output_tokens or settings.max_output_tokens,
                reasoning=reasoning_config(options),
            )
        final_report = clean_analysis_output(final_report)
        if not streamed_content:
            yield {"event": "final_delta", "delta": final_report}
    else:
        final_report = ""
        yield {"event": "final_start"}

    yield {
        "event": "final_done",
        "final_report": final_report,
        "text_char_count": len(clipped_text),
        "model": options.model,
        "base_url": str(options.base_url),
    }
