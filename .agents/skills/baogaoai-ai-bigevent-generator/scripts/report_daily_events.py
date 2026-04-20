#!/usr/bin/env python3
"""Report normalized daily-events payload and verify it was saved."""

from __future__ import annotations

import argparse
import json
import os
import ssl
import urllib.parse
import urllib.request


BASE_URL = "https://api.aitrend.us"


def build_ssl_context(insecure: bool) -> ssl.SSLContext | None:
    if not insecure:
        return None
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def request_json(url: str, timeout: int, insecure: bool) -> dict:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "baogaoai-ai-bigevent-generator/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout, context=build_ssl_context(insecure)) as resp:
        return json.load(resp)


def post_json(url: str, payload: dict, token: str, timeout: int, insecure: bool) -> dict:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        method="POST",
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "baogaoai-ai-bigevent-generator/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout, context=build_ssl_context(insecure)) as resp:
        return json.load(resp)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Report daily-events payload and verify save.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--context")
    parser.add_argument("--out", required=True)
    parser.add_argument("--base-url", default=BASE_URL)
    parser.add_argument("--token")
    parser.add_argument("--token-file")
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--insecure", action="store_true")
    return parser.parse_args()


def resolve_token(args: argparse.Namespace) -> str:
    if args.token:
        return args.token.strip()

    for env_name in ("BAOGAOAI_DAILY_EVENTS_TOKEN", "BAOGAOAI_ADMIN_TOKEN"):
        value = os.environ.get(env_name, "").strip()
        if value:
            return value

    if args.token_file and os.path.exists(args.token_file):
        with open(args.token_file, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
        for key in ("dailyEventsAdminToken", "adminToken"):
            value = str(payload.get(key, "")).strip()
            if value:
                return value

    raise RuntimeError("Missing daily-events admin token. Use --token, --token-file, or BAOGAOAI_DAILY_EVENTS_TOKEN.")


def main() -> int:
    args = parse_args()
    token = resolve_token(args)
    with open(args.input, "r", encoding="utf-8") as fh:
      payload = json.load(fh)

    if payload.get("status") == "skip" or not payload.get("events"):
        verification = {
            "status": "skip",
            "targetDate": payload.get("targetDate"),
            "runMode": payload.get("runMode"),
            "saved": 0,
            "skipped": 0,
            "verificationPassed": False,
            "message": payload.get("skipReason") or "no events to report",
        }
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(verification, fh, ensure_ascii=False, indent=2)
        return 0

    target_date = payload["eventDate"]
    report_url = f"{args.base_url.rstrip('/')}/admin/daily-events/report"
    verify_api_url = f"{args.base_url.rstrip('/')}/daily-events?{urllib.parse.urlencode({'from': target_date, 'to': target_date})}"

    report_response = post_json(report_url, payload, token, args.timeout, args.insecure)
    verify_response = request_json(verify_api_url, args.timeout, args.insecure)
    returned_titles = {
        (event.get("title") or "").strip()
        for event in (((verify_response.get("data") or {}).get("events")) or [])
    }
    expected_titles = {(event.get("title") or "").strip() for event in payload.get("events") or []}
    verification_passed = bool(expected_titles) and expected_titles.issubset(returned_titles)

    verification = {
        "status": "success" if verification_passed else "failed",
        "targetDate": target_date,
        "runMode": (payload.get("runMode") or "first"),
        "saved": len(payload.get("events") or []),
        "skipped": 0,
        "reportResponse": report_response,
        "verifyResponse": verify_response,
        "verificationPassed": verification_passed,
        "reportUrl": report_url,
        "verifyApiUrl": verify_api_url,
        "message": None if verification_passed else "reported events were not fully visible in verify response",
    }
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(verification, fh, ensure_ascii=False, indent=2)
    return 0 if verification_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
