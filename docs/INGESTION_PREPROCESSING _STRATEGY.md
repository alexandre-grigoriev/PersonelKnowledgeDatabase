# DATA PREPROCESSING STRATEGY

## Goal
Normalize all input sources into consistent, high-quality Markdown files suitable for indexing, retrieval, and RAG workflows.

Each ingested item must produce:
- One `.md` file
- An abstract (generated if missing)
- A dedicated image subfolder (if images exist)
- Updated image references (if folder renamed)
- Metadata describing the source and processing

---

## Standard Markdown Structure

```md
---
source_type: pdf | web | txt | image | screenshot | github | markdown
source: "<original file path or URL>"
created_at: "<ISO date>"
image_folder: "<relative image folder>"
---

# Title

## Abstract
Short summary of the document content.

## Content
Converted or original Markdown content.

## Images
References to extracted or embedded images.
```

---

## General Rules

### Image Handling (Critical Rule)

- All images must be stored in a dedicated subfolder
- If an image folder is renamed:
  - **ALL references in the Markdown MUST be updated accordingly**
- Image paths must always be relative

---

## 1. PDF Ingestion

### Processing
- Convert PDF to Markdown
- Extract all images
- Store images in a subfolder: `<document_name>_images/`
- Insert image references in Markdown
- Generate abstract if missing

---

## 2. Web Page Ingestion

### Processing
- Extract main content (remove navigation, ads, etc.)
- Convert to Markdown
- Download embedded images
- Store images in a uniquely named folder

### Folder Naming Strategy
Use unique folder names to avoid collisions:
```
<slug>_images/
```
or
```
images_<hash>/
```
- Generate abstract

---

## 3. TXT Ingestion

### Processing
- Convert `.txt` to Markdown
- Preserve structure (paragraphs, lists)
- Generate abstract

---

## 4. Screenshots / Images Ingestion

### Processing
- Run OCR to extract text
- Convert to Markdown
- Store original image in subfolder
- Reference image in Markdown
- Generate abstract

---

## 5. Scanned PDF Handling

### Processing
- Detect if PDF is text-based or scanned
- If scanned:
  - Apply OCR
- Extract images if possible
- Store in subfolder
- Generate abstract

---

## 6. GitHub URL Ingestion

### Processing
- Keep full original URL
- Generate abstract
- Optionally extract visible content (README, file)
- **Do not modify or shorten URL**

### Example
```md
---
source_type: github
source: "https://github.com/org/repo/blob/main/file.md"
---

# GitHub Resource

## Abstract
Description of repository or file.

## Source URL
https://github.com/org/repo/blob/main/file.md
```

---

## 7. Markdown (MD) File Handling

### Processing
- Keep the Markdown file **as-is** (no content transformation)
- Detect if there is an associated image folder
- If needed:
  - Rename the image folder to follow standard naming
  - Example: `old_folder/` → `<document_name>_images/`

### Important Rule
If the image folder is renamed:
- **ALL image references inside the Markdown MUST be updated**

---

## Pipeline Overview

### Step 1 — Detect Source Type
- `pdf`
- `web`
- `txt`
- `image` / `screenshot`
- `github`
- `markdown`

### Step 2 — Extract Content
- Use appropriate parser or OCR

### Step 3 — Extract / Normalize Images
- Extract or collect images
- Place in subfolder
- Rename folder if needed
- Update references

### Step 4 — Generate Abstract
If missing:
- 3–6 sentences
- Include purpose, domain, key topics

### Step 5 — Normalize Markdown
- Clean formatting
- Add metadata
- Ensure structure consistency

### Step 6 — Save Output
```
output/
  document.md
  document_images/
    image_001.png
    image_002.png
```

---

## Acceptance Criteria

A document is valid if:

- [ ] Markdown file exists
- [ ] Abstract is present
- [ ] Source metadata is present
- [ ] Images are stored locally (if applicable)
- [ ] Image folder follows naming convention
- [ ] Image references are correct and updated
- [ ] GitHub URLs are preserved fully
- [ ] OCR is applied when needed
- [ ] Markdown structure is consistent
