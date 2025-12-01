import http.server
import ssl
import os
from os.path import join

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        # 빌드된 정적 파일이 있는 디렉토리로 경로를 변경합니다.
        build_dir = join(os.path.dirname(__file__), 'build')
        # 기본 경로 변환을 수행합니다.
        path = super().translate_path(path)
        # 빌드 디렉토리로 경로를 조정합니다.
        relpath = os.path.relpath(path, os.getcwd())
        return os.path.join(build_dir, relpath)

# 현재 디렉토리에서 서버를 실행합니다.
# 특정 포트(예: 8000)를 지정할 수 있습니다.
port = 443
server_class = http.server.HTTPServer
handler_class = CustomHandler
server_address = ('', port)

# SSL 컨텍스트 설정
# certfile 경로가 올바른지 확인하십시오.
ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ssl_context.load_cert_chain('../server/cert.pem', keyfile='../server/key.pem')

# 서버 인스턴스 생성 및 소켓 래핑
httpd = server_class(server_address, handler_class)
httpd.socket = ssl_context.wrap_socket(httpd.socket, server_side=True)

print(f"Serving HTTPS on port {port}...")

try:
    httpd.serve_forever()
except KeyboardInterrupt:
    httpd.server_close()
    print("Server stopped.")
