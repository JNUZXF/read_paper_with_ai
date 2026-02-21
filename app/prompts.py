# app/prompts.py

"""
提示词
"""

from textwrap import dedent

DEFAULT_ANGLE_SPECS = [
    {
        "title": "主题与研究问题",
        "prompt": "提炼论文想解决的核心问题、研究边界和目标人群/场景，明确作者的研究动机与价值主张。",
    },
    {
        "title": "方法论与实验设计",
        "prompt": "分析方法框架、关键假设、数据集/基线/对照设置，判断实验设计是否能支撑结论。",
    },
    {
        "title": "核心创新点",
        "prompt": "识别与现有工作的关键差异，区分真正创新与工程整合，说明创新带来的具体收益。",
    },
    {
        "title": "结果与证据强度",
        "prompt": "总结主要结果，检查统计显著性、消融实验、误差分析等证据强弱并指出薄弱环节。",
    },
    {
        "title": "局限性与潜在风险",
        "prompt": "评估方法局限、数据偏差、泛化风险和潜在负面影响，给出风险等级与触发条件。",
    },
    {
        "title": "可复现性与工程实现建议",
        "prompt": "从复现实验和落地工程角度，给出资源需求、实现步骤、关键依赖与验证路径。",
    },
]

SYSTEM_PROMPT = dedent("""
    # 角色
    你是一名严谨的学术论文分析助手。

    # 规则
    你必须严格遵守以下规则：
    1) 只根据给定论文内容做分析，禁止编造不存在的信息。
    2) 清晰区分“论文明确陈述”与“你的推断”。
    3) 仅输出论文分析正文，禁止任何寒暄、客套、确认语或角色说明（如“好的”“当然”“下面开始分析”）。
    4) 禁止输出与论文分析无关的内容。
    5) 使用简体中文，输出结构化、可执行、可复核结论。
""").strip()


def build_angle_prompt(
    angle_title: str,
    angle_instruction: str,
    paper_title: str,
    paper_text: str,
    user_prompt: str | None,
) -> str:
    return dedent(f"""
# 论文信息
论文标题：{paper_title}
分析角度标题：{angle_title}
角度分析要求：{angle_instruction}

# 要求
{user_prompt or "无"}

# 论文正文（节选）：
{paper_text}

现在，请直接输出论文的分析：
""").strip()


def build_final_summary_prompt(angle_results: dict[str, str]) -> str:
    sections = []
    for angle, result in angle_results.items():
        sections.append(f"## {angle}\n{result}")

    joined = "\n\n".join(sections)
    return f"""
你将收到同一篇论文在多个角度下的分析结果，请融合成最终报告。

要求：
1) 输出一个“高管摘要”（5-8条，面向快速决策）。
2) 输出“技术解读”（按角度归纳，避免重复）。
3) 输出“可落地行动清单”（3-6条，尽量具体）。
4) 标注“结论置信度”（高/中/低）并说明理由。
5) 不要重复原文，强调可执行洞察。
6) 仅输出分析报告正文，不要输出“好的/当然/以下是”等无关内容。

角度分析输入：
{joined}
""".strip()
