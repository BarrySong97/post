/**
 * @purpose Import an X/Twitter post as a Markdown asset with related local media.
 * @role    Main-process workflow for resolution, idempotent Vault writes, and database relationships.
 * @deps    Twitter resolver, extension image/video import services, js-yaml, Drizzle, and background tasks.
 * @gotcha  Repeated saves replace only generated Markdown while preserving user frontmatter and notes.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { dump as dumpYaml, load as loadYaml } from "js-yaml";

import { schema, type TagRecord } from "@post/db";
import { backgroundTaskManager } from "../background-tasks";
import { getDatabase } from "../db";
import { getRequestedOrActiveVault } from "../repositories/vaults-repository";
import { saveExtensionImage } from "./extension-image-import-service";
import { saveExtensionVideo } from "./extension-video-import-service";
import {
  resolveTwitterPost,
  type ResolvedTwitterPost,
  type TwitterPostVisibleSnapshot,
} from "./twitter-post-resolver";

const POST_DIR = "assets/web-clips/posts";
const POST_MEDIA_DIR = "assets/web-clips/media";
const GENERATED_START = "<!-- post:generated:start -->";
const GENERATED_END = "<!-- post:generated:end -->";
const POST_SCHEMA_VERSION = 2;

export type SaveExtensionPostInput = {
  postId: string;
  canonicalUrl: string;
  pageUrl?: string;
  pageTitle?: string;
  capturedAt?: number;
  visibleSnapshot?: TwitterPostVisibleSnapshot;
  tagId?: string;
  vaultId?: string;
};

export type SaveExtensionPostResult = {
  assetId: string;
  fileId: string;
  tagId: string | null;
  vaultId: string;
  relativePath: string;
  title: string;
  status: "created" | "updated";
  childAssetIds: string[];
  warnings: string[];
};

type ImportedMedia = {
  kind: "image" | "video";
  assetId: string;
  relativePath: string;
  sourceUrl: string;
};

// Resolve an optional tag: null when none was chosen (post lands untagged in Inbox);
// throws only when a tag was requested but does not exist in the vault.
function resolveTag(tagId: string | undefined, vaultId: string): TagRecord | null {
  if (!tagId) {
    return null;
  }
  const tag = getDatabase()
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.id, tagId), eq(schema.tags.vaultId, vaultId)))
    .get();
  if (!tag) {
    throw new Error("Selected tag was not found in the active vault.");
  }
  return tag;
}

function normalizeFileStem(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "post"
  );
}

function postTitle(post: ResolvedTwitterPost) {
  const firstLine = post.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) {
    return firstLine.slice(0, 140);
  }
  if (post.authorHandle) {
    return `@${post.authorHandle} on X`;
  }
  return `X post ${post.postId}`;
}

function subjectNameFromPostInput(input: SaveExtensionPostInput): string {
  const snapshotText = input.visibleSnapshot?.text
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (snapshotText) {
    return snapshotText.slice(0, 140);
  }

  const handle = input.visibleSnapshot?.authorHandle?.trim();
  if (handle) {
    return `@${handle.replace(/^@/, "")}`;
  }

  return `X post ${input.postId}`;
}

function relativeMediaLink(postRelativePath: string, mediaRelativePath: string) {
  return path.posix.relative(path.posix.dirname(postRelativePath), mediaRelativePath);
}

function renderGeneratedBody(
  post: ResolvedTwitterPost,
  postRelativePath: string,
  media: ImportedMedia[],
  warnings: string[],
) {
  const sections: string[] = [];
  if (post.text) {
    sections.push(post.text);
  }

  for (const item of media) {
    const relativePath = relativeMediaLink(postRelativePath, item.relativePath);
    sections.push(
      item.kind === "image"
        ? `![Post image](${relativePath.replaceAll(" ", "%20")})`
        : `[Post video](${relativePath.replaceAll(" ", "%20")})`,
    );
  }

  if (post.quotedPost) {
    const quoteLines = [
      post.quotedPost.authorHandle
        ? `Quoted post by @${post.quotedPost.authorHandle}`
        : "Quoted post",
      post.quotedPost.text,
      post.quotedPost.url,
    ].filter((value): value is string => Boolean(value));
    sections.push(`## Quoted Post\n\n${quoteLines.map((line) => `> ${line}`).join("\n>\n")}`);
  }

  if (post.replyToUrl) {
    sections.push(`Replying to: ${post.replyToUrl}`);
  }

  if (post.poll) {
    const choices = post.poll.choices
      .map((choice) => `- ${choice.label}${choice.count === undefined ? "" : `: ${choice.count}`}`)
      .join("\n");
    const pollMeta = [
      post.poll.endsAt ? `Ends: ${post.poll.endsAt}` : undefined,
      post.poll.countsFinal === undefined
        ? undefined
        : `Counts final: ${post.poll.countsFinal ? "yes" : "no"}`,
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n");
    sections.push(`## Poll\n\n${choices}${pollMeta ? `\n\n${pollMeta}` : ""}`);
  }

  if (post.linkCard) {
    sections.push(
      [
        "## Link",
        post.linkCard.title ? `**${post.linkCard.title}**` : undefined,
        post.linkCard.description,
        post.linkCard.url,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n\n"),
    );
  }

  sections.push(`[View on X](${post.canonicalUrl})`);

  if (warnings.length > 0) {
    sections.push(`## Capture Warnings\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}`);
  }

  return `${GENERATED_START}\n${sections.join("\n\n")}\n${GENERATED_END}`;
}

function parseExistingMarkdown(raw: string | undefined) {
  if (!raw) {
    return { frontmatter: {} as Record<string, unknown>, suffix: "\n\n## Notes\n" };
  }

  let frontmatter: Record<string, unknown> = {};
  let body = raw;
  if (raw.startsWith("---\n") || raw.startsWith("---\r\n")) {
    const end = raw.indexOf("\n---", 3);
    if (end >= 0) {
      const parsed = loadYaml(raw.slice(3, end).trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        frontmatter = parsed as Record<string, unknown>;
      }
      body = raw.slice(end + 4).replace(/^\r?\n/, "");
    }
  }

  const generatedEnd = body.indexOf(GENERATED_END);
  if (generatedEnd >= 0) {
    const suffix = body.slice(generatedEnd + GENERATED_END.length);
    return { frontmatter, suffix: suffix || "\n\n## Notes\n" };
  }

  const preserved = body.trim();
  return {
    frontmatter,
    suffix: preserved ? `\n\n## Notes\n\n${preserved}\n` : "\n\n## Notes\n",
  };
}

export function mergePostMarkdown(
  existingRaw: string | undefined,
  post: ResolvedTwitterPost,
  relativePath: string,
  media: ImportedMedia[],
  warnings: string[],
) {
  const existing = parseExistingMarkdown(existingRaw);
  const ownedFrontmatter = {
    type: "x-post",
    title: postTitle(post),
    platform: "x",
    post_id: post.postId,
    source_url: post.canonicalUrl,
    author_name: post.authorName ?? null,
    author_handle: post.authorHandle ?? null,
    author_avatar_url: post.authorAvatarUrl ?? null,
    published_at: post.publishedAt?.toISOString() ?? null,
    captured_at: post.capturedAt.toISOString(),
    language: post.language ?? null,
    reply_to_post_id: post.replyToPostId ?? null,
    reply_to_url: post.replyToUrl ?? null,
    quoted_post_id: post.quotedPost?.postId ?? null,
    quoted_post_url: post.quotedPost?.url ?? null,
    reposted_by_handle: post.repostedByHandle ?? null,
    capture_status: warnings.length > 0 ? "partial" : "complete",
  };
  const frontmatter = { ...existing.frontmatter, ...ownedFrontmatter };
  const yaml = dumpYaml(frontmatter, { lineWidth: -1, noRefs: true, sortKeys: false }).trimEnd();
  const generated = renderGeneratedBody(post, relativePath, media, warnings);
  return `---\n${yaml}\n---\n\n${generated}${existing.suffix}`;
}

async function pathExists(absolutePath: string) {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function choosePostRelativePath(rootPath: string, post: ResolvedTwitterPost) {
  const date = (post.publishedAt ?? post.capturedAt).toISOString().slice(0, 10);
  const handle = normalizeFileStem(post.authorHandle ?? "x");
  const stem = `${date}-${handle}-${post.postId}`;
  for (let index = 0; ; index += 1) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const relativePath = path.posix.join(POST_DIR, `${stem}${suffix}.md`);
    if (!(await pathExists(path.join(rootPath, relativePath)))) {
      return relativePath;
    }
  }
}

function findExistingPost(vaultId: string, postId: string) {
  return getDatabase()
    .select({ asset: schema.assets, file: schema.assetFiles, post: schema.postCache })
    .from(schema.postCache)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.postCache.assetId))
    .innerJoin(schema.assetFiles, eq(schema.assetFiles.assetId, schema.assets.id))
    .where(
      and(
        eq(schema.postCache.vaultId, vaultId),
        eq(schema.postCache.platform, "x"),
        eq(schema.postCache.externalPostId, postId),
        isNull(schema.assets.deletedAt),
      ),
    )
    .get();
}

function findRelatedPostAssetId(vaultId: string, postId: string | undefined) {
  if (!postId) {
    return undefined;
  }
  return getDatabase()
    .select({ assetId: schema.postCache.assetId })
    .from(schema.postCache)
    .where(
      and(
        eq(schema.postCache.vaultId, vaultId),
        eq(schema.postCache.platform, "x"),
        eq(schema.postCache.externalPostId, postId),
      ),
    )
    .get()?.assetId;
}

async function importPostMedia(
  post: ResolvedTwitterPost,
  input: SaveExtensionPostInput,
  vaultId: string,
  taskId: string,
) {
  const imported: ImportedMedia[] = [];
  const warnings: string[] = [];
  const title = postTitle(post);

  for (const [index, media] of post.media.entries()) {
    backgroundTaskManager.updateTask(taskId, {
      progress: {
        current: index,
        total: post.media.length + 2,
        label: `Importing media ${index + 1} of ${post.media.length}`,
      },
    });
    try {
      const fileStem = `${post.postId}-${index + 1}`;
      const result =
        media.kind === "image"
          ? await saveExtensionImage({
              srcUrl: media.url,
              pageUrl: post.canonicalUrl,
              pageTitle: title,
              tagId: input.tagId,
              vaultId,
              destinationDir: POST_MEDIA_DIR,
              fileStem,
            })
          : await saveExtensionVideo({
              srcUrl: media.url,
              candidateUrls: media.candidateUrls,
              pageUrl: post.canonicalUrl,
              pageTitle: title,
              tagId: input.tagId,
              vaultId,
              destinationDir: POST_MEDIA_DIR,
              fileStem,
              hiddenTask: true,
            });
      imported.push({
        kind: media.kind,
        assetId: result.assetId,
        relativePath: result.relativePath,
        sourceUrl: media.url,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Media import failed.";
      warnings.push(`Media ${index + 1} was not downloaded: ${message} (${media.url})`);
    }
  }

  return { imported, warnings };
}

async function writePostFile(absolutePath: string, content: string) {
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const tempDir = await mkdtemp(path.join(path.dirname(absolutePath), ".post-import-"));
  const tempPath = path.join(tempDir, path.basename(absolutePath));
  try {
    await writeFile(tempPath, content, "utf8");
    await rename(tempPath, absolutePath);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function saveExtensionPost(
  input: SaveExtensionPostInput,
): Promise<SaveExtensionPostResult> {
  const vault = getRequestedOrActiveVault(input.vaultId);
  if (!vault) {
    throw new Error("No active vault selected.");
  }
  const tag = resolveTag(input.tagId, vault.id);
  const subjectName = subjectNameFromPostInput(input);
  const task = backgroundTaskManager.createTask({
    type: "import",
    title: "Importing X post",
    vaultId: vault.id,
    vaultName: vault.name,
    subject: { names: [subjectName], count: 1 },
    progress: { current: 0, label: "Resolving post" },
  });
  backgroundTaskManager.startTask(task.id);

  try {
    const post = await resolveTwitterPost({
      postId: input.postId,
      canonicalUrl: input.canonicalUrl,
      capturedAt: input.capturedAt,
      visibleSnapshot: input.visibleSnapshot,
    });
    const existing = findExistingPost(vault.id, post.postId);
    const relativePath =
      existing?.file.relativePath ?? (await choosePostRelativePath(vault.rootPath, post));
    const absolutePath = path.join(vault.rootPath, relativePath);
    const existingRaw =
      existing && (await pathExists(absolutePath))
        ? await readFile(absolutePath, "utf8")
        : undefined;

    const mediaResult = await importPostMedia(post, input, vault.id, task.id);
    const warnings = [...post.warnings, ...mediaResult.warnings];
    const content = mergePostMarkdown(
      existingRaw,
      post,
      relativePath,
      mediaResult.imported,
      warnings,
    );

    backgroundTaskManager.updateTask(task.id, {
      progress: {
        current: post.media.length + 1,
        total: post.media.length + 2,
        label: "Writing post",
      },
    });
    await writePostFile(absolutePath, content);
    const fileStat = await stat(absolutePath);
    const bytes = Buffer.byteLength(content, "utf8");
    const contentHash = createHash("sha256").update(content).digest("hex");
    const now = new Date();
    const title = postTitle(post);
    const excerpt = post.text.slice(0, 160);
    const assetId = existing?.asset.id ?? randomUUID();
    const fileId = existing?.file.id ?? randomUUID();
    const captureStatus = warnings.length > 0 ? "partial" : "complete";
    const mediaJson = JSON.stringify(
      post.media.map((item) => {
        const local = mediaResult.imported.find((candidate) => candidate.sourceUrl === item.url);
        return {
          ...item,
          localAssetId: local?.assetId,
          localPath: local?.relativePath,
        };
      }),
    );

    getDatabase().transaction((tx) => {
      if (existing) {
        tx.update(schema.assets)
          .set({
            kind: "post",
            title,
            description: excerpt || null,
            updatedAt: now,
            indexedAt: now,
            deletedAt: null,
          })
          .where(eq(schema.assets.id, assetId))
          .run();
        tx.update(schema.assetFiles)
          .set({
            relativePath,
            fileName: path.basename(relativePath),
            extension: "md",
            mimeType: "text/markdown",
            sizeBytes: bytes,
            mtimeMs: fileStat.mtime,
            contentHash,
            quickFingerprint: `${bytes}:${fileStat.mtimeMs}:md`,
            fileExists: true,
            missingSince: null,
            lastSeenAt: now,
          })
          .where(eq(schema.assetFiles.id, fileId))
          .run();
      } else {
        tx.insert(schema.assets)
          .values({
            id: assetId,
            vaultId: vault.id,
            kind: "post",
            status: "inbox",
            privacy: "normal",
            title,
            description: excerpt || null,
            createdAt: now,
            updatedAt: now,
            indexedAt: now,
          })
          .run();
        tx.insert(schema.assetFiles)
          .values({
            id: fileId,
            assetId,
            vaultId: vault.id,
            relativePath,
            fileName: path.basename(relativePath),
            extension: "md",
            mimeType: "text/markdown",
            sizeBytes: bytes,
            mtimeMs: fileStat.mtime,
            ctimeMs: fileStat.birthtime,
            contentHash,
            quickFingerprint: `${bytes}:${fileStat.mtimeMs}:md`,
            fileExists: true,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .run();
      }

      if (tag) {
        tx.insert(schema.assetTags)
          .values({ assetId, tagId: tag.id, createdAt: now })
          .onConflictDoNothing()
          .run();
      }

      tx.insert(schema.markdownCache)
        .values({
          assetId,
          vaultId: vault.id,
          title,
          excerpt,
          wordCount: post.text.split(/\s+/).filter(Boolean).length,
          headingsJson: "[]",
          outboundLinkCount: 1,
          inboundLinkCount: 0,
          parseStatus: "pending",
          parserVersion: "extension-post/1",
        })
        .onConflictDoUpdate({
          target: schema.markdownCache.assetId,
          set: {
            title,
            excerpt,
            wordCount: post.text.split(/\s+/).filter(Boolean).length,
            parseStatus: "pending",
            parserVersion: "extension-post/1",
          },
        })
        .run();

      const postCacheValues = {
        vaultId: vault.id,
        platform: "x",
        externalPostId: post.postId,
        canonicalUrl: post.canonicalUrl,
        text: post.text,
        authorName: post.authorName ?? null,
        authorHandle: post.authorHandle ?? null,
        authorAvatarUrl: post.authorAvatarUrl ?? null,
        publishedAt: post.publishedAt ?? null,
        capturedAt: post.capturedAt,
        language: post.language ?? null,
        replyToExternalId: post.replyToPostId ?? null,
        replyToUrl: post.replyToUrl ?? null,
        quotedExternalId: post.quotedPost?.postId ?? null,
        quotedUrl: post.quotedPost?.url ?? null,
        repostedByHandle: post.repostedByHandle ?? null,
        captureStatus,
        mediaJson,
        quotedPostJson: post.quotedPost ? JSON.stringify(post.quotedPost) : null,
        pollJson: post.poll ? JSON.stringify(post.poll) : null,
        linkCardJson: post.linkCard ? JSON.stringify(post.linkCard) : null,
        warningsJson: JSON.stringify(warnings),
        schemaVersion: POST_SCHEMA_VERSION,
        updatedAt: now,
      } as const;

      tx.insert(schema.postCache)
        .values({ assetId, ...postCacheValues })
        .onConflictDoUpdate({ target: schema.postCache.assetId, set: postCacheValues })
        .run();

      tx.delete(schema.assetLinks)
        .where(
          and(
            eq(schema.assetLinks.sourceAssetId, assetId),
            eq(schema.assetLinks.createdFrom, "manual"),
            inArray(schema.assetLinks.relationType, ["post_media", "reply_to", "quoted_post"]),
          ),
        )
        .run();

      for (const item of mediaResult.imported) {
        tx.insert(schema.assetLinks)
          .values({
            id: randomUUID(),
            vaultId: vault.id,
            sourceAssetId: assetId,
            targetAssetId: item.assetId,
            targetRef: item.relativePath,
            relationType: "post_media",
            targetKindHint: item.kind,
            resolvedStatus: "resolved",
            createdFrom: "manual",
            discoveredAt: now,
            updatedAt: now,
          })
          .run();
      }

      const externalRelations = [
        {
          type: "reply_to" as const,
          postId: post.replyToPostId,
          url: post.replyToUrl,
        },
        {
          type: "quoted_post" as const,
          postId: post.quotedPost?.postId,
          url: post.quotedPost?.url,
        },
      ];
      for (const relation of externalRelations) {
        if (!relation.url) {
          continue;
        }
        const targetAssetId = findRelatedPostAssetId(vault.id, relation.postId);
        tx.insert(schema.assetLinks)
          .values({
            id: randomUUID(),
            vaultId: vault.id,
            sourceAssetId: assetId,
            targetAssetId,
            targetRef: relation.url,
            relationType: relation.type,
            targetKindHint: "post",
            resolvedStatus: targetAssetId ? "resolved" : "unresolved",
            createdFrom: "manual",
            discoveredAt: now,
            updatedAt: now,
          })
          .run();
      }
    });

    backgroundTaskManager.completeTask(
      task.id,
      warnings.length > 0 ? `Imported ${title} with warnings` : `Imported ${title}`,
    );
    return {
      assetId,
      fileId,
      tagId: tag?.id ?? null,
      vaultId: vault.id,
      relativePath,
      title,
      status: existing ? "updated" : "created",
      childAssetIds: mediaResult.imported.map((item) => item.assetId),
      warnings,
    };
  } catch (error) {
    backgroundTaskManager.failTask(task.id, error);
    throw error;
  }
}
