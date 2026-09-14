// GET /api/image?path=<storyId>/<filename> — streams one image from the
// private "story-images" bucket. Images never get a public Supabase URL;
// they only ever reach the browser through this same password-gated route.
import { supabase } from "./_supabase.js";

const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const { path } = req.query;
  if (!path || typeof path !== "string" || path.includes("..")) {
    return res.status(400).json({ error: "invalid path" });
  }

  const { data, error } = await supabase.storage.from("story-images").download(path);
  if (error) return res.status(404).json({ error: "Image not found" });

  const ext = path.split(".").pop()?.toLowerCase() || "";
  const contentType = MIME_BY_EXT[ext] || "application/octet-stream";
  const buffer = Buffer.from(await data.arrayBuffer());

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.status(200).send(buffer);
}
