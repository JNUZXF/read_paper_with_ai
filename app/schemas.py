from pydantic import BaseModel, Field, HttpUrl


class ModelConnectionRequest(BaseModel):
    api_key: str = Field(min_length=8)
    base_url: HttpUrl | str
    model: str = Field(min_length=1)
    timeout_seconds: float | None = None


class ModelConnectionResponse(BaseModel):
    ok: bool
    model: str
    base_url: str
    provider_fingerprint: str
    message: str


class AngleSpec(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    prompt: str = Field(min_length=1, max_length=4000)


class AnalyzeOptions(BaseModel):
    api_key: str | None = Field(default=None, min_length=8)
    base_url: HttpUrl | str | None = None
    model: str | None = Field(default=None, min_length=1)
    provider_id: int | None = None
    paper_title: str | None = None
    angles: list[str] | None = None
    angle_specs: list[AngleSpec] | None = None
    user_prompt: str | None = None
    max_input_chars: int | None = Field(default=None, ge=2000, le=30000)
    temperature: float = Field(default=0.2, ge=0.0, le=1.0)
    max_output_tokens: int | None = None
    stream_mode: str = Field(default="sequential", pattern="^(sequential|parallel)$")
    parallel_limit: int = Field(default=3, ge=1, le=8)
    mock_mode: bool = False
    enable_reasoning: bool = False
    reasoning_effort: str = Field(default="high", pattern="^(low|medium|high)$")
    enable_final_report: bool = True


class AngleResult(BaseModel):
    angle: str
    rounds: list[str]
    final: str


class PaperAnalysisResponse(BaseModel):
    paper_title: str
    model: str
    base_url: str
    text_char_count: int
    angles: list[AngleResult]
    final_report: str


class ProviderConfigCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    api_key: str = Field(min_length=8)
    base_url: HttpUrl | str
    model: str = Field(min_length=1)
    is_default: bool = False


class ProviderConfigUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    api_key: str | None = Field(default=None, min_length=8)
    base_url: HttpUrl | str | None = None
    model: str | None = Field(default=None, min_length=1)
    is_default: bool | None = None


class ProviderConfigOut(BaseModel):
    id: int
    name: str
    api_key_masked: str
    base_url: str
    model: str
    is_default: bool
    created_at: str
    updated_at: str


class AngleExport(BaseModel):
    title: str
    content: str


class ExportDocxRequest(BaseModel):
    paper_title: str
    angles: list[AngleExport]
    final_report: str | None = None


class PaperExport(BaseModel):
    paper_title: str
    angles: list[AngleExport]
    final_report: str | None = None


class BatchExportDocxRequest(BaseModel):
    papers: list[PaperExport]


class ExportDocxResponse(BaseModel):
    file_path: str
    filename: str
    download_url: str
