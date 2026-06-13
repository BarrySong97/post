export function buildAssetFileUrl(assetId: string, fileName: string) {
  return `post-file://asset/${encodeURIComponent(assetId)}/${encodeURIComponent(fileName)}`;
}

export function buildAssetThumbnailUrl(assetId: string, fileName: string) {
  return `post-file://thumb/${encodeURIComponent(assetId)}/${encodeURIComponent(fileName)}.jpg`;
}

export function buildVaultFileUrl(vaultId: string, relativePath: string) {
  const encoded = relativePath.split("/").map(encodeURIComponent).join("/");
  return `post-file://vault/${encodeURIComponent(vaultId)}/${encoded}`;
}

export function resolveMarkdownImageUrl(src: string | undefined, vaultId: string, fileDir: string): string {
  if (!src || /^(https?:|data:)/.test(src)) {
    return src ?? "";
  }

  const normalizeParts = (parts: string[]) => {
    const normalized: string[] = [];
    for (const part of parts) {
      if (part === "" || part === ".") {
        continue;
      }
      if (part === "..") {
        normalized.pop();
      } else {
        normalized.push(part);
      }
    }
    return normalized.join("/");
  };

  const base = fileDir ? fileDir.split("/") : [];
  const srcParts = src.startsWith("/") ? src.slice(1).split("/") : [...base, ...src.split("/")];
  return buildVaultFileUrl(vaultId, normalizeParts(srcParts));
}
