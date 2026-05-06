#!/usr/bin/env python3
"""
pdf_to_md.py  —  Convert a PDF to Markdown with inline images.
Usage: python pdf_to_md.py <pdf_path> <output_dir>

Outputs:
  <output_dir>/content.md        Markdown document, images inline
  <output_dir>/images/fig_*.ext  Extracted figures (>= 60×60 px)

Prints a JSON result line to stdout.
"""

import sys
import json
import re
import hashlib
from pathlib import Path

try:
    import fitz  # pymupdf
except ImportError:
    print(json.dumps({"error": "pymupdf not installed — run: pip install pymupdf"}))
    sys.exit(1)


# ── Text helpers ──────────────────────────────────────────────────────────────

def clean(text: str) -> str:
    text = text.replace("\xad", "")           # soft hyphen
    text = re.sub(r"-\s*\n\s*", "", text)     # de-hyphenate
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def spans_of(block: dict) -> list:
    return [s for line in block.get("lines", []) for s in line.get("spans", [])]


def block_text(block: dict) -> str:
    parts = []
    for line in block.get("lines", []):
        words = " ".join(s["text"] for s in line.get("spans", []) if s["text"].strip())
        if words:
            parts.append(words)
    return clean(" ".join(parts))


def avg_size(block: dict) -> float:
    spans = spans_of(block)
    return sum(s["size"] for s in spans) / len(spans) if spans else 0.0


def is_bold(block: dict) -> bool:
    return any("bold" in s.get("font", "").lower() for s in spans_of(block))


def median_body_size(page_dicts: list) -> float:
    sizes = []
    for pd in page_dicts:
        for b in pd["blocks"]:
            if b["type"] == 0:
                sizes.extend(s["size"] for s in spans_of(b))
    if not sizes:
        return 11.0
    sizes.sort()
    return sizes[len(sizes) // 2]


def heading_level(size: float, bold: bool, body: float) -> int:
    ratio = size / body if body else 1.0
    if ratio >= 1.6 or (ratio >= 1.3 and bold):
        return 1
    if ratio >= 1.2 or (ratio >= 1.05 and bold):
        return 2
    if bold and ratio >= 1.0:
        return 3
    return 0


# ── Main converter ────────────────────────────────────────────────────────────

def pdf_to_md(pdf_path: str, output_dir: str) -> dict:
    out = Path(output_dir)
    img_dir = out / "images"
    # Clear stale images from previous runs before writing new ones
    if img_dir.exists():
        import shutil
        shutil.rmtree(img_dir)
    img_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(pdf_path)
    page_count = len(doc)

    # Pass 1: collect all page dicts to estimate body font size
    flags = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP
    page_dicts = [page.get_text("dict", flags=flags) for page in doc]
    body_size = median_body_size(page_dicts)

    md_parts: list[str] = []
    image_index = 0
    seen_image_hashes: set = set()   # deduplicate images by content hash
    seen_xrefs: set = set()          # deduplicate XObject images by xref

    for page_num, (page, page_dict) in enumerate(zip(doc, page_dicts), 1):
        # Sort blocks top-to-bottom so images appear in reading order
        blocks = sorted(page_dict["blocks"], key=lambda b: b["bbox"][1])

        for block in blocks:

            # ── Text block ────────────────────────────────────────────────────
            if block["type"] == 0:
                txt = block_text(block)
                if not txt:
                    continue

                size  = avg_size(block)
                bold  = is_bold(block)
                level = heading_level(size, bold, body_size)

                if level == 1:
                    md_parts.append(f"\n# {txt}\n")
                elif level == 2:
                    md_parts.append(f"\n## {txt}\n")
                elif level == 3:
                    md_parts.append(f"\n### {txt}\n")
                else:
                    md_parts.append(txt)

            # ── Image block (inline) ──────────────────────────────────────────
            elif block["type"] == 1:
                img_bytes = block.get("image")
                if img_bytes:
                    w = block.get("width",  0)
                    h = block.get("height", 0)
                    if w >= 60 and h >= 60:
                        img_hash = hashlib.md5(img_bytes).hexdigest()
                        if img_hash not in seen_image_hashes:
                            seen_image_hashes.add(img_hash)
                            ext   = block.get("ext", "png")
                            fname = f"fig_{page_num}_{image_index + 1}.{ext}"
                            (img_dir / fname).write_bytes(img_bytes)
                            image_index += 1
                            md_parts.append(f"\n![Figure {image_index}](images/{fname})\n")

        # ── XObject images — render via page clip to avoid colorspace issues ──
        for img_info in page.get_image_info(xrefs=True):
            xref = img_info.get("xref", 0)
            if not xref or xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)

            bbox = img_info.get("bbox")
            if not bbox:
                continue

            rect = fitz.Rect(bbox)
            if rect.width < 60 or rect.height < 60:
                continue

            try:
                # Render the image area at 150 DPI equivalent (2× page units)
                mat = fitz.Matrix(2, 2)
                pix = page.get_pixmap(matrix=mat, clip=rect, alpha=False)
                img_bytes = pix.tobytes("png")
                pix = None
            except Exception:
                continue

            img_hash = hashlib.md5(img_bytes).hexdigest()
            if img_hash in seen_image_hashes:
                continue
            seen_image_hashes.add(img_hash)
            fname = f"fig_{page_num}_{image_index + 1}.png"
            (img_dir / fname).write_bytes(img_bytes)
            image_index += 1
            md_parts.append(f"\n![Figure {image_index}](images/{fname})\n")

    md_content = "\n\n".join(p for p in md_parts if p.strip())
    (out / "content.md").write_text(md_content, encoding="utf-8")

    return {
        "md_path":     str(out / "content.md"),
        "image_count": image_index,
        "page_count":  page_count,
    }


# ── CLI entry point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: pdf_to_md.py <pdf_path> <output_dir>"}))
        sys.exit(1)

    try:
        result = pdf_to_md(sys.argv[1], sys.argv[2])
        print(json.dumps(result))
    except Exception as exc:
        import traceback
        print(json.dumps({"error": str(exc), "trace": traceback.format_exc()}))
        sys.exit(1)
