import json
import platform
import re
import subprocess
from datetime import datetime
from pathlib import Path
import asyncio

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.analyzer import analyze_paper, analyze_paper_stream
from app.catalog_sync import periodic_sync_loop, sync_catalog_once
from app.config import settings
from app.llm_client import build_client, chat_once, provider_fingerprint
from app.pdf_service import extract_text_from_pdf_bytes
from app.prompts import SYSTEM_PROMPT
from app.provider_catalog import get_catalog_sync_status, get_provider_catalog
from app.provider_store import (
    create_provider,
    delete_provider,
    get_provider_secret,
    init_store,
    list_providers,
    update_provider,
)
from app.schemas import (
    AnalyzeOptions,
    AngleExport,
    BatchExportDocxRequest,
    ExportDocxRequest,
    ExportDocxResponse,
    ModelConnectionRequest,
    ModelConnectionResponse,
    PaperExport,
    ProviderConfigCreate,
    ProviderConfigOut,
    ProviderConfigUpdate,
)

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path("web")
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

sync_stop_event: asyncio.Event | None = None
sync_task: asyncio.Task | None = None


def _resolve_options(raw: AnalyzeOptions) -> AnalyzeOptions:
    data = raw.model_dump()
    if raw.mock_mode:
        data["api_key"] = data.get("api_key") or "mock-api-key"
        data["base_url"] = data.get("base_url") or "https://mock.local/v1"
        data["model"] = data.get("model") or "mock-model"
        return AnalyzeOptions.model_validate(data)

    if raw.provider_id is not None:
        secret = get_provider_secret(raw.provider_id)
        if not secret:
            raise HTTPException(status_code=404, detail=f"provider_id={raw.provider_id} 不存在")
        data["api_key"] = secret["api_key"]
        data["base_url"] = secret["base_url"]
        data["model"] = secret["model"]

    if not data.get("api_key") or not data.get("base_url") or not data.get("model"):
        raise HTTPException(status_code=400, detail="缺少模型配置：请传 api_key/base_url/model 或 provider_id。")
    return AnalyzeOptions.model_validate(data)


@app.on_event("startup")
async def _startup():
    global sync_stop_event, sync_task
    init_store()
    if settings.catalog_sync_enabled:
        sync_stop_event = asyncio.Event()
        sync_task = asyncio.create_task(periodic_sync_loop(sync_stop_event))


@app.on_event("shutdown")
async def _shutdown():
    global sync_stop_event, sync_task
    if sync_stop_event:
        sync_stop_event.set()
    if sync_task:
        try:
            await sync_task
        except Exception:
            pass


@app.get("/")
async def index():
    page = STATIC_DIR / "index.html"
    if page.exists():
        return FileResponse(str(page))
    return JSONResponse({"ok": True, "message": "Frontend not found. Put files into ./web"})


@app.get("/batch")
@app.get("/batch.html")
async def batch_page():
    # SPA: serve index.html for all frontend routes
    page = STATIC_DIR / "index.html"
    if page.exists():
        return FileResponse(str(page))
    raise HTTPException(status_code=404, detail="Frontend not found")


@app.get("/health")
async def health():
    return {"ok": True, "service": settings.app_name}


@app.get("/v1/catalog/providers")
async def provider_catalog():
    return {"providers": get_provider_catalog()}


@app.get("/v1/catalog/sync/status")
async def catalog_sync_status():
    return get_catalog_sync_status()


@app.post("/v1/catalog/sync/trigger")
async def catalog_sync_trigger():
    if not settings.catalog_sync_enabled:
        raise HTTPException(status_code=400, detail="catalog_sync_enabled=false")
    return await sync_catalog_once()


@app.post("/v1/models/validate", response_model=ModelConnectionResponse)
async def validate_model_connection(req: ModelConnectionRequest):
    try:
        client = build_client(
            api_key=req.api_key,
            base_url=str(req.base_url),
            timeout_seconds=req.timeout_seconds,
        )
        _ = await chat_once(
            client=client,
            model=req.model,
            system_prompt=SYSTEM_PROMPT,
            user_prompt="请仅回复: CONNECTED",
            temperature=0,
            max_output_tokens=32,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"模型连接失败: {exc}") from exc

    return ModelConnectionResponse(
        ok=True,
        model=req.model,
        base_url=str(req.base_url),
        provider_fingerprint=provider_fingerprint(str(req.base_url), req.model),
        message="连接成功，可用于论文分析。",
    )


@app.post("/v1/models/validate/provider/{provider_id}", response_model=ModelConnectionResponse)
async def validate_model_connection_by_provider(provider_id: int):
    secret = get_provider_secret(provider_id)
    if not secret:
        raise HTTPException(status_code=404, detail="provider 不存在")
    req = ModelConnectionRequest(
        api_key=secret["api_key"],
        base_url=secret["base_url"],
        model=secret["model"],
    )
    return await validate_model_connection(req)


@app.get("/v1/providers", response_model=list[ProviderConfigOut])
async def list_provider_configs():
    return list_providers()


@app.post("/v1/providers", response_model=ProviderConfigOut)
async def create_provider_config(payload: ProviderConfigCreate):
    return create_provider(payload)


@app.put("/v1/providers/{provider_id}", response_model=ProviderConfigOut)
async def update_provider_config(provider_id: int, payload: ProviderConfigUpdate):
    updated = update_provider(provider_id, payload)
    if not updated:
        raise HTTPException(status_code=404, detail="provider 不存在")
    return updated


@app.delete("/v1/providers/{provider_id}")
async def delete_provider_config(provider_id: int):
    ok = delete_provider(provider_id)
    if not ok:
        raise HTTPException(status_code=404, detail="provider 不存在")
    return {"ok": True}


@app.post("/v1/papers/analyze")
async def analyze_paper_endpoint(
    options_json: str = Form(..., description="AnalyzeOptions 的 JSON 字符串"),
    file: UploadFile = File(..., description="论文 PDF 文件"),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="仅支持 PDF 文件。")

    try:
        options = _resolve_options(AnalyzeOptions.model_validate(json.loads(options_json)))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"options_json 解析失败: {exc}") from exc

    raw = await file.read()
    text, meta_title = extract_text_from_pdf_bytes(raw)
    if not text:
        raise HTTPException(status_code=400, detail="PDF 未提取到有效文本，请检查文档内容。")

    paper_title = options.paper_title or meta_title or file.filename
    result = await analyze_paper(options=options, paper_text=text, paper_title=paper_title)
    return JSONResponse(content=result.model_dump())


@app.post("/v1/papers/analyze/stream")
async def analyze_paper_stream_endpoint(
    options_json: str = Form(..., description="AnalyzeOptions 的 JSON 字符串"),
    file: UploadFile = File(..., description="论文 PDF 文件"),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="仅支持 PDF 文件。")

    try:
        options = _resolve_options(AnalyzeOptions.model_validate(json.loads(options_json)))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"options_json 解析失败: {exc}") from exc

    raw = await file.read()
    text, meta_title = extract_text_from_pdf_bytes(raw)
    if not text:
        raise HTTPException(status_code=400, detail="PDF 未提取到有效文本，请检查文档内容。")
    paper_title = options.paper_title or meta_title or file.filename

    async def event_stream():
        async for item in analyze_paper_stream(options=options, paper_text=text, paper_title=paper_title):
            payload = json.dumps(item, ensure_ascii=False)
            yield f"data: {payload}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/v1/papers/analyze/batch")
async def analyze_paper_batch_endpoint(
    options_json: str = Form(..., description="AnalyzeOptions 的 JSON 字符串"),
    files: list[UploadFile] = File(..., description="论文 PDF 文件（可多选）"),
):
    if not files:
        raise HTTPException(status_code=400, detail="至少上传一个 PDF 文件。")

    try:
        options = _resolve_options(AnalyzeOptions.model_validate(json.loads(options_json)))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"options_json 解析失败: {exc}") from exc

    semaphore = asyncio.Semaphore(options.parallel_limit)

    async def analyze_single(upload: UploadFile) -> dict:
        filename = upload.filename or "unknown.pdf"
        if not filename.lower().endswith(".pdf"):
            return {
                "filename": filename,
                "ok": False,
                "error": "仅支持 PDF 文件。",
            }
        try:
            raw = await upload.read()
            text, meta_title = extract_text_from_pdf_bytes(raw)
            if not text:
                return {
                    "filename": filename,
                    "ok": False,
                    "error": "PDF 未提取到有效文本，请检查文档内容。",
                }
            paper_title = meta_title or filename
            async with semaphore:
                result = await analyze_paper(options=options, paper_text=text, paper_title=paper_title)
            return {
                "filename": filename,
                "ok": True,
                "result": result.model_dump(),
            }
        except Exception as exc:
            return {
                "filename": filename,
                "ok": False,
                "error": str(exc),
            }

    items = await asyncio.gather(*(analyze_single(f) for f in files))
    succeeded = sum(1 for item in items if item["ok"])
    return JSONResponse(
        content={
            "total": len(items),
            "succeeded": succeeded,
            "failed": len(items) - succeeded,
            "items": items,
        }
    )


EXPORTS_DIR = Path("exports")


@app.post("/v1/papers/export/docx", response_model=ExportDocxResponse)
async def export_paper_docx(request: ExportDocxRequest):
    """Convert markdown analysis results to a Word document and save locally."""
    from app.docx_exporter import build_docx

    EXPORTS_DIR.mkdir(exist_ok=True)

    # Build a filesystem-safe filename from the paper title
    safe_title = re.sub(r'[^\w\u4e00-\u9fff\-_. ]', '_', request.paper_title).strip()[:60]
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"{safe_title}_{timestamp}.docx"
    file_path = EXPORTS_DIR / filename

    doc = build_docx(
        paper_title=request.paper_title,
        angles=[a.model_dump() for a in request.angles],
        final_report=request.final_report,
    )
    doc.save(str(file_path))

    return ExportDocxResponse(
        file_path=str(file_path.resolve()),
        filename=filename,
        download_url=f"/v1/papers/download/{filename}",
    )


@app.post("/v1/papers/export/batch-docx", response_model=ExportDocxResponse)
async def export_papers_batch_docx(request: BatchExportDocxRequest):
    """Merge analyses of multiple papers into a single Word document."""
    from app.docx_exporter import build_batch_docx

    if not request.papers:
        raise HTTPException(status_code=400, detail="至少需要一篇论文的数据")

    EXPORTS_DIR.mkdir(exist_ok=True)

    paper_count = len(request.papers)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f"多篇论文分析_{paper_count}篇_{timestamp}.docx"
    file_path = EXPORTS_DIR / filename

    doc = build_batch_docx([p.model_dump() for p in request.papers])
    doc.save(str(file_path))

    return ExportDocxResponse(
        file_path=str(file_path.resolve()),
        filename=filename,
        download_url=f"/v1/papers/download/{filename}",
    )


@app.get("/v1/papers/download/{filename}")
async def download_paper_docx(filename: str):
    """Serve a previously exported Word document for browser download."""
    # Prevent path traversal
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="无效的文件名")
    file_path = EXPORTS_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在，请重新导出")
    return FileResponse(
        path=str(file_path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=filename,
    )
