#!/usr/bin/env python3
"""
SmartRoute 개발 환경 복구 스크립트
배포 후 CORS를 개발 서버 설정으로 되돌린다.
사용: python3 dev_restore.py
"""
import sys
import paramiko

HOST            = "192.168.0.150"
PORT            = 22
USER            = "root"
PASS            = "root"
LIGHTTPD_CONF   = "/etc/lighttpd/lighttpd.conf"
CORS_DEV_ORIGIN  = "http://127.0.0.1:5500"
CORS_PROD_ORIGIN = f"http://{HOST}"

def restore_cors(ssh):
    sftp = ssh.open_sftp()
    try:
        with sftp.open(LIGHTTPD_CONF, "r") as f:
            conf = f.read().decode()
    except FileNotFoundError:
        print(f"  ✗ {LIGHTTPD_CONF} 없음")
        sftp.close()
        return False

    updated = conf.replace(
        f'"Access-Control-Allow-Origin"      => "{CORS_PROD_ORIGIN}"',
        f'"Access-Control-Allow-Origin"      => "{CORS_DEV_ORIGIN}"',
    )
    if conf == updated:
        print("  ℹ  CORS Origin 이미 개발 설정")
        sftp.close()
        return True

    with sftp.open(LIGHTTPD_CONF, "w") as f:
        f.write(updated)
    sftp.close()
    print(f"  ✓ CORS Origin: {CORS_PROD_ORIGIN} → {CORS_DEV_ORIGIN}")
    return True

def reboot_device(ssh):
    print("  디바이스 재부팅 명령 전송…")
    ssh.exec_command("reboot")
    print("  ✓ reboot 명령 전송 완료")
    print("  ℹ  약 30~60초 후 개발 서버(http://127.0.0.1:5500)에서 접속하세요.")

def main():
    print(f"[SmartRoute Dev Restore] → {HOST}\n")

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, PORT, USER, PASS, timeout=10)
    except Exception as e:
        print(f"✗ SSH 연결 실패: {e}")
        sys.exit(1)

    print("[1/2] lighttpd CORS 설정 복구")
    restore_cors(ssh)

    print("\n[2/2] 디바이스 재부팅")
    reboot_device(ssh)

    ssh.close()
    print("\n완료.")

if __name__ == "__main__":
    main()
