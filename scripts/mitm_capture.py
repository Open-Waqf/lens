import json
import os
import time

from mitmproxy import http

OUT_PATH = os.environ.get("MITM_CAPTURE_PATH", "mitm-requests.jsonl")


def request(flow: http.HTTPFlow) -> None:
    entry = {
        "ts": time.time(),
        "method": flow.request.method,
        "scheme": flow.request.scheme,
        "host": flow.request.host,
        "port": flow.request.port,
        "path": flow.request.path,
        "url": flow.request.pretty_url,
    }
    with open(OUT_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=True) + "\n")

