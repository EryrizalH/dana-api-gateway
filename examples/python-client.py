"""Python 3, standard library; no automatic retries."""
import json
import os
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def gateway_request(base_url, api_key, route, body=None):
    url = urlsplit(base_url)
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("Invalid gateway base URL")
    if not api_key:
        raise ValueError("Gateway API key is required")
    headers = {"Accept": "application/json", "x-api-key": api_key}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")
    request = Request(base_url.rstrip("/") + route, data=data, headers=headers)
    try:
        with build_opener(NoRedirect).open(request, timeout=20) as response:
            payload = json.load(response)
    except HTTPError as error:
        raise RuntimeError(f"Gateway HTTP error: {error.code}") from None
    except (URLError, TimeoutError):
        raise RuntimeError("Gateway network error; outcome may be unknown. Do not retry creation automatically.") from None
    if not isinstance(payload, dict) or payload.get("success") is not True or not isinstance(payload.get("data"), dict):
        raise RuntimeError("Invalid gateway response")
    return payload["data"]


if __name__ == "__main__":
    base_url = os.environ.get("DANA_GATEWAY_URL", "")
    api_key = os.environ.get("DANA_GATEWAY_API_KEY", "")
    if not base_url or not api_key or len(sys.argv) < 2:
        raise SystemExit("Set gateway environment variables and pass an order reference")
    qr = gateway_request(base_url, api_key, "/create-qris", {"amount": 25000, "reference_id": sys.argv[1]})
    # Persist IDs, reference, amount and expiry in the application's order storage.
    print(json.dumps({"trx_id": qr["trx_id"], "qris_url": qr["qris_url"]}))
    payment = gateway_request(base_url, api_key, "/check-payment?trx_id=" + quote(qr["trx_id"], safe=""))
    print(payment["status"])
