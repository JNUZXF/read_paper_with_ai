from io import BytesIO

from pypdf import PdfReader


def extract_text_from_pdf_bytes(raw: bytes) -> tuple[str, str | None]:
    reader = PdfReader(BytesIO(raw))
    title = None
    if reader.metadata:
        title = reader.metadata.title

    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")

    return "\n\n".join(pages).strip(), title
