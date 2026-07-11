#!/usr/bin/env bash
#
# Insert real, web-sourced sample assets into a Post SQLite database, in the app's own
# storage format, under a "测试tag" tag. This is a pure data operation — it changes no app
# code. It downloads real content (photos, a GitHub OG card, an arXiv PDF, a real tweet's
# text) and runs the existing Rust indexer to produce real thumbnails + luma.
#
# Prerequisite: the target DB must be at the current schema. If yours is behind, launch the
# app once (it auto-migrates), quit it, then run this with the app CLOSED.
#
# Usage:  scripts/seed-real-test-assets.sh [DB_PATH]
# Default DB_PATH is the dev database under the Post userData dir.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Mirror the app's applyUserDataPath(): POST_USER_DATA_DIR, else <appData>/desktop
# (NOT <appData>/Post — the app overrides Electron's default userData dir).
USERDATA="${POST_USER_DATA_DIR:-$HOME/Library/Application Support/desktop}"
DB="${1:-$USERDATA/post-dev.sqlite}"
THUMB_ROOT="$USERDATA/thumbnails"
VAULT_ROOT="$USERDATA/test-vault"

echo "DB:          $DB"
echo "vault root:  $VAULT_ROOT"

# ---- 0. preflight: schema must be current ----------------------------------
for table in post_cache web_cache; do
  if ! sqlite3 "$DB" "SELECT 1 FROM $table LIMIT 1;" >/dev/null 2>&1; then
    echo "✗ $DB 缺表 '$table' —— 数据库未迁移到最新。" >&2
    echo "  请先启动一次 app(会自动迁移),退出后再运行本脚本。" >&2
    exit 1
  fi
done
if ! sqlite3 "$DB" "SELECT thumbnail_luma FROM image_cache LIMIT 0;" >/dev/null 2>&1; then
  echo "✗ image_cache 缺 thumbnail_luma 列 —— 请先启动一次 app 迁移。" >&2
  exit 1
fi

NOW="CAST(strftime('%s','now') AS INTEGER) * 1000"
sql() { sqlite3 "$DB" "$1"; }
q() { printf "%s" "$1" | sed "s/'/''/g"; }  # single-quote escape for SQL literals

# Average Rec. 601 luma (0-255) of an image, via a 1x1 downsample (sips averages all pixels).
# BMP stores the pixel as B G R after a 54-byte header; awk ignores od's leading whitespace.
image_luma() {
  local tmp; tmp="$(mktemp).bmp"
  sips -s format bmp -z 1 1 "$1" --out "$tmp" >/dev/null 2>&1 || { rm -f "$tmp"; return 1; }
  od -An -tu1 -j 54 -N 3 "$tmp" | awk '{ if ($3=="") exit 1; printf "%d", (77*$3 + 150*$2 + 29*$1)/256 }'
  rm -f "$tmp"
}

# ---- 1. sample files: real downloads ---------------------------------------
mkdir -p "$VAULT_ROOT"/{media,posts,web,docs,notes,links}

echo "→ downloading real photos, GitHub OG image, arXiv PDF …"
# Real photos from Lorem Picsum (deterministic ids: 1015 = bright river, 1050 = dark forest).
curl -fsSL -o "$VAULT_ROOT/media/river.jpg"  "https://picsum.photos/id/1015/1280/850"
curl -fsSL -o "$VAULT_ROOT/media/forest.jpg" "https://picsum.photos/id/1050/1280/850"
# Real public PDF: "Attention Is All You Need".
curl -fsSL -o "$VAULT_ROOT/docs/attention-is-all-you-need.pdf" "https://arxiv.org/pdf/1706.03762"

# Real GitHub repo → its live OG image + metadata (the web/OG card).
GH_URL="https://github.com/anthropics/claude-code"
GH_DOMAIN="github.com"
GH_TITLE="anthropics/claude-code"
GH_DESC="Claude Code is an agentic coding tool that lives in your terminal."
GH_OG="$(curl -fsSL "$GH_URL" | grep -ioE '<meta property="og:image" content="[^"]+"' | head -1 | sed -E 's/.*content="([^"]+)".*/\1/')"
echo "  github og:image = ${GH_OG:-<none>}"
printf '# %s\n\n%s\n' "$GH_TITLE" "$GH_URL" > "$VAULT_ROOT/web/claude-code.md"

# Real tweet (X blocks scraping; content transcribed from the public post).
TWEET_URL="https://twitter.com/karpathy/status/1885740687727808984"
TWEET_AUTHOR="Andrej Karpathy"
TWEET_HANDLE="@karpathy"
TWEET_TEXT="The hottest new programming language is English."
TWEET_DATE="1706400000000"  # 2024-01-28, the post's date, in ms
cat > "$VAULT_ROOT/posts/karpathy-english.md" <<MD
---
type: x-post
post_id: "1885740687727808984"
---

$TWEET_TEXT
MD

# Real note + spreadsheet + bookmark link (plain text, no download needed).
cat > "$VAULT_ROOT/notes/waterfall-virtualization.md" <<'MD'
# 瀑布流虚拟化的三个坑

列分配要用估算高度而不是测量高度，否则回滚时 lane 会跳。第二个坑是缩略图未就绪时的高度占位。第三个坑是滚动方向反转时的 overscan。
MD
printf 'date,subscribers\n2026-01,1204\n2026-02,1388\n2026-03,1591\n' > "$VAULT_ROOT/docs/subscribers.csv"
printf '[InternetShortcut]\nURL=https://www.inkandswitch.com/local-first/\n' > "$VAULT_ROOT/links/local-first.url"

# ---- 2. register the vault -------------------------------------------------
VAULT_ID="$(sql "SELECT id FROM vaults WHERE root_path = '$(q "$VAULT_ROOT")';")"
if [ -z "$VAULT_ID" ]; then
  VAULT_ID="$(uuidgen)"
  sql "INSERT INTO vaults (id,name,root_path,created_at,updated_at,last_opened_at,sync_status)
       VALUES ('$VAULT_ID','测试素材','$(q "$VAULT_ROOT")',$NOW,$NOW,$NOW,'idle');"
fi
echo "→ vault id = $VAULT_ID"

# ---- 3. let the real indexer create assets + thumbnails + luma --------------
echo "→ running indexer (scan + thumbnails) …"
INDEXER=(cargo run -q -p post-indexer --)
COMMON=(--vault-id "$VAULT_ID" --root-path "$VAULT_ROOT" --db-path "$DB" --thumbnail-root "$THUMB_ROOT")
( cd "$REPO" && "${INDEXER[@]}" scan "${COMMON[@]}" >/dev/null )
( cd "$REPO" && "${INDEXER[@]}" thumbnails "${COMMON[@]}" >/dev/null )

# ---- 4. post_cache for the tweet (indexer set kind=post but not the details) -
POST_ID="$(sql "SELECT id FROM assets WHERE vault_id='$VAULT_ID' AND kind='post' LIMIT 1;")"
if [ -n "$POST_ID" ]; then
  sql "INSERT OR REPLACE INTO post_cache
       (asset_id,vault_id,platform,external_post_id,canonical_url,text,author_name,author_handle,
        published_at,captured_at,capture_status,media_json,warnings_json,schema_version,updated_at)
       VALUES ('$POST_ID','$VAULT_ID','x','1885740687727808984','$(q "$TWEET_URL")',
        '$(q "$TWEET_TEXT")','$(q "$TWEET_AUTHOR")','$(q "$TWEET_HANDLE")',
        $TWEET_DATE,$NOW,'complete','[]','[]',1,$NOW);"
  echo "→ post_cache set for $POST_ID"
fi

# ---- 5. upgrade the scanned bookmark file into a web asset + OG cover --------
# The indexer already created an asset from web/claude-code.md (as markdown); convert that
# row in place to kind=web so there is no relative_path collision, then attach web_cache + OG.
WEB_ID="$(sql "SELECT a.id FROM assets a JOIN asset_files f ON f.asset_id=a.id
               WHERE a.vault_id='$VAULT_ID' AND f.relative_path='web/claude-code.md' LIMIT 1;")"
if [ -n "$WEB_ID" ]; then
  WEB_FILE_ID="$(sql "SELECT id FROM asset_files WHERE asset_id='$WEB_ID' LIMIT 1;")"
  sql "UPDATE assets SET kind='web', title='$(q "$GH_TITLE")', description='$(q "$GH_DESC")', updated_at=$NOW WHERE id='$WEB_ID';"
  sql "INSERT OR REPLACE INTO web_cache (asset_id,vault_id,url,domain,site_name,description,captured_at,updated_at)
       VALUES ('$WEB_ID','$VAULT_ID','$(q "$GH_URL")','$GH_DOMAIN','GitHub','$(q "$GH_DESC")',$NOW,$NOW);"
  if [ -n "${GH_OG:-}" ]; then
    mkdir -p "$THUMB_ROOT/$VAULT_ID"
    OG_PATH="$THUMB_ROOT/$VAULT_ID/$WEB_ID-og.png"
    if curl -fsSL -o "$OG_PATH" "$GH_OG"; then
      OG_DIMS="$(sips -g pixelWidth -g pixelHeight "$OG_PATH" 2>/dev/null | awk '/pixelWidth/{w=$2} /pixelHeight/{h=$2} END{print w" "h}')"
      OG_W="${OG_DIMS% *}"; OG_H="${OG_DIMS#* }"
      OG_LUMA="$(image_luma "$OG_PATH")"
      sql "INSERT OR REPLACE INTO image_cache
           (asset_id,vault_id,file_id,width,height,thumbnail_path,thumbnail_width,thumbnail_height,
            thumbnail_size_bytes,thumbnail_format,thumbnail_luma,status,updated_at)
           VALUES ('$WEB_ID','$VAULT_ID','$WEB_FILE_ID',${OG_W:-1200},${OG_H:-600},'$(q "$OG_PATH")',
            ${OG_W:-1200},${OG_H:-600},$(wc -c < "$OG_PATH" | tr -d ' '),'png',${OG_LUMA:-NULL},'ready',$NOW);"
      echo "→ web OG cover set (${OG_W:-?}x${OG_H:-?}, luma ${OG_LUMA:-null})"
    fi
  fi
fi

# ---- 5b. the .url bookmark: give it a display domain (link card, no cover) ---
LINK_ID="$(sql "SELECT a.id FROM assets a JOIN asset_files f ON f.asset_id=a.id
                WHERE a.vault_id='$VAULT_ID' AND f.relative_path='links/local-first.url' LIMIT 1;")"
if [ -n "$LINK_ID" ]; then
  sql "INSERT OR REPLACE INTO web_cache (asset_id,vault_id,url,domain,site_name,description,captured_at,updated_at)
       VALUES ('$LINK_ID','$VAULT_ID','https://www.inkandswitch.com/local-first/','inkandswitch.com','Ink & Switch',NULL,$NOW,$NOW);"
  sql "UPDATE assets SET title='Local-first software: you own your data' WHERE id='$LINK_ID';"
fi

# ---- 6. the shared "测试tag" tag on every seeded asset ----------------------
TAG_ID="$(sql "SELECT id FROM tags WHERE vault_id='$VAULT_ID' AND name='测试tag';")"
if [ -z "$TAG_ID" ]; then
  TAG_ID="$(uuidgen)"
  sql "INSERT INTO tags (id,vault_id,name,color,sort_order,created_at,updated_at)
       VALUES ('$TAG_ID','$VAULT_ID','测试tag','#c2410c',0,$NOW,$NOW);"
fi
sql "INSERT OR IGNORE INTO asset_tags (asset_id,tag_id,created_at)
     SELECT id,'$TAG_ID',$NOW FROM assets WHERE vault_id='$VAULT_ID' AND deleted_at IS NULL;"

COUNT="$(sql "SELECT count(*) FROM asset_tags at JOIN assets a ON a.id=at.asset_id
              WHERE at.tag_id='$TAG_ID' AND a.deleted_at IS NULL;")"
echo "✓ 完成：$COUNT 个真实资产已打上 '测试tag'（vault 测试素材）。启动 app 后点进该 tag 查看。"
