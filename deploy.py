#!/usr/bin/env python3
"""
SmartRoute Web UI 배포 스크립트
사용: python3 deploy.py
"""
import os
import re
import sys
import paramiko

# ── 설정 ────────────────────────────────────────────────────────────────────
HOST        = "192.168.0.150"
PORT        = 22
USER        = "root"
PASS        = "root"
LOCAL_BASE  = os.path.dirname(os.path.abspath(__file__))
REMOTE_BASE = "/var/www/html"

LIGHTTPD_CONF     = "/etc/lighttpd/lighttpd.conf"
CORS_DEV_ORIGIN   = "http://127.0.0.1:5500"
CORS_PROD_ORIGIN  = f"http://{HOST}"

EXCLUDE_DIRS  = {"referencs", "webtest_for_help", "webtest", "__pycache__", "docs"}
EXCLUDE_FILES = {"dev-server.py", "deploy.py", "dev_restore.py"}
EXCLUDE_EXTS  = {".md"}

# ── 파일 수집 ────────────────────────────────────────────────────────────────
def collect_files():
    files = []
    for root, dirs, fnames in os.walk(LOCAL_BASE):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for fname in fnames:
            if fname in EXCLUDE_FILES:
                continue
            if os.path.splitext(fname)[1] in EXCLUDE_EXTS:
                continue
            local_path  = os.path.join(root, fname)
            rel_path    = os.path.relpath(local_path, LOCAL_BASE)
            remote_path = REMOTE_BASE + "/" + rel_path.replace(os.sep, "/")
            files.append((local_path, remote_path))
    return files

def ensure_remote_dir(sftp, path):
    parts = path.strip("/").split("/")
    cur = ""
    for part in parts:
        cur += "/" + part
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)

def patch_config_js(content):
    """Live Server API_BASE 조건 분기 → 배포용 빈 문자열로 교체"""
    return re.sub(
        r'const API_BASE\s*=\s*location\.hostname.*?;',
        'const API_BASE = "";',
        content,
        flags=re.DOTALL,
    )

# ── lighttpd CORS 수정 ───────────────────────────────────────────────────────
def update_cors(ssh):
    sftp = ssh.open_sftp()
    try:
        with sftp.open(LIGHTTPD_CONF, "r") as f:
            conf = f.read().decode()
    except FileNotFoundError:
        print(f"  ⚠  {LIGHTTPD_CONF} 없음 — CORS 수정 건너뜀")
        sftp.close()
        return False

    updated = conf.replace(
        f'"Access-Control-Allow-Origin"      => "{CORS_DEV_ORIGIN}"',
        f'"Access-Control-Allow-Origin"      => "{CORS_PROD_ORIGIN}"',
    )
    if conf == updated:
        print("  ℹ  CORS Origin 이미 프로덕션 설정")
        sftp.close()
        return True

    with sftp.open(LIGHTTPD_CONF, "w") as f:
        f.write(updated)
    sftp.close()
    print(f"  ✓ CORS Origin: {CORS_DEV_ORIGIN} → {CORS_PROD_ORIGIN}")
    return True

def reboot_device(ssh):
    print("  디바이스 재부팅 명령 전송…")
    ssh.exec_command("reboot")
    print("  ✓ reboot 명령 전송 완료")
    print("  ℹ  디바이스가 재부팅됩니다. 약 30~60초 후 http://192.168.0.150 으로 접속하세요.")

# ── 메인 ────────────────────────────────────────────────────────────────────
def main():
    print(f"[SmartRoute Deploy] → {HOST}:{REMOTE_BASE}\n")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, PORT, USER, PASS, timeout=10)
    except Exception as e:
        print(f"✗ SSH 연결 실패: {e}")
        sys.exit(1)

    sftp = ssh.open_sftp()

    # 1. 파일 배포
    files = collect_files()
    print(f"[1/3] 파일 배포 ({len(files)}개)")
    created_dirs = set()
    for local_path, remote_path in files:
        remote_dir = "/".join(remote_path.split("/")[:-1])
        if remote_dir not in created_dirs:
            ensure_remote_dir(sftp, remote_dir)
            created_dirs.add(remote_dir)

        if os.path.basename(local_path) == "config.js":
            with open(local_path, "r", encoding="utf-8") as f:
                content = f.read()
            with sftp.open(remote_path, "w") as rf:
                rf.write(patch_config_js(content))
            print(f"  ✓ {remote_path}  [API_BASE 패치]")
        else:
            sftp.put(local_path, remote_path)
            print(f"  ✓ {remote_path}")

    # preflight용 빈 파일 보장
    preflight = REMOTE_BASE + "/_cors_preflight"
    try:
        sftp.stat(preflight)
    except FileNotFoundError:
        sftp.open(preflight, "w").close()
        print(f"  ✓ {preflight}  [생성]")

    sftp.close()

    # 2. lighttpd CORS 수정
    print("\n[2/2] lighttpd CORS 설정 수정")
    update_cors(ssh)

    # 3. 디바이스 재부팅
    print("\n[3/3] 디바이스 재부팅")
    reboot_device(ssh)

    ssh.close()
    print("\n배포 완료.")

if __name__ == "__main__":
    main()
