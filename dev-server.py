#!/usr/bin/env python3
"""
SmartRoute CORS 프록시 (포트 8089)
Live Server(5500) 사용 시 API 요청을 기기(192.168.0.150)로 전달하고
CORS 헤더를 추가하여 브라우저 차단을 우회한다.

사용법:
    python3 dev-server.py

Live Server는 그대로 유지하고 이 프록시만 추가로 실행하면 된다.
"""
import http.server
import urllib.request
import urllib.error
import sys

DEVICE = "http://192.168.0.150"
PORT   = 8089


class CorsProxyHandler(http.server.BaseHTTPRequestHandler):

    def _cors_headers(self):
        origin = self.headers.get("Origin", "*")
        return {
            "Access-Control-Allow-Origin":      origin,
            "Access-Control-Allow-Credentials": "true",
            "Access-Control-Allow-Methods":     "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers":     "Content-Type, Authorization, Cookie",
            "Access-Control-Max-Age":           "86400",
        }

    def _send_cors(self):
        for k, v in self._cors_headers().items():
            self.send_header(k, v)

    # OPTIONS preflight
    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):    self._proxy()
    def do_POST(self):   self._proxy()
    def do_PUT(self):    self._proxy()
    def do_DELETE(self): self._proxy()

    def _proxy(self):
        target = f"{DEVICE}{self.path}"

        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length) if length else None

        # host / origin / referer 는 프록시 측 값을 제거하고 전달
        skip = {"host", "origin", "referer"}
        fwd  = {k: v for k, v in self.headers.items() if k.lower() not in skip}

        req = urllib.request.Request(target, data=body, headers=fwd, method=self.command)

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                self.send_response(resp.status)
                self._send_cors()
                for k, v in resp.headers.items():
                    # 중복 방지 및 불필요 헤더 제거
                    if k.lower() in ("transfer-encoding", "access-control-allow-origin",
                                     "access-control-allow-credentials"):
                        continue
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(resp.read())

        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self._send_cors()
            for k, v in e.headers.items():
                if k.lower() in ("transfer-encoding",):
                    continue
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(e.read())

        except Exception as e:
            self.send_error(502, f"Proxy error: {e}")

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[proxy] {self.address_string()} {fmt % args}\n")


if __name__ == "__main__":
    server = http.server.HTTPServer(("", PORT), CorsProxyHandler)
    print(f"CORS 프록시 실행 중: http://localhost:{PORT}")
    print(f"API 전달 대상       : {DEVICE}")
    print(f"Live Server와 함께  : http://127.0.0.1:5500 에서 접속\n")
    print("(Ctrl+C 로 종료)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n종료.")
