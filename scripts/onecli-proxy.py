#!/usr/bin/env python3
"""Forward 172.17.0.1:PORT -> TARGET_HOST:PORT so Docker containers can reach OneCLI."""
import socket
import threading
import sys
import os
import signal

LISTEN_HOST = os.environ.get('PROXY_LISTEN_HOST', '172.17.0.1')
TARGET_HOST = os.environ.get('PROXY_TARGET_HOST', '192.168.224.205')
PORT = int(os.environ.get('PROXY_PORT', '10255'))


def forward(src: socket.socket, dst: socket.socket) -> None:
    try:
        while True:
            data = src.recv(65536)
            if not data:
                break
            dst.sendall(data)
    except OSError:
        pass
    finally:
        try:
            src.close()
        except OSError:
            pass
        try:
            dst.close()
        except OSError:
            pass


def handle(client: socket.socket) -> None:
    try:
        target = socket.create_connection((TARGET_HOST, PORT), timeout=10)
    except OSError as e:
        print(f'[onecli-proxy] Cannot connect to {TARGET_HOST}:{PORT}: {e}', flush=True)
        client.close()
        return
    t1 = threading.Thread(target=forward, args=(client, target), daemon=True)
    t2 = threading.Thread(target=forward, args=(target, client), daemon=True)
    t1.start()
    t2.start()


def main() -> None:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        srv.bind((LISTEN_HOST, PORT))
    except OSError as e:
        print(f'[onecli-proxy] Cannot bind {LISTEN_HOST}:{PORT}: {e}', flush=True)
        sys.exit(1)
    srv.listen(128)
    print(f'[onecli-proxy] Forwarding {LISTEN_HOST}:{PORT} -> {TARGET_HOST}:{PORT}', flush=True)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    while True:
        try:
            client, _ = srv.accept()
        except OSError:
            break
        threading.Thread(target=handle, args=(client,), daemon=True).start()


if __name__ == '__main__':
    main()
