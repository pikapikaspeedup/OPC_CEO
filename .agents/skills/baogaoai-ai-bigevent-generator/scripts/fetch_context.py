#!/usr/bin/env python3
"""Prepare deterministic AI big-event context from aitrend.us APIs."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
import ssl
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo


BASE_URL = "https://api.aitrend.us"
SH_TZ = ZoneInfo("Asia/Shanghai")
UTC = dt.timezone.utc
EVENT_KEYWORDS = (
    "融资", "募资", "收购", "并购", "ipo", "上市", "发布", "推出", "开源", "合作",
    "监管", "法案", "裁决", "升级", "模型", "产品", "药物发现", "机器人", "agent",
    "芯片", "估值", "亿美元", "亿人民币", "亿美元", "战略",
)
EVENT_CATEGORY_HINTS = {"投融资", "产品", "资讯", "模型", "政策监管", "战略合作", "开源"}


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare AI big-event context.")
    parser.add_argument("--date", help="Target date in YYYY-MM-DD. Defaults to today in Asia/Shanghai.")
    parser.add_argument("--mode", choices=["first", "supplement"], help="Override run mode.")
    parser.add_argument("--base-url", default=BASE_URL)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--max-pages", type=int, default=3)
    parser.add_argument("--timeout", type=int, default=20)
    parser.add_argument("--out", required=True)
    parser.add_argument("--insecure", action="store_true")
    return parser.parse_args()


def parse_target_date(value: str | None) -> dt.date:
    if value:
        return dt.date.fromisoformat(value)
    return dt.datetime.now(SH_TZ).date()


def isoformat_z(value: dt.datetime) -> str:
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def build_window(target_date: dt.date) -> tuple[dt.datetime, dt.datetime]:
    window_start = dt.datetime.combine(target_date - dt.timedelta(days=1), dt.time(20, 0), tzinfo=SH_TZ)
    window_end = dt.datetime.combine(target_date, dt.time(20, 0), tzinfo=SH_TZ)
    return window_start, window_end


def parse_created_at(value) -> dt.datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return dt.datetime.fromtimestamp(float(value), tz=UTC)
    if isinstance(value, str):
        normalized = value.replace("Z", "+00:00")
        try:
            parsed = dt.datetime.fromisoformat(normalized)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)
    return None


def strip_html(raw: str | None) -> str:
    if not raw:
        return ""
    cleaned = re.sub(r"<style[\s\S]*?</style>", " ", raw, flags=re.I)
    cleaned = re.sub(r"<script[\s\S]*?</script>", " ", cleaned, flags=re.I)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = html.unescape(cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def score_item(item: dict) -> int:
    text = f"{item.get('titleZh', '')} {item.get('summary', '')}".lower()
    categories = set(item.get("recommendCategory", []))
    score = 0
    for keyword in EVENT_KEYWORDS:
        if keyword.lower() in text:
            score += 2
    for category in categories:
        if category in EVENT_CATEGORY_HINTS:
            score += 3
    if any(char.isdigit() for char in text):
        score += 1
    return score


def fetch_selected_articles(base_url: str, limit: int, max_pages: int, timeout: int, insecure: bool) -> list[dict]:
    items: list[dict] = []
    for page in range(1, max_pages + 1):
        url = f"{base_url.rstrip('/')}/selected-articles?{urllib.parse.urlencode({'limit': limit, 'page': page})}"
        payload = request_json(url, timeout, insecure)
        page_items = ((payload.get("data") or {}).get("items") or [])
        if not isinstance(page_items, list) or not page_items:
            break
        items.extend(page_items)
    return items


def fetch_daily_events(base_url: str, start_date: str, end_date: str, timeout: int, insecure: bool) -> list[dict]:
    url = f"{base_url.rstrip('/')}/daily-events?{urllib.parse.urlencode({'from': start_date, 'to': end_date})}"
    payload = request_json(url, timeout, insecure)
    return (((payload.get("data") or {}).get("events")) or [])


def normalize_selected_item(item: dict) -> dict:
    recommend = item.get("recommend") or {}
    return {
        "id": item.get("articleId") or item.get("id"),
        "title": item.get("titleZh") or item.get("title") or "",
        "summary": item.get("summary") or recommend.get("summary") or "",
        "url": item.get("url") or "",
        "createdAt": item.get("createdAt"),
        "recommendCategory": recommend.get("category") or [],
    }


def fetch_article_detail(base_url: str, article_id: int, timeout: int, insecure: bool) -> dict:
    payload = request_json(f"{base_url.rstrip('/')}/articles/{article_id}", timeout, insecure)
    data = payload.get("data") or {}
    optimization = data.get("optimizationResult") or {}
    content_snippet = strip_html(data.get("content"))[:1400]
    return {
        "id": article_id,
        "title": data.get("titleZh") or data.get("title") or "",
        "summary": data.get("summary") or optimization.get("description") or "",
        "url": data.get("url") or "",
        "createdAt": parse_created_at(data.get("createdAt")).isoformat().replace("+00:00", "Z") if parse_created_at(data.get("createdAt")) else None,
        "aiCategory": data.get("aiCategory") or "",
        "tags": data.get("tags") or optimization.get("tags") or [],
        "description": optimization.get("description") or "",
        "points": optimization.get("points") or [],
        "contentSnippet": content_snippet,
        "aiPeople": data.get("aiPeople") or [],
    }


def main() -> int:
    args = parse_args()
    target_date = parse_target_date(args.date)
    window_start_sh, window_end_sh = build_window(target_date)
    window_start_utc = window_start_sh.astimezone(UTC)
    window_end_utc = window_end_sh.astimezone(UTC)

    same_day_events = fetch_daily_events(args.base_url, target_date.isoformat(), target_date.isoformat(), args.timeout, args.insecure)
    history_events = fetch_daily_events(
        args.base_url,
        (target_date - dt.timedelta(days=30)).isoformat(),
        (target_date - dt.timedelta(days=1)).isoformat(),
        args.timeout,
        args.insecure,
    )
    run_mode = args.mode or ("supplement" if same_day_events else "first")
    same_day_article_ids = {
        int(article_id)
        for event in same_day_events
        for article_id in (event.get("sourceArticleIds") or [])
        if isinstance(article_id, int)
    }

    selected = [normalize_selected_item(item) for item in fetch_selected_articles(args.base_url, args.limit, args.max_pages, args.timeout, args.insecure)]
    in_window: list[dict] = []
    for item in selected:
        created_at = parse_created_at(item.get("createdAt"))
        if not created_at:
            continue
        if window_start_utc <= created_at <= window_end_utc:
            item["createdAt"] = created_at.isoformat().replace("+00:00", "Z")
            in_window.append(item)

    if run_mode == "supplement":
        in_window = [item for item in in_window if int(item.get("id") or 0) not in same_day_article_ids]

    scored = sorted(in_window, key=lambda item: (score_item(item), item.get("createdAt") or ""), reverse=True)
    candidates = scored[:18]

    article_details_by_id: dict[str, dict] = {}
    candidate_articles: list[dict] = []
    source_article_ids: list[int] = []
    for item in candidates:
        article_id = int(item.get("id") or 0)
        if article_id <= 0:
            continue
        detail = fetch_article_detail(args.base_url, article_id, args.timeout, args.insecure)
        source_article_ids.append(article_id)
        candidate_articles.append({
            "id": article_id,
            "title": detail["title"] or item.get("title") or "",
            "summary": detail["summary"] or item.get("summary") or "",
            "url": detail["url"] or item.get("url") or "",
            "createdAt": detail.get("createdAt") or item.get("createdAt"),
            "aiCategory": detail.get("aiCategory") or "",
            "tags": detail.get("tags") or [],
        })
        article_details_by_id[str(article_id)] = detail

    payload = {
        "status": "ok" if candidate_articles else "skip",
        "skipReason": None if candidate_articles else "no_candidate_articles_in_window",
        "targetDate": target_date.isoformat(),
        "runMode": run_mode,
        "timezone": "Asia/Shanghai",
        "windowStart": isoformat_z(window_start_sh),
        "windowEnd": isoformat_z(window_end_sh),
        "articleCount": len(candidate_articles),
        "sourceArticleIds": source_article_ids,
        "candidateArticles": candidate_articles,
        "articleDetailsById": article_details_by_id,
        "existingEvents": {
            "sameDay": same_day_events,
            "last30Days": history_events,
        },
        "source": args.base_url,
        "fetchedAt": dt.datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
