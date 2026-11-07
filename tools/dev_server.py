# -*- coding: utf-8 -*-
"""내 컴퓨터에서 AI 까지 시험하는 서버 — 화면 파일 + /api/classify 를 한 주소(8001)로 띄운다.

열쇠는 이 파일에도, 폴더에도 적지 않는다. 띄우는 사람이 자기 터미널에서 환경 변수로 넣는다.
  set -a && source ../classifier/.env && set +a && python3 tools/dev_server.py
배포(Vercel)에서는 쓰지 않는다. Vercel 은 api/classify.py 를 직접 돌린다.
"""
import importlib.util
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
spec = importlib.util.spec_from_file_location("classify", os.path.join(ROOT, "api", "classify.py"))
classify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classify)


class Dev(classify.handler, SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        SimpleHTTPRequestHandler.__init__(self, *a, directory=ROOT, **kw)

    def do_GET(self):
        if self.path.startswith("/api/classify"):
            return classify.handler.do_GET(self)
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self):
        if self.path.startswith("/api/classify"):
            return classify.handler.do_POST(self)
        self.send_error(404)


if __name__ == "__main__":
    has_key = bool(os.environ.get("GEMINI_API_KEY", "").strip())
    print(f"http://localhost:8001  — 열쇠 {'있음' if has_key else '없음 (AI 는 실패하고 규칙으로 돌아갑니다)'}"
          f" · 모델 {classify.model_name()}")
    ThreadingHTTPServer(("127.0.0.1", 8001), Dev).serve_forever()
