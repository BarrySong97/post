"use client";

/**
 * @purpose 博客正文图片组件:blur-up 渐进加载——thumbhash 平均色(瞬时)+ 模糊图打底,真图加载完 opacity 淡入盖上;点击放大走 <img> 灯箱,缩略图经 Motion React 的 layoutId 共享布局「原地放大」morph 进灯箱。
 * @role    MDX 中由 scripts/img.mjs 改写生成的 <BlogImage/>;经 mdx-content.tsx 的 components 注入,无需 MDX import。
 * @deps    react;motion/react(layoutId 共享布局动画);thumbhash(thumbHashToDataURL / thumbHashToAverageRGBA);../../lib/cn。
 * @gotcha  灯箱用普通 <img>(不走 WebGL:WebGL 取纹理需 CORS,R2 不发 CORS 头会黑屏)。放大转场用 layoutId(缩略图与灯箱图同一 React 树)→ 全浏览器可用。
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { thumbHashToDataURL, thumbHashToAverageRGBA } from "thumbhash";

import { cn } from "../../lib/cn";

interface BlogImageProps {
  src: string;
  alt: string;
  width: number;
  height: number;
  /** 脚本生成的 thumbhash(base64);缺省则退化为无占位 */
  thumbhash?: string;
  className?: string;
  /** 是否可点击放大查看,默认 true */
  zoomable?: boolean;
}

// 「原地放大 / 缩回」的共享布局过渡
const MORPH = { duration: 0.36, ease: [0.22, 1, 0.36, 1] as const };

function base64ToBytes(b64: string): Uint8Array {
  const bin =
    typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function BlogImage({
  src,
  alt,
  width,
  height,
  thumbhash,
  className,
  zoomable = true,
}: BlogImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const layoutId = useId(); // 缩略图 ↔ 灯箱图共享,唯一标识本实例

  // thumbhash → { 平均色(瞬时绘制,免白屏), 模糊图 dataURL }。SSR 与客户端都算,首帧即有占位。
  const placeholder = useMemo(() => {
    if (!thumbhash) return null;
    try {
      const bytes = base64ToBytes(thumbhash);
      const { r, g, b, a } = thumbHashToAverageRGBA(bytes);
      const avg = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
      return { avg, url: thumbHashToDataURL(bytes) };
    } catch {
      return null;
    }
  }, [thumbhash]);

  // 真图加载完成(含水合前已缓存命中的情况)→ 触发淡入
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) {
      setLoaded(true);
      return;
    }
    const onLoad = () => setLoaded(true);
    img.addEventListener("load", onLoad);
    return () => img.removeEventListener("load", onLoad);
  }, [src]);

  // Esc 关闭 + 锁页面滚动
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <figure
        className={cn("relative overflow-hidden rounded-md", className)}
        style={{
          aspectRatio: `${width}/${height}`,
          // 平均色瞬时绘制(无需解码,杜绝首帧白屏),模糊图随后盖上
          backgroundColor: placeholder?.avg,
          backgroundImage: placeholder ? `url(${placeholder.url})` : undefined,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* 真图加载完 opacity 0→1 淡入;灯箱打开时隐藏自身,morph 的是灯箱里的同 layoutId 图 */}
        <motion.img
          ref={imgRef}
          layoutId={layoutId}
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          onClick={zoomable ? () => setOpen(true) : undefined}
          className={cn(
            "h-full w-full object-cover transition-opacity duration-700 ease-out",
            open ? "opacity-0" : loaded ? "opacity-100" : "opacity-0",
            zoomable && "cursor-zoom-in",
          )}
        />
      </figure>

      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
            role="dialog"
            aria-modal="true"
            aria-label="图片查看器"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <button
              type="button"
              aria-label="关闭"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <motion.img
              layoutId={layoutId}
              src={src}
              alt={alt}
              onClick={(e) => e.stopPropagation()}
              transition={MORPH}
              className="max-h-full max-w-full cursor-zoom-out rounded-sm object-contain shadow-2xl"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
