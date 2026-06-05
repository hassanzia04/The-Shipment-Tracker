import io
from PIL import Image
from pypdf import PdfReader, PdfWriter


def compress_pdf(data: bytes) -> bytes:
    reader = PdfReader(io.BytesIO(data))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    # compress_content_streams must be called after pages are added to the writer
    for page in writer.pages:
        page.compress_content_streams(level=9)
    buf = io.BytesIO()
    writer.write(buf)
    compressed = buf.getvalue()
    return compressed if len(compressed) < len(data) else data


def compress_image(data: bytes, content_type: str, max_dimension: int = 2000, quality: int = 75) -> bytes:
    img = Image.open(io.BytesIO(data))

    # Resize if too large while preserving aspect ratio
    if max(img.size) > max_dimension:
        img.thumbnail((max_dimension, max_dimension), Image.LANCZOS)

    # Convert RGBA to RGB for JPEG output
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")

    fmt = "JPEG" if "jpeg" in content_type or "jpg" in content_type else img.format or "JPEG"
    buf = io.BytesIO()
    img.save(buf, format=fmt, optimize=True, quality=quality)
    compressed = buf.getvalue()
    return compressed if len(compressed) < len(data) else data


def compress_file(data: bytes, content_type: str) -> bytes:
    ct = content_type.lower()
    if "pdf" in ct:
        return compress_pdf(data)
    if any(x in ct for x in ("jpeg", "jpg", "png", "webp", "tiff")):
        return compress_image(data, ct)
    return data  # unsupported format — return as-is
