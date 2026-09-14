// GET /api/story?id=<uuid> — full story + chunks, for the book viewer and
// for polling generation progress.
import { supabase } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "id is required" });

  const { data: story, error: storyErr } = await supabase.from("stories").select("*").eq("id", id).single();
  if (storyErr) return res.status(404).json({ error: "Story not found" });

  const { data: chunks, error: chunksErr } = await supabase
    .from("chunks")
    .select("*")
    .eq("story_id", id)
    .order("order", { ascending: true });
  if (chunksErr) return res.status(500).json({ error: chunksErr.message });

  res.status(200).json({ story, chunks });
}
