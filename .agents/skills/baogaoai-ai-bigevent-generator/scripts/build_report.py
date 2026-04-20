#!/usr/bin/env python3
"""Normalize Native Codex draft output into /daily-events report payload."""

from __future__ import annotations

import argparse
import json
import re


ALLOWED_CATEGORIES = {
    "model_release",
    "product_launch",
    "funding",
    "ipo_ma",
    "policy",
    "milestone",
    "partnership",
    "talent",
    "open_source",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build daily-events report payload.")
    parser.add_argument("--context", required=True)
    parser.add_argument("--draft-file", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--result-out")
    return parser.parse_args()


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", "", (value or "").strip().lower())


def extract_json_object(raw: str):
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, flags=re.I)
    candidate = fenced.group(1).strip() if fenced else raw.strip()
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in draft output")
    return json.loads(candidate[start:end + 1])


def load_json(path: str):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def safe_summary(event: dict, article_lookup: dict[int, dict]) -> str:
    summary = (event.get("summary") or "").strip()
    if summary:
        return summary
    for article_id in event.get("sourceArticleIds") or []:
        article = article_lookup.get(int(article_id))
        if article and article.get("summary"):
            return article["summary"]
        if article and article.get("description"):
            return article["description"]
    raise ValueError("Missing summary and could not infer one from context")


def main() -> int:
    args = parse_args()
    context = load_json(args.context)
    draft = extract_json_object(open(args.draft_file, "r", encoding="utf-8").read())

    target_date = context["targetDate"]
    run_mode = context.get("runMode", "first")
    candidate_articles = context.get("candidateArticles") or []
    article_details = context.get("articleDetailsById") or {}
    article_lookup = {
        int(article["id"]): article
        for article in candidate_articles
        if article.get("id") is not None
    }
    for key, value in article_details.items():
        try:
            article_lookup[int(key)] = value
        except Exception:
            continue

    valid_article_ids = set(article_lookup.keys())
    valid_urls = {
        article.get("url")
        for article in article_lookup.values()
        if article.get("url")
    }
    same_day_titles = {normalize_text(event.get("title", "")) for event in (context.get("existingEvents") or {}).get("sameDay") or []}
    history_titles = {normalize_text(event.get("title", "")) for event in (context.get("existingEvents") or {}).get("last30Days") or []}

    incoming_events = draft.get("events") or []
    if not isinstance(incoming_events, list):
        raise ValueError("draft.events must be an array")

    kept_events = []
    seen_titles = set()
    skipped = 0

    for raw_event in incoming_events:
        if not isinstance(raw_event, dict):
            skipped += 1
            continue

        category = (raw_event.get("category") or "").strip()
        title = (raw_event.get("title") or "").strip()
        if category not in ALLOWED_CATEGORIES or not title:
            skipped += 1
            continue

        title_key = normalize_text(title)
        if title_key in seen_titles or title_key in history_titles or title_key in same_day_titles:
            skipped += 1
            continue

        source_ids = []
        for article_id in raw_event.get("sourceArticleIds") or []:
            try:
                parsed = int(article_id)
            except Exception:
                continue
            if parsed in valid_article_ids:
                source_ids.append(parsed)
        source_ids = sorted(set(source_ids))
        if not source_ids:
            skipped += 1
            continue

        source_urls = []
        for url in raw_event.get("sourceUrls") or []:
            if isinstance(url, str) and url in valid_urls:
                source_urls.append(url)
        if not source_urls:
            source_urls = [article_lookup[article_id].get("url") for article_id in source_ids if article_lookup.get(article_id, {}).get("url")]
        source_urls = sorted(set(filter(None, source_urls)))

        importance = raw_event.get("importance", 3)
        try:
            importance = int(importance)
        except Exception:
            importance = 3
        importance = max(1, min(5, importance))

        try:
            summary = safe_summary({**raw_event, "sourceArticleIds": source_ids}, article_lookup)
        except Exception:
            skipped += 1
            continue

        kept_events.append({
            "category": category,
            "title": title,
            "summary": summary,
            "importance": importance,
            "sourceArticleIds": source_ids,
            "sourceUrls": source_urls,
        })
        seen_titles.add(title_key)

    if not kept_events:
        result = {
            "status": "skip",
            "skipReason": "no_new_events_after_validation",
            "targetDate": target_date,
            "runMode": run_mode,
            "events": [],
            "notes": draft.get("notes") or "没有新的有效事件可上报。",
        }
    else:
        result = {
            "eventDate": target_date,
            "events": kept_events[:8],
            "notes": (draft.get("notes") or f"从 {context.get('articleCount', 0)} 篇候选文章中提炼 {len(kept_events[:8])} 个事件。").strip(),
        }

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)

    if args.result_out:
        with open(args.result_out, "w", encoding="utf-8") as fh:
            json.dump({
                "status": result.get("status", "ok"),
                "targetDate": target_date,
                "runMode": run_mode,
                "candidateCount": len(incoming_events),
                "keptCount": len(kept_events),
                "skippedCount": skipped,
            }, fh, ensure_ascii=False, indent=2)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
