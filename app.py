import io
import json
import os
import tempfile
import uuid

from flask import Flask, jsonify, request, send_file, render_template, send_from_directory

import excel_builder
import pdf_export

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_PATH = os.path.join(BASE_DIR, "settings.json")
# 사무실 같은 네트워크의 다른 PC/모바일에서도 같은 서버로 접속할 수 있도록, work-gallery/work-shoot(정적 파일)도 함께 서빙한다.
GALLERY_DIR = os.path.join(os.path.dirname(BASE_DIR), "work-gallery")
SHOOT_DIR = os.path.join(os.path.dirname(BASE_DIR), "work-shoot")

app = Flask(__name__)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0  # 개발 중인 갤러리/work-shoot이 모바일에 캐시돼 옛 버전이 보이는 문제 방지


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


def load_settings():
    if os.path.exists(SETTINGS_PATH):
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"project_name": "", "company_name": "", "work_title": ""}


def save_settings(data):
    with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/gallery/")
def gallery_index():
    return send_from_directory(GALLERY_DIR, "index.html")


@app.route("/gallery/<path:filename>")
def gallery_static(filename):
    return send_from_directory(GALLERY_DIR, filename)


@app.route("/shoot/")
def shoot_index():
    return send_from_directory(SHOOT_DIR, "index.html")


@app.route("/shoot/<path:filename>")
def shoot_static(filename):
    return send_from_directory(SHOOT_DIR, filename)


@app.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(load_settings())


@app.route("/api/settings", methods=["POST"])
def post_settings():
    data = request.get_json(force=True)
    settings = {
        "project_name": (data.get("project_name") or "").strip(),
        "company_name": (data.get("company_name") or "").strip(),
        "work_title": (data.get("work_title") or "").strip(),
    }
    save_settings(settings)
    return jsonify(settings)


def _parse_pages(files):
    """multipart 요청에서 pages 메타(JSON)와 사진 파일을 조합해 excel_builder가 원하는 구조로 변환.
    사진 한 장 = 세트 한 개(고유 dwg/location/content/date)이므로, sets 배열 순서가
    레이아웃 4는 [top_left, top_right, bottom_left, bottom_right], 레이아웃 2는 [top, bottom]이어야 한다."""
    meta = json.loads(request.form["pages"])
    pages = []
    for page in meta:
        sets = []
        for set_meta in page.get("sets") or []:
            photo_key = set_meta.get("photo_key")
            file_storage = files.get(photo_key) if photo_key else None
            sets.append({
                "dwg": set_meta.get("dwg", ""),
                "location": set_meta.get("location", ""),
                "content": set_meta.get("content", ""),
                "date": set_meta.get("date", ""),
                "photo": file_storage.read() if file_storage else None,
            })
        pages.append({"layout": page.get("layout", "4"), "sets": sets})
    return pages


@app.route("/api/generate", methods=["POST"])
def generate():
    fmt = request.form.get("format", "xlsx")
    settings = json.loads(request.form.get("settings", "{}"))
    pages = _parse_pages(request.files)

    wb = excel_builder.build_workbook(pages, settings)

    work_title = (settings.get("work_title") or "").strip() or "사진대지"
    base_name = f"{work_title}_사진대지"

    if fmt == "xlsx":
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return send_file(
            buf,
            as_attachment=True,
            download_name=f"{base_name}.xlsx",
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    # pdf: 임시 xlsx로 저장 후 Excel COM으로 변환
    tmp_dir = tempfile.mkdtemp(prefix="photo_sheet_")
    tmp_xlsx = os.path.join(tmp_dir, f"{uuid.uuid4().hex}.xlsx")
    tmp_pdf = os.path.join(tmp_dir, f"{uuid.uuid4().hex}.pdf")
    wb.save(tmp_xlsx)
    pdf_export.xlsx_to_pdf(tmp_xlsx, tmp_pdf)

    with open(tmp_pdf, "rb") as f:
        pdf_bytes = f.read()

    try:
        os.remove(tmp_xlsx)
        os.remove(tmp_pdf)
        os.rmdir(tmp_dir)
    except OSError:
        pass

    return send_file(
        io.BytesIO(pdf_bytes),
        as_attachment=True,
        download_name=f"{base_name}.pdf",
        mimetype="application/pdf",
    )


if __name__ == "__main__":
    # 0.0.0.0: 같은 네트워크(사무실 와이파이 등)의 다른 PC에서도 이 PC의 LAN IP로 접속 가능
    app.run(host="0.0.0.0", port=5183, debug=True)
