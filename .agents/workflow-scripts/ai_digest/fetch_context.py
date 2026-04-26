#!/usr/bin/env python3
"""Fetch selected articles/headlines and build deterministic context for AI digest generation."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any
from zoneinfo import ZoneInfo

DEFAULT_BASE_URL = "https://api.aitrend.us"
TARGET_TZ = ZoneInfo("Asia/Shanghai")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch selected articles and headlines for digest context."
    )
    parser.add_argument("--date", help="Target digest date in YYYY-MM-DD (default: today in Asia/Shanghai).")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--max-pages", type=int, default=2)
    parser.add_argument("--min-articles", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--out", default="context.json")
    parser.add_argument("--insecure", action="store_true")
    parser.add_argument("--window-start-hour", type=int, default=20)
    parser.add_argument("--window-end-hour", type=int, default=8)
    return parser.parse_args()


def parse_target_date(value: str | None) -> str:
    if not value:
        return dt.datetime.now(TARGET_TZ).date().isoformat()
    try:
        return dt.date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise SystemExit(f"Invalid --date format: {value!r}. Use YYYY-MM-DD.") from exc


def ssl_context(insecure: bool) -> ssl.SSLContext | None:
    if insecure:
        return ssl._create_unverified_context()
    return None


def json_request(url: str, timeout: float, insecure: bool) -> tuple[Any, int]:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "baogaoai-ai-digest-generator/1.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout, context=ssl_context(insecure)) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw), getattr(response, "status", 200)


def find_article_list(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("items", "data", "results", "articles", "list"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = find_article_list(value)
            if nested:
                return nested
    return []


def normalize_id(value: Any) -> int | str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        if stripped.isdigit():
            return int(stripped)
        return stripped
    return str(value)


def normalize_tags(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                out.append(text)
        return out
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(",")]
        return [p for p in parts if p]
    return []


def parse_created_at(value: Any) -> tuple[str | None, str | None]:
    if not value:
        return None, None
    text = str(value).strip()
    if not text:
        return None, None
    normalized = text.replace("Z", "+00:00")
    parsed: dt.datetime | None = None
    try:
        parsed = dt.datetime.fromisoformat(normalized)
    except ValueError:
        for pattern in (
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M:%S.%f",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M:%S.%f",
        ):
            try:
                parsed = dt.datetime.strptime(text, pattern)
                break
            except ValueError:
                continue
    if parsed is None:
        return text, None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    local = parsed.astimezone(TARGET_TZ)
    return local.isoformat(), local.date().isoformat()


def normalize_article(raw: dict[str, Any]) -> dict[str, Any]:
    article_id = normalize_id(raw.get("id") or raw.get("articleId"))
    created_at, created_date = parse_created_at(
        raw.get("createdAt") or raw.get("created_at") or raw.get("publishedAt")
    )
    return {
        "id": article_id,
        "title": str(raw.get("title") or raw.get("headline") or "").strip(),
        "summary": str(raw.get("summary") or raw.get("description") or "").strip(),
        "url": str(raw.get("url") or raw.get("link") or "").strip(),
        "source": str(raw.get("source") or raw.get("sourceName") or "").strip(),
        "createdAt": created_at,
        "createdDate": created_date,
        "tags": normalize_tags(raw.get("tags")),
    }


def dedupe_articles(articles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for article in articles:
        key = ""
        if article.get("id") is not None:
            key = f"id:{article['id']}"
        elif article.get("title"):
            key = f"title:{article['title']}|date:{article.get('createdDate')}"
        else:
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(article)
    return out


def fetch_selected_articles(base_url, limit, max_pages, timeout, insecure):
    all_articles = []
    endpoints = []
    for page in range(1, max_pages + 1):
        params = urllib.parse.urlencode({"limit": limit, "page": page})
        url = f"{base_url.rstrip('/')}/selected-articles?{params}"
        payload, _ = json_request(url, timeout=timeout, insecure=insecure)
        page_articles = [normalize_article(item) for item in find_article_list(payload)]
        endpoints.append(url)
        all_articles.extend(page_articles)
        if len(page_articles) < limit:
            break
    return all_articles, endpoints


def fetch_headlines(base_url, timeout, insecure):
    url = f"{base_url.rstrip('/')}/headlines/latest"
    payload, _ = json_request(url, timeout=timeout, insecure=insecure)
    return payload, url


def extract_deep_dive_topics(content_html: str) -> list[str]:
    import re

    topics: list[str] = []
    for tag in ("h2", "h3"):
        topics.extend(re.findall(rf"<{tag}[^>]*>(.*?)</{tag}>", content_html, re.DOTALL))
    cleaned: list[str] = []
    skip_keywords = {"快讯", "编辑手记", "手记", "目录", "导读"}
    for t in topics:
        t = re.sub(r"<[^>]+>", "", t).strip()
        if not t:
            continue
        if any(kw in t for kw in skip_keywords):
            continue
        cleaned.append(t)
    return cleaned


def check_digest_exists(base_url, target_date, timeout, insecure):
    url = f"{base_url.rstrip('/')}/digest?date={target_date}"
    try:
        payload, _ = json_request(url, timeout=timeout, insecure=insecure)
    except (urllib.error.URLError, json.JSONDecodeError):
        return False
    data = payload.get("data", {})
    return bool(data.get("exists"))


def fetch_recent_digests(base_url, target_date, days, timeout, insecure):
    target = dt.date.fromisoformat(target_date)
    recent = []
    for i in range(1, days + 1):
        check_date = (target - dt.timedelta(days=i)).isoformat()
        url = f"{base_url.rstrip('/')}/digest?date={check_date}"
        try:
            payload, _ = json_request(url, timeout=timeout, insecure=insecure)
        except (urllib.error.URLError, json.JSONDecodeError):
            continue
        data = payload.get("data", {})
        if not data.get("exists"):
            continue
        run = data.get("run", {})
        deep_dive_topics = extract_deep_dive_topics(run.get("contentHtml", ""))
        recent.append(
            {
                "date": run.get("digestDate", check_date),
                "title": run.get("title", ""),
                "summary": run.get("summary", ""),
                "deepDiveTopics": deep_dive_topics,
                "contentHtml": run.get("contentHtml", ""),
            }
        )
    return recent


def write_output(data, output_path):
    rendered = json.dumps(data, ensure_ascii=False, indent=2)
    if output_path == "-":
        print(rendered)
        return
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(rendered + "\n")


def build_time_window(target_date: str, start_hour: int, end_hour: int) -> tuple[dt.datetime, dt.datetime]:
    date_value = dt.date.fromisoformat(target_date)
    window_end = dt.datetime.combine(date_value, dt.time(hour=end_hour), tzinfo=TARGET_TZ)
    if end_hour <= start_hour:
        window_start_date = date_value - dt.timedelta(days=1)
    else:
        window_start_date = date_value
    window_start = dt.datetime.combine(window_start_date, dt.time(hour=start_hour), tzinfo=TARGET_TZ)
    return window_start, window_end


def filter_articles_for_window(
    articles: list[dict[str, Any]],
    window_start: dt.datetime,
    window_end: dt.datetime,
) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for article in articles:
        created_at = article.get("createdAt")
        if not created_at:
            continue
        try:
            parsed = dt.datetime.fromisoformat(str(created_at))
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=TARGET_TZ)
        else:
            parsed = parsed.astimezone(TARGET_TZ)
        if window_start <= parsed < window_end:
            filtered.append(article)
    return filtered


def main() -> int:
    args = parse_args()
    target_date = parse_target_date(args.date)
    try:
        selected_articles, selected_urls = fetch_selected_articles(
            args.base_url, args.limit, args.max_pages, args.timeout, args.insecure
        )
        headlines_payload, headlines_url = fetch_headlines(
            args.base_url, args.timeout, args.insecure
        )
    except (urllib.error.URLError, json.JSONDecodeError) as exc:
        error_payload = {
            "status": "error",
            "targetDate": target_date,
            "reason": str(exc),
        }
        write_output(error_payload, args.out)
        return 1

    deduped_articles = dedupe_articles(selected_articles)
    window_start, window_end = build_time_window(
        target_date, args.window_start_hour, args.window_end_hour
    )
    filtered_articles = filter_articles_for_window(deduped_articles, window_start, window_end)
    if not filtered_articles:
        filtered_articles = deduped_articles

    if check_digest_exists(args.base_url, target_date, args.timeout, args.insecure):
        payload = {
            "status": "skip",
            "skipReason": "digest_already_exists",
            "targetDate": target_date,
            "articleCount": len(filtered_articles),
            "sourceArticleIds": [article["id"] for article in filtered_articles if article.get("id") is not None],
            "recentDigests": fetch_recent_digests(
                args.base_url, target_date, 7, args.timeout, args.insecure
            ),
            "articles": filtered_articles,
            "selectedArticlesEndpointUrls": selected_urls,
            "headlinesEndpointUrl": headlines_url,
            "headlinesPayload": headlines_payload,
            "window": {
                "start": window_start.isoformat(),
                "end": window_end.isoformat(),
            },
        }
        write_output(payload, args.out)
        return 0

    if len(filtered_articles) < args.min_articles:
        payload = {
            "status": "skip",
            "skipReason": "insufficient_articles",
            "targetDate": target_date,
            "articleCount": len(filtered_articles),
            "minArticles": args.min_articles,
            "sourceArticleIds": [article["id"] for article in filtered_articles if article.get("id") is not None],
            "articles": filtered_articles,
            "recentDigests": fetch_recent_digests(
                args.base_url, target_date, 7, args.timeout, args.insecure
            ),
            "selectedArticlesEndpointUrls": selected_urls,
            "headlinesEndpointUrl": headlines_url,
            "headlinesPayload": headlines_payload,
            "window": {
                "start": window_start.isoformat(),
                "end": window_end.isoformat(),
            },
        }
        write_output(payload, args.out)
        return 0

    payload = {
        "status": "ok",
        "targetDate": target_date,
        "articleCount": len(filtered_articles),
        "sourceArticleIds": [article["id"] for article in filtered_articles if article.get("id") is not None],
        "articles": filtered_articles,
        "recentDigests": fetch_recent_digests(
            args.base_url, target_date, 7, args.timeout, args.insecure
        ),
        "selectedArticlesEndpointUrls": selected_urls,
        "headlinesEndpointUrl": headlines_url,
        "headlinesPayload": headlines_payload,
        "window": {
            "start": window_start.isoformat(),
            "end": window_end.isoformat(),
        },
    }
    write_output(payload, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
