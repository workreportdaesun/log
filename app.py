import io
import json
import logging
import os
import tempfile
import threading
import time
import uuid

from flask import Flask, jsonify, request, send_file, render_template, send_from_directory

import excel_builder
import pdf_export

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SETTINGS_PATH = os.path.join(BASE_DIR, "settings.json")
LOG_PATH = os.path.join(BASE_DIR, "flask.log")
# 사무실 같은 네트워크의 다른 PC/모바일에서도 같은 서버로 접속할 수 있도록, work-gallery/work-shoot(정적 파일)도 함께 서빙한다.
GALLERY_DIR = os.path.join(os.path.dirname(BASE_DIR), "work-gallery")
SHOOT_DIR = os.path.join(os.path.dirname(BASE_DIR), "work-shoot")

app = Flask(__name__)
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0  # 개발 중인 갤러리/work-shoot이 모바일에 캐시돼 옛 버전이 보이는 문제 방지


@app.after_request
def add_no_cache_headers(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return response


# ─────────────────────────────────────────────────────────────────────────────
# 창 수명에 서버를 묶는다 (2026-08-13)
#
# 예전엔 bat이 콘솔 창을 하나 띄우고 서버를 거기 붙여놨다. 그래서 (1) 검은 창이 작업표시줄에
# 계속 남고 (2) 브라우저를 닫아도 서버가 살아 있었다. 이제 런처가 pythonw(콘솔 없는 파이썬)로
# 서버를 띄우므로 창이 아예 없고, 대신 "언제 꺼야 하는지"를 서버가 스스로 판단해야 한다.
#
# 판단 근거 두 가지:
#   - 열려 있는 화면이 주기적으로 /api/ping 을 보낸다(클라이언트 등록).
#   - 그 외 아무 요청이나 들어와도 활동으로 친다. 휴대폰이 /gallery/ 를 보고 있는 동안에는
#     계속 요청이 오므로 PC 창과 무관하게 서버가 유지된다.
# 마지막 화면이 닫히면(/api/bye) 곧바로, 브라우저가 강제 종료돼 신호를 못 보낸 경우에도
# IDLE_TIMEOUT 이 지나면 워치독이 종료시킨다.
# ─────────────────────────────────────────────────────────────────────────────
IDLE_TIMEOUT = 20.0     # 이 시간 동안 아무 활동이 없으면 종료
STARTUP_GRACE = 90.0    # 첫 화면이 붙기 전까지 기다려주는 시간(브라우저가 늦게 뜨는 경우)
WATCH_INTERVAL = 5.0

_life_lock = threading.Lock()
_clients = {}            # client_id -> 마지막 ping 시각
_last_activity = time.time()
_ever_connected = False
_busy = 0                # 진행 중인 생성 작업 수 (0이 아니면 절대 종료하지 않는다)


def _touch():
    global _last_activity
    _last_activity = time.time()


@app.before_request
def _mark_activity():
    _touch()


class _BusyJob:
    """엑셀/PDF 생성 중에는 종료를 막는다. PDF는 Excel COM을 띄우는 작업이라
    도중에 프로세스를 죽이면 Excel이 유령으로 남는다."""

    def __enter__(self):
        global _busy
        with _life_lock:
            _busy += 1

    def __exit__(self, *exc):
        global _busy
        with _life_lock:
            _busy -= 1
        _touch()
        return False


@app.route("/api/ping", methods=["POST"])
def ping():
    global _ever_connected
    cid = (request.get_json(silent=True) or {}).get("id") or request.remote_addr
    with _life_lock:
        _clients[cid] = time.time()
        _ever_connected = True
    return jsonify({"ok": True, "clients": len(_clients)})


@app.route("/api/bye", methods=["POST"])
def bye():
    """창이 닫힐 때 sendBeacon으로 호출된다. 닫히는 순간의 일반 fetch는 브라우저가
    취소해버리기 때문에 sendBeacon을 쓴다."""
    cid = None
    raw = request.get_data(as_text=True) or ""
    if raw:
        try:
            cid = (json.loads(raw) or {}).get("id")
        except ValueError:
            cid = None
    with _life_lock:
        _clients.pop(cid or request.remote_addr, None)
        remaining = len(_clients)
    app.logger.info("client closed (%s) - remaining %d", cid, remaining)
    return jsonify({"ok": True, "clients": remaining})


def _watchdog():
    while True:
        time.sleep(WATCH_INTERVAL)
        now = time.time()
        with _life_lock:
            for cid, seen in list(_clients.items()):
                if now - seen > IDLE_TIMEOUT:
                    _clients.pop(cid, None)
            clients = len(_clients)
            busy = _busy
            connected = _ever_connected
        if busy:
            continue
        idle = now - _last_activity
        limit = IDLE_TIMEOUT if connected else STARTUP_GRACE
        if clients == 0 and idle > limit:
            app.logger.info("no client for %.0fs - shutting down", idle)
            logging.shutdown()
            os._exit(0)


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
    with _BusyJob():   # 생성이 끝날 때까지 워치독이 서버를 끄지 못하게 막는다
        return _generate()


def _generate():
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
    # pythonw로 띄우면 콘솔이 없어 print/로그가 갈 곳이 없다 — 전부 flask.log로 보낸다.
    logging.basicConfig(
        filename=LOG_PATH,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        encoding="utf-8",
    )
    logging.getLogger("werkzeug").setLevel(logging.WARNING)   # 요청 한 줄씩 쌓이면 로그가 금방 커진다

    threading.Thread(target=_watchdog, daemon=True).start()
    app.logger.info("server start (pid %d) port 5183", os.getpid())

    # debug=True는 쓰지 않는다. 자동 재시작(reloader)이 프로세스를 하나 더 띄우는데,
    # 콘솔 없는 pythonw에서는 그 자식이 남아 포트를 잡고 안 죽는 일이 생긴다.
    # 워치독 스레드도 두 벌 돌게 된다.
    # 0.0.0.0: 같은 네트워크(사무실 와이파이 등)의 다른 PC에서도 이 PC의 LAN IP로 접속 가능
    app.run(host="0.0.0.0", port=5183, debug=False, use_reloader=False, threaded=True)
