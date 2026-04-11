"""
Scrapling-powered web scraping and search module for Vesper.

Three tiers:
  1. Fetcher    — fast stealthy HTTP (curl_cffi, no browser)
  2. Dynamic    — full JS rendering via Playwright (already installed)
  3. search()   — DuckDuckGo HTML search via Fetcher

All functions return plain text summaries suitable for LLM consumption.
"""

from __future__ import annotations
import re
import logging
from urllib.parse import urljoin, urlparse, quote_plus

logger = logging.getLogger(__name__)

_MAX_TEXT = 8000
_MAX_LINKS = 30
_MAX_RESULTS = 10


def _clean_text(text: str) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" {2,}", " ", text)
    return text.strip()


def _page_to_dict(page, url: str, selector: str | None = None) -> dict:
    """Extract structured data from a Scrapling page object."""
    title = ""
    try:
        title_el = page.css("title")
        if title_el:
            title = title_el[0].text or ""
    except Exception:
        pass

    # Body text
    body_text = ""
    try:
        for tag in ["script", "style", "noscript", "nav", "footer", "aside"]:
            for el in page.css(tag):
                try:
                    el.remove()
                except Exception:
                    pass
        body_text = page.get_text(strip=True, separator="\n") or ""
    except Exception:
        body_text = page.text or ""

    body_text = _clean_text(body_text)[:_MAX_TEXT]

    # Links
    links = []
    try:
        for a in page.css("a[href]")[:_MAX_LINKS]:
            href = a.attrib.get("href", "")
            if href and href.startswith("http"):
                label = (a.text or "").strip()[:80]
                links.append({"url": href, "label": label or href})
    except Exception:
        pass

    # Optional CSS selector extraction
    selected = []
    if selector:
        try:
            for el in page.css(selector):
                selected.append((el.text or "").strip())
        except Exception:
            pass

    return {
        "url": url,
        "title": title.strip(),
        "text": body_text,
        "links": links,
        "selected": selected,
    }


def _format_result(data: dict, selector: str | None = None) -> str:
    lines = [
        f"URL: {data['url']}",
        f"Title: {data['title']}",
        "",
        "=== CONTENT ===",
        data["text"],
    ]
    if selector and data.get("selected"):
        lines += ["", f"=== SELECTED ({selector}) ==="]
        for i, item in enumerate(data["selected"], 1):
            lines.append(f"{i}. {item}")
    if data.get("links"):
        lines += ["", "=== LINKS ==="]
        for lnk in data["links"]:
            lines.append(f"- [{lnk['label']}]({lnk['url']})")
    return "\n".join(lines)


# ─── Public API ───────────────────────────────────────────────────────────────

def scrape(url: str, selector: str | None = None, dynamic: bool = False) -> str:
    """
    Fetch and parse a URL. Returns a text summary.

    Args:
        url:      Full URL to scrape.
        selector: Optional CSS selector to extract specific elements.
        dynamic:  If True, use a headless browser for JS-heavy pages.
    """
    if dynamic:
        return _scrape_dynamic(url, selector)
    return _scrape_fast(url, selector)


def _scrape_fast(url: str, selector: str | None = None) -> str:
    """Tier-1: curl_cffi based, no browser, fast and stealthy."""
    try:
        from scrapling.fetchers import Fetcher

        page = Fetcher.get(url, stealthy_headers=True, timeout=15)
        data = _page_to_dict(page, url, selector)
        return _format_result(data, selector)
    except Exception as e:
        logger.warning(f"Fast scrape failed for {url}: {e} — retrying with dynamic")
        return _scrape_dynamic(url, selector)


def _scrape_dynamic(url: str, selector: str | None = None) -> str:
    """Tier-2: Playwright headless browser for JS-rendered pages."""
    try:
        from scrapling.fetchers import DynamicFetcher

        page = DynamicFetcher.fetch(
            url,
            headless=True,
            network_idle=True,
            timeout=25000,
        )
        data = _page_to_dict(page, url, selector)
        return _format_result(data, selector)
    except ImportError:
        return _scrape_playwright_fallback(url, selector)
    except Exception as e:
        logger.warning(f"Dynamic scrape failed for {url}: {e} — trying playwright fallback")
        return _scrape_playwright_fallback(url, selector)


def _scrape_playwright_fallback(url: str, selector: str | None = None) -> str:
    """Tier-3: raw Playwright fallback (already installed in Vesper for sessions)."""
    try:
        from playwright.sync_api import sync_playwright
        from config import find_chromium

        with sync_playwright() as p:
            exe = find_chromium()
            browser = p.chromium.launch(
                headless=True,
                executable_path=exe,
                args=["--no-sandbox", "--disable-setuid-sandbox",
                      "--disable-dev-shm-usage", "--disable-gpu"],
            )
            page = browser.new_page()
            try:
                page.goto(url, wait_until="networkidle", timeout=25000)
                title = page.title()
                text = page.evaluate(
                    "() => (document.body ? document.body.innerText : '').slice(0, 8000)"
                )
                text = _clean_text(text)

                links_raw = page.evaluate("""
                    () => Array.from(document.querySelectorAll('a[href]'))
                        .filter(a => a.href.startsWith('http'))
                        .slice(0, 30)
                        .map(a => ({ url: a.href, label: (a.innerText || '').trim().slice(0, 80) }))
                """)

                selected = []
                if selector:
                    selected = page.evaluate(f"""
                        () => Array.from(document.querySelectorAll('{selector}'))
                            .map(el => el.innerText.trim())
                    """)

                data = {
                    "url": url, "title": title, "text": text,
                    "links": links_raw, "selected": selected,
                }
                return _format_result(data, selector)
            finally:
                browser.close()
    except Exception as e:
        return f"✗ ERROR scraping {url}: {e}"


def search(query: str, num_results: int = 8) -> str:
    """
    Search DuckDuckGo HTML and return top results.

    Args:
        query:       Search query string.
        num_results: Number of results to return (max 10).
    """
    num_results = min(num_results, _MAX_RESULTS)
    ddg_url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"

    try:
        from scrapling.fetchers import Fetcher

        page = Fetcher.get(
            ddg_url,
            stealthy_headers=True,
            timeout=15,
            headers={"User-Agent": "Mozilla/5.0 (compatible; Vesper/1.0)"},
        )

        results = []
        for result in page.css(".result")[:num_results]:
            try:
                title_el = result.css(".result__title a")
                snippet_el = result.css(".result__snippet")
                url_el = result.css(".result__url")

                title = (title_el[0].text if title_el else "").strip()
                snippet = (snippet_el[0].text if snippet_el else "").strip()
                href = title_el[0].attrib.get("href", "") if title_el else ""
                display_url = (url_el[0].text if url_el else href).strip()

                if title and href:
                    results.append({
                        "title": title,
                        "url": display_url or href,
                        "snippet": snippet,
                        "href": href,
                    })
            except Exception:
                continue

        if not results:
            return f"No results found for: {query}"

        lines = [f"Search results for: {query}", ""]
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. {r['title']}")
            lines.append(f"   URL: {r['url']}")
            if r["snippet"]:
                lines.append(f"   {r['snippet']}")
            lines.append("")
        return "\n".join(lines)

    except Exception as e:
        return f"✗ ERROR searching '{query}': {e}"


def batch_scrape(urls: list[str], selector: str | None = None) -> str:
    """Scrape multiple URLs and return combined results."""
    results = []
    for url in urls[:5]:
        try:
            results.append(f"--- {url} ---\n{_scrape_fast(url, selector)}")
        except Exception as e:
            results.append(f"--- {url} ---\n✗ ERROR: {e}")
    return "\n\n".join(results)
