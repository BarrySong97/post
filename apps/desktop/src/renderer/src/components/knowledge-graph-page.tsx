import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Network } from "lucide-react";
import ForceGraph2D, { type NodeObject, type LinkObject, type ForceGraphMethods } from "react-force-graph-2d";
import { useNavigate } from "@tanstack/react-router";

import { trpc } from "@/lib/trpc";
import { PageChrome } from "@/components/app-layout";

type GraphNode = { id: string; title: string; kind: string; status: string };
type GraphEdge = { source: string; target: string; relationType: string };

const NODE_COLORS: Record<string, string> = {
  markdown: "#6366f1",
  image: "#10b981",
  video: "#f59e0b",
  link: "#3b82f6",
  web: "#06b6d4",
  file: "#94a3b8",
};

const LINK_COLORS: Record<string, string> = {
  wiki_link: "rgba(99,102,241,0.55)",
  embed: "rgba(16,185,129,0.45)",
  markdown_link: "rgba(59,130,246,0.45)",
  markdown_image: "rgba(245,158,11,0.4)",
  external_url: "rgba(148,163,184,0.3)",
};

export function KnowledgeGraphPage() {
  const navigate = useNavigate();

  const { data: graphData, isLoading } = useQuery({
    ...trpc.assets.graphData.queryOptions(),
    staleTime: 30_000,
  });

  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const hasFitRef = useRef(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, []);

  const forceGraphData = {
    nodes: (graphData?.nodes ?? []).map((n) => ({ ...n })) as NodeObject[],
    links: (graphData?.edges ?? []).map((e) => ({ ...e })) as LinkObject[],
  };

  const handleNodeClick = useCallback(
    (node: NodeObject) => {
      const id = (node as unknown as GraphNode).id;
      if (id) void navigate({ to: "/assets/$assetId", params: { assetId: id } });
    },
    [navigate],
  );

  const nodeColor = useCallback(
    (node: NodeObject) => NODE_COLORS[(node as unknown as GraphNode).kind] ?? "#94a3b8",
    [],
  );

  const linkColor = useCallback(
    (link: LinkObject) => LINK_COLORS[(link as unknown as GraphEdge).relationType] ?? "rgba(148,163,184,0.3)",
    [],
  );

  const nodeLabel = useCallback(
    (node: NodeObject) => (node as unknown as GraphNode).title ?? (node as unknown as GraphNode).id,
    [],
  );

  const nodeCount = graphData?.nodes.length ?? 0;
  const edgeCount = graphData?.edges.length ?? 0;

  const statsLabel = nodeCount > 0 ? `${nodeCount} 个节点 · ${edgeCount} 条链接` : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-50">
      <PageChrome>
        <h1 className="text-[15px] font-semibold tracking-normal text-zinc-950">知识图谱</h1>
        {statsLabel && <span className="text-xs text-zinc-400">{statsLabel}</span>}
      </PageChrome>
      <div ref={canvasRef} className="relative min-h-0 flex-1 w-full bg-zinc-50">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
            加载中…
          </div>
        )}
        {!isLoading && nodeCount === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-zinc-400">
            <Network size={32} className="text-zinc-300" />
            <span>当前资产库暂无链接数据</span>
          </div>
        )}
        {!isLoading && nodeCount > 0 && (
          <>
            <ForceGraph2D
              ref={graphRef}
              graphData={forceGraphData}
              width={canvasSize.width}
              height={canvasSize.height}
              nodeColor={nodeColor}
              nodeLabel={nodeLabel}
              nodeRelSize={5}
              warmupTicks={200}
              cooldownTicks={0}
              linkColor={linkColor}
              linkWidth={1.2}
              linkDirectionalArrowLength={4}
              linkDirectionalArrowRelPos={1}
              onNodeClick={handleNodeClick}
              backgroundColor="#f9fafb"
              onEngineStop={() => {
                if (!hasFitRef.current) {
                  hasFitRef.current = true;
                  const fg = graphRef.current;
                  if (!fg) return;
                  const bbox = fg.getGraphBbox();
                  const cx = (bbox.x[0] + bbox.x[1]) / 2;
                  const cy = (bbox.y[0] + bbox.y[1]) / 2;
                  const w = canvasRef.current?.clientWidth ?? canvasSize.width;
                  const h = canvasRef.current?.clientHeight ?? canvasSize.height;
                  const graphW = bbox.x[1] - bbox.x[0];
                  const graphH = bbox.y[1] - bbox.y[0];
                  const padding = 80;
                  const zoom = Math.min(
                    (w - padding * 2) / Math.max(graphW, 1),
                    (h - padding * 2) / Math.max(graphH, 1),
                    1.2,
                  );
                  fg.centerAt(cx, cy, 400);
                  fg.zoom(zoom, 400);
                }
              }}
              nodeCanvasObjectMode={() => "after"}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const label = (node as unknown as GraphNode).title ?? "";
                if (globalScale < 1.4) return;
                const fontSize = 10 / globalScale;
                ctx.font = `${fontSize}px Inter, sans-serif`;
                ctx.fillStyle = "rgba(63,63,70,0.85)";
                ctx.textAlign = "center";
                ctx.textBaseline = "top";
                ctx.fillText(label.slice(0, 24), node.x ?? 0, (node.y ?? 0) + 7);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
